// =========================================================
// SGU WORKSPACE — CẤU HÌNH SUPABASE (NGUỒN DUY NHẤT)
// -------------------------------------------------------
// CHỈ SỬA Ở ĐÂY khi đổi project Supabase — mọi trang khác (Dashboard, TKB, Hồ Sơ) đều
// dùng chung 2 biến global này, không còn tự khai báo riêng nữa.
//
// PHẢI nạp file này bằng <script> TRƯỚC shared.js và trước bất kỳ script nào gọi
// window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY):
//   <script src="supabase-config.js"></script>   (ở trang gốc, vd index.html)
//   <script src="../supabase-config.js"></script> (ở trang trong thư mục con, vd profile/, tkb/)
// =========================================================
const SUPABASE_URL = 'https://sbefenwjwqoloeyvelmq.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNiZWZlbndqd3FvbG9leXZlbG1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0MjI5NDgsImV4cCI6MjEwNTk5ODk0OH0.Fqo5APCtMm_1KIx34QGhcmp1KzMNMmiEh21S6diTOco';
