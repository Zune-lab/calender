// THAY MÃ SUPABASE CỦA BẠN VÀO ĐÂY (giữ đồng bộ với dashboard.js và tkb/app.js):
const supabaseUrl = 'https://oyumvhldhmjmahohavsp.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im95dW12aGxkaG1qbWFob2hhdnNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMDU0MTEsImV4cCI6MjA5Nzc4MTQxMX0.Wl_SANDz_-FQUaFQwcKXVFVz1Oo1YJNJ-0yMWF_aM1c';

let base64Image = null;
let originalMeta = {};

// ==========================================
// QUAY LẠI ĐÚNG NƠI ĐÃ VÀO PROFILE (TKB hoặc Dashboard)
// ==========================================
window.goBackFromProfile = function() {
    const returnTo = localStorage.getItem('profileReturnTo') || '../dashboard.html';
    localStorage.removeItem('profileReturnTo');
    window.location.href = returnTo;
};

// ==========================================
// 0. RANDOM MÀU ACCENT (tránh trùng màu môn học đã lưu trong localStorage)
//    Ở light-mode: tự giảm sáng/giảm chói vì màu gốc được thiết kế cho nền tối.
// ==========================================
const ACCENT_POOL = ['#FF3366', '#00C9FF', '#7c3aed', '#11998e', '#FDBB2D', '#22C1C3', '#E100FF', '#92FE9D', '#0A84FF', '#f97316'];
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
    document.documentElement.style.setProperty('--accent-r', r);
    document.documentElement.style.setProperty('--accent-g', g);
    document.documentElement.style.setProperty('--accent-b', b);
}

function pickRandomAccent() {
    let usedColors = [];
    try {
        const saved = JSON.parse(localStorage.getItem('subjectCustomColors') || '{}');
        usedColors = Object.values(saved);
    } catch(e){}
    
    let available = ACCENT_POOL.filter(c => !usedColors.includes(c));
    if(!available.length) available = ACCENT_POOL;
    
    const randomColor = available[Math.floor(Math.random() * available.length)];
    applyAccentColor(randomColor);
    
    // QUAN TRỌNG: Xóa lệnh chèn background cũ để nhường quyền cho CSS xử lý Light Mode
    document.body.style.backgroundImage = ''; 
}

// ==========================================
// 1. THEME (đồng bộ localStorage 'theme' dùng chung toàn hệ thống)
// ==========================================
function applyTheme() {
    const isLight = localStorage.getItem('theme') === 'light';
    document.body.classList.toggle('light-mode', isLight);
}
applyTheme();
pickRandomAccent();

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
        window.location.href = '../tkb/index.html';
        return;
    }

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
        originalMeta = meta;

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
