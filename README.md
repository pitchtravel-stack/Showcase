# PunProject — ทะเบียนโปรเจกต์ รพ.ร้องกวาง

- หน้าเว็บ: `index.html` (GitHub Pages)
- API: `gas/Code.gs` (Apps Script ใน Google Sheet PunProject)
- เข้าสู่ระบบด้วย Gmail + รหัส OTP · อยู่ในระบบได้ 4 ชั่วโมง
- เฉพาะอีเมลใน `ALLOWED_EMAILS` (ใน Code.gs) เท่านั้นที่เข้าได้
- repo นี้ไม่มีข้อมูลโปรเจกต์หรือรหัสผ่าน ข้อมูลทั้งหมดอยู่ใน Google Sheet

## ติดตั้ง
1. เปิด Sheet PunProject → Extensions → Apps Script → วาง `gas/Code.gs` แทนไฟล์เดิม (ลบไฟล์ Index เดิมได้)
2. Deploy → New deployment → Web app · Execute as **Me** · Who has access **Anyone**
3. ใส่ URL ที่ลงท้าย `/exec` ใน `API_URL` ของ `index.html`
