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
const CACHE_NAME = 'sgu-workspace-v3'; // BUMP VERSION MỖI KHI SỬA index.js/css/html để SW xóa cache cũ và nạp lại bản mới
const APP_SHELL_RELATIVE = [
    'index.html', 'index.css', 'index.js', 'shared.js',
    'profile/profile.html', 'profile/profile.css', 'profile/profile.js',
    'tkb/calendar.html', 'tkb/calendar.css', 'tkb/calendar.js',
    'manifest.json', 'icon-192.png', 'icon-512.png',
];

function scopedUrl(relativePath) {
    return new URL(relativePath, self.registration.scope).href;
}

self.addEventListener('install', (event) => {
    const appShell = APP_SHELL_RELATIVE.map(scopedUrl);
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(appShell))
            .catch((e) => console.warn('[SW] Cache app shell lỗi (không sao, sẽ thử lại lần request sau):', e.message))
    );
    self.skipWaiting(); // kích hoạt SW mới ngay, không cần đợi user đóng hết tab cũ
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((names) =>
            Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
        ).then(() => self.clients.claim()) // chiếm quyền kiểm soát các tab đang mở ngay lập tức
    );
});

// Chiến lược: network-first cho HTML (luôn ưu tiên bản mới nhất khi có mạng), fallback về cache
// khi mất mạng. Với file tĩnh khác (css/js/icon) thì cache-first cho nhanh.
self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return; // bỏ qua request tới Supabase/CDN ngoài

    const isHTML = req.headers.get('accept')?.includes('text/html');

    if (isHTML) {
        event.respondWith(
            fetch(req).then((res) => {
                const clone = res.clone();
                caches.open(CACHE_NAME).then((c) => c.put(req, clone));
                return res;
            }).catch(() => caches.match(req).then((c) => c || caches.match(scopedUrl('index.html'))))
        );
    } else {
        event.respondWith(
            caches.match(req).then((cached) => cached || fetch(req).then((res) => {
                const clone = res.clone();
                caches.open(CACHE_NAME).then((c) => c.put(req, clone));
                return res;
            }))
        );
    }
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