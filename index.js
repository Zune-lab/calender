// DÁN MÃ SUPABASE CỦA BẠN VÀO 2 DÒNG DƯỚI ĐÂY:
const dashUrl = 'https://oyumvhldhmjmahohavsp.supabase.co';
const dashKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im95dW12aGxkaG1qbWFob2hhdnNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMDU0MTEsImV4cCI6MjA5Nzc4MTQxMX0.Wl_SANDz_-FQUaFQwcKXVFVz1Oo1YJNJ-0yMWF_aM1c';

// Không tạo client ngay ở đây nữa — nếu CDN Supabase load lỗi/chậm (mạng yếu, bị chặn), gọi thẳng
// window.supabase.createClient() ở top-level sẽ ném lỗi ngay lúc parse file và làm crash toàn bộ
// index.js, khiến loader treo mãi mãi mà không có thông báo gì (bug y hệt đã từng xảy ra và được
// sửa ở profile.js). Giờ khởi tạo có kiểm tra bên trong initDashboard(), đồng bộ cách xử lý.
let dashClient = null;
let dashSubjects = [];
let semesterStartDate = new Date('2026-05-18');
let currentUserId = null;

// escapeHtml(), parseVNExamDate() và toàn bộ logic màu accent (ACCENT_POOL,
// hashStringToIndex, resolveAccentForUser...) giờ nằm ở shared.js
// (load trước file này trong index.html)

// ==========================================
// LƯỚI GIỜ TIẾT HỌC SGU (đồng bộ với sguStartTime/sguEndTime trong tkb/calendar.js)
// Dùng để biết CHÍNH XÁC một lớp đang diễn ra hay chưa, thay vì chỉ so "cùng ngày"
// ==========================================
const PERIOD_START_MINS = { 1:420, 2:470, 3:540, 4:590, 5:640, 6:780, 7:830, 8:900, 9:950, 10:1000, 11:1060, 12:1110, 13:1160, 14:1210 };
const PERIOD_END_MINS   = { 1:470, 2:520, 3:590, 4:640, 5:690, 6:830, 7:880, 8:950, 9:1000, 10:1050, 11:1110, 12:1160, 13:1210, 14:1260 };

function parsePeriodRange(sub) {
    const match = (sub.time_slot || '').match(/Tiết\s*(\d+)(?:\s*-\s*(\d+))?/i);
    if (!match) return null;
    const startP = parseInt(match[1]);
    const endP = match[2] ? parseInt(match[2]) : startP;
    const startMin = PERIOD_START_MINS[startP];
    const endMin = PERIOD_END_MINS[endP];
    if (startMin === undefined || endMin === undefined) return null;
    return { startMin, endMin };
}

// Tìm buổi học gần nhất trong tương lai, bắt đầu tìm SAU (afterWeek, afterDay) — dùng cho
// cả trường hợp "hết lịch hôm nay" lẫn "lớp đang học xong thì lớp kế tiếp là gì"
function findNearestFutureSession(afterWeek, afterDay) {
    let candidates = [];
    dashSubjects.forEach(sub => {
        if (!sub.weeks) return;
        for (let w = afterWeek; w < sub.weeks.length; w++) {
            const char = sub.weeks.charAt(w);
            if (char !== '-' && char !== ' ') {
                if (w > afterWeek || (w === afterWeek && sub.day > afterDay)) {
                    candidates.push({ sub, w, day: sub.day });
                    break;
                }
            }
        }
    });
    if (!candidates.length) return null;
    candidates.sort((a, b) => {
        if (a.w !== b.w) return a.w - b.w;
        if (a.day !== b.day) return a.day - b.day;
        const ra = parsePeriodRange(a.sub), rb = parsePeriodRange(b.sub);
        return (ra ? ra.startMin : 0) - (rb ? rb.startMin : 0);
    });
    return candidates[0];
}

// resolveDisplayName() giờ nằm ở shared.js (dùng chung với calendar.js, tránh mỗi nơi
// tự viết lại logic full_name/hide_email/email riêng)

// ==========================================
// ÁP DỤNG THEME ĐÃ LƯU (đọc/áp dụng dùng chung qua applyTheme() ở shared.js; chỉnh theme
// chỉ còn 1 nơi duy nhất — tab Cài Đặt ở TKB — Dashboard chỉ đọc lại để hiển thị đúng)
// ==========================================
applyTheme();

// ==========================================
// ẢNH NỀN TUỲ CHỈNH — giờ dùng chung qua bg-sync.js (đồng bộ với TKB + Hồ Sơ, sửa 1 chỗ ở
// đó là cả 3 trang đổi theo, không còn 3 bản copy-paste khác nhau nữa).
// ==========================================
if (window.syncCustomBackground) syncCustomBackground();

// Ẩn/hiện lại blob ambient NGAY khi ảnh nền tuỳ chỉnh được đổi (từ Cài Đặt TKB, Hồ Sơ, hoặc
// từ 1 tab khác) — không cần đợi tới lần render hero kế tiếp mới cập nhật theo.
window.addEventListener('customBackgroundChange', (e) => {
    const ambient = document.querySelector('.ambient-bg');
    if (ambient) ambient.style.display = e.detail.active ? 'none' : '';
    const scrim = document.getElementById('bg-scrim');
    if (scrim) scrim.classList.toggle('active', !!e.detail.active);
    // FIX "CHỮ KHÓ ĐỌC TRÊN ẢNH NỀN TUỲ CHỈNH": trước đây chữ trên thẻ TKB chỉ đổi theo
    // light/dark mode, không quan tâm ẢNH NỀN thực tế sáng hay tối -> chữ trắng chìm vào ảnh
    // trắng, hoặc chữ đen chìm vào ảnh tối. Giờ bg-sync.js tự ĐO độ sáng trung bình của ảnh
    // (event.detail.isLightBg) và ở đây chỉ cần bật đúng class màu chữ tương ứng — không phụ
    // thuộc đang bật light hay dark mode nữa. Xem rule ở index.css (body.has-custom-bg /
    // body.has-custom-bg.bg-photo-light).
    document.body.classList.toggle('has-custom-bg', !!e.detail.active);
    document.body.classList.toggle('bg-photo-light', !!e.detail.active && !!e.detail.isLightBg);
});

// ==========================================
// TÔ MÀU AMBIENT BLOB THEO ACCENT (thay cho set background-image phẳng 1 màu cũ)
// ==========================================
function applyAmbientTint(hexColor) {
    if (window.hasCustomBackground ? window.hasCustomBackground() : localStorage.getItem('customBg')) {
        // Người dùng đã đặt ảnh nền tuỳ chỉnh (ở Cài Đặt TKB/Hồ Sơ) -> ẩn blob, không đè lên,
        // đồng thời bật lớp kính mờ (.bg-scrim) để phủ dịu ảnh nền, giúp chữ luôn đọc rõ.
        const ambient = document.querySelector('.ambient-bg');
        if (ambient) ambient.style.display = 'none';
        const scrim = document.getElementById('bg-scrim');
        if (scrim) scrim.classList.add('active');
        document.body.classList.add('has-custom-bg'); // xem ghi chú ở listener 'customBackgroundChange' phía trên
        // Hero có thể được render lại (đổi accent) TRƯỚC KHI bg-sync.js đo xong độ sáng ảnh lần
        // đầu — dùng cache đã đo được gần nhất (mặc định false = coi ảnh tối) thay vì bỏ trống.
        document.body.classList.toggle('bg-photo-light', !!(window.isCustomBackgroundLight && window.isCustomBackgroundLight()));
        return;
    }
    document.body.classList.remove('has-custom-bg');
    document.body.classList.remove('bg-photo-light');
    const blobA = document.getElementById('ambient-blob-a');
    const blobB = document.getElementById('ambient-blob-b');
    if (blobA) blobA.style.background = `radial-gradient(circle, ${hexColor}48 0%, transparent 60%)`;
    // Blob-b: màu BÙ thật (180° - tương phản chuẩn theo lý thuyết màu), nhưng giảm bão hòa
    // + tăng nhẹ độ sáng để nó là "counterpoint" êm dịu, không cạnh tranh gắt với blob-a
    if (blobB) blobB.style.background = `radial-gradient(circle, ${softComplement(hexColor)}32 0%, transparent 60%)`;
}

// Tính màu bù (180°) đã giảm bão hòa + tăng sáng nhẹ -> tương phản nhưng dịu mắt
function softComplement(hex) {
    return shiftHue(hex, 180, 0.55, 0.12);
}

// Dịch hue của 1 màu hex đi X độ, có thể tuỳ chỉnh hệ số bão hòa (satFactor)
// và cộng thêm độ sáng (lightBoost, 0-1) -> tạo màu thứ 2 hài hòa cho blob-b
function shiftHue(hex, degrees, satFactor = 1, lightBoost = 0) {
    let r = parseInt(hex.slice(1, 3), 16) / 255;
    let g = parseInt(hex.slice(3, 5), 16) / 255;
    let b = parseInt(hex.slice(5, 7), 16) / 255;

    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max === min) { h = s = 0; }
    else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            default: h = (r - g) / d + 4;
        }
        h /= 6;
    }

    h = (h * 360 + degrees) % 360 / 360;
    s = Math.max(0, Math.min(1, s * satFactor));
    l = Math.max(0, Math.min(1, l + lightBoost));

    function hue2rgb(p, q, t) {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
    }

    let r2, g2, b2;
    if (s === 0) { r2 = g2 = b2 = l; }
    else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r2 = hue2rgb(p, q, h + 1/3);
        g2 = hue2rgb(p, q, h);
        b2 = hue2rgb(p, q, h - 1/3);
    }

    const toHex = v => Math.round(v * 255).toString(16).padStart(2, '0');
    return '#' + toHex(r2) + toHex(g2) + toHex(b2);
}

function renderProfilePill(user, meta) {
    const profileWrap = document.querySelector('.top-right-profile');
    if (!profileWrap) return;

    meta = meta || {};

    // 1. Chỉ tìm và cập nhật Avatar/Info, tuyệt đối KHÔNG dùng innerHTML ghi đè để bảo toàn nút Toggle
    let avatarDiv = profileWrap.querySelector('.profile-avatar');
    let infoDiv = profileWrap.querySelector('.profile-info');

    if (meta.avatar) {
        // CÓ AVT: hiển thị ảnh, ẩn phần text thông tin đi. Vẫn gắn title = tên đã resolve
        // (tôn trọng hide_email) để hover vào avatar là biết đang đăng nhập bằng ai, tránh
        // toggle "Ẩn Email công khai" trở nên vô nghĩa với tài khoản đã có avatar.
        profileWrap.classList.add('avatar-only');
        const nameToShow = resolveDisplayName(user, meta);
        if (avatarDiv) {
            avatarDiv.innerHTML = `<img src="${meta.avatar}" title="${escapeHtml(nameToShow)}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
        }
        if (infoDiv) infoDiv.style.display = 'none';
    } else {
        // CHƯA CÓ AVT: hiển thị Icon và Email
        profileWrap.classList.remove('avatar-only');
        const nameToShow = resolveDisplayName(user, meta);
        
        if (avatarDiv) avatarDiv.innerHTML = `<i class="fas fa-user-graduate"></i>`;
        if (infoDiv) {
            infoDiv.style.display = 'flex';
            const emailDisplay = infoDiv.querySelector('#user-email-display');
            if (emailDisplay) emailDisplay.innerText = nameToShow;
        }
    }

    // 2. Click vào khung Avatar/Info -> nhảy sang trang Profile
    profileWrap.style.cursor = 'pointer';
    profileWrap.title = "Sửa Hồ Sơ Của Bạn";
    profileWrap.onclick = () => {
        localStorage.setItem('profileReturnTo', '../index.html');
        navigateWithFade('profile/profile.html');
    };
}

// navigateWithFade() giờ nằm ở bg-sync.js (dùng chung với calendar.js, tránh lặp code)

async function initDashboard() {
    // 1. Ép bật màn hình Loading ngay khi hàm bắt đầu chạy
    const loader = document.getElementById('global-loader');
    if (loader) loader.classList.remove('hidden');

    // Kiểm tra thư viện Supabase (CDN) đã load thành công chưa TRƯỚC khi tạo client — tránh
    // crash im lặng nếu mạng lỗi/CDN bị chặn (đồng bộ với cách profile.js đang xử lý).
    if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
        if (loader) loader.classList.add('hidden');
        document.getElementById('mini-tkb-name').innerText = "LỖI TẢI THƯ VIỆN";
        document.getElementById('mini-tkb-time').innerText = "Không tải được Supabase (CDN). Kiểm tra kết nối mạng rồi tải lại trang.";
        return;
    }
    dashClient = window.supabase.createClient(dashUrl, dashKey);

    // FIX "LOADER TREO VÔ THỜI HẠN NẾU MẤT MẠNG/API LỖI GIỮA CHỪNG": trước đây chỉ có bước kiểm
    // tra CDN Supabase ở trên là được bọc chống lỗi — getSession() và Promise.all() bên dưới hoàn
    // toàn không có try/catch, nên nếu 1 trong các lời gọi mạng đó bị reject (mất mạng giữa chừng,
    // Supabase timeout, RLS chặn...) thì lỗi rơi vào unhandled rejection: loader đứng hình mãi mãi,
    // không có bất kỳ thông báo nào cho người dùng biết chuyện gì đang xảy ra. Thêm watchdog (10s)
    // + bọc try/catch quanh toàn bộ phần còn lại, đồng bộ đúng tinh thần đã áp dụng ở profile.js.
    const dashWatchdog = setTimeout(() => {
        if (loader) loader.classList.add('hidden');
        document.getElementById('mini-tkb-name').innerText = "TẢI QUÁ LÂU";
        document.getElementById('mini-tkb-time').innerText = "Kiểm tra kết nối mạng hoặc mở Console (F12) để xem lỗi chi tiết, rồi tải lại trang.";
    }, 10000);

    try {
        const { data: { session } } = await dashClient.auth.getSession();
        if (!session) { clearTimeout(dashWatchdog); return window.location.href = 'tkb/calendar.html'; }

        const userId = session.user.id;
        currentUserId = userId;
        const meta = session.user.user_metadata || {};

        renderProfilePill(session.user, meta);

        try {
            const { data: settingsData } = await dashClient
                .from('user_settings')
                .select('semester_start_date')
                .eq('user_id', userId)
                .single();
            if (settingsData && settingsData.semester_start_date) {
                semesterStartDate = new Date(settingsData.semester_start_date + 'T00:00:00');
            }
        } catch (e) {}

        const [subjectsRes, examsRes, detailsRes] = await Promise.all([
            dashClient.from('subjects').select('*').eq('user_id', userId),
            dashClient.from('exams').select('*').eq('user_id', userId),
            dashClient.from('subject_details').select('*').eq('user_id', userId).eq('status', 'upcoming')
        ]);

        dashSubjects = subjectsRes.data || [];
        const allDetails = detailsRes.data || [];
        window.allTasks = allDetails.filter(d => d.type === 'task');
        window.allNotes = allDetails.filter(d => d.type === 'note' || d.type === 'notification');

        const now = new Date();
        const diffDays = Math.floor((now - semesterStartDate) / (1000 * 60 * 60 * 24));
        // weekIndex là 0-indexed (dùng để tra cứu ký tự trong chuỗi "weeks" bitmap), nên trừ 1
        // so với calcCurrentWeekNumber() (1-indexed, ở shared.js) — cùng 1 công thức làm tròn,
        // chỉ khác quy ước đánh số, để Dashboard và trang TKB không bao giờ lệch tuần nhau.
        const weekIndex = diffDays >= 0 ? calcCurrentWeekNumber(now, semesterStartDate) - 1 : -1;

        let activeClassesThisWeek = 0;
        if (weekIndex >= 0) {
            activeClassesThisWeek = dashSubjects.filter(sub => {
                if (!sub.weeks || sub.weeks.length <= weekIndex) return false;
                const char = sub.weeks.charAt(weekIndex);
                return char !== '-' && char !== ' ';
            }).length;
        }

        const uniqueSubs = new Set(dashSubjects.map(s => String(s.name || '').split('-')[0].split('(')[0].trim().toLowerCase()));
        document.getElementById('stat-total-subs').innerText = uniqueSubs.size;
        document.getElementById('stat-tkb-count').innerText = activeClassesThisWeek;
        document.getElementById('stat-exam-count').innerText = (examsRes.data || []).length;

        renderHero(now, weekIndex, examsRes.data || []);
        switchWidget(0, document.querySelector('.widget-tabs button.active'));

        const mainUI = document.getElementById('main-dashboard-ui');
        if (mainUI) {
            mainUI.style.opacity = '1';
            mainUI.style.pointerEvents = 'auto';
        }

        clearTimeout(dashWatchdog);

        // FIX BUG "1-2 KHUNG HÌNH BỊ MỜ/LOANG MÀU LÚC VỪA VÀO" (giống hệt bug ở calendar.js):
        // #main-dashboard-ui fade-in mất 500ms (transition:opacity 0.5s ease khai báo ở index.html)
        // nhưng loader trước đây chỉ đợi 250ms rồi ẩn -> khi mạng nhanh, loader biến mất TRƯỚC khi UI
        // hiện đủ 100% opacity, lộ ra khung hình mờ/loang trong khoảnh khắc ngắn. Tăng lên 550ms.
        setTimeout(() => {
            const loader2 = document.getElementById('global-loader');
            if (loader2) loader2.classList.add('hidden');
        }, 550);
    } catch (err) {
        clearTimeout(dashWatchdog);
        if (loader) loader.classList.add('hidden');
        document.getElementById('mini-tkb-name').innerText = "LỖI KẾT NỐI";
        document.getElementById('mini-tkb-time').innerText = "Không tải được dữ liệu: " + (err && err.message ? err.message : "Vui lòng kiểm tra kết nối mạng rồi tải lại trang.");
        console.error('[Dashboard] initDashboard lỗi:', err);
    }
}

// ==========================================
// LỊCH THI HÔM NAY -> ƯU TIÊN HIỆN Ở HERO DASHBOARD
// ==========================================
function findTodayExam(examsData, now) {
    if (!examsData || !examsData.length) return null;

    // FIX BUG "LỊCH THI HÔM NAY KHÔNG BAO GIỜ HIỆN VỚI NGÀY DẠNG DD/MM/YY (năm 2 số)":
    // trước đây ở đây có 1 bản parseExamDate() TỰ VIẾT RIÊNG, khác bản dùng chung
    // parseVNExamDate() ở shared.js — bản riêng này chỉ nhận diện được năm khi p[0] HOẶC p[2]
    // dài đúng 4 ký tự, nên với "05/09/26" (DD/MM/YY, năm 2 số) cả 2 điều kiện đều sai ->
    // luôn trả về null -> exam hôm nay không bao giờ được phát hiện, dù đúng ngày, không có lỗi
    // hay cảnh báo gì để nhận ra. Dùng lại đúng parseVNExamDate() dùng chung (đã xử lý đúng cả
    // DD/MM/YYYY, YYYY-MM-DD, DD-MM-YYYY, DD/MM/YY) để không còn 2 bản logic lệch nhau nữa.
    const todayStr = now.toDateString();
    return examsData.find(exam => {
        const d = parseVNExamDate(exam.exam_date);
        return d && d.toDateString() === todayStr;
    }) || null;
}

function renderExamDayHero(exam, now) {
    const rawName = (exam.subject_name || 'Môn thi').trim();

    // Tính còn bao nhiêu phút tới giờ thi để quyết định mức độ khẩn cấp hiển thị
    let minutesUntilExam = null;
    const timeMatch = String(exam.exam_time || '').match(/(\d{1,2}):(\d{2})/);
    if (timeMatch) {
        const examDateTime = new Date(now);
        examDateTime.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2]), 0, 0);
        minutesUntilExam = (examDateTime - now) / 60000;
    }

    const isUrgent = minutesUntilExam !== null && minutesUntilExam > 0 && minutesUntilExam <= 30;
    const isPast = minutesUntilExam !== null && minutesUntilExam <= 0;

    document.getElementById('mini-tkb-name').innerText = rawName;
    document.getElementById('mini-tkb-time').innerText = isPast
        ? `ĐÃ THI XONG  •  ${exam.exam_time || ''}`
        : `HÔM NAY  •  ${exam.exam_time || ''}`;
    document.getElementById('mini-tkb-room').innerText = exam.room || "N/A";
    document.getElementById('mini-tkb-gv').innerText = exam.course_code || "—";
    document.getElementById('val-bg-text').innerText = exam.course_code || "THI";
    document.getElementById('hero-status').innerText = isUrgent
        ? `⚠ CÒN ${Math.ceil(minutesUntilExam)} PHÚT NỮA!`
        : (isPast ? "ĐÃ THI XONG HÔM NAY" : "LỊCH THI HÔM NAY");

    // Nhãn "Giảng viên" vốn dùng cho lớp học thường -> đổi nhãn cho đúng ngữ cảnh thi
    const gvLabel = document.getElementById('mini-tkb-gv-label');
    if (gvLabel) gvLabel.innerText = 'Mã MH:';

    const finalColor = isUrgent ? '#ff1744' : '#FF3366';
    document.documentElement.style.setProperty('--accent', finalColor);
    applyAmbientTint(finalColor);
}

function renderHero(now, weekIndex, examsData) {
    const nextLineEl = document.getElementById('tkb-next-line');
    const nextTextEl = document.getElementById('tkb-next-text');
    if (nextLineEl) nextLineEl.style.display = 'none'; // mặc định ẩn, chỉ bật khi có dữ liệu thật

    // Reset nhãn về mặc định "Giảng viên:" trước, tránh dính chữ "Mã MH:" từ lần render lịch thi trước đó
    const gvLabelReset = document.getElementById('mini-tkb-gv-label');
    if (gvLabelReset) gvLabelReset.innerText = 'Giảng viên:';

    // ƯU TIÊN HÀNG ĐẦU: nếu HÔM NAY có lịch thi, hiện ngay thông tin đó ở hero,
    // bất kể lịch học bình thường còn hay đã hết (thi quan trọng hơn lớp học thường)
    const todayExam = findTodayExam(examsData, now);
    if (todayExam) {
        renderExamDayHero(todayExam, now);
        return;
    }

    if (!dashSubjects.length) {
        document.getElementById('mini-tkb-name').innerText = "TRỐNG LỊCH HỌC";
        document.getElementById('mini-tkb-time').innerText = "Click icon TKB bên phải để tải dữ liệu";
        document.getElementById('val-bg-text').innerText = "SGU";
        document.getElementById('hero-status').innerText = "CHƯA CÓ DỮ LIỆU";
        
        // Màu accent khi chưa nhập TKB — ưu tiên màu người dùng tự chọn ở Cài Đặt,
        // nếu chưa có thì rơi về hash ổn định theo tài khoản (xem shared.js)
        const randomColor = resolveAccentForUser(currentUserId);
        document.documentElement.style.setProperty('--accent', randomColor);
        applyAmbientTint(randomColor);
        return;
    }

    const curDay = now.getDay() === 0 ? 8 : now.getDay() + 1;
    const curMins = now.getHours() * 60 + now.getMinutes();

    let upcoming = null;
    let status = 'future'; // 'ongoing' (đang học) | 'today' (chưa tới giờ, học hôm nay) | 'future' (ngày khác)
    let nextAfter = null;  // buổi học kế tiếp, để hiển thị khi lớp hiện tại kết thúc

    if (weekIndex >= 0) {
        const activeToday = dashSubjects
            .filter(sub => {
                if (sub.day !== curDay) return false;
                if (!sub.weeks || sub.weeks.length <= weekIndex) return false;
                const char = sub.weeks.charAt(weekIndex);
                return char !== '-' && char !== ' ';
            })
            .map(sub => ({ sub, range: parsePeriodRange(sub) }))
            .filter(x => x.range)
            .sort((a, b) => a.range.startMin - b.range.startMin);

        // 1. Có lớp nào ĐANG diễn ra đúng lúc này không? (so theo giờ thật, không chỉ theo ngày)
        const ongoingIdx = activeToday.findIndex(x => curMins >= x.range.startMin && curMins <= x.range.endMin);
        if (ongoingIdx !== -1) {
            upcoming = activeToday[ongoingIdx].sub;
            status = 'ongoing';
            const nextToday = activeToday[ongoingIdx + 1];
            nextAfter = nextToday ? { sub: nextToday.sub, day: curDay } : findNearestFutureSession(weekIndex, curDay);
        } else {
            // 2. Chưa tới giờ nhưng vẫn còn lớp hôm nay phía trước
            const todayUpcoming = activeToday.find(x => x.range.startMin > curMins);
            if (todayUpcoming) {
                upcoming = todayUpcoming.sub;
                status = 'today';
            }
        }

        // 3. Hôm nay hết lịch (hoặc chưa có lịch hôm nay) -> tìm buổi gần nhất trong tương lai
        if (!upcoming) {
            const found = findNearestFutureSession(weekIndex, curDay);
            if (found) {
                upcoming = found.sub;
                status = 'future';
            }
        }
    }

    // ĐÃ SỬA: Khi lịch học kết thúc, background cũng sẽ random thay vì chỉ là màu Đỏ mặc định
    if (!upcoming) {
        if (weekIndex < 0) {
            // weekIndex = -1 nghĩa là semesterStartDate còn nằm trong TƯƠNG LAI -> kỳ CHƯA bắt đầu,
            // không phải đã kết thúc. Tách nhánh riêng để không hiển thị nhầm "KỲ HỌC KẾT THÚC".
            // diffDays được tính riêng trong initDashboard() nên KHÔNG tồn tại ở đây -> phải tự
            // tính lại từ (now, semesterStartDate) là 2 biến sẵn có trong phạm vi renderHero.
            const diffDaysLocal = Math.floor((now - semesterStartDate) / (1000 * 60 * 60 * 24));
            const daysLeft = Math.abs(diffDaysLocal);
            document.getElementById('mini-tkb-name').innerText = "KỲ HỌC CHƯA BẮT ĐẦU";
            document.getElementById('mini-tkb-time').innerText = `Còn ${daysLeft} ngày nữa tới khai giảng`;
            document.getElementById('mini-tkb-room').innerText = "—";
            document.getElementById('mini-tkb-gv').innerText = "—";
            document.getElementById('val-bg-text').innerText = "SOON";
            document.getElementById('hero-status').innerText = "SẮP KHAI GIẢNG";
        } else {
            // weekIndex >= 0 nhưng vẫn không tìm được buổi học nào trong toàn bộ chuỗi weeks
            // -> đây mới là trường hợp thực sự đã học hết lịch (KỲ HỌC KẾT THÚC).
            document.getElementById('mini-tkb-name').innerText = "KỲ HỌC KẾT THÚC";
            document.getElementById('mini-tkb-time').innerText = "Lịch học chính thức đã hoàn thành!";
            document.getElementById('mini-tkb-room').innerText = "Tại Gia";
            document.getElementById('mini-tkb-gv').innerText = "Tự Ôn Tập";
            document.getElementById('val-bg-text').innerText = "FINISH";
            document.getElementById('hero-status').innerText = "CHÚC BẠN THI TỐT";
        }

        // Màu accent khi chưa/đã hết kỳ học — ưu tiên màu người dùng tự chọn ở Cài Đặt,
        // nếu chưa có thì rơi về hash ổn định theo tài khoản (xem shared.js)
        const randomColor = resolveAccentForUser(currentUserId);
        document.documentElement.style.setProperty('--accent', randomColor);
        applyAmbientTint(randomColor);
        return;
    }

    const rawName = (upcoming.name || 'Môn Ẩn').split('-')[0].split('(')[0].trim();
    document.getElementById('mini-tkb-name').innerText = rawName;
    document.getElementById('mini-tkb-time').innerText = `${upcoming.day === curDay ? "HÔM NAY" : (upcoming.day === 8 ? "CHỦ NHẬT" : "THỨ " + upcoming.day)}  •  ${upcoming.exact_time || upcoming.time_slot || ''}`;
    document.getElementById('mini-tkb-room').innerText = upcoming.room || "N/A";
    document.getElementById('mini-tkb-gv').innerText = upcoming.lecturer || "N/A";
    document.getElementById('val-bg-text').innerText = upcoming.course_code || "SGU";
    document.getElementById('hero-status').innerText =
        status === 'ongoing' ? "ĐANG DIỄN RA" :
        status === 'today' ? "SẮP DIỄN RA" : "LỚP TIẾP THEO";

    // Hiển thị "lớp kế tiếp" khi lớp hiện tại đang diễn ra, để dù hết tiết sớm vẫn biết tiết sau là gì
    if (status === 'ongoing' && nextAfter && nextLineEl && nextTextEl) {
        const nextRawName = (nextAfter.sub.name || 'Môn Ẩn').split('-')[0].split('(')[0].trim();
        const dayLabel = nextAfter.day === curDay ? "hôm nay" : (nextAfter.day === 8 ? "Chủ Nhật" : "Thứ " + nextAfter.day);
        nextTextEl.innerText = `${nextRawName} • ${dayLabel}, ${nextAfter.sub.exact_time || nextAfter.sub.time_slot || ''}`;
        nextLineEl.style.display = 'flex';
    }

    const colors = ['#FF3366', '#00C9FF', '#7c3aed', '#11998e', '#FDBB2D'];
    let colorMap = {}, i = 0;
    dashSubjects.forEach(s => {
        const bn = (s.name || '').split('-')[0].split('(')[0].trim().toLowerCase();
        if (!colorMap[bn]) colorMap[bn] = colors[i++ % colors.length];
    });

    const savedColors = getSavedSubjectColors();
    // GIỮ NGUYÊN THEO YÊU CẦU: màu ở đây LUÔN theo đúng môn học đang hiển thị (không bị màu
    // 'customAccent' ở Cài Đặt ghi đè), để nhìn màu là biết ngay sắp học môn gì. "Đổi màu Accent
    // hệ thống" ở Cài Đặt chỉ có tác dụng ở các màn hình KHÔNG có môn học cụ thể để tô theo
    // (chưa nhập TKB, kỳ học chưa bắt đầu/đã kết thúc) — xem nhánh "if (!upcoming)" phía trên.
    const finalColor = savedColors[rawName.toLowerCase()] || colorMap[rawName.toLowerCase()] || '#ff4655';

    document.documentElement.style.setProperty('--accent', finalColor);
    applyAmbientTint(finalColor);
}

window.switchWidget = function(idx, btn) {
    if(btn) {
        btn.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    const box = document.getElementById('widget-dynamic-content');
    if(!box) return;

    const data = idx === 0 ? (window.allTasks || []) : (window.allNotes || []);
    const icon = idx === 0 ? 'fa-tasks' : 'fa-pen';

    if (!data.length) {
        box.innerHTML = `<div class="empty-state"><i class="fas ${idx === 0 ? 'fa-check-circle' : 'fa-sticky-note'}"></i> ${idx === 0 ? "Xong hết bài tập!" : "Chưa có ghi chú nào."}</div>`;
        return;
    }

    box.innerHTML = data.slice(0, 3).map(item => `
        <div class="list-item" onclick="window.goToTab('timetable')">
            <div class="list-icon" style="color: var(--accent);"><i class="fas ${icon}"></i></div>
            <div class="list-text"><h4>${item.content ? escapeHtml(item.content) : "Trống"}</h4><p>Click mở Workspace</p></div>
        </div>
    `).join('');
};

// ==========================================
// CẦU NỐI NHẢY TAB TỪ DASHBOARD VÀO WORKSPACE
// ==========================================
window.goToTab = function(tabName) {
    localStorage.setItem('targetTab', tabName);
    navigateWithFade('tkb/calendar.html');
};

window.logout = async () => {
    if (dashClient) await dashClient.auth.signOut();
    navigateWithFade('tkb/calendar.html');
};

initDashboard();

// ==========================================
// PWA: ĐĂNG KÝ SERVICE WORKER
// Cần thiết để trình duyệt cho phép "Cài đặt ứng dụng" (app chạy độc lập, có icon riêng,
// chỉ dùng được trên máy đã cài) và để nhận Push Notification thật (xem sw.js).
// ==========================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(err => {
            console.warn('[PWA] Không đăng ký được Service Worker:', err.message);
        });
    });
}