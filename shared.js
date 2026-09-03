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
    const d = new Date(year, month - 1, day);
    return isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------
// Tính "tuần hiện tại của kỳ học" (1-indexed) theo NGÀY đã trôi qua kể từ semesterStartDate.
// Dùng chung để Dashboard (index.js) và TKB (calendar.js) luôn ra CÙNG 1 kết quả — trước đây
// mỗi nơi làm tròn kiểu khác nhau (Math.floor theo ngày vs Math.ceil theo mili-giây) nên có
// thể lệch 1 tuần ngay tại thời điểm nửa đêm giao giữa 2 tuần.
// ---------------------------------------------------------
function calcCurrentWeekNumber(now, semesterStartDate, maxW) {
    const diffDays = Math.floor((now.getTime() - semesterStartDate.getTime()) / (1000 * 60 * 60 * 24));
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
    return localStorage.getItem('customAccent') || null;
}

function setSavedAccentColor(hex) {
    localStorage.setItem('customAccent', hex);
}

function clearSavedAccentColor() {
    localStorage.removeItem('customAccent');
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
    localStorage.setItem('subjectCustomColors', JSON.stringify(saved));
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