# calender

## License

Copyright (c) 2026 Zune (https://github.com/Zune-lab)

The **code** in this repository is released under the [MIT License](./LICENSE).
You can reuse it, but you must keep the copyright notice and the license text.

Personal content (photos, names, texts, audio, documents and anything that
belongs to the people or events featured here) is **not** licensed for reuse.
Please do not present this work as your own.

Original repository: https://github.com/Zune-lab/calender

## Offline & thư viện tự host

- Font Inter, Font Awesome, supabase-js, xlsx, html2canvas nằm trong `vendor/` + `fonts.css` (không còn phụ thuộc CDN); service worker precache toàn bộ.
- Xem lại TKB / Lịch thi / Ghi chú / Kế hoạch khi mất mạng: mỗi truy vấn đọc thành công được lưu bản sao (`OfflineStore` trong `shared.js`, theo tài khoản); mất mạng thì dùng bản đã lưu và hiện nhãn "Đang offline" (chỉ đọc). Đăng xuất xoá bản sao.
- Cần mở app ít nhất 1 lần có mạng (và đã đăng nhập) để có dữ liệu offline. Service worker không chạy trên `localhost` (xem `IS_LOCAL_DEV`) nên test offline trên bản deploy HTTPS.
- Nâng phiên bản thư viện: tải lại file vào `vendor/` và tăng `CACHE_NAME` trong `sw.js`.

## Thông báo push chạy nền (không cần mở app)
Toàn bộ thông báo (báo trước N phút cho Kế Hoạch, chuông đúng giờ, báo Hạn công việc/ghi chú) do **server** gửi mỗi phút qua Edge Function `planner-push-cron` + pg_cron; app chỉ đăng ký thiết bị. Thiết lập 1 lần: chạy `supabase/push_setup.sql`, deploy function, đặt secrets `VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT` (email THẬT — iPhone từ chối subject giả). iPhone: phải "Thêm vào Màn hình chính" và mở app từ icon, rồi vào Cài đặt bấm **Gửi thông báo thử** để kiểm tra cả chuỗi. Test logic server: `supabase/functions/planner-push-cron/test/`.
