// =========================================
// SGU WORKSPACE - SERVICE WORKER
// 2 nhiệm vụ:
//  1) Cache "app shell" (HTML/CSS/JS tĩnh) -> cho phép cài thành app + mở được cả khi mất mạng
//     (dữ liệu TKB/ghi chú vẫn cần mạng để đồng bộ với Supabase, nhưng ít nhất app MỞ ĐƯỢC).
//  2) Nhận Push từ server (Supabase Edge Function) và hiển thị Notification thật, kể cả khi
//     không có tab nào của web đang mở.
// =========================================

// FIX: Dùng path TƯƠNG ĐỐI (không có dấu / ở đầu) và tự tính theo self.registration.scope,
// để hoạt động đúng dù chạy ở domain gốc (Live Server) hay dưới 1 subpath khi deploy
// (vd GitHub Pages: https://user.github.io/ten-repo/...).
const CACHE_NAME = 'sgu-workspace-v9'; // BUMP v8: gộp supabaseUrl/supabaseKey của index.js,
// profile.js, tkb/calendar-1-core.js về 1 file chung 'supabase-config.js' (load trước mọi
// script khác) -> thêm file mới này vào app shell để cache offline, đồng thời bump version
// để SW install lại và không phục vụ nhầm bản index.js/profile.js/calendar-1-core.js cũ
// (vẫn còn khai báo supabaseUrl/supabaseKey riêng, đã bị xoá) từ cache trước đó.
const APP_SHELL_RELATIVE = [
    'index.html', 'index.css', 'index.js', 'supabase-config.js', 'shared.js', 'bg-sync.js',
    'profile/profile.html', 'profile/profile.css', 'profile/profile.js',
    'tkb/calendar.html',
    'tkb/calendar-1-base.css', 'tkb/calendar-2-notes-glass-lightmode.css', 'tkb/calendar-3-desktop-settings-dialog.css',
    'tkb/calendar-4-planner-overview.css', 'tkb/calendar-7-layout-refresh.css',
    'tkb/calendar-1-core.js', 'tkb/calendar-2-timetable-modal.js', 'tkb/calendar-3-personalization.js',
    'tkb/calendar-4-planner-notify.js', 'tkb/calendar-5-planner-ui.js', 'tkb/calendar-5b-planner-overview.js',
    'tkb/calendar-6-export-capture.js',
    'manifest.json', 'icon-192.png', 'icon-512.png',
];

// FIX BUG "SỬA/XÓA CODE XONG RELOAD LOCAL VẪN THẤY BẢN CŨ": khi chạy local (Live Server...),
// SW cũ trả file từ cache trước rồi mới tải bản mới ngầm -> phải reload 2 lần mới thấy thay đổi
// (hoặc không bao giờ thấy nếu file đã bị xóa khỏi ổ đĩa mà cache vẫn còn). Ở local, SW không
// can thiệp request và không giữ cache nào.
const IS_LOCAL_DEV = ['localhost', '127.0.0.1', '[::1]'].includes(self.location.hostname);

function scopedUrl(relativePath) {
    return new URL(relativePath, self.registration.scope).href;
}

self.addEventListener('install', (event) => {
    self.skipWaiting(); // kích hoạt SW mới ngay, không cần đợi user đóng hết tab cũ
    if (IS_LOCAL_DEV) return;
    const appShell = APP_SHELL_RELATIVE.map(scopedUrl);
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(appShell))
            .catch((e) => console.warn('[SW] Cache app shell lỗi (không sao, sẽ thử lại lần request sau):', e.message))
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((names) =>
            Promise.all(names.filter((n) => IS_LOCAL_DEV || n !== CACHE_NAME).map((n) => caches.delete(n)))
        ).then(() => self.clients.claim()) // chiếm quyền kiểm soát các tab đang mở ngay lập tức
    );
});

// Chiến lược: NETWORK-FIRST cho mọi file cùng origin (HTML/CSS/JS/icon), fallback về cache khi
// mất mạng. Dùng cache:'no-cache' để luôn hỏi lại server (304 nếu không đổi -> vẫn nhẹ) thay vì
// bị HTTP cache của GitHub Pages (max-age 10 phút) trả bản cũ. Nhờ vậy push code xong chỉ cần
// reload 1 lần là thấy bản mới; mở offline vẫn dùng được nhờ cache.
self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (IS_LOCAL_DEV) return; // local: để trình duyệt tự xử lý, không cache
    if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return; // bỏ qua request tới Supabase/CDN ngoài

    const isHTML = req.headers.get('accept')?.includes('text/html');

    event.respondWith(
        fetch(req, { cache: 'no-cache' }).then((res) => {
            if (res.ok) {
                const clone = res.clone();
                caches.open(CACHE_NAME).then((c) => c.put(req, clone));
            }
            return res;
        }).catch(() => caches.match(req).then((c) => c || (isHTML ? caches.match(scopedUrl('index.html')) : undefined)))
    );
});

// Nhận push message từ server (planner-push-cron Edge Function bắn qua Web Push)
self.addEventListener('push', (event) => {
    let payload = { title: 'SGU Workspace', body: 'Bạn có một việc sắp tới giờ.' };
    try {
        if (event.data) payload = event.data.json();
    } catch (e) {
        if (event.data) payload.body = event.data.text();
    }

    const title = payload.title || 'SGU Workspace';
    const options = {
        body: payload.body || '',
        icon: payload.icon || scopedUrl('icon-192.png'),
        badge: payload.badge || scopedUrl('icon-192.png'),
        tag: payload.tag || 'sgu-planner',
        data: { url: payload.url || scopedUrl('tkb/calendar.html') },
        vibrate: [100, 50, 100],
        requireInteraction: false,
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

// Bấm vào notification -> mở (hoặc focus) đúng trang Kế Hoạch Ngày
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = (event.notification.data && event.notification.data.url) || scopedUrl('tkb/calendar.html');

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if (client.url.includes('calendar.html') && 'focus' in client) {
                    return client.focus();
                }
            }
            if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
        })
    );
});