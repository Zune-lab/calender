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
        if (localStorage.getItem(STORAGE_KEYS.theme) === 'system') {
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
};

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
