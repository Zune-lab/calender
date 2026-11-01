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
