/**
 * PunProject · ทะเบียนโปรเจกต์ รพ.ร้องกวาง
 * v1.6.0 — หน้าเว็บย้ายไป GitHub Pages · ไฟล์นี้เป็น API · เข้าสู่ระบบด้วย Gmail + OTP (อยู่ในระบบได้ 4 ชั่วโมง)
 * วิธีใช้: เปิด Google Sheet PunProject > Extensions > Apps Script
 *          วางไฟล์นี้แทน Code.gs เดิม (ไฟล์ Index.html ใน Apps Script ไม่ใช้แล้ว ลบได้)
 *          Deploy > New deployment > Web app
 *          Execute as: Me · Who has access: Anyone
 *          แล้วนำ URL ที่ลงท้าย /exec ไปใส่ API_URL ใน index.html บน GitHub
 */
const SHEET_ID   = '';        // ว่าง = ใช้ Spreadsheet ที่ผูกกับ script นี้
const SHEET_NAME = 'Sheet1';  // ชื่อแท็บที่เก็บรายการ (ถ้าไม่พบจะใช้แท็บแรก)
const VERSION    = 'v1.6.0';
const APP_NAME   = 'PunProject';

// อีเมลที่เข้าระบบได้ (ข้อมูลมีรหัสผ่าน จึงให้เฉพาะอีเมลในรายการนี้)
const ALLOWED_EMAILS = ['pimcha.st@gmail.com'];
const OTP_TTL_MIN   = 10;        // รหัส OTP ใช้ได้กี่นาที
const SESSION_HOURS = 4;         // อยู่ในระบบได้กี่ชั่วโมง (สูงสุด 6 ตามข้อจำกัดของ CacheService)

/* ====================== API (เรียกจากหน้าเว็บบน GitHub Pages) ====================== */
const API = { apiPing, apiRequestOtp, apiVerifyOtp, apiLogout, apiRows, apiSave };

function doGet() {
  return json_({ ok: true, app: APP_NAME, version: VERSION });
}

function doPost(e) {
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const fn = API[req.fn];
    if (!fn) return json_({ ok: false, error: 'ไม่รู้จักคำสั่ง ' + req.fn });
    return json_(fn.apply(null, req.args || []));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function apiPing() { return { ok: true, version: VERSION }; }

function apiRequestOtp(email) {
  email = norm_(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('รูปแบบอีเมลไม่ถูกต้อง');
  if (!allowed_(email)) { log_(email, 'login_denied'); throw new Error('อีเมลนี้ไม่มีสิทธิ์เข้าระบบ'); }
  const cache = CacheService.getScriptCache();
  if (cache.get('otp_wait_' + email)) throw new Error('เพิ่งส่งรหัสไปแล้ว กรุณารอ 1 นาทีแล้วลองใหม่');
  const code = String(Math.floor(100000 + Math.random() * 900000));
  cache.put('otp_' + email, JSON.stringify({ h: hash_(code + email), n: 0 }), OTP_TTL_MIN * 60);
  cache.put('otp_wait_' + email, '1', 60);
  MailApp.sendEmail({
    to: email, name: APP_NAME,
    subject: 'รหัสเข้าสู่ระบบ ' + APP_NAME + ': ' + code,
    htmlBody: '<div style="font-family:sans-serif;font-size:15px;color:#0f172a"><p>รหัสเข้าสู่ระบบ <b>' + APP_NAME + '</b></p>'
      + '<p style="font-size:30px;letter-spacing:6px;font-weight:700;color:#4f46e5">' + code + '</p>'
      + '<p style="color:#64748b">ใช้ได้ ' + OTP_TTL_MIN + ' นาที · หากไม่ได้ขอรหัสนี้ ไม่ต้องทำอะไร</p></div>',
  });
  log_(email, 'otp_sent');
  return { ok: true };
}

function apiVerifyOtp(email, code) {
  email = norm_(email);
  if (!allowed_(email)) throw new Error('อีเมลนี้ไม่มีสิทธิ์เข้าระบบ');
  const cache = CacheService.getScriptCache();
  const raw = cache.get('otp_' + email);
  if (!raw) throw new Error('รหัสหมดอายุ กรุณาขอรหัสใหม่');
  const o = JSON.parse(raw);
  if (o.n >= 5) { cache.remove('otp_' + email); throw new Error('ใส่รหัสผิดเกิน 5 ครั้ง กรุณาขอรหัสใหม่'); }
  if (hash_(String(code).trim() + email) !== o.h) {
    o.n++; cache.put('otp_' + email, JSON.stringify(o), OTP_TTL_MIN * 60);
    log_(email, 'otp_fail');
    throw new Error('รหัสไม่ถูกต้อง (เหลือ ' + (5 - o.n) + ' ครั้ง)');
  }
  cache.remove('otp_' + email);
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const ttl = Math.min(SESSION_HOURS, 6) * 3600;
  cache.put('s_' + hash_(token), email, ttl);
  log_(email, 'login');
  return { ok: true, token: token, email: email, exp: Date.now() + ttl * 1000 };
}

function apiLogout(token) {
  if (token) CacheService.getScriptCache().remove('s_' + hash_(token));
  return { ok: true };
}

function apiRows(token) { auth_(token); return { ok: true, rows: getRows_(), version: VERSION }; }

function apiSave(token, p) {
  const email = auth_(token);
  const rows = saveProject_(p);
  log_(email, p && p.row ? 'edit' : 'add', p && p.name);
  return { ok: true, rows: rows, version: VERSION };
}

function auth_(token) {
  const email = token && CacheService.getScriptCache().get('s_' + hash_(token));
  if (!email || !allowed_(email)) throw new Error('AUTH');
  return email;
}
function allowed_(email) { return ALLOWED_EMAILS.map(norm_).indexOf(norm_(email)) >= 0; }
function hash_(s) { return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)); }
function norm_(e) { return String(e || '').trim().toLowerCase(); }
function log_(email, action, detail) {
  try {
    const ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName('Log');
    if (!sh) { sh = ss.insertSheet('Log', ss.getNumSheets()); sh.appendRow(['time', 'email', 'action', 'detail']); }
    sh.appendRow([new Date(), email, action, String(detail || '').slice(0, 200)]);
  } catch (e) {}
}

/* ====================== Sheet (ฟังก์ชันเดิม — เรียกผ่าน API ที่ตรวจสิทธิ์แล้วเท่านั้น) ====================== */
/** ส่งข้อมูลทั้งแท็บ (รวมแถวหัวตาราง) ให้หน้าเว็บ */
function getSheet_() {
  const ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
}

function getRows_() {
  return getSheet_().getDataRange().getDisplayValues();
}

/**
 * เพิ่ม (p.row = 0) หรือแก้ไข (p.row = เลขแถว) โปรเจกต์
 * เขียนเฉพาะคอลัมน์ที่รู้จัก — คอลัมน์อื่น/สูตรในแถวเดิมไม่ถูกแตะ
 */
function saveProject_(p) {
  if (!p || !String(p.name || '').trim()) throw new Error('ต้องมีชื่อโปรเจกต์');
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = getSheet_();
    const lastCol = Math.max(sh.getLastColumn(), 1);
    const head = sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(x => String(x).trim().toLowerCase());
    const find = (...k) => head.findIndex(c => k.some(x => c.startsWith(x)));

    let iCat = find('category', 'หมวด');
    if (iCat < 0 && p.cat) {               // สร้างคอลัมน์ Category ครั้งแรกที่มีการเลือกหมวด
      iCat = head.length;
      sh.getRange(1, iCat + 1, sh.getMaxRows(), 1).clearDataValidations();
      sh.getRange(1, iCat + 1).setValue('Category');
    }
    const map = {
      no: find('no', 'ลำดับ'), name: find('project', 'ชื่อ'), sheet: find('sheet'),
      pw: find('password', 'รหัส'), rm: find('remark', 'หมายเหตุ'),
      wa: find('webapp', 'web app'), type: find('type', 'ประเภท'), cat: iCat
    };
    if (map.name < 0) throw new Error('ไม่พบคอลัมน์ Project ในแถวหัวตาราง');

    let row = Number(p.row) || 0;
    if (row) {
      // หาแถวจริงจากชื่อเดิม (กันแก้ผิดแถวถ้ามีการแทรก/ลบแถวใน Sheet)
      const norm = v => String(v || '').replace(/\s+/g, ' ').trim();
      const want = norm(p.origName);
      const last = sh.getLastRow();
      if (norm(row <= last ? sh.getRange(row, map.name + 1).getDisplayValue() : '') !== want) {
        const names = sh.getRange(1, map.name + 1, last, 1).getDisplayValues().map(r => norm(r[0]));
        const hits = names.map((n, i) => n === want ? i + 1 : 0).filter(Boolean);
        if (hits.length !== 1)
          throw new Error(hits.length ? 'พบชื่อนี้ซ้ำหลายแถว กรุณาแก้ใน Sheet โดยตรง'
                                      : 'ไม่พบแถวเดิมใน Sheet กรุณากด "โหลดข้อมูลใหม่" แล้วลองอีกครั้ง');
        row = hits[0];
      }
    } else {
      row = sh.getLastRow() + 1;
    }
    Object.keys(map).forEach(k => {
      const col = map[k];
      if (col < 0 || p[k] === undefined) return;
      const cell = sh.getRange(row, col + 1);
      if (k === 'no') cell.setNumberFormat('@'); // กัน 13.10 กลายเป็น 13.1
      let v = fitList_(cell, String(p[k] || ''));
      if (v === null && k === 'cat') {        // คอลัมน์ Category เป็นของระบบ: ล้าง dropdown ที่ติดมา
        sh.getRange(2, col + 1, sh.getMaxRows() - 1, 1).clearDataValidations();
        v = String(p[k] || '');
      }
      if (v === null) throw new Error('ค่า "' + p[k] + '" ไม่อยู่ใน dropdown ของคอลัมน์ "' +
        sh.getRange(1, col + 1).getDisplayValue() + '" (แถว ' + row + ')');
      cell.setValue(v);
    });
    SpreadsheetApp.flush();
    return getRows_();
  } finally {
    lock.releaseLock();
  }
}

/** ถ้าเซลล์มี dropdown ให้จับคู่ค่าแบบไม่สนตัวพิมพ์เล็ก/ใหญ่ (เช่น AppSheet → Appsheet); ไม่เข้าเงื่อนไข = null */
function fitList_(cell, v) {
  if (v === '') return v;
  const dv = cell.getDataValidation();
  if (!dv || dv.getCriteriaType() !== SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) return v;
  const list = (dv.getCriteriaValues()[0] || []).map(String);
  const hit = list.find(x => x.trim().toLowerCase() === v.trim().toLowerCase());
  return hit === undefined ? null : hit;
}
