# RK Showcase — ผลงานระบบดิจิทัล โรงพยาบาลร้องกวาง

เว็บรวมผลงานระบบที่พัฒนาใช้ในโรงพยาบาล มีภาพ preview, รายละเอียดคร่าว ๆ และลิงก์เข้าใช้งาน จัดกลุ่มด้วย **#แท็ก** (เช่น #HR #ENV #LAB)

- หน้าเว็บ: `index.html` (GitHub Pages)
- API + ข้อมูล: `gas/Code.gs` (Google Apps Script ผูกกับ Google Sheet)
- เข้าสู่ระบบด้วย **อีเมล + รหัส OTP 6 หลัก** เท่านั้น
- ใน repo นี้ไม่มีข้อมูลผลงาน ข้อมูลทั้งหมดอยู่ใน Google Sheet

## ติดตั้ง
1. สร้าง Google Sheet ใหม่ → Extensions → Apps Script → วาง `gas/Code.gs`
2. ตรวจ `OWNER_EMAIL` แล้ว Run ฟังก์ชัน `setup` (อนุญาตสิทธิ์ครั้งแรก)
3. Deploy → New deployment → Web app · Execute as **Me** · Who has access **Anyone**
4. คัดลอก URL ที่ลงท้าย `/exec` ใส่ `API_URL` ใน `index.html` แล้ว commit
5. GitHub → Settings → Pages → Branch `main` / root

ถ้า `API_URL` ว่าง เว็บจะเปิดเป็นโหมดตัวอย่าง (ใช้รหัส 123456)

## แท็บใน Sheet
| แท็บ | ใช้ทำอะไร |
|---|---|
| Projects | ผลงาน (ชื่อ, คำโปรย, แท็ก, สถานะ, รายละเอียด, ความสามารถ, ลิงก์, รูป) |
| Users | อีเมลที่เข้าชมได้ · role `ADMIN` แก้ไขผลงานได้ · `VIEWER` ดูอย่างเดียว |
| Config | `viewMode` = `list` (เฉพาะอีเมลใน Users) หรือ `any` (อีเมลใดก็ได้) |
| Log | ประวัติการเข้าระบบและการแก้ไข |

รูป preview เก็บในโฟลเดอร์ Drive “RK Showcase Images” รูปย่อเก็บในชีต
