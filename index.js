// SUPABASE_URL / SUPABASE_KEY nằm ở supabase-config.js (nạp trước file này trong index.html).

// Không tạo client ngay ở đây nữa — nếu CDN Supabase load lỗi/chậm (mạng yếu, bị chặn), gọi thẳng
// window.supabase.createClient() ở top-level sẽ ném lỗi ngay lúc parse file và làm crash toàn bộ
// index.js, khiến loader treo mãi mãi mà không có thông báo gì (bug y hệt đã từng xảy ra và được
// sửa ở profile.js). Giờ khởi tạo có kiểm tra bên trong initDashboard(), đồng bộ cách xử lý.
let dashClient = null;
let dashSubjects = [];
let semesterStartDate = new Date('2026-05-18');
let currentUserId = null;
// FIX: id của MÔN HỌC đang hiển thị ở Hero (nếu có) — dùng để lọc đúng BÀI TẬP/GHI CHÚ của
// riêng môn đó ở widget bên dưới. Trước đây widget lấy thẳng window.allTasks/allNotes (TOÀN
// BỘ ghi chú của MỌI môn học gộp chung), nên hero đang hiện "Cầu Lông 1" mà dưới lại lòi ra
// ghi chú của môn khác (vd "làm code theo HƯỚNG ĐỐI TƯỢNG") — rất dễ gây hiểu lầm. reset về
// null mỗi lần renderHero() chạy lại, chỉ gán khi thực sự có 1 môn học cụ thể đang hiển thị.
let heroSubjectId = null;
// Khi nhiều buổi cùng môn được gộp thành 1 khối ở Hero, mỗi buổi là 1 dòng subjects riêng (id khác
// nhau) -> widget Bài tập/Ghi chú phải lọc theo TẤT CẢ id của khối, không chỉ id đầu tiên.
let heroSubjectIds = [];
function setHeroSubjects(subs) {
    heroSubjectIds = (subs || []).map(s => s.id);
    heroSubjectId = heroSubjectIds.length ? heroSubjectIds[0] : null;
}

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

// ==========================================
// GIỜ RA CHƠI + GỘP BUỔI HỌC LIỀN NHAU
// Giờ ra chơi KHÔNG hardcode: tự suy ra từ khoảng trống giữa 2 tiết liên tiếp trong lưới giờ ở trên
// (vd tiết 2 hết 08:40, tiết 3 bắt đầu 09:00 -> ra chơi 08:40–09:00; tiết 7 hết 14:40, tiết 8 bắt
// đầu 15:00 -> ra chơi 14:40–15:00). Đổi lưới giờ là giờ ra chơi tự đổi theo.
// Khoảng trống dài hơn MERGE_MAX_BREAK_MIN (nghỉ trưa 11:30–13:00) không tính là ra chơi và không
// gộp 2 buổi học qua nó.
// ==========================================
const MERGE_MAX_BREAK_MIN = 30;

function computeGridGaps() {
    const nums = Object.keys(PERIOD_START_MINS).map(Number).sort((a, b) => a - b);
    const gaps = [];
    for (let i = 0; i < nums.length - 1; i++) {
        const breakStart = PERIOD_END_MINS[nums[i]];      // hết tiết trước
        const breakEnd = PERIOD_START_MINS[nums[i + 1]];  // vào tiết sau
        if (breakEnd > breakStart) {
            gaps.push({ startMin: breakStart, endMin: breakEnd, len: breakEnd - breakStart,
                        long: breakEnd - breakStart > MERGE_MAX_BREAK_MIN });
        }
    }
    return gaps;
}
const GRID_GAPS = computeGridGaps();
const GRID_BREAKS = GRID_GAPS.filter(g => !g.long);      // ra chơi (nằm trong 1 khối học)
const GRID_LONG_BREAKS = GRID_GAPS.filter(g => g.long);  // nghỉ trưa (11:30–13:00 với lưới hiện tại)

function fmtClock(mins) {
    return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
}

function baseSubjectName(sub) {
    return String(sub.name || 'Môn Ẩn').split('-')[0].split('(')[0].trim();
}

// Các buổi học của 1 ngày cụ thể (tuần weekIndex 0-indexed, thứ day theo quy ước 2..8), đã sắp theo giờ
function daySessions(week, day) {
    return dashSubjects
        .filter(sub => {
            if (sub.day !== day) return false;
            if (!sub.weeks || sub.weeks.length <= week) return false;
            const char = sub.weeks.charAt(week);
            return char !== '-' && char !== ' ';
        })
        .map(sub => ({ sub, range: parsePeriodRange(sub) }))
        .filter(x => x.range)
        .sort((a, b) => a.range.startMin - b.range.startMin);
}

function uniqueJoin(values, sep) {
    const seen = [];
    values.forEach(v => { const t = String(v || '').trim(); if (t && !seen.includes(t)) seen.push(t); });
    return seen.join(sep);
}

// Gộp các buổi CÙNG MÔN nằm liền nhau (kể cả chồng tiết, vd 1–3 rồi 3–5) thành 1 khối duy nhất.
// Trả về [{ subs, sub, name, startMin, endMin, hoursText, breaks }]
function buildBlocks(sessions) {
    const blocks = [];
    sessions.forEach(({ sub, range }) => {
        // Tìm khối gần nhất CÙNG MÔN (không chỉ khối cuối, phòng khi 2 môn khác nhau bị nhập chồng giờ)
        const key = baseSubjectName(sub).toLowerCase();
        const last = [...blocks].reverse().find(b => b.key === key);
        if (last && range.startMin - last.endMin <= MERGE_MAX_BREAK_MIN) {
            last.subs.push(sub);
            last.endMin = Math.max(last.endMin, range.endMin);
        } else {
            blocks.push({ key: baseSubjectName(sub).toLowerCase(), subs: [sub], startMin: range.startMin, endMin: range.endMin });
        }
    });
    return blocks.map(finalizeBlock);
}

function finalizeBlock(b) {
    const merged = b.subs.length > 1;
    return {
        subs: b.subs,
        sub: b.subs[0],
        name: baseSubjectName(b.subs[0]),
        startMin: b.startMin,
        endMin: b.endMin,
        // 1 buổi đơn giữ nguyên chuỗi giờ gốc; nhiều buổi gộp thì dựng lại từ lưới giờ
        hoursText: merged || !(b.subs[0].exact_time || b.subs[0].time_slot)
            ? `${fmtClock(b.startMin)} -> ${fmtClock(b.endMin)}`
            : (b.subs[0].exact_time || b.subs[0].time_slot),
        room: uniqueJoin(b.subs.map(s => s.room), ' / '),
        lecturer: uniqueJoin(b.subs.map(s => s.lecturer), ' / '),
        breaks: GRID_BREAKS.filter(br => br.startMin >= b.startMin && br.endMin <= b.endMin)
    };
}

// Khối (đã gộp) chứa buổi học `sub` vào tuần/ngày chỉ định; không tìm được thì trả về khối đơn
function blockForSession(sub, week, day) {
    const found = buildBlocks(daySessions(week, day)).find(b => b.subs.includes(sub));
    if (found) return found;
    const range = parsePeriodRange(sub);
    return finalizeBlock({
        subs: [sub],
        startMin: range ? range.startMin : 0,
        endMin: range ? range.endMin : 0
    });
}

// Các chip "Ra chơi" / "Nghỉ trưa" cho khối đang hiển thị.
// - Ra chơi: những khoảng nghỉ nằm TRONG khối (vd 14:40–15:00 với khối 13:00–17:30).
// - Nghỉ trưa: chỉ khi trong ngày CÓ buổi kết thúc đúng lúc bắt đầu nghỉ trưa (sáng học tới tiết 5, hết 11:30)
//   VÀ có buổi bắt đầu đúng lúc hết nghỉ trưa (chiều có tiết 6, vào 13:00). Hiện ở khối buổi sáng, hoặc ở
//   khối buổi chiều khi nó CHƯA bắt đầu (đang trong buổi sáng / đang nghỉ trưa).
function heroBreakChips(block, dayBlocks, status) {
    if (status === 'future') return []; // chip ra chơi chỉ có nghĩa trong ngày hôm nay
    const chips = block.breaks.map(b => ({ label: 'Ra chơi', icon: 'fa-mug-hot', startMin: b.startMin, endMin: b.endMin }));
    GRID_LONG_BREAKS.forEach(lunch => {
        const hasBefore = dayBlocks.some(x => x.endMin === lunch.startMin);
        const hasAfter = dayBlocks.some(x => x.startMin === lunch.endMin);
        if (!hasBefore || !hasAfter) return;
        const onMorning = block.endMin === lunch.startMin;
        const onAfternoon = block.startMin === lunch.endMin && status === 'today';
        if (onMorning || onAfternoon) chips.push({ label: 'Nghỉ trưa', icon: 'fa-utensils', startMin: lunch.startMin, endMin: lunch.endMin });
    });
    return chips.sort((a, b) => a.startMin - b.startMin);
}

// Chip chỉ hiện khi SẮP tới giờ nghỉ (trong HERO_BREAK_LEAD_MIN phút trước) hoặc đang nghỉ; nghỉ xong là ẩn.
// Nhờ vậy lúc mới vào học không bị chip ra chơi/nghỉ trưa chiếm chỗ khi còn rất lâu mới tới giờ.
const HERO_BREAK_LEAD_MIN = 30;
let heroBreakList = [];

function setHeroBreaks(chips) {
    heroBreakList = chips || [];
    paintHeroBreaks(new Date());
}

function paintHeroBreaks(d) {
    const box = document.getElementById('hero-breaks');
    if (!box) return;
    const cur = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
    box.textContent = '';
    heroBreakList
        .filter(c => cur < c.endMin && cur >= c.startMin - HERO_BREAK_LEAD_MIN)
        .forEach(c => {
            const now = cur >= c.startMin; // đang trong giờ nghỉ
            const el = document.createElement('span');
            el.className = 'hero-break' + (now ? ' now' : '');
            const icon = document.createElement('i');
            icon.className = 'fas ' + (c.icon || 'fa-mug-hot');
            const name = document.createElement('span');
            name.className = 'hb-name';
            name.textContent = now ? (c.label === 'Ra chơi' ? 'Đang ra chơi' : 'Đang nghỉ trưa') : c.label;
            const time = document.createElement('b');
            time.textContent = `${fmtClock(c.startMin)} – ${fmtClock(c.endMin)}`;
            const rel = document.createElement('em');
            rel.textContent = now ? `còn ${fmtHeroDuration(c.endMin - cur)}` : `sau ${fmtHeroDuration(c.startMin - cur)}`;
            el.append(icon, name, time, rel);
            box.appendChild(el);
        });
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
    dashClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

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
            const { data: settingsData } = await withRetry(() =>
                dashClient.from('user_settings').select('semester_start_date').eq('user_id', userId).single()
            );
            if (settingsData && settingsData.semester_start_date) {
                semesterStartDate = new Date(settingsData.semester_start_date + 'T00:00:00');
            }
        } catch (e) {}

        // Bọc withRetry() cho từng lời gọi: Supabase thỉnh thoảng có đợt hạ tầng chập chờn ngắn
        // khiến GET bị timeout/500-520 (xem shared.js -> withRetry để biết chi tiết) — tự thử lại
        // vài lần thay vì để cả Dashboard trắng dữ liệu chỉ vì 1 request thoáng qua bị lỗi.
        const [subjectsRes, examsRes, detailsRes] = await Promise.all([
            withRetry(() => dashClient.from('subjects').select('*').eq('user_id', userId)),
            withRetry(() => dashClient.from('exams').select('*').eq('user_id', userId)),
            withRetry(() => dashClient.from('subject_details').select('*').eq('user_id', userId).eq('status', 'upcoming'))
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

// ==========================================
// HERO: GIỜ HỌC LỚN + ĐẾM NGƯỢC (cập nhật mỗi 30s, tự render lại khi tới mốc)
// ==========================================
let heroTickTimer = null;
let heroLastArgs = null;

function fmtHeroDuration(mins) {
    mins = Math.max(0, Math.ceil(mins));
    if (mins < 60) return `${mins} phút`;
    const h = Math.floor(mins / 60), m = mins % 60;
    return m ? `${h}g ${m}p` : `${h}g`;
}

// "07:00 -> 09:50" => "07:00 – 09:50" (không để mũi tên làm xuống dòng)
function fmtHeroHours(raw) {
    return String(raw || '').replace(/\s*(?:->|→|=>)\s*/, ' – ').trim();
}

function stopHeroTick() {
    if (heroTickTimer) { clearInterval(heroTickTimer); heroTickTimer = null; }
}

// Trả hero về dạng chữ thường (các trạng thái "trống lịch", "kỳ học kết thúc"... tự gán innerText)
function resetHeroTimeRow() {
    stopHeroTick();
    const p = document.getElementById('mini-tkb-time');
    if (p) p.classList.remove('hero-time-row');
    setHeroBreaks([]);
}

// Dựng dòng: [NHÃN NGÀY] [GIỜ LỚN] [chip đếm ngược] — dùng textContent nên an toàn với dữ liệu từ DB
function setHeroTime(dayLabel, hoursText, chip) {
    const p = document.getElementById('mini-tkb-time');
    if (!p) return;
    p.textContent = '';
    p.classList.add('hero-time-row');
    const day = document.createElement('span');
    day.className = 'hero-day';
    day.textContent = dayLabel;
    p.appendChild(day);
    if (hoursText) {
        const hrs = document.createElement('span');
        hrs.className = 'hero-hours';
        hrs.textContent = fmtHeroHours(hoursText);
        p.appendChild(hrs);
    }
    if (chip && chip.text) {
        const c = document.createElement('span');
        c.id = 'hero-countdown';
        c.className = 'hero-countdown' + (chip.kind ? ' ' + chip.kind : '');
        c.textContent = chip.text;
        p.appendChild(c);
    }
}

// buildChip(now) -> {text, kind} | null. Khi trả null (tới mốc) => render lại hero để chuyển trạng thái.
function startHeroTick(buildChip) {
    stopHeroTick();
    heroTickTimer = setInterval(() => {
        paintHeroBreaks(new Date());
        const el = document.getElementById('hero-countdown');
        const chip = el ? buildChip(new Date()) : null;
        if (!chip) {
            stopHeroTick();
            if (heroLastArgs) {
                const before = heroSubjectId;
                renderHero(new Date(), heroLastArgs.weekIndex, heroLastArgs.examsData);
                if (heroSubjectId !== before) switchWidget(0, document.querySelector('.widget-tabs button.active'));
            }
            return;
        }
        el.textContent = chip.text;
        el.className = 'hero-countdown' + (chip.kind ? ' ' + chip.kind : '');
    }, 30000);
}

function classCountdownChip(status, range, d) {
    const cur = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
    if (status === 'ongoing') {
        const left = range.endMin - cur;
        if (left <= 0) return null;
        return { text: `Kết thúc sau ${fmtHeroDuration(left)}`, kind: 'live' };
    }
    if (status === 'today') {
        const until = range.startMin - cur;
        return until > 0 ? { text: `Bắt đầu sau ${fmtHeroDuration(until)}`, kind: until <= 15 ? 'soon' : '' } : null;
    }
    return null;
}

// Nhãn ngày: HÔM NAY / NGÀY MAI / THỨ X (· TUẦN N nếu không phải tuần này)
function heroDayLabel(sessionDay, curDay, status, sessionWeek, weekIndex) {
    if (status === 'ongoing' || status === 'today') return 'HÔM NAY';
    const dayName = sessionDay === 8 ? 'CHỦ NHẬT' : 'THỨ ' + sessionDay;
    const sameWeek = sessionWeek === weekIndex;
    const tomorrow = (sameWeek && sessionDay === curDay + 1) ||
                     (sessionWeek === weekIndex + 1 && curDay === 8 && sessionDay === 2);
    if (tomorrow) return 'NGÀY MAI';
    return sameWeek ? dayName : `${dayName} · TUẦN ${sessionWeek + 1}`;
}

function renderExamDayHero(exam, now) {
    const rawName = (exam.subject_name || 'Môn thi').trim();

    // Tính còn bao nhiêu phút tới giờ thi để quyết định mức độ khẩn cấp hiển thị
    let minutesUntilExam = null;
    let examStart = null;
    const timeMatch = String(exam.exam_time || '').match(/(\d{1,2}):(\d{2})/);
    if (timeMatch) {
        const examDateTime = new Date(now);
        examDateTime.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2]), 0, 0);
        minutesUntilExam = (examDateTime - now) / 60000;
        examStart = examDateTime;
    }

    const isUrgent = minutesUntilExam !== null && minutesUntilExam > 0 && minutesUntilExam <= 30;
    const isPast = minutesUntilExam !== null && minutesUntilExam <= 0;

    document.getElementById('mini-tkb-name').innerText = rawName;
    const examChipFor = (d) => {
        if (!examStart) return null;
        const m = (examStart - d) / 60000;
        return m > 0 ? { text: `Thi sau ${fmtHeroDuration(m)}`, kind: m <= 30 ? 'soon' : '' } : null;
    };
    setHeroTime(isPast ? 'ĐÃ THI XONG' : 'HÔM NAY', exam.exam_time || '', isPast ? null : examChipFor(now));
    if (!isPast && examStart) startHeroTick(examChipFor);
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
    heroLastArgs = { weekIndex, examsData };
    resetHeroTimeRow(); // dừng đếm ngược cũ + bỏ kiểu "giờ lớn" cho các trạng thái chỉ có chữ

    // Reset nhãn về mặc định "Giảng viên:" trước, tránh dính chữ "Mã MH:" từ lần render lịch thi trước đó
    const gvLabelReset = document.getElementById('mini-tkb-gv-label');
    if (gvLabelReset) gvLabelReset.innerText = 'Giảng viên:';

    // ƯU TIÊN HÀNG ĐẦU: nếu HÔM NAY có lịch thi, hiện ngay thông tin đó ở hero,
    // bất kể lịch học bình thường còn hay đã hết (thi quan trọng hơn lớp học thường)
    const todayExam = findTodayExam(examsData, now);
    if (todayExam) {
        setHeroSubjects([]); // ngày thi không gắn với 1 "subject_details.subject_id" cụ thể
        renderExamDayHero(todayExam, now);
        return;
    }

    if (!dashSubjects.length) {
        setHeroSubjects([]);
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

    let upcoming = null;   // buổi học đầu tiên của khối đang hiển thị
    let block = null;      // khối đã gộp các buổi cùng môn liền nhau (giờ, ra chơi, phòng, GV)
    let status = 'future'; // 'ongoing' (đang học) | 'today' (chưa tới giờ, học hôm nay) | 'future' (ngày khác)
    let dayBlocks = [];    // các khối của ngày đang hiển thị (để biết có nghỉ trưa không)
    let nextAfter = null;  // khối học kế tiếp { block, day }, để hiển thị khi lớp hiện tại kết thúc
    let upcomingWeek = weekIndex; // tuần (0-indexed) của buổi học đang hiển thị

    // Khối học kế tiếp ở ngày/tuần khác (đã gộp), hoặc null
    const nextFutureAfter = () => {
        const f = findNearestFutureSession(weekIndex, curDay);
        return f ? { block: blockForSession(f.sub, f.w, f.day), day: f.day } : null;
    };

    if (weekIndex >= 0) {
        // Gộp các tiết cùng môn nằm liền nhau (vd C# 13:00–15:50 rồi 15:50–17:30 -> 13:00–17:30)
        const activeToday = buildBlocks(daySessions(weekIndex, curDay));
        dayBlocks = activeToday;

        // 1. Có lớp nào ĐANG diễn ra đúng lúc này không? (so theo giờ thật, không chỉ theo ngày)
        // Giờ ra chơi nằm trong khối nên vẫn tính là đang học, không nhảy sang "lớp tiếp theo".
        const ongoingIdx = activeToday.findIndex(x => curMins >= x.startMin && curMins <= x.endMin);
        if (ongoingIdx !== -1) {
            block = activeToday[ongoingIdx];
            status = 'ongoing';
            const nextToday = activeToday[ongoingIdx + 1];
            nextAfter = nextToday ? { block: nextToday, day: curDay } : nextFutureAfter();
        } else {
            // 2. Chưa tới giờ nhưng vẫn còn lớp hôm nay phía trước
            const todayUpcoming = activeToday.find(x => x.startMin > curMins);
            if (todayUpcoming) {
                block = todayUpcoming;
                status = 'today';
            }
        }

        // 3. Hôm nay hết lịch (hoặc chưa có lịch hôm nay) -> tìm buổi gần nhất trong tương lai
        if (!block) {
            const found = findNearestFutureSession(weekIndex, curDay);
            if (found) {
                dayBlocks = buildBlocks(daySessions(found.w, found.day));
                block = dayBlocks.find(b => b.subs.includes(found.sub)) || blockForSession(found.sub, found.w, found.day);
                upcomingWeek = found.w;
                status = 'future';
            }
        }
        upcoming = block ? block.sub : null;
    }

    // ĐÃ SỬA: Khi lịch học kết thúc, background cũng sẽ random thay vì chỉ là màu Đỏ mặc định
    if (!upcoming) {
        setHeroSubjects([]);
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

    // FIX: lưu lại đúng id môn học đang hiển thị ở Hero, để widget BÀI TẬP/GHI CHÚ bên dưới lọc
    // đúng theo môn này (xem switchWidget) thay vì gộp chung ghi chú của mọi môn học lại.
    setHeroSubjects(block.subs);

    const rawName = block.name;
    document.getElementById('mini-tkb-name').innerText = rawName;
    // block có startMin/endMin/breaks -> dùng thẳng làm "range" cho chip đếm ngược (tính tới hết CẢ khối gộp)
    const classRange = block.endMin > block.startMin ? block : null;
    const classChipFor = (d) => classRange ? classCountdownChip(status, classRange, d) : null;
    setHeroTime(
        heroDayLabel(upcoming.day, curDay, status, upcomingWeek, weekIndex),
        block.hoursText,
        classChipFor(now)
    );
    setHeroBreaks(heroBreakChips(block, dayBlocks, status));
    if (status === 'ongoing' || status === 'today') startHeroTick(classChipFor);
    document.getElementById('mini-tkb-room').innerText = block.room || "N/A";
    document.getElementById('mini-tkb-gv').innerText = block.lecturer || "N/A";
    document.getElementById('val-bg-text').innerText = upcoming.course_code || "SGU";
    document.getElementById('hero-status').innerText =
        status === 'ongoing' ? "ĐANG DIỄN RA" :
        status === 'today' ? "SẮP DIỄN RA" : "LỚP TIẾP THEO";

    // Hiển thị "lớp kế tiếp" khi lớp hiện tại đang diễn ra, để dù hết tiết sớm vẫn biết tiết sau là gì
    if (status === 'ongoing' && nextAfter && nextLineEl && nextTextEl) {
        const dayLabel = nextAfter.day === curDay ? "hôm nay" : (nextAfter.day === 8 ? "Chủ Nhật" : "Thứ " + nextAfter.day);
        nextTextEl.innerText = `${nextAfter.block.name} • ${dayLabel}, ${nextAfter.block.hoursText}`;
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

    // TAB 3 "SẮP TỚI HẠN": gộp chung Bài Tập + Ghi Chú có đặt Hạn (due_date) thành 1 danh sách
    // DUY NHẤT, sắp theo hạn gần nhất lên đầu — kiểu "Agenda view" của Google Calendar. Khác 2 tab
    // kia, danh sách này KHÔNG lọc theo môn đang hiển thị ở Hero (heroSubjectId): mục đích là luôn
    // thấy được việc nào sắp tới hạn nhất trên toàn bộ workspace, bất kể Hero đang hiện môn nào.
    if (idx === 2) {
        const merged = [...(window.allTasks || []), ...(window.allNotes || [])]
            .filter(d => d.due_date)
            .sort((a, b) => a.due_date.localeCompare(b.due_date));

        if (!merged.length) {
            box.innerHTML = `<div class="empty-state"><i class="fas fa-calendar-check"></i> Không có việc/ghi chú nào sắp tới hạn.</div>`;
            return;
        }

        const todayStr = new Date().toISOString().slice(0, 10);
        const priorityDot = { high: '#ff4d4f', normal: '#ffb020', low: '#8b96a5' };
        box.innerHTML = merged.slice(0, 5).map(item => {
            const daysUntil = Math.round((new Date(item.due_date + 'T00:00:00') - new Date(todayStr + 'T00:00:00')) / 86400000);
            const dueLabel = daysUntil < 0 ? `Trễ ${-daysUntil} ngày` : (daysUntil === 0 ? 'Hôm nay' : `Còn ${daysUntil} ngày`);
            const typeLabel = item.type === 'task' ? 'Bài tập' : 'Ghi chú';
            const dotColor = priorityDot[item.priority] || priorityDot.normal;
            return `
            <div class="list-item" onclick="window.goToTab('timetable')">
                <div class="list-icon" style="color:${dotColor};"><i class="fas fa-circle" style="font-size:8px;"></i></div>
                <div class="list-text"><h4>${item.content ? escapeHtml(item.content) : "Trống"}</h4><p>${typeLabel} · ${dueLabel}</p></div>
            </div>`;
        }).join('');
        return;
    }

    const rawData = idx === 0 ? (window.allTasks || []) : (window.allNotes || []);
    // FIX: CHỈ hiện đúng bài tập/ghi chú của MÔN đang hiển thị ở Hero phía trên (so theo
    // subject_details.subject_id), thay vì gộp ghi chú của TẤT CẢ môn học lại — trước đây hero
    // đang hiện "Cầu Lông 1" mà widget dưới lại lòi ra ghi chú của môn hoàn toàn khác, gây hiểu
    // lầm là ghi chú đó thuộc về môn đang hiển thị.
    const data = heroSubjectIds.length ? rawData.filter(d => heroSubjectIds.includes(d.subject_id)) : [];
    const icon = idx === 0 ? 'fa-tasks' : 'fa-pen';

    if (!data.length) {
        const emptyMsg = !heroSubjectIds.length
            ? "Không có môn học cụ thể đang hiển thị."
            : (idx === 0 ? "Xong hết bài tập môn này!" : "Chưa có ghi chú nào cho môn này.");
        box.innerHTML = `<div class="empty-state"><i class="fas ${idx === 0 ? 'fa-check-circle' : 'fa-sticky-note'}"></i> ${emptyMsg}</div>`;
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