// THAY MÃ SUPABASE CỦA BẠN VÀO ĐÂY (giữ đồng bộ với index.js và tkb/calendar.js):
const supabaseUrl = 'https://oyumvhldhmjmahohavsp.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im95dW12aGxkaG1qbWFob2hhdnNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMDU0MTEsImV4cCI6MjA5Nzc4MTQxMX0.Wl_SANDz_-FQUaFQwcKXVFVz1Oo1YJNJ-0yMWF_aM1c';

let base64Image = null;

// ==========================================
// LỐI TẮT CHUYỂN TRANG NHANH (Dashboard / TKB / Lịch Thi / Cài Đặt)
// ==========================================
window.navigateFromProfile = function(url, tabName) {
    if (tabName) localStorage.setItem('targetTab', tabName);
    window.location.href = url;
};

// ==========================================
// QUAY LẠI ĐÚNG NƠI ĐÃ VÀO PROFILE (TKB hoặc Dashboard)
// ==========================================
window.goBackFromProfile = function() {
    const returnTo = localStorage.getItem('profileReturnTo') || '../index.html';
    localStorage.removeItem('profileReturnTo');
    window.location.href = returnTo;
};

// ==========================================
// 0. MÀU ACCENT CỐ ĐỊNH THEO TÀI KHOẢN (hash từ user ID, tránh trùng màu môn học đã lưu)
//    Cùng 1 tài khoản sẽ luôn ra cùng 1 màu mỗi lần vào Profile, thay vì random mỗi lần tải trang.
//    Ở light-mode: tự giảm sáng/giảm chói vì màu gốc được thiết kế cho nền tối.
// ==========================================
// ACCENT_POOL, hashStringToIndex(), getSavedAccentColor(), resolveAccentForUser()...
// giờ nằm ở shared.js (load trước file này trong profile.html)
let currentAccentBase = null;

function applyAccentColor(hex) {
    currentAccentBase = hex;
    let r = parseInt(hex.slice(1, 3), 16);
    let g = parseInt(hex.slice(3, 5), 16);
    let b = parseInt(hex.slice(5, 7), 16);

    if (document.body.classList.contains('light-mode')) {
        // Giảm sáng ~28% để bớt chói trên nền trắng, vẫn giữ đúng sắc màu gốc
        const darken = 0.72;
        r = Math.round(r * darken);
        g = Math.round(g * darken);
        b = Math.round(b * darken);
    }

    const finalHex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    document.documentElement.style.setProperty('--accent', finalHex);

    // Nếu người dùng đã có ảnh nền tuỳ chỉnh (gán thẳng lên body.style.backgroundImage, xem khối
    // "ẢNH NỀN TUỲ CHỈNH" phía dưới), KHÔNG được ghi đè mất ảnh đó bằng gradient accent này —
    // cả 2 đều dùng chung 1 thuộc tính background-image trên body.
    if (!(window.hasCustomBackground ? window.hasCustomBackground() : localStorage.getItem('customBg'))) {
        document.body.style.backgroundImage = `radial-gradient(circle at 30% 0%, ${finalHex}25 0%, transparent 55%)`;
    }
}

function pickAccentForUser(userId) {
    // Nếu người dùng đã tự chọn màu ở tab Cài Đặt (tkb/calendar.html) thì luôn ưu tiên
    // dùng đúng màu đó, khỏi cần hash gì thêm.
    const customColor = getSavedAccentColor();
    if (customColor) {
        applyAccentColor(customColor);
        return;
    }

    // getSavedSubjectColors() (shared.js) đã tự try/catch bên trong rồi, không cần bọc thêm ở đây.
    const usedColors = Object.values(getSavedSubjectColors());

    let available = ACCENT_POOL.filter(c => !usedColors.includes(c));
    if(!available.length) available = ACCENT_POOL;

    const chosenColor = available[hashStringToIndex(userId, available.length)];
    applyAccentColor(chosenColor);
}

// ==========================================
// 1. THEME — applyTheme() giờ dùng chung ở shared.js
// ==========================================
applyTheme();

// ==========================================
// ẢNH NỀN TUỲ CHỈNH — trang Hồ Sơ không còn UI tự đổi ảnh nữa (đã bỏ card riêng), chỉ CÒN
// hiển thị lại đúng ảnh nền đã đổi từ Dashboard/TKB, qua bg-sync.js dùng chung. Lưu ý:
// applyAccentColor() ở trên đã tự kiểm tra hasCustomBackground() để KHÔNG ghi đè mất ảnh
// (cả 2 đều dùng chung thuộc tính background-image của body).
// ==========================================
if (window.syncCustomBackground) syncCustomBackground();
updateTopbarScrimFromBg();

// Nếu ảnh nền đổi (từ trang này, trang khác, hoặc tab khác) trong lúc đang xem Profile, áp lại
// ngay màu accent hiện tại để nó tự quyết định có vẽ gradient hay không (xem applyAccentColor),
// đồng thời lấy lại màu chủ đạo của ảnh mới để tô lại thanh topbar.
window.addEventListener('customBackgroundChange', () => {
    if (currentAccentBase) applyAccentColor(currentAccentBase);
    updateTopbarScrimFromBg();
});

// ==========================================
// THANH TOPBAR LẤY ĐÚNG MÀU ẢNH NỀN — đọc chính background-image đang áp trên <body> (dù là
// ảnh tuỳ chỉnh do bg-sync.js gán, hay gradient accent do applyAccentColor() gán), lấy màu
// trung bình của ảnh và dùng THẲNG màu đó làm --topbar-scrim, không pha trộn/kéo về đen-trắng
// gì cả — thanh topbar phải đúng màu ảnh nền như yêu cầu. Phần cần đổi để dễ đọc là MÀU CHỮ
// (--topbar-text / --topbar-muted): dựa vào độ sáng của đúng màu đó để chọn chữ trắng hay đen,
// không đụng vào màu thanh.
// ==========================================
function updateTopbarScrimFromBg() {
    const bgImage = getComputedStyle(document.body).backgroundImage;
    const match = bgImage.match(/url\(["']?(.*?)["']?\)/);

    if (!match) {
        // Không có ảnh nền tuỳ chỉnh (chỉ có gradient hoặc trống) -> bỏ override, trả lại
        // đúng giá trị mặc định theo theme mà :root / .light-mode đã định nghĩa sẵn.
        document.body.style.removeProperty('--topbar-scrim');
        document.body.style.removeProperty('--topbar-text');
        document.body.style.removeProperty('--topbar-muted');
        return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
        try {
            const size = 24; // thu nhỏ ảnh trước khi đọc pixel cho nhanh, chỉ cần màu trung bình
            const canvas = document.createElement('canvas');
            canvas.width = size; canvas.height = size;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, size, size);

            const { data } = ctx.getImageData(0, 0, size, size);
            let r = 0, g = 0, b = 0, count = 0;
            for (let i = 0; i < data.length; i += 4) {
                r += data[i]; g += data[i + 1]; b += data[i + 2];
                count++;
            }
            r = Math.round(r / count); g = Math.round(g / count); b = Math.round(b / count);

            // Thanh topbar = đúng màu trung bình của ảnh, không pha gì thêm.
            document.body.style.setProperty('--topbar-scrim', `rgba(${r}, ${g}, ${b}, 0.6)`);

            // Độ sáng cảm nhận của đúng màu đó (0 = tối, 255 = sáng) để chọn chữ trắng hay đen.
            const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
            const bgIsLight = luminance > 150;
            document.body.style.setProperty('--topbar-text', bgIsLight ? '#1f2328' : '#ffffff');
            document.body.style.setProperty('--topbar-muted', bgIsLight ? 'rgba(15, 18, 22, 0.65)' : 'rgba(255, 255, 255, 0.75)');
        } catch (err) {
            // Ảnh dính CORS (nguồn ngoài, không phải data URL) -> không đọc được pixel, âm thầm
            // bỏ qua và giữ nguyên màu scrim mặc định thay vì làm vỡ trang.
            console.warn('[Profile] Không lấy được màu ảnh nền cho topbar:', err);
        }
    };
    img.src = match[1];
}

// ==========================================
// 2. HIỂN THỊ LỖI RÕ RÀNG NGAY TRÊN TRANG (thay vì đứng im khó hiểu)
// ==========================================
function showFatalError(message) {
    const subtitle = document.getElementById('user-email');
    if (subtitle) {
        subtitle.innerText = "⚠ " + message;
        subtitle.style.color = '#ff8a93';
    }
    console.error('[Profile]', message);
}

// Nếu sau 8 giây vẫn chưa load xong -> báo lỗi rõ ràng, tránh im lặng khó hiểu
let loadWatchdog = setTimeout(() => {
    showFatalError("Tải quá lâu — kiểm tra kết nối mạng hoặc mở Console (F12) để xem lỗi chi tiết.");
}, 8000);

// ==========================================
// 3. KHỞI TẠO SUPABASE CLIENT (kiểm tra kỹ trước khi dùng)
// ==========================================
async function bootProfile() {
    if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
        clearTimeout(loadWatchdog);
        showFatalError("Không tải được thư viện Supabase (CDN). Kiểm tra kết nối mạng rồi tải lại trang.");
        return;
    }

    const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);
    window._sbClient = supabase; // để saveProfile() dùng lại, tránh tạo client 2 lần

    let session;
    try {
        const result = await supabase.auth.getSession();
        session = result.data.session;
    } catch (err) {
        clearTimeout(loadWatchdog);
        showFatalError("Lỗi kết nối Supabase: " + err.message);
        return;
    }

    clearTimeout(loadWatchdog);

    if (!session) {
        window.location.href = '../tkb/calendar.html';
        return;
    }

    pickAccentForUser(session.user.id);
    updateTopbarScrimFromBg();

    try {
        document.getElementById('user-email').innerText = session.user.email;
        document.getElementById('user-email').style.color = '';
        const emailField2 = document.getElementById('user-email-2');
        if (emailField2) emailField2.innerText = session.user.email;

        const joined = session.user.created_at ? new Date(session.user.created_at) : null;
        if (joined) {
            document.getElementById('user-joined').innerText = joined.toLocaleDateString('vi-VN');
        }

        const meta = session.user.user_metadata || {};

        if (meta.avatar) {
            base64Image = meta.avatar;
            document.getElementById('avatar-container').innerHTML = `<img src="${meta.avatar}">`;
            document.getElementById('remove-avatar-btn').style.display = 'inline-flex';
        }
        if (meta.full_name) {
            document.getElementById('display-name').value = meta.full_name;
        }
        document.getElementById('hide-email-toggle').checked = !!meta.hide_email;
    } catch (err) {
        showFatalError("Lỗi khi hiển thị dữ liệu hồ sơ: " + err.message);
    }
}

// ==========================================
// 4. AVATAR UPLOAD (nén ảnh về webp 150x150)
// ==========================================
document.getElementById('file-input').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(event) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = 150; canvas.height = 150;
            const size = Math.min(img.width, img.height);
            const x = (img.width - size) / 2; const y = (img.height - size) / 2;

            ctx.drawImage(img, x, y, size, size, 0, 0, 150, 150);
            base64Image = canvas.toDataURL('image/webp', 0.6);
            document.getElementById('avatar-container').innerHTML = `<img src="${base64Image}">`;
            document.getElementById('remove-avatar-btn').style.display = 'inline-flex';
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
});

window.removeAvatar = function() {
    base64Image = null;
    document.getElementById('avatar-container').innerHTML = `<i class="fas fa-user-astronaut"></i>`;
    document.getElementById('remove-avatar-btn').style.display = 'none';
    document.getElementById('file-input').value = '';
};

// ==========================================
// 5. SAVE
// ==========================================
window.saveProfile = async function() {
    const btn = document.getElementById('save-btn');
    const statusEl = document.getElementById('save-status');
    const newName = document.getElementById('display-name').value.trim();
    const hideEmail = document.getElementById('hide-email-toggle').checked;

    if (!window._sbClient) {
        statusEl.textContent = "Chưa kết nối được Supabase, không thể lưu.";
        statusEl.className = 'save-status err';
        return;
    }

    btn.disabled = true;
    btn.innerText = "ĐANG ĐỒNG BỘ...";
    statusEl.textContent = '';
    statusEl.className = 'save-status';

    const { error } = await window._sbClient.auth.updateUser({
        data: {
            avatar: base64Image,
            full_name: newName,
            hide_email: hideEmail
        }
    });

    if (error) {
        statusEl.textContent = "Lỗi: " + error.message;
        statusEl.className = 'save-status err';
    } else {
        statusEl.textContent = "Đã lưu hồ sơ thành công!";
        statusEl.className = 'save-status ok';
    }

    btn.disabled = false;
    btn.innerText = "LƯU THAY ĐỔI";
};

bootProfile();

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('../sw.js').catch(() => {});
    });
}