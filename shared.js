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

// Mốc bắt đầu học kỳ mặc định (thứ Hai 18/05/2026) — 1 nơi duy nhất cho cả Dashboard và TKB.
function defaultSemesterStartDate() { return new Date(2026, 4, 18); }

// Tên môn gốc (bỏ phần "- nhóm", "(thực hành)"...) viết thường — dùng làm khoá gộp môn/màu môn.
// Trước đây đoạn split('-')[0].split('(')[0].trim().toLowerCase() bị chép tay ở ~10 chỗ.
function baseSubjectKey(name) {
    return String(name || '').split('-')[0].split('(')[0].trim().toLowerCase();
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
    try { return localStorage.getItem('customAccent') || null; } catch (e) { return null; }
}

function setSavedAccentColor(hex) {
    try { localStorage.setItem('customAccent', hex); } catch (e) { console.warn('[Accent] Không lưu được màu (bộ nhớ đầy?):', e.message); }
}

function clearSavedAccentColor() {
    try { localStorage.removeItem('customAccent'); } catch (e) {}
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
    return isLight;
}

function getIsLightForCurrentThemeSetting() {
    const saved = localStorage.getItem('theme');
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
        if (localStorage.getItem('theme') === 'system') {
            const isLight = applyTheme();
            window.dispatchEvent(new CustomEvent('themeChanged', { detail: { isLight } }));
        }
    };
    if (_systemThemeMql.addEventListener) _systemThemeMql.addEventListener('change', _onSystemThemeChange);
    else if (_systemThemeMql.addListener) _systemThemeMql.addListener(_onSystemThemeChange);
}

// ---------------------------------------------------------
// Đọc/ghi màu tuỳ chỉnh theo môn học (localStorage 'subjectCustomColors') — gom về đây
// vì cả 3 trang đều cần ĐỌC giá trị này (calendar.js còn cần GHI ở tab Cài Đặt).
// Trước đây index.js và profile.js tự JSON.parse trực tiếp, lệch khỏi bản try/catch an toàn
// mà calendar.js đã có.
// ---------------------------------------------------------
function getSavedSubjectColors() {
    try { return JSON.parse(localStorage.getItem('subjectCustomColors')) || {}; }
    catch (e) { return {}; }
}
function saveSubjectColor(subjectName, color) {
    const saved = getSavedSubjectColors();
    saved[subjectName] = color;
    try { localStorage.setItem('subjectCustomColors', JSON.stringify(saved)); }
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
