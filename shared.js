// =========================================================
// SGU WORKSPACE — SHARED UTILITIES
// Dùng chung cho index.html (Dashboard), tkb/calendar.html, profile/profile.html.
// Mục đích: tránh copy-paste cùng 1 logic ra nhiều file rồi lệch nhau khi chỉ sửa 1 chỗ
// (đã từng xảy ra với escapeHtml và parse ngày thi — có tới 4 bản khác nhau).
// PHẢI include file này bằng <script src="...shared.js"></script> TRƯỚC index.js / calendar.js / profile.js.
// =========================================================

// ---------------------------------------------------------
// Escape HTML để chống XSS khi render nội dung do người dùng nhập
// (ghi chú, bài tập, dữ liệu import từ Excel: tên môn, GV, phòng, lịch thi...)
// ---------------------------------------------------------
function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------
// RETRY CÓ BACKOFF CHO CÁC LỆNH GỌI SUPABASE — dùng chung cho index.js (Dashboard),
// tkb/calendar-1-core.js và calendar-3-personalization.js.
// Lý do cần: Supabase thỉnh thoảng có những đợt hạ tầng chập chờn ngắn (vài chục giây tới vài
// phút) khiến PostgREST timeout nội bộ và trả lỗi 500/520 cho các request GET — trình duyệt lại
// hiển thị nhầm thành "blocked by CORS policy" (vì response lỗi không kèm header CORS), dễ khiến
// tưởng nhầm là lỗi cấu hình CORS/RLS trong khi thực chất chỉ là lỗi tạm thời phía server.
// -> Thử lại query vài lần với độ trễ tăng dần trước khi chấp nhận thua và trả lỗi ra ngoài.
// CHỈ dùng cho SELECT (đọc, không có tác dụng phụ) — không dùng cho insert/update/delete vì gọi
// lại nhiều lần một lệnh ghi/xoá có thể gây trùng lặp dữ liệu.
// ---------------------------------------------------------
async function withRetry(queryFn, { retries = 2, baseDelayMs = 700 } = {}) {
    // CHỈ thử lại khi lỗi mang tính TẠM THỜI: mất mạng (status 0/không có), 5xx, 429, 408.
    // Lỗi vĩnh viễn (4xx như 400/401/403/404/406 — vd .single() không có dòng nào, RLS chặn...) thì
    // trả về NGAY, không đợi thêm 2,1 giây vô ích rồi cũng ra đúng kết quả đó.
    const isTransient = (r) => {
        if (!r || !r.error) return false;
        const st = r.status;
        return !st || st >= 500 || st === 429 || st === 408;
    };
    let lastResult;
    for (let attempt = 0; attempt <= retries; attempt++) {
        lastResult = await queryFn();
        if (!lastResult.error) return lastResult;
        if (!isTransient(lastResult)) return lastResult;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return lastResult; // offline: thử lại vô ích, trả lỗi ngay để rơi về cache
        if (attempt < retries) {
            await new Promise((r) => setTimeout(r, baseDelayMs * (attempt + 1)));
        }
    }
    return lastResult; // đã thử hết số lần cho phép, vẫn lỗi -> trả kết quả lỗi cuối cùng
}

// ---------------------------------------------------------
// Parse chuỗi ngày thi (exam_date) về Date object.
// Chấp nhận: DD/MM/YYYY, YYYY-MM-DD, DD-MM-YYYY, DD/MM/YY (năm 2 số -> +2000).
// Xác định thành phần NĂM bằng ĐỘ DÀI chuỗi (4 số), không dựa vào vị trí trong chuỗi,
// nên đúng bất kể ngày hay năm nằm ở đầu.
// ---------------------------------------------------------
function parseVNExamDate(str) {
    if (!str) return null;
    const p = String(str).trim().split(/[-/]/);
    if (p.length !== 3) return null;

    let day, month, year;
    if (p[0].length === 4) {          // YYYY-MM-DD
        year = parseInt(p[0], 10); month = parseInt(p[1], 10); day = parseInt(p[2], 10);
    } else {                          // DD/MM/YYYY hoặc DD/MM/YY
        day = parseInt(p[0], 10); month = parseInt(p[1], 10); year = parseInt(p[2], 10);
        if (year < 100) year += 2000;
    }
    if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(year, month - 1, day);
    // new Date() tự "tràn" ngày (31/02 -> 03/03) -> phải so lại để từ chối ngày không có thật,
    // nếu không lịch thi sai ngày (và có thể bị tự động xoá nhầm vì tưởng đã quá 14 ngày).
    if (isNaN(d.getTime()) || d.getDate() !== day || d.getMonth() !== month - 1) return null;
    return d;
}

// ---------------------------------------------------------
// Ngày LOCAL dạng YYYY-MM-DD (KHÔNG dùng toISOString() vì nó trả về ngày UTC: ở Việt Nam, từ
// 00:00–07:00 sáng nó vẫn ra "hôm qua", làm sai nhãn "Hôm nay"/"Còn N ngày").
// ---------------------------------------------------------
function fmtLocalDate(d) {
    const dt = d || new Date();
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// 'YYYY-MM-DD' -> Date lúc 00:00 GIỜ ĐỊA PHƯƠNG (new Date('YYYY-MM-DD') parse theo UTC nên lệch 7 giờ ở VN)
function parseLocalDateStr(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(str || ''));
    return m ? new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)) : null;
}

// Mốc bắt đầu học kỳ mặc định — 1 nơi duy nhất cho cả Dashboard và TKB. TRƯỚC ĐÂY cứng 18/05/2026 nên tài khoản
// chưa có cài đặt bị tính tuần từ tháng 5 (đã quá 20 tuần). Giờ mặc định là THỨ HAI CỦA TUẦN HIỆN TẠI; khi nhập TKB,
// mốc thật được dò từ file Excel và lưu vào user_settings (xem calendar-1-core.js).
function defaultSemesterStartDate() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
}

// Tên môn gốc (bỏ phần "- nhóm", "(thực hành)"...) viết thường — dùng làm khoá gộp môn/màu môn.
// Trước đây đoạn split('-')[0].split('(')[0].trim().toLowerCase() bị chép tay ở ~10 chỗ.
function baseSubjectLabel(name) {
    return String(name || '').split('-')[0].split('(')[0].trim();
}
function baseSubjectKey(name) {
    return baseSubjectLabel(name).toLowerCase();
}

// Buổi học có diễn ra ở tuần weekIndex (0-indexed) không? Dùng chung Dashboard + TKB để 2 nơi
// không bao giờ lệch nhau. Không có thông tin tuần (rỗng) -> coi như học mọi tuần; có chuỗi tuần
// mà weekIndex nằm ngoài độ dài chuỗi -> môn đã kết thúc (trước đây TKB lại vẫn vẽ ra).
function isSubjectActiveInWeek(sub, weekIndex) {
    const weeks = sub && sub.weeks;
    if (!weeks || !String(weeks).trim()) return true;
    if (weekIndex < 0 || weekIndex >= weeks.length) return false;
    const ch = weeks.charAt(weekIndex);
    return ch !== '-' && ch !== ' ';
}

// Nạp 1 thư viện ngoài (xlsx, html2canvas...) CHỈ KHI cần dùng, thay vì chặn trang lúc khởi động
// bằng ~1.2MB script mà đa số lần mở trang không dùng tới. Gọi nhiều lần vẫn chỉ nạp 1 lần.
const _scriptLoadCache = {};
function loadScriptOnce(url, globalName) {
    if (globalName && typeof window[globalName] !== 'undefined') return Promise.resolve();
    if (_scriptLoadCache[url]) return _scriptLoadCache[url];
    _scriptLoadCache[url] = new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = url;
        el.onload = () => resolve();
        el.onerror = () => { delete _scriptLoadCache[url]; el.remove(); reject(new Error('Không tải được thư viện: ' + url)); };
        document.head.appendChild(el);
    });
    return _scriptLoadCache[url];
}

// ---------------------------------------------------------
// Tính "tuần hiện tại của kỳ học" (1-indexed) theo NGÀY đã trôi qua kể từ semesterStartDate.
// Dùng chung để Dashboard (index.js) và TKB (calendar.js) luôn ra CÙNG 1 kết quả — trước đây
// mỗi nơi làm tròn kiểu khác nhau (Math.floor theo ngày vs Math.ceil theo mili-giây) nên có
// thể lệch 1 tuần ngay tại thời điểm nửa đêm giao giữa 2 tuần.
// ---------------------------------------------------------
// Số NGÀY LỊCH (địa phương) từ b tới a: a - b. Không phụ thuộc giờ trong ngày hay múi giờ của mốc.
function calendarDayDiff(a, b) {
    const dayNum = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;
    return dayNum(a) - dayNum(b);
}

function calcCurrentWeekNumber(now, semesterStartDate, maxW) {
    // So theo NGÀY LỊCH địa phương (Date.UTC của y/m/d) thay vì chênh mili-giây: tuần mới luôn bắt
    // đầu đúng 00:00 thứ Hai, không bị trễ 7 tiếng khi mốc học kỳ được parse theo UTC.
    const diffDays = calendarDayDiff(now, semesterStartDate);
    let week = diffDays >= 0 ? Math.floor(diffDays / 7) + 1 : 1;
    if (week < 1) week = 1;
    if (maxW && week > maxW) week = maxW;
    return week;
}

// ---------------------------------------------------------
// MÀU ACCENT HỆ THỐNG — dùng chung cho index.js (Dashboard), tkb/calendar.js (khi ở
// trạng thái chưa/đã hết lịch) và profile/profile.js (avatar accent).
// Trước đây MỖI file có 1 bản ACCENT_POOL + hashStringToIndex() RIÊNG (dễ lệch nếu chỉ sửa
// 1 chỗ) -> gộp về đây làm nguồn DUY NHẤT.
//
// Mặc định: hash ổn định theo user ID (cùng tài khoản luôn ra cùng màu, khỏi cần lưu DB).
// Người dùng có thể tự chọn màu khác ở tab Cài Đặt (tkb/calendar.html) -> lưu vào
// localStorage 'customAccent' (giống cơ chế customBg/subjectCustomColors đã có sẵn),
// khi đó màu tự chọn sẽ được ưu tiên áp dụng ở CẢ 3 trang.
// ---------------------------------------------------------
const ACCENT_POOL = ['#FF3366', '#00C9FF', '#7c3aed', '#11998e', '#FDBB2D', '#22C1C3', '#E100FF', '#92FE9D', '#0A84FF', '#f97316'];

function hashStringToIndex(str, arrayLength) {
    if (!str) return 0;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    }
    return hash % arrayLength;
}

function getSavedAccentColor() {
    try { return localStorage.getItem(STORAGE_KEYS.customAccent) || null; } catch (e) { return null; }
}

function setSavedAccentColor(hex) {
    try { localStorage.setItem(STORAGE_KEYS.customAccent, hex); } catch (e) { console.warn('[Accent] Không lưu được màu (bộ nhớ đầy?):', e.message); }
}

function clearSavedAccentColor() {
    try { localStorage.removeItem(STORAGE_KEYS.customAccent); } catch (e) {}
}

// Màu accent cuối cùng cho 1 user: ưu tiên màu tự chọn đã lưu (nếu có), nếu chưa
// từng đổi thì rơi về hash ổn định theo userId trong ACCENT_POOL mặc định.
function resolveAccentForUser(userId) {
    return getSavedAccentColor() || ACCENT_POOL[hashStringToIndex(userId, ACCENT_POOL.length)];
}

// ---------------------------------------------------------
// THEME (SÁNG/TỐI) — đọc localStorage('theme') và bật/tắt class 'light-mode' trên <body>.
// Trước đây index.js và profile.js mỗi nơi tự viết lại y hệt đoạn if/else này (calendar.js
// còn có thêm phần ghi + toggle UI riêng ở tab Cài Đặt nên vẫn giữ lại phần đó ở calendar.js,
// chỉ dùng chung hàm này cho phần ĐỌC/ÁP DỤNG lúc khởi trang).
// Trả về true/false (đang ở light-mode hay không) để nơi gọi tự đồng bộ UI riêng nếu cần
// (vd: checkbox toggle ở trang Cài Đặt).
// ---------------------------------------------------------
function applyTheme() {
    // MẶC ĐỊNH LIGHT MODE: trước đây chưa lưu gì trong localStorage thì rơi về dark (so sánh
    // === 'light' fail khi giá trị là null) -> đổi lại: chỉ khi người dùng ĐÃ TỪNG tự chọn dark
    // (lưu rõ 'dark') thì mới tắt light-mode, còn lại (kể cả chưa từng chọn gì) mặc định sáng.
    //
    // HỖ TRỢ THÊM GIÁ TRỊ 'system': khi người dùng bật "Theo giao diện hệ thống" ở tab Cài Đặt,
    // localStorage('theme') lưu đúng chuỗi 'system' thay vì 'light'/'dark' -> đọc thẳng theme
    // hiện tại của HĐH qua matchMedia('(prefers-color-scheme: dark)') mỗi lần hàm này chạy.
    const isLight = getIsLightForCurrentThemeSetting();
    document.body.classList.toggle('light-mode', isLight);
    syncStatusBarArea(); // vùng trên cùng (status bar) đổi theo chế độ sáng/tối
    return isLight;
}

function getIsLightForCurrentThemeSetting() {
    let saved = null;
    try { saved = localStorage.getItem(STORAGE_KEYS.theme); } catch (e) { /* localStorage bị chặn (chế độ riêng tư...) -> mặc định sáng */ }
    if (saved === 'system') {
        return !(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    return saved !== 'dark';
}

// Khi đang ở chế độ 'system' mà người dùng đổi theme của HĐH/trình duyệt NGAY LÚC app đang mở
// (không cần tải lại trang) -> tự áp lại theme + bắn sự kiện 'themeChanged' để trang nào có UI
// riêng cần đồng bộ (vd. công tắc Sáng/Tối ở tab Cài Đặt của calendar.js) tự cập nhật theo.
// addEventListener('change') là API chuẩn hiện đại; addListener() là fallback cho trình duyệt
// cũ hơn (đã bị deprecated nhưng vẫn còn 1 số WebView cũ chỉ hỗ trợ bản này).
if (window.matchMedia) {
    const _systemThemeMql = window.matchMedia('(prefers-color-scheme: dark)');
    const _onSystemThemeChange = function () {
        if (lsGet(STORAGE_KEYS.theme) === 'system') {
            const isLight = applyTheme();
            window.dispatchEvent(new CustomEvent('themeChanged', { detail: { isLight } }));
        }
    };
    if (_systemThemeMql.addEventListener) _systemThemeMql.addEventListener('change', _onSystemThemeChange);
    else if (_systemThemeMql.addListener) _systemThemeMql.addListener(_onSystemThemeChange);
}

// ---------------------------------------------------------
// VÙNG TRÊN CÙNG (thanh trạng thái / tai thỏ trên iPhone) — NGUỒN DUY NHẤT cho cả 3 trang.
// Trước đây iOS tự tô 1 dải xám/trắng ở trên cùng khi mở app từ icon Màn hình chính vì:
//   (1) chưa khai báo apple-mobile-web-app-status-bar-style=black-translucent -> iOS không cho nội dung
//       (ảnh nền) vẽ xuống dưới thanh trạng thái (đã thêm meta ở 3 file HTML);
//   (2) <meta theme-color> bị đặt cứng #08090c, không theo chế độ sáng/tối hay ảnh nền tuỳ chỉnh.
// Hàm này: (a) đặt theme-color theo chế độ sáng/tối, rồi theo MÀU TRUNG BÌNH dải trên cùng của ảnh nền
// tuỳ chỉnh nếu có (bg-sync.js -> measureImageStats); (b) thêm 1 lớp mờ dần cao đúng bằng vùng an toàn phía
// trên (env(safe-area-inset-top) = 0 trên máy không tai thỏ/trình duyệt thường nên lớp này tự biến mất) để
// giờ/pin màu trắng của iOS vẫn đọc được trên mọi ảnh nền, mà vẫn thấy ảnh chứ không còn mảng xám đặc.
// ---------------------------------------------------------
const STATUS_BAR_THEME_COLOR = { dark: '#08090c', light: '#e2e8f0' }; // = --bg-color của 3 trang (manifest dùng #08090c)
let _statusBarSeq = 0; // yêu cầu đo ảnh cũ bị bỏ khi đã có yêu cầu mới (đổi ảnh/đổi theme liên tục)

function setThemeColorMeta(color) {
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('name', 'theme-color');
        document.head.appendChild(meta);
    }
    if (meta.getAttribute('content') !== color) meta.setAttribute('content', color);
}

function ensureStatusBarScrim() {
    if (!document.getElementById('status-bar-scrim-style')) {
        const st = document.createElement('style');
        st.id = 'status-bar-scrim-style';
        st.textContent = '#status-bar-scrim{position:fixed;top:0;left:0;right:0;height:env(safe-area-inset-top,0px);z-index:99998;pointer-events:none;'
            + 'background:linear-gradient(to bottom,var(--status-scrim,rgba(8,9,12,.45)),transparent)}';
        document.head.appendChild(st);
    }
    let el = document.getElementById('status-bar-scrim');
    if (!el) {
        el = document.createElement('div');
        el.id = 'status-bar-scrim';
        el.setAttribute('aria-hidden', 'true');
        document.body.appendChild(el);
    }
    return el;
}

function syncStatusBarArea() {
    if (!document.body) { document.addEventListener('DOMContentLoaded', syncStatusBarArea, { once: true }); return; }
    const isLight = document.body.classList.contains('light-mode');
    const bgUrl = lsGet(STORAGE_KEYS.customBg);
    const seq = ++_statusBarSeq;

    setThemeColorMeta(isLight ? STATUS_BAR_THEME_COLOR.light : STATUS_BAR_THEME_COLOR.dark);
    // Ảnh nền bất kỳ (kể cả ảnh sáng) -> lớp mờ tối vừa đủ cho chữ trắng; nền sáng trơn -> nhạt hơn cho đỡ "xám".
    ensureStatusBarScrim().style.setProperty('--status-scrim', bgUrl ? 'rgba(8,9,12,.42)' : (isLight ? 'rgba(30,41,59,.28)' : 'rgba(8,9,12,.45)'));

    if (bgUrl && typeof window.measureImageStats === 'function') {
        window.measureImageStats(bgUrl, 0.06).then((st) => { // 6% trên cùng của ảnh = đúng phần nằm dưới thanh trạng thái
            if (seq === _statusBarSeq && st) setThemeColorMeta('rgb(' + st.r + ', ' + st.g + ', ' + st.b + ')');
        });
    }
}
window.addEventListener('customBackgroundChange', syncStatusBarArea); // bg-sync.js: đổi/xoá ảnh nền
window.addEventListener('themeChanged', syncStatusBarArea);
// KHÔNG gọi ngay: STORAGE_KEYS (const, khai báo phía dưới file này) chưa khởi tạo lúc đoạn này chạy -> đợi hết lượt nạp script.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncStatusBarArea, { once: true });
else setTimeout(syncStatusBarArea, 0);

// ---------------------------------------------------------
// Đọc/ghi màu tuỳ chỉnh theo môn học (localStorage 'subjectCustomColors') — gom về đây
// vì cả 3 trang đều cần ĐỌC giá trị này (calendar.js còn cần GHI ở tab Cài Đặt).
// Trước đây index.js và profile.js tự JSON.parse trực tiếp, lệch khỏi bản try/catch an toàn
// mà calendar.js đã có.
// ---------------------------------------------------------
function getSavedSubjectColors() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.subjectColors)) || {}; }
    catch (e) { return {}; }
}
function saveSubjectColor(subjectName, color) {
    const saved = getSavedSubjectColors();
    saved[subjectName] = color;
    try { localStorage.setItem(STORAGE_KEYS.subjectColors, JSON.stringify(saved)); }
    catch (e) { console.warn('[SubjectColor] Không lưu được màu môn (bộ nhớ đầy?):', e.message); }
}

// ---------------------------------------------------------
// TÊN HIỂN THỊ CỦA USER — dùng chung cho index.js (pill Dashboard) và calendar.js (pill TKB).
// Trước đây calendar.js tự viết lại y hệt logic này bằng tay (if/else nội tuyến) thay vì gọi
// hàm chung, nên rất dễ lệch nếu chỉ sửa 1 nơi. Ưu tiên: full_name đã đặt > "Người dùng SGU"
// (nếu bật hide_email) > email thật.
// ---------------------------------------------------------
function resolveDisplayName(user, meta) {
    if (meta && meta.full_name && String(meta.full_name).trim()) {
        return String(meta.full_name).trim();
    }
    if (meta && meta.hide_email) {
        return "Người dùng SGU";
    }
    return user.email;
}

// ---------------------------------------------------------
// Giờ trong chuỗi (vd "07:30", "7h30", "07g30", "7.30") -> số phút từ 00:00, hoặc null.
// Trước đây Dashboard và TKB chỉ nhận dạng "HH:MM" nên lịch thi ghi "7h30" không có đếm ngược.
// ---------------------------------------------------------
function parseClockMinutes(str) {
    const m = String(str || '').match(/(\d{1,2})\s*[:hHgG.]\s*(\d{2})/);
    if (!m) return null;
    const h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
    return (h > 23 || mi > 59) ? null : h * 60 + mi;
}

// Phút trong ngày -> "HH:MM" (kẹp 0..1440). Trước đây index.js (fmtClock) và Kế Hoạch (plannerFmtHM) mỗi nơi 1 bản.
function fmtMinutesHM(min) {
    min = Math.max(0, Math.min(1440, Math.round(min)));
    return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
}

// Thời điểm BẮT ĐẦU của 1 kỳ thi (ngày thi + giờ bắt đầu) hoặc null nếu thiếu/sai ngày hoặc giờ.
// Trước đây Dashboard và trang Lịch Thi mỗi nơi tự ghép lại logic này.
function examStartDate(exam) {
    const d = parseVNExamDate(exam && exam.exam_date);
    const m = parseClockMinutes(exam && exam.exam_time);
    if (!d || m === null) return null;
    d.setHours(Math.floor(m / 60), m % 60, 0, 0);
    return d;
}

// ---------------------------------------------------------
// Gỡ Push Subscription của thiết bị này khỏi tài khoản đang đăng nhập (gọi TRƯỚC signOut).
// Nếu không, server vẫn tiếp tục đẩy tiêu đề các việc của tài khoản cũ tới thiết bị này sau khi
// đã đăng xuất (lộ nội dung riêng tư trên máy dùng chung). Best-effort, tối đa ~2,5 giây để
// không chặn việc đăng xuất khi mạng chậm.
// ---------------------------------------------------------
async function removePushSubscriptionFor(client) {
    try {
        if (!client || !('serviceWorker' in navigator)) return;
        const work = (async () => {
            const reg = await navigator.serviceWorker.getRegistration();
            const sub = reg && reg.pushManager ? await reg.pushManager.getSubscription() : null;
            if (!sub) return;
            await client.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
            await sub.unsubscribe();
        })();
        await Promise.race([work, new Promise((r) => setTimeout(r, 2500))]);
    } catch (e) { console.warn('[Push] Không gỡ được subscription khi đăng xuất:', e.message); }
}

// ---------------------------------------------------------
// Khi nhập lại TKB, các dòng `subjects` cũ bị xoá và tạo lại với id MỚI -> ghi chú/bài tập
// (subject_details.subject_id) trỏ vào id cũ sẽ mất hoặc mồ côi. Hàm này ghép mỗi dòng cũ với 1 dòng
// mới tương ứng để chuyển ghi chú sang. Thứ tự ưu tiên (chọn mức đầu tiên có kết quả):
//   1) trùng mã HP + nhóm + thứ + tiết   2) trùng tên môn gốc + thứ + tiết   3) cùng tên môn gốc
// (ghi chú vốn được gom theo TÊN MÔN GỐC nên mức 3 vẫn hiển thị đúng ở popup môn).
// Trả về Map(idCũ -> idMới); dòng cũ không ghép được (môn không còn trong TKB mới) không có trong Map.
// ---------------------------------------------------------
function buildSubjectIdRemap(oldRows, newRows) {
    const k1 = (r) => [r.course_code || '', r.group_id || '', r.day, r.time_slot || ''].join('|').toLowerCase();
    const k2 = (r) => [baseSubjectKey(r.name), r.day, r.time_slot || ''].join('|');
    const k3 = (r) => baseSubjectKey(r.name);
    const idx = [new Map(), new Map(), new Map()];
    (newRows || []).forEach((r) => {
        [k1(r), k2(r), k3(r)].forEach((key, i) => { if (!idx[i].has(key)) idx[i].set(key, r.id); });
    });
    const remap = new Map();
    (oldRows || []).forEach((o) => {
        const target = idx[0].get(k1(o)) ?? idx[1].get(k2(o)) ?? idx[2].get(k3(o));
        if (target !== undefined) remap.set(o.id, target);
    });
    return remap;
}

// ---------------------------------------------------------
// ĐỒNG BỘ TKB GIỮ NGUYÊN ID: thay vì xoá hết `subjects` rồi tạo lại (id đổi toàn bộ -> phải "chuyển"
// ghi chú sang id mới, 1 bước lỗi là nhân đôi buổi học hoặc mất ghi chú), ghép từng buổi trong file
// MỚI với buổi cũ tương ứng để GIỮ NGUYÊN dòng cũ. Nhập lại đúng TKB cũ => mọi buổi đều ghép được =>
// không thêm/xoá dòng nào, ghi chú/bài tập không bị đụng tới.
// Ghép theo nhiều lượt từ chặt đến lỏng; mỗi dòng cũ chỉ được ghép tối đa 1 lần (nên các buổi trùng
// mã HP + nhóm + thứ + tiết nhưng khác tuần/phòng vẫn ghép 1-1 đúng cặp):
//   1) giống hệt toàn bộ  2) mã HP + nhóm + thứ + tiết + tuần  3) mã HP + nhóm + thứ + tiết
//   4) tên môn gốc + thứ + tiết
// Trả về { matches: [{ oldRow, newRow }], toInsert: [newRow], unmatchedOld: [oldRow] }.
// ---------------------------------------------------------
function planSubjectSync(oldRows, newRows) {
    const n = (v) => String(v == null ? '' : v).trim().toLowerCase();
    const keyFns = [
        (r) => [r.course_code, r.group_id, r.day, r.time_slot, r.weeks, r.room, r.lecturer, r.name].map(n).join('|'),
        (r) => [r.course_code, r.group_id, r.day, r.time_slot, r.weeks].map(n).join('|'),
        (r) => [r.course_code, r.group_id, r.day, r.time_slot].map(n).join('|'),
        (r) => [baseSubjectKey(r.name), r.day, n(r.time_slot)].join('|'),
    ];
    const olds = (oldRows || []).slice().sort((a, b) => (a.id > b.id ? 1 : a.id < b.id ? -1 : 0));
    const news = (newRows || []).slice();
    const oldUsed = new Set();
    const newMatch = new Array(news.length).fill(null);
    keyFns.forEach((keyOf) => {
        const queues = new Map();
        olds.forEach((o) => {
            if (oldUsed.has(o.id)) return;
            const k = keyOf(o);
            if (!queues.has(k)) queues.set(k, []);
            queues.get(k).push(o);
        });
        news.forEach((nr, i) => {
            if (newMatch[i]) return;
            const q = queues.get(keyOf(nr));
            if (q && q.length) { const o = q.shift(); oldUsed.add(o.id); newMatch[i] = o; }
        });
    });
    return {
        matches: news.map((nr, i) => newMatch[i] ? { oldRow: newMatch[i], newRow: nr } : null).filter(Boolean),
        toInsert: news.filter((_, i) => !newMatch[i]),
        unmatchedOld: olds.filter((o) => !oldUsed.has(o.id)),
    };
}

// =========================================================
// HẰNG SỐ DÙNG CHUNG (trước đây bị chép tay ở nhiều file và dễ lệch nhau)
// =========================================================

// Khoá localStorage dùng ở NHIỀU file — gom 1 chỗ để không gõ sai chính tả ở nơi nào đó.
const STORAGE_KEYS = {
    theme: 'theme',
    customBg: 'customBg',
    customAccent: 'customAccent',
    subjectColors: 'subjectCustomColors',
    targetTab: 'targetTab',
    profileReturnTo: 'profileReturnTo',
    // Các khoá trước đây viết chuỗi cứng rải rác ở calendar-4/5/5b/7:
    plannerViewMode: 'plannerViewMode',
    wallpaperSize: 'wallpaperSize',
    plannerNotifLeadMin: 'plannerNotifLeadMin',
    plannerNotifEnabled: 'plannerNotifEnabled',
    plannerCleanupDay: 'plannerCleanupDay',
    plannerNotifiedIds: 'plannerNotifiedIds',
    plannerAlarmFiredIds: 'plannerAlarmFiredIds',
    deadlineNotifiedIds: 'deadlineNotifiedIds',
    offlineStore: 'sguOfflineV1',
};

// localStorage AN TOÀN: chế độ riêng tư / bị chặn lưu trữ làm getItem/setItem ném lỗi -> trước đây nhiều nơi gọi trần
// và crash cả trang. Mọi chỗ đọc/ghi đơn giản nên dùng 3 hàm này.
function lsGet(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch (e) { return fallback; }
}
function lsSet(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
}
function lsRemove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* bỏ qua */ }
}

// Đường dẫn các trang — 1 nơi duy nhất (trước đây gõ 'tkb/calendar.html' / '../index.html' ở ~12 chỗ, mỗi nơi 1 kiểu tương đối).
// appUrl() trả URL TUYỆT ĐỐI tính từ thư mục gốc app nên dùng được ở cả trang gốc lẫn tkb/, profile/.
const PAGES = { dashboard: 'index.html', calendar: 'tkb/calendar.html', profile: 'profile/profile.html' };
function appUrl(page) { return new URL(PAGES[page] || page, APP_ROOT_URL || location.href).href; }

// =========================================================
// DỮ LIỆU OFFLINE — xem lại TKB / Lịch thi / Ghi chú / Kế hoạch khi mất mạng.
// Cơ chế: mỗi truy vấn ĐỌC thành công được lưu bản sao vào localStorage (theo tài khoản); khi mạng lỗi thì trả bản
// đã lưu (chỉ đọc) và hiện nhãn "Đang offline". Đăng xuất sẽ xoá sạch bản sao (xem OfflineStore.clear()).
// =========================================================
const OfflineStore = (() => {
    const MAX_ENTRIES = 40; // giới hạn số mục (mỗi tuần kế hoạch là 1 mục) để không phình localStorage
    let state = null;
    function load() {
        if (state) return state;
        try { state = JSON.parse(lsGet(STORAGE_KEYS.offlineStore) || 'null'); } catch (e) { state = null; }
        if (!state || typeof state !== 'object' || !state.entries) state = { user: null, entries: {} };
        return state;
    }
    function persist() {
        const s = load();
        const keys = Object.keys(s.entries).sort((a, b) => s.entries[b].t - s.entries[a].t);
        keys.slice(MAX_ENTRIES).forEach((k) => delete s.entries[k]);
        if (lsSet(STORAGE_KEYS.offlineStore, JSON.stringify(s))) return;
        // Đầy bộ nhớ: bỏ dần mục cũ nhất tới khi ghi được
        for (let i = keys.length - 1; i >= 0; i--) {
            delete s.entries[keys[i]];
            if (lsSet(STORAGE_KEYS.offlineStore, JSON.stringify(s))) return;
        }
    }
    return {
        // Gọi mỗi khi có phiên đăng nhập hợp lệ: nhớ user (để mở lại offline) và bỏ dữ liệu của tài khoản khác.
        setUser(user) {
            if (!user || !user.id) return;
            const s = load();
            if (s.user && s.user.id !== user.id) s.entries = {};
            s.user = { id: user.id, email: user.email, user_metadata: user.user_metadata || {} };
            persist();
        },
        getUser() { const s = load(); return s.user || null; },
        get(key) { return load().entries[key] || null; },
        set(key, data) { load().entries[key] = { t: Date.now(), data }; persist(); },
        clear() { state = { user: null, entries: {} }; lsRemove(STORAGE_KEYS.offlineStore); },
    };
})();

function isLikelyOfflineResult(res) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    const err = res && res.error;
    if (!err) return false;
    const st = res.status;
    return !st || st >= 500 || /fetch|network|timeout|load failed/i.test(String(err.message || err));
}

// Nhãn "Đang offline" (tự chèn, không cần sửa HTML từng trang). Khi có mạng lại, bấm vào để tải lại dữ liệu mới.
let _offlineBadgeEl = null;
function showOfflineBadge() {
    if (!document.body) { document.addEventListener('DOMContentLoaded', showOfflineBadge, { once: true }); return; }
    if (!document.getElementById('offline-badge-style')) {
        const st = document.createElement('style');
        st.id = 'offline-badge-style';
        st.textContent = '#offline-badge{position:fixed;left:50%;bottom:calc(14px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:99999;'
            + 'padding:9px 16px;border-radius:999px;font:600 0.82rem var(--font-sans,system-ui);color:#fff;background:rgba(30,32,38,.92);'
            + 'border:1px solid rgba(255,255,255,.18);box-shadow:0 6px 24px rgba(0,0,0,.35);cursor:default;max-width:92vw;text-align:center}'
            + '#offline-badge.online{background:#1f9d62;cursor:pointer}';
        document.head.appendChild(st);
    }
    if (!_offlineBadgeEl) {
        _offlineBadgeEl = document.createElement('div');
        _offlineBadgeEl.id = 'offline-badge';
        _offlineBadgeEl.setAttribute('role', 'status');
        _offlineBadgeEl.onclick = () => { if (navigator.onLine) location.reload(); };
        document.body.appendChild(_offlineBadgeEl);
    }
    _offlineBadgeEl.classList.remove('online');
    _offlineBadgeEl.textContent = '⚠ Đang offline — xem dữ liệu đã lưu (chỉ đọc)';
}
function hideOfflineBadge() { if (_offlineBadgeEl) { _offlineBadgeEl.remove(); _offlineBadgeEl = null; } }
window.addEventListener('offline', () => { if (OfflineStore.getUser()) showOfflineBadge(); });
window.addEventListener('online', () => {
    if (!_offlineBadgeEl) return;
    _offlineBadgeEl.classList.add('online');
    _offlineBadgeEl.textContent = '✓ Đã có mạng — bấm để tải dữ liệu mới';
});

// Đọc dữ liệu có dự phòng offline. queryFn trả {data, error} như supabase. Thành công -> lưu bản sao; lỗi mạng -> trả bản đã lưu.
async function offlineRead(key, queryFn) {
    let res;
    try { res = await queryFn(); } catch (e) { res = { data: null, error: { message: (e && e.message) || String(e) } }; }
    if (!res.error) { OfflineStore.set(key, res.data); return res; }
    if (isLikelyOfflineResult(res)) {
        const hit = OfflineStore.get(key);
        if (hit) { showOfflineBadge(); return { data: hit.data, error: null, status: 200, fromCache: true, cachedAt: hit.t }; }
    }
    return res;
}

// Lấy phiên đăng nhập, dùng user đã nhớ khi offline / token không làm mới được. Trả {session, offline}.
async function getSessionOrOffline(client) {
    let session = null, err = null;
    try { const r = await client.auth.getSession(); session = r.data && r.data.session; err = r.error; }
    catch (e) { err = e; }
    if (session) { OfflineStore.setUser(session.user); return { session, offline: false }; }
    const cached = OfflineStore.getUser();
    if (cached && (err || navigator.onLine === false)) {
        showOfflineBadge();
        return { session: { user: cached, offline: true }, offline: true };
    }
    return { session: null, offline: false };
}

// Số tuần tối đa của 1 học kỳ (lưới chọn tuần, mảng bitmap tuần của import Excel...).
const MAX_SEMESTER_WEEKS = 20;

// LƯỚI TIẾT HỌC SGU — NGUỒN DUY NHẤT (Dashboard, bảng TKB và import Excel cùng dùng).
// Trước đây có 3 bản chép tay (index.js: phút, calendar-1: chuỗi giờ bắt đầu/kết thúc,
// calendar-2: chuỗi giờ bắt đầu) — đổi lưới giờ phải nhớ sửa cả 3 nơi.
const SGU_PERIOD_TIMES = {
    1: ['07:00', '07:50'],  2: ['07:50', '08:40'],  3: ['09:00', '09:50'],  4: ['09:50', '10:40'],
    5: ['10:40', '11:30'],  6: ['13:00', '13:50'],  7: ['13:50', '14:40'],  8: ['15:00', '15:50'],
    9: ['15:50', '16:40'], 10: ['16:40', '17:30'], 11: ['17:40', '18:30'], 12: ['18:30', '19:20'],
    13: ['19:20', '20:10'], 14: ['20:10', '21:00'],
};
const SGU_PERIOD_COUNT = Object.keys(SGU_PERIOD_TIMES).length;
function _hmToMinutes(hm) { const [h, m] = hm.split(':').map(Number); return h * 60 + m; }
function sguPeriodStartText(p) { return SGU_PERIOD_TIMES[p] ? SGU_PERIOD_TIMES[p][0] : ''; }
function sguPeriodEndText(p) { return SGU_PERIOD_TIMES[p] ? SGU_PERIOD_TIMES[p][1] : ''; }
function sguPeriodStartMin(p) { return SGU_PERIOD_TIMES[p] ? _hmToMinutes(SGU_PERIOD_TIMES[p][0]) : undefined; }
function sguPeriodEndMin(p) { return SGU_PERIOD_TIMES[p] ? _hmToMinutes(SGU_PERIOD_TIMES[p][1]) : undefined; }

// 3 MỨC ƯU TIÊN — dùng chung Dashboard, ghi chú/công việc, Kế Hoạch Ngày (trước đây màu bị chép
// ở index.js lẫn calendar-4). Edge Function (Deno) không import được file này nên bản của nó
// (supabase/functions/wallpaper/index.ts) phải sửa tay khi đổi màu ở đây.
const PRIORITY_LEVELS = {
    high:   { label: 'Quan trọng',           color: '#ff4d4f', leadDays: 7, order: 0 },
    normal: { label: 'Bình thường',          color: '#ffb020', leadDays: 5, order: 1 },
    low:    { label: 'Không quan trọng lắm', color: '#8b96a5', leadDays: 3, order: 2 }
};
function getPriorityInfo(key) { return PRIORITY_LEVELS[key] || PRIORITY_LEVELS.normal; }

// MÀU MÔN HỌC — 1 bảng gradient + 1 hàm gán màu DUY NHẤT cho Dashboard, bảng TKB và Lịch Thi.
// Trước đây: 3 bản bảng màu chép tay (Dashboard dùng #7c3aed, TKB dùng #9d4edd cho môn thứ 3) và
// màu gán theo THỨ TỰ GẶP TRONG BẢNG ĐANG XEM nên cùng 1 môn đổi màu khi chuyển tuần / chuyển trang.
// Giờ gán theo thứ tự tên môn gốc (A-Z) trên TOÀN BỘ danh sách môn -> ổn định ở mọi nơi.
const SUBJECT_GRADIENTS = [
    ['#FF3366', '#FF9933'], ['#00C9FF', '#92FE9D'], ['#9d4edd', '#E100FF'],
    ['#11998e', '#38ef7d'], ['#FDBB2D', '#22C1C3'],
];
function buildSubjectColorMap(subjects) {
    const keys = [...new Set((subjects || []).map((s) => baseSubjectKey(s.name)))].sort();
    const map = {};
    keys.forEach((k, i) => { map[k] = SUBJECT_GRADIENTS[i % SUBJECT_GRADIENTS.length]; });
    return map;
}

// ---------------------------------------------------------
// ĐỊNH DẠNG NGÀY/THỨ (VN) — trước đây chép tay ở ~10 chỗ
// ---------------------------------------------------------
// day theo quy ước của app: 2..7 = Thứ 2..Thứ 7, 8 = Chủ Nhật.
function dayLabelVN(day, upper) {
    const t = day === 8 ? 'Chủ Nhật' : 'Thứ ' + day;
    return upper ? t.toUpperCase() : t;
}
function pad2(n) { return String(n).padStart(2, '0'); }
function fmtDM(d) { return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`; }
function fmtDMY(d) { return `${fmtDM(d)}/${d.getFullYear()}`; }
// Số ngày lịch giữa 2 chuỗi 'YYYY-MM-DD' (to - from)
function daysBetweenDateStrings(fromStr, toStr) {
    const a = parseLocalDateStr(toStr), b = parseLocalDateStr(fromStr);
    return a && b ? calendarDayDiff(a, b) : NaN;
}

// ---------------------------------------------------------
// MÀU: HSL <-> HEX (trước đây index.js có shiftHue(), calendar-3 có hslToHex() riêng)
// ---------------------------------------------------------
function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const toHex = (x) => Math.round(255 * x).toString(16).padStart(2, '0');
    return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}
// Xoay hue của màu '#RRGGBB' đi `degrees`, nhân bão hoà với satFactor, cộng thêm lightBoost (0-1)
function shiftHue(hex, degrees, satFactor = 1, lightBoost = 0) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h /= 6;
    }
    const nh = (((h * 360 + degrees) % 360) + 360) % 360;
    const ns = Math.max(0, Math.min(1, s * satFactor));
    const nl = Math.max(0, Math.min(1, l + lightBoost));
    return hslToHex(nh, ns * 100, nl * 100);
}

// Chỉ cho phép ảnh data:image/ hoặc http(s) — dùng cho avatar do người dùng tự ghi vào metadata.
function isSafeImageSrc(src) { return /^(data:image\/|https?:\/\/)/i.test(String(src || '')); }

// Màu môn học đã lưu: thêm hàm xoá (trước đây gọi localStorage.removeItem thẳng ở nhiều nơi)
function clearSavedSubjectColors() {
    try { localStorage.removeItem(STORAGE_KEYS.subjectColors); } catch (e) {}
}

// Đổi theme thủ công (calendar-1 trước đây tự ghi class + localStorage ở 3 chỗ)
function setThemePreference(value) { // 'light' | 'dark' | 'system'
    try { localStorage.setItem(STORAGE_KEYS.theme, value); } catch (e) {}
    return applyTheme();
}

// Đăng ký Service Worker — đường dẫn tính theo vị trí của chính shared.js (cùng thư mục sw.js)
// nên dùng được ở cả trang gốc lẫn tkb/, profile/ mà không phải gõ 'sw.js' / '../sw.js' từng nơi.
const APP_ROOT_URL = (document.currentScript && document.currentScript.src) ? new URL('./', document.currentScript.src).href : '';
function registerAppServiceWorker() {
    if (!('serviceWorker' in navigator)) return Promise.resolve(null);
    return navigator.serviceWorker.register(APP_ROOT_URL + 'sw.js').catch((err) => {
        console.warn('[PWA] Không đăng ký được Service Worker:', err && err.message);
        return null;
    });
}
