// =========================================================
// ẢNH NỀN MÀN HÌNH KHOÁ — quản lý link ảnh tự cập nhật (Edge Function `wallpaper`).
// Người dùng tạo 1 TOKEN riêng (bảng wallpaper_tokens, RLS chỉ cho chủ sở hữu) -> app dựng link
//   <SUPABASE_URL>/functions/v1/wallpaper?t=<token>&w=..&h=..&accent=..
// Dán link này vào iOS Shortcuts (Automation hằng ngày) / Tasker để điện thoại tự đặt ảnh nền mới.
// Ảnh xem trước trong Cài Đặt dùng chính link đó nên luôn khớp với ảnh sẽ nhận trên điện thoại.
// =========================================================

const WALLPAPER_SIZES = {
    '1179x2556': 'iPhone 15 / 16 / 17',
    '1290x2796': 'iPhone Plus / Pro Max',
    '1170x2532': 'iPhone 12 / 13 / 14',
    '1080x2400': 'Android (FHD+)',
    '1440x3120': 'Android (QHD+)',
};
let wallpaperToken = null;
let wallpaperBusy = false;

function wallpaperGenToken() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);                       // 256 bit ngẫu nhiên mật mã học
    let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); // base64url, 43 ký tự
}

function wallpaperSize() {
    let saved = null;
    try { saved = localStorage.getItem('wallpaperSize'); } catch (e) {}
    return WALLPAPER_SIZES[saved] ? saved : '1179x2556';
}

function wallpaperUrl(withCacheBust) {
    if (!wallpaperToken) return '';
    const [w, h] = wallpaperSize().split('x');
    const accent = (typeof getSavedAccentColor === 'function' && getSavedAccentColor()) || '';
    let url = `${SUPABASE_URL}/functions/v1/wallpaper?t=${encodeURIComponent(wallpaperToken)}&w=${w}&h=${h}`;
    if (/^#[0-9a-fA-F]{6}$/.test(accent)) url += `&accent=${accent.slice(1)}`;
    if (withCacheBust) url += `&_=${Date.now()}`;
    return url;
}

function wallpaperRender() {
    const box = document.getElementById('wallpaper-box');
    if (!box) return;
    if (!wallpaperToken) {
        box.innerHTML = `
            <button type="button" class="glass-btn" id="wallpaper-create-btn" style="margin-top: 14px;">Tạo link ảnh nền</button>`;
        document.getElementById('wallpaper-create-btn').onclick = () => wallpaperSaveToken(false);
        return;
    }
    const sizeOpts = Object.entries(WALLPAPER_SIZES)
        .map(([k, label]) => `<option value="${k}"${k === wallpaperSize() ? ' selected' : ''}>${escapeHtml(label)} (${k.replace('x', '×')})</option>`).join('');
    box.innerHTML = `
        <div class="wallpaper-layout">
            <div class="wallpaper-phone"><div class="wallpaper-phone-screen">
                <img id="wallpaper-preview" alt="Xem trước ảnh nền màn hình khoá">
                <div class="wallpaper-preview-msg" id="wallpaper-preview-msg">Đang vẽ ảnh…</div>
            </div></div>
            <div class="wallpaper-controls">
                <label class="wallpaper-label" for="wallpaper-size">Kích thước màn hình</label>
                <select id="wallpaper-size" class="wallpaper-input">${sizeOpts}</select>
                <label class="wallpaper-label" for="wallpaper-url">Link ảnh (giữ bí mật — ai có link xem được lịch của bạn)</label>
                <input id="wallpaper-url" class="wallpaper-input" type="text" readonly>
                <div class="wallpaper-actions">
                    <button type="button" class="glass-btn" id="wallpaper-copy">Sao chép link</button>
                    <button type="button" class="glass-btn" id="wallpaper-download">Tải ảnh PNG</button>
                    <button type="button" class="glass-btn" id="wallpaper-refresh">Làm mới</button>
                </div>
                <div class="wallpaper-actions">
                    <button type="button" class="glass-btn" id="wallpaper-regen">Tạo lại link (thu hồi link cũ)</button>
                    <button type="button" class="glass-btn" id="wallpaper-delete">Tắt tính năng</button>
                </div>
                <details class="wallpaper-help">
                    <summary>Cách tự cập nhật hằng ngày trên iPhone</summary>
                    <ol>
                        <li>Mở ứng dụng <b>Phím tắt</b> → tab <b>Tự động hóa</b> → tạo mới <b>Thời gian trong ngày</b> (vd 06:00, lặp lại hằng ngày, chọn “Chạy ngay”).</li>
                        <li>Thêm hành động <b>Lấy nội dung của URL</b> và dán link ở trên.</li>
                        <li>Thêm hành động <b>Đặt hình nền</b> (Set Wallpaper), chọn Màn hình khóa và tắt “Hiện bản xem trước”.</li>
                    </ol>
                    Android: dùng Tasker/MacroDroid với hành động tải URL rồi đặt hình nền khoá.
                </details>
            </div>
        </div>`;
    wallpaperLoadPreview();
    document.getElementById('wallpaper-url').value = wallpaperUrl(false);
    document.getElementById('wallpaper-size').onchange = function () {
        try { localStorage.setItem('wallpaperSize', this.value); } catch (e) {}
        document.getElementById('wallpaper-url').value = wallpaperUrl(false);
        wallpaperLoadPreview();
    };
    document.getElementById('wallpaper-refresh').onclick = wallpaperLoadPreview;
    document.getElementById('wallpaper-copy').onclick = wallpaperCopy;
    document.getElementById('wallpaper-download').onclick = wallpaperDownload;
    document.getElementById('wallpaper-regen').onclick = async () => {
        if (await showConfirm('Link cũ sẽ ngừng hoạt động ngay. Bạn cần dán link mới vào Phím tắt/Tasker. Tiếp tục?', 'Tạo lại link')) wallpaperSaveToken(true);
    };
    document.getElementById('wallpaper-delete').onclick = async () => {
        if (await showConfirm('Tắt tính năng sẽ xoá link hiện tại; ảnh nền đã đặt trên điện thoại không bị ảnh hưởng. Tiếp tục?', 'Tắt ảnh nền tự động')) wallpaperDeleteToken();
    };
}

function wallpaperLoadPreview() {
    const img = document.getElementById('wallpaper-preview');
    const msg = document.getElementById('wallpaper-preview-msg');
    if (!img || !msg) return;
    msg.style.display = 'flex'; msg.textContent = 'Đang vẽ ảnh…'; img.style.opacity = '0';
    img.onload = () => { msg.style.display = 'none'; img.style.opacity = '1'; };
    img.onerror = () => {
        msg.style.display = 'flex';
        msg.textContent = 'Chưa xem được ảnh. Hãy chắc chắn đã deploy Edge Function “wallpaper” (xem supabase/wallpaper_setup.sql).';
    };
    img.src = wallpaperUrl(true);
}

async function wallpaperCopy() {
    const url = wallpaperUrl(false);
    try { await navigator.clipboard.writeText(url); showAlert('Đã sao chép link ảnh nền.', 'Hoàn tất'); }
    catch (e) {
        const input = document.getElementById('wallpaper-url');
        if (input) { input.focus(); input.select(); }
        showAlert('Không tự sao chép được — link đã được bôi đen, hãy nhấn giữ để sao chép.', 'Sao chép thủ công');
    }
}

async function wallpaperDownload() {
    const btn = document.getElementById('wallpaper-download');
    if (btn) btn.disabled = true;
    try {
        const res = await fetch(wallpaperUrl(true));
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const blobUrl = URL.createObjectURL(await res.blob());
        const a = document.createElement('a');
        a.href = blobUrl; a.download = `man-hinh-khoa-${fmtLocalDate(new Date())}.png`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 4000);
    } catch (e) {
        showAlert('Không tải được ảnh. Kiểm tra mạng và việc đã deploy Edge Function “wallpaper”.', 'Lỗi tải ảnh');
    } finally { if (btn) btn.disabled = false; }
}

async function wallpaperSaveToken(isRegen) {
    if (wallpaperBusy || !currentUser) return;
    wallpaperBusy = true;
    const token = wallpaperGenToken();
    const { error } = await sbClient.from('wallpaper_tokens')
        .upsert({ user_id: currentUser.id, token }, { onConflict: 'user_id' });
    wallpaperBusy = false;
    if (error) {
        console.error('[Wallpaper] Lỗi lưu token:', error);
        const missing = error.code === '42P01' || /wallpaper_tokens/.test(error.message || '');
        showAlert(missing
            ? 'Chưa có bảng wallpaper_tokens trong Supabase. Hãy chạy file supabase/wallpaper_setup.sql trước.'
            : 'Không tạo được link: ' + error.message, 'Lỗi');
        return;
    }
    wallpaperToken = token;
    wallpaperRender();
    if (isRegen) showAlert('Đã tạo link mới. Nhớ cập nhật lại trong Phím tắt/Tasker.', 'Hoàn tất');
}

async function wallpaperDeleteToken() {
    if (wallpaperBusy || !currentUser) return;
    wallpaperBusy = true;
    const { error } = await sbClient.from('wallpaper_tokens').delete().eq('user_id', currentUser.id);
    wallpaperBusy = false;
    if (error) { showAlert('Không tắt được: ' + error.message, 'Lỗi'); return; }
    wallpaperToken = null;
    wallpaperRender();
}

async function wallpaperInit() {
    if (!document.getElementById('wallpaper-box')) return;
    if (!(await plannerWaitForUser())) return;
    wallpaperToken = null; // đổi tài khoản không tải lại trang: không được giữ token (link xem lịch) của người trước
    const { data, error } = await sbClient.from('wallpaper_tokens').select('token').eq('user_id', currentUser.id).maybeSingle();
    // Bảng chưa tạo (42P01) = người dùng chưa bật tính năng: vẫn hiện nút tạo, lỗi cụ thể báo khi bấm
    if (!error && data) wallpaperToken = data.token;
    wallpaperRender();
}

// Gọi lại mỗi khi có người dùng MỚI đăng nhập (handleSession ở calendar-1-core.js) — trước đây chỉ chạy 1 lần lúc
// mở trang: đăng nhập sau 10s thì hộp ảnh nền không bao giờ khởi tạo, đổi tài khoản thì hiện nhầm link của tài khoản cũ.
window.onUserSessionStart = (window.onUserSessionStart || []).concat(wallpaperInit);
