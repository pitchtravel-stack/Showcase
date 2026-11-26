/**
 * RK Showcase · ผลงานระบบดิจิทัล โรงพยาบาลร้องกวาง
 * API สำหรับหน้าเว็บบน GitHub Pages — เข้าสู่ระบบด้วยอีเมล + รหัส OTP เท่านั้น
 * v1.0.0
 *
 * ติดตั้ง
 *  1) สร้าง Google Sheet ใหม่ → Extensions → Apps Script → วางไฟล์นี้เป็น Code.gs
 *  2) แก้ OWNER_EMAIL ด้านล่างเป็น Gmail ของผู้ดูแล แล้วกด Run ฟังก์ชัน setup (อนุญาตสิทธิ์ครั้งแรก)
 *  3) Deploy → New deployment → Web app · Execute as: Me · Who has access: Anyone
 *  4) คัดลอก URL ที่ลงท้าย /exec ไปใส่ API_URL ใน index.html
 */
const VERSION     = 'v1.0.0';
const OWNER_EMAIL = 'pimcha.st@gmail.com';   // ผู้ดูแลหลัก (ADMIN)
const APP_NAME    = 'RK Showcase';
const OTP_TTL_MIN = 10;      // รหัส OTP ใช้ได้กี่นาที
const SESSION_DAYS = 30;     // อยู่ในระบบได้กี่วันก่อนต้องขอรหัสใหม่
const IMG_FOLDER  = 'RK Showcase Images';

// tags = แท็ก (#) คั่นด้วยจุลภาค ใช้จัดกลุ่มและค้นหาผลงาน · order = ลำดับการแสดง
const SH = {
  P: { name: 'Projects', head: ['id','order','name','tagline','tags','status','summary','features','users','tech','link','linkLabel','repo','year','imageId','thumb','visible','updated'] },
  U: { name: 'Users',    head: ['email','name','role','active','note','lastLogin'] },
  C: { name: 'Config',   head: ['key','value','note'] },
  L: { name: 'Log',      head: ['time','email','action','detail'] },
};

/* ====================== setup ====================== */
function setup() {
  const ss = SpreadsheetApp.getActive();
  Object.values(SH).forEach(s => {
    let sh = ss.getSheetByName(s.name);
    if (!sh) sh = ss.insertSheet(s.name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, s.head.length).setValues([s.head]).setFontWeight('bold').setBackground('#e8eefc');
      sh.setFrozenRows(1);
    }
  });
  const u = ss.getSheetByName(SH.U.name);
  if (!readObjs_(SH.U).some(r => norm_(r.email) === norm_(OWNER_EMAIL))) {
    u.appendRow([norm_(OWNER_EMAIL), 'ผู้ดูแลระบบ', 'ADMIN', true, 'สร้างโดย setup', '']);
  }
  const c = ss.getSheetByName(SH.C.name);
  if (c.getLastRow() < 2) {
    c.getRange(2, 1, 3, 3).setValues([
      ['viewMode', 'list', 'list = เฉพาะอีเมลในแท็บ Users · any = อีเมลใดก็ได้เข้าชมได้'],
      ['siteTitle', 'ผลงานระบบดิจิทัล โรงพยาบาลร้องกวาง', 'หัวเรื่องบนหน้าเว็บ'],
      ['siteIntro', 'รวมระบบงานที่ทีมพัฒนาขึ้นเองเพื่อลดงานเอกสารและเชื่อมข้อมูลในโรงพยาบาล', 'คำโปรยหน้าแรก'],
    ]);
  }
  const p = ss.getSheetByName(SH.P.name);
  p.getRange('A:A').setNumberFormat('@');
  imgFolder_();
  ['Sheet1', 'แผ่น1'].forEach(n => { const s = ss.getSheetByName(n); if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s); });
  return 'setup เรียบร้อย ' + VERSION;
}

/* ====================== router ====================== */
const API = {
  apiPing, apiRequestOtp, apiVerifyOtp, apiLogout,
  apiBoot, apiImage, apiSaveProject, apiDeleteProject, apiRenameTag,
  apiUsers, apiSaveUser, apiDeleteUser, apiSaveConfig,
};

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
    return json_({ ok: false, error: err && err.message === 'AUTH' ? 'AUTH' : String(err && err.message || err) });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ====================== auth: email + OTP ====================== */
function apiPing() { return { ok: true, version: VERSION }; }

function apiRequestOtp(email) {
  email = norm_(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('รูปแบบอีเมลไม่ถูกต้อง');
  const user = findUser_(email);
  const mode = cfg_('viewMode', 'list');
  if (!user && mode !== 'any') { log_(email, 'login_denied', ''); throw new Error('อีเมลนี้ยังไม่ได้รับสิทธิ์เข้าชม กรุณาติดต่อผู้ดูแลระบบ'); }
  if (user && !truthy_(user.active)) throw new Error('บัญชีนี้ถูกปิดการใช้งาน');

  const cache = CacheService.getScriptCache();
  if (cache.get('otp_wait_' + email)) throw new Error('เพิ่งส่งรหัสไปแล้ว กรุณารอ 1 นาทีแล้วลองใหม่');
  const dayKey = 'otp_day_' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd');
  const sent = Number(cache.get(dayKey) || 0);
  if (sent >= 80) throw new Error('วันนี้ส่งรหัสครบโควตาแล้ว กรุณาลองใหม่พรุ่งนี้');

  const code = String(Math.floor(100000 + Math.random() * 900000));
  cache.put('otp_' + email, JSON.stringify({ h: hash_(code + email), n: 0 }), OTP_TTL_MIN * 60);
  cache.put('otp_wait_' + email, '1', 60);
  cache.put(dayKey, String(sent + 1), 6 * 3600);

  MailApp.sendEmail({
    to: email,
    subject: 'รหัสเข้าสู่ระบบ ' + APP_NAME + ': ' + code,
    htmlBody: '<div style="font-family:sans-serif;font-size:15px;color:#0f172a">'
      + '<p>รหัสเข้าสู่ระบบ <b>' + APP_NAME + '</b> ของท่านคือ</p>'
      + '<p style="font-size:30px;letter-spacing:6px;font-weight:700;color:#1d4ed8">' + code + '</p>'
      + '<p style="color:#64748b">รหัสใช้ได้ ' + OTP_TTL_MIN + ' นาที หากท่านไม่ได้ขอรหัสนี้ ไม่ต้องดำเนินการใด ๆ</p></div>',
    name: APP_NAME,
  });
  log_(email, 'otp_sent', '');
  return { ok: true, ttl: OTP_TTL_MIN };
}

function apiVerifyOtp(email, code) {
  email = norm_(email);
  const cache = CacheService.getScriptCache();
  const raw = cache.get('otp_' + email);
  if (!raw) throw new Error('รหัสหมดอายุ กรุณาขอรหัสใหม่');
  const o = JSON.parse(raw);
  if (o.n >= 5) { cache.remove('otp_' + email); throw new Error('ใส่รหัสผิดเกิน 5 ครั้ง กรุณาขอรหัสใหม่'); }
  if (hash_(String(code).trim() + email) !== o.h) {
    o.n++; cache.put('otp_' + email, JSON.stringify(o), OTP_TTL_MIN * 60);
    log_(email, 'otp_fail', '');
    throw new Error('รหัสไม่ถูกต้อง (เหลือ ' + (5 - o.n) + ' ครั้ง)');
  }
  cache.remove('otp_' + email);
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const exp = Date.now() + SESSION_DAYS * 864e5;
  PropertiesService.getScriptProperties().setProperty('s_' + hash_(token), JSON.stringify({ e: email, x: exp }));
  touchUser_(email);
  log_(email, 'login', '');
  cleanSessions_();
  return { ok: true, token: token, me: me_(email) };
}

function apiLogout(token) {
  if (token) PropertiesService.getScriptProperties().deleteProperty('s_' + hash_(token));
  return { ok: true };
}

function auth_(token, needAdmin) {
  if (!token) throw new Error('AUTH');
  const raw = PropertiesService.getScriptProperties().getProperty('s_' + hash_(token));
  if (!raw) throw new Error('AUTH');
  const s = JSON.parse(raw);
  if (s.x < Date.now()) { PropertiesService.getScriptProperties().deleteProperty('s_' + hash_(token)); throw new Error('AUTH'); }
  const u = findUser_(s.e);
  if (u && !truthy_(u.active)) throw new Error('AUTH');
  if (!u && cfg_('viewMode', 'list') !== 'any') throw new Error('AUTH');
  const m = me_(s.e);
  if (needAdmin && !m.admin) throw new Error('ต้องเป็นผู้ดูแลระบบ (ADMIN) จึงจะทำรายการนี้ได้');
  return m;
}

function me_(email) {
  const u = findUser_(email);
  return { email: email, name: (u && u.name) || email.split('@')[0], admin: !!u && String(u.role).toUpperCase() === 'ADMIN' };
}

function cleanSessions_() {
  const props = PropertiesService.getScriptProperties(), all = props.getProperties(), now = Date.now();
  Object.keys(all).forEach(k => { if (k.indexOf('s_') === 0) { try { if (JSON.parse(all[k]).x < now) props.deleteProperty(k); } catch (e) { props.deleteProperty(k); } } });
}

/* ====================== data ====================== */
function apiBoot(token) {
  const me = auth_(token);
  let projects = readObjs_(SH.P).filter(p => p.id);
  if (!me.admin) projects = projects.filter(p => truthy_(p.visible));
  projects = projects.map(cleanProject_).sort((a, b) => (a.order || 999) - (b.order || 999));
  return {
    ok: true, me: me, version: VERSION, projects: projects,
    site: { title: cfg_('siteTitle', 'ผลงานระบบดิจิทัล'), intro: cfg_('siteIntro', ''), viewMode: cfg_('viewMode', 'list') },
  };
}

function cleanProject_(p) {
  return {
    id: String(p.id), order: Number(p.order) || 0, name: s_(p.name), tagline: s_(p.tagline), tags: tags_(p.tags),
    status: s_(p.status), summary: s_(p.summary), features: s_(p.features), users: s_(p.users), tech: s_(p.tech),
    link: s_(p.link), linkLabel: s_(p.linkLabel), repo: s_(p.repo), year: s_(p.year),
    hasImage: !!p.imageId, thumb: s_(p.thumb), visible: truthy_(p.visible), updated: p.updated ? new Date(p.updated).toISOString() : '',
  };
}

/** รูปเต็มของผลงาน (ส่งเป็น data URL เพราะหน้าเว็บอยู่คนละโดเมนกับ Drive) */
function apiImage(token, id) {
  auth_(token);
  const p = readObjs_(SH.P).find(r => String(r.id) === String(id));
  if (!p || !p.imageId) return { ok: true, src: '' };
  const b = DriveApp.getFileById(p.imageId).getBlob();
  return { ok: true, src: 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes()) };
}

function apiSaveProject(token, p) {
  const me = auth_(token, true);
  if (!s_(p.name)) throw new Error('กรุณาใส่ชื่อผลงาน');
  if (p.link && !/^https?:\/\//i.test(p.link)) throw new Error('ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://');
  if (p.thumb && String(p.thumb).length > 48000) throw new Error('รูปย่อมีขนาดใหญ่เกินไป');
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = sheet_(SH.P), rows = readObjs_(SH.P);
    let idx = p.id ? rows.findIndex(r => String(r.id) === String(p.id)) : -1;
    const old = idx >= 0 ? rows[idx] : {};
    const rec = Object.assign({}, old, {
      id: old.id || ('P' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyMMddHHmmss')),
      order: Number(p.order) > 0 ? Math.floor(Number(p.order)) : (old.order || (rows.reduce((m, r) => Math.max(m, Number(r.order) || 0), 0) + 1)),
      name: s_(p.name), tagline: s_(p.tagline), tags: tags_(p.tags), status: s_(p.status),
      summary: s_(p.summary), features: s_(p.features), users: s_(p.users), tech: s_(p.tech),
      link: s_(p.link), linkLabel: s_(p.linkLabel), repo: s_(p.repo), year: s_(p.year),
      visible: p.visible !== false, updated: new Date(),
    });
    if (p.image === 'remove') { trashImg_(old.imageId); rec.imageId = ''; rec.thumb = ''; }
    else if (p.image && /^data:image\//.test(p.image)) {
      trashImg_(old.imageId);
      const m = p.image.match(/^data:(image\/[\w+]+);base64,(.+)$/);
      const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], rec.id + '.' + (m[1].split('/')[1] || 'jpg'));
      rec.imageId = imgFolder_().createFile(blob).getId();
      rec.thumb = s_(p.thumb);
    }
    const line = SH.P.head.map(k => rec[k] === undefined ? '' : rec[k]);
    if (idx >= 0) sh.getRange(idx + 2, 1, 1, line.length).setValues([line]);
    else sh.appendRow(line);
    log_(me.email, idx >= 0 ? 'project_edit' : 'project_add', rec.name);
    return { ok: true, project: cleanProject_(rec) };
  } finally { lock.releaseLock(); }
}

function apiDeleteProject(token, id) {
  const me = auth_(token, true);
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const rows = readObjs_(SH.P), idx = rows.findIndex(r => String(r.id) === String(id));
    if (idx < 0) throw new Error('ไม่พบรายการ');
    trashImg_(rows[idx].imageId);
    sheet_(SH.P).deleteRow(idx + 2);
    log_(me.email, 'project_delete', rows[idx].name);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

/** เปลี่ยนชื่อแท็กในทุกผลงาน (to ว่าง = ลบแท็กนี้ออกจากทุกผลงาน) */
function apiRenameTag(token, from, to) {
  const me = auth_(token, true);
  from = tags_(from); to = tags_(to);
  if (!from) throw new Error('ไม่ระบุแท็ก');
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = sheet_(SH.P), rows = readObjs_(SH.P), col = SH.P.head.indexOf('tags') + 1;
    let n = 0;
    rows.forEach((r, i) => {
      const list = tags_(r.tags).split(', ').filter(Boolean);
      if (!list.some(t => t.toLowerCase() === from.toLowerCase())) return;
      const next = list.map(t => (t.toLowerCase() === from.toLowerCase() ? to : t)).filter(Boolean);
      sh.getRange(i + 2, col).setValue(tags_(next.join(','))); n++;
    });
    log_(me.email, 'tag_rename', from + ' → ' + (to || '(ลบ)') + ' · ' + n + ' รายการ');
    return Object.assign(apiBoot(token), { changed: n });
  } finally { lock.releaseLock(); }
}

/* ====================== users & config (ADMIN) ====================== */
function apiUsers(token) {
  auth_(token, true);
  return { ok: true, users: readObjs_(SH.U).filter(u => u.email).map(u => ({ email: norm_(u.email), name: s_(u.name), role: String(u.role || 'VIEWER').toUpperCase(), active: truthy_(u.active), note: s_(u.note), lastLogin: u.lastLogin ? new Date(u.lastLogin).toISOString() : '' })), viewMode: cfg_('viewMode', 'list') };
}

function apiSaveUser(token, u, oldEmail) {
  const me = auth_(token, true);
  const email = norm_(u.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('รูปแบบอีเมลไม่ถูกต้อง');
  const role = u.role === 'ADMIN' ? 'ADMIN' : 'VIEWER';
  const sh = sheet_(SH.U), rows = readObjs_(SH.U);
  const key = norm_(oldEmail || email);
  const idx = rows.findIndex(r => norm_(r.email) === key);
  if (oldEmail && norm_(oldEmail) !== email && rows.some(r => norm_(r.email) === email)) throw new Error('มีอีเมลนี้อยู่แล้ว');
  if (!oldEmail && idx >= 0) throw new Error('มีอีเมลนี้อยู่แล้ว');
  if (norm_(key) === norm_(me.email) && (role !== 'ADMIN' || u.active === false)) throw new Error('ไม่สามารถลดสิทธิ์หรือปิดบัญชีของตัวเองได้');
  const line = [email, s_(u.name), role, u.active !== false, s_(u.note), idx >= 0 ? rows[idx].lastLogin : ''];
  if (idx >= 0) sh.getRange(idx + 2, 1, 1, line.length).setValues([line]); else sh.appendRow(line);
  log_(me.email, idx >= 0 ? 'user_edit' : 'user_add', email);
  return apiUsers(token);
}

function apiDeleteUser(token, email) {
  const me = auth_(token, true);
  if (norm_(email) === norm_(me.email)) throw new Error('ไม่สามารถลบบัญชีของตัวเองได้');
  const rows = readObjs_(SH.U), idx = rows.findIndex(r => norm_(r.email) === norm_(email));
  if (idx >= 0) sheet_(SH.U).deleteRow(idx + 2);
  log_(me.email, 'user_delete', email);
  return apiUsers(token);
}

function apiSaveConfig(token, c) {
  const me = auth_(token, true);
  const allowed = { viewMode: v => (v === 'any' ? 'any' : 'list'), siteTitle: s_, siteIntro: s_ };
  Object.keys(c || {}).forEach(k => { if (allowed[k]) setCfg_(k, allowed[k](c[k])); });
  log_(me.email, 'config', JSON.stringify(c));
  return { ok: true };
}

/* ====================== helpers ====================== */
function sheet_(s) { const sh = SpreadsheetApp.getActive().getSheetByName(s.name); if (!sh) throw new Error('ไม่พบแท็บ ' + s.name + ' — กรุณา Run setup'); return sh; }
function readObjs_(s) {
  const sh = SpreadsheetApp.getActive().getSheetByName(s.name);
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getRange(1, 1, sh.getLastRow(), Math.max(sh.getLastColumn(), s.head.length)).getValues();
  const h = v[0].map(x => String(x).trim());
  return v.slice(1).map(r => { const o = {}; h.forEach((k, i) => { if (k) o[k] = r[i]; }); return o; });
}
function findUser_(email) { return readObjs_(SH.U).find(r => norm_(r.email) === norm_(email)); }
function touchUser_(email) {
  const rows = readObjs_(SH.U), i = rows.findIndex(r => norm_(r.email) === norm_(email));
  if (i >= 0) sheet_(SH.U).getRange(i + 2, SH.U.head.indexOf('lastLogin') + 1).setValue(new Date());
}
function cfg_(k, d) { const r = readObjs_(SH.C).find(x => x.key === k); return r && r.value !== '' ? String(r.value) : d; }
function setCfg_(k, v) {
  const sh = sheet_(SH.C), rows = readObjs_(SH.C), i = rows.findIndex(x => x.key === k);
  if (i >= 0) sh.getRange(i + 2, 2).setValue(v); else sh.appendRow([k, v, '']);
}
function log_(email, action, detail) {
  try { const sh = SpreadsheetApp.getActive().getSheetByName(SH.L.name); if (sh) sh.appendRow([new Date(), email, action, String(detail || '').slice(0, 300)]); } catch (e) {}
}
function imgFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('imgFolder');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const f = DriveApp.createFolder(IMG_FOLDER);
  props.setProperty('imgFolder', f.getId());
  return f;
}
function trashImg_(id) { if (id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {} } }
function hash_(s) { return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)); }
/** ทำแท็กให้เป็นรูปแบบเดียว: ตัด # ช่องว่างหัวท้าย ตัดซ้ำ แล้วคั่นด้วย ', ' */
function tags_(v) {
  const seen = {}, out = [];
  String(v || '').split(/[,\n#]+/).map(t => t.trim().replace(/\s+/g, ' ')).filter(Boolean).forEach(t => { const k = t.toLowerCase(); if (!seen[k]) { seen[k] = 1; out.push(t.slice(0, 40)); } });
  return out.join(', ');
}
function norm_(e) { return String(e || '').trim().toLowerCase(); }
function s_(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function truthy_(v) { return v === true || /^(true|yes|1|y|ใช่)$/i.test(String(v).trim()); }
