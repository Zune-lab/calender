# SGU Workspace — bản mobile native

Viết lại bản web thành app **native** cho từng nền tảng, dùng chung backend Supabase (cùng project, cùng tài khoản):

| Nền tảng | Ngôn ngữ / UI | Thư mục |
|---|---|---|
| Android | Kotlin + Jetpack Compose (Material 3) | `android/` |
| iPhone / iPad | Swift + SwiftUI | `ios/` |

Không dùng SDK Supabase: cả hai gọi thẳng REST (GoTrue + PostgREST) nên cơ chế làm mới token và dự phòng offline hoàn toàn nằm trong code của dự án. Không có thư viện ngoài ở iOS; Android chỉ dùng Compose + OkHttp.

## Tính năng
- Đăng nhập email/mật khẩu (tài khoản của bản web), phiên lưu an toàn (Keychain / bộ nhớ riêng của app, `allowBackup=false`).
- **Hôm nay:** buổi đang học / sắp tới (đếm ngược, tự đổi tuần khi qua nửa đêm), thống kê, việc sắp tới hạn (việc còn hạn lên trước, trễ hạn xuống sau).
- **TKB** theo tuần (1–20), **Lịch thi**, **Kế hoạch** theo ngày (tick hoàn thành), **Cài đặt** (đổi ngày bắt đầu học kỳ, đăng xuất).
- **Offline:** mỗi lần đọc thành công được lưu bản sao theo tài khoản; mất mạng thì app dùng bản đã lưu (chỉ đọc) và hiện banner. Đăng xuất xoá sạch bản sao.

## Logic dùng chung
`core/Logic.kt` (Android) và `Sources/Logic.swift` (iOS) là bản port 1-1 từ `shared.js`/`index.js` của web (lưới giờ SGU, tuần học, `weeks`, ngày thi, hero, sắp xếp hạn). Hai bên có bộ test tương đương (`LogicTest.kt`, `LogicTests.swift`) — sửa quy tắc ở đâu thì sửa cả 3 nơi (web + 2 app).

## Chạy
**Android:** mở `android/` bằng Android Studio (Ladybug+), Sync Gradle, Run. Test logic: `./gradlew :app:testDebugUnitTest` (cần tạo Gradle wrapper lần đầu: `gradle wrapper`).

**iOS:** cần Mac + Xcode 15+. `brew install xcodegen && cd ios && xcodegen generate && open SGUWorkspace.xcodeproj`, chọn máy/simulator rồi Run. Test: Cmd+U.

## Cần làm trước khi phát hành
- Chạy `supabase/rls_policies.sql` trên Supabase (app dùng anon key; RLS là lớp bảo vệ duy nhất).
- Thêm icon app, ký bản build (Android keystore / iOS signing), đặt bundle id/applicationId của bạn.
- Chưa có: nhập TKB từ Excel, ghi chú/bài tập chi tiết từng môn, thông báo đẩy — các phần này vẫn dùng trên web (app đọc được dữ liệu đó).
