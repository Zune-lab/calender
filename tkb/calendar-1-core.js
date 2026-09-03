// ===== calendar-1-core.js =====
// Phần 1/5 của calendar.js (tách file để dễ bảo trì, mỗi file < 1000 dòng).
// Nội dung: Custom dialog, đăng nhập/chuyển tab, dropdown menu, nút quay lại từ Profile,
// khởi tạo tuần học, loadTimetable().
// LƯU Ý: các file được nạp bằng nhiều thẻ <script> KHÔNG dùng module, nên vẫn chia sẻ chung
// 1 global scope — PHẢI giữ đúng thứ tự nạp trong calendar.html:
// calendar-1-core.js -> calendar-2-timetable-modal.js -> calendar-3-personalization.js
// -> calendar-4-planner-notify.js -> calendar-5-planner-ui.js

const supabaseUrl = 'https://oyumvhldhmjmahohavsp.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im95dW12aGxkaG1qbWFob2hhdnNwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMDU0MTEsImV4cCI6MjA5Nzc4MTQxMX0.Wl_SANDz_-FQUaFQwcKXVFVz1Oo1YJNJ-0yMWF_aM1c';
// Không gọi window.supabase.createClient() ngay ở top-level nữa — nếu CDN Supabase load lỗi/chậm
// (mạng yếu, bị chặn), việc này sẽ ném lỗi ngay lúc parse file và crash toàn bộ calendar.js trước
// khi bất kỳ dòng nào khác kịp chạy. Dời việc khởi tạo có kiểm tra vào bên trong DOMContentLoaded
// (đồng bộ với cách profile.js đang xử lý sự cố này).
let sbClient = null;

let currentUser = null;
let currentSubjectId = null;
let allLoadedSubjects = []; 

// getSavedSubjectColors() / saveSubjectColor() giờ nằm ở shared.js (dùng chung với
// index.js và profile.js, tránh mỗi nơi tự JSON.parse localStorage riêng)

let semesterStartDate = new Date('2026-05-18'); 

// FIX BUG "THANH MỜ KHÔNG PHỦ HẾT CÁC THỨ": lưu ResizeObserver để hủy bản cũ mỗi lần render lại
// bảng TKB, tránh tạo nhiều observer chồng chéo gây rò rỉ bộ nhớ.
let _stickyBarResizeObserver = null;

// =========================================
// 0. CUSTOM DIALOG LOGIC (THAY THẾ ALERT/CONFIRM)
// =========================================
window.showCustomDialog = function(message, isConfirm = false, title = "Thông báo") {
    return new Promise((resolve) => {
        const overlay = document.getElementById('custom-dialog-overlay');
        const titleEl = document.getElementById('custom-dialog-title');
        const msgEl = document.getElementById('custom-dialog-msg');
        const cancelBtn = document.getElementById('custom-dialog-cancel');
        const okBtn = document.getElementById('custom-dialog-ok');

        titleEl.innerText = title;
        msgEl.innerHTML = message.replace(/\n/g, '<br>');

        if (isConfirm) {
            cancelBtn.style.display = 'inline-flex';
        } else {
            cancelBtn.style.display = 'none';
        }

        overlay.classList.remove('hidden');

        // Hàm dọn dẹp và đóng popup
        const cleanup = () => {
            overlay.classList.add('hidden');
            // Clone node để xóa bỏ mọi event listener rác của lần mở trước
            cancelBtn.replaceWith(cancelBtn.cloneNode(true));
            okBtn.replaceWith(okBtn.cloneNode(true));
        };

        // Gắn sự kiện cho các nút mới
        const newCancelBtn = document.getElementById('custom-dialog-cancel');
        const newOkBtn = document.getElementById('custom-dialog-ok');

        newCancelBtn.addEventListener('click', () => { cleanup(); resolve(false); });
        newOkBtn.addEventListener('click', () => { cleanup(); resolve(true); });
    });
};

window.showAlert = (msg, title) => window.showCustomDialog(msg, false, title);
window.showConfirm = (msg, title) => window.showCustomDialog(msg, true, title);


// =========================================
// 1. QUẢN LÝ ĐĂNG NHẬP & CHUYỂN TAB
// =========================================
document.addEventListener('DOMContentLoaded', () => {
    // Kiểm tra thư viện Supabase (CDN) đã load thành công chưa TRƯỚC khi tạo client — tránh
    // crash im lặng nếu mạng lỗi/CDN bị chặn, hiện thông báo rõ ràng thay vì treo màn hình loading.
    if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
        const loader = document.getElementById('global-loader');
        if (loader) loader.classList.add('hidden');
        window.showCustomDialog && window.showCustomDialog(
            "Không tải được thư viện Supabase (CDN). Kiểm tra kết nối mạng rồi tải lại trang.",
            false, "Lỗi kết nối"
        );
        console.error('[TKB] Không tải được thư viện Supabase (CDN).');
        return;
    }
    sbClient = window.supabase.createClient(supabaseUrl, supabaseKey);

    sbClient.auth.getSession().then(({ data: { session } }) => { handleSession(session); });
    sbClient.auth.onAuthStateChange((_event, session) => { handleSession(session); });

    updateDesktopClock();
    setInterval(updateDesktopClock, 1000);

    // Tự làm mới Lịch Thi mỗi 60s để badge "Còn X phút nữa!" luôn đúng thời gian thực,
    // chỉ gọi khi người dùng đang thật sự đứng ở tab Lịch Thi (tránh gọi Supabase thừa)
    setInterval(() => {
        const examsPane = document.getElementById('tab-exams');
        if (examsPane && examsPane.classList.contains('active') && typeof loadExams === 'function') {
            loadExams();
        }
    }, 60000);
    renderNeonColorButtons();
    renderAccentColorPresets();
    initPriorityPickers();

    // FIX: 2 ô chọn "Hạn" (note-due-date, task-due-date) trước đây không giới hạn gì, người
    // dùng bấm vào lịch có thể chọn lùi về NGÀY ĐÃ QUA (vô lý vì hạn công việc/ghi chú không
    // thể ở quá khứ). Set min = đúng ngày hôm nay -> trình duyệt tự khoá, không cho bấm chọn
    // ngày trước đó trong lịch popup nữa (chỉ chọn được hôm nay trở đi).
    const todayInputStr = plannerFmtDateInput(new Date());
    ['note-due-date', 'task-due-date'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.min = todayInputStr;
    });
    initCustomDatePicker('note-due-date');
    initCustomDatePicker('task-due-date');

    const plannerLeadSelect = document.getElementById('planner-notif-lead-select');
    if (plannerLeadSelect) plannerLeadSelect.value = String(getPlannerNotifLeadMin());
    initNotifLeadCustomSelect();
    
    const themeToggle = document.getElementById('theme-toggle');
    const themeSystemToggle = document.getElementById('theme-system-toggle');

    // Bật/tắt trạng thái khoá của công tắc thủ công (Sáng/Tối) tuỳ theo có đang ở chế độ
    // "Theo giao diện hệ thống" hay không — không cho bấm công tắc thủ công khi HĐH đang
    // quyết định theme, tránh gây hiểu nhầm là đổi được nhưng bấm không ăn thua gì.
    function syncManualSwitchLockState(isSystemMode) {
        if (!themeToggle) return;
        themeToggle.disabled = isSystemMode;
        themeToggle.checked = applyTheme();
    }

    if (themeToggle) {
        const isSystemModeNow = localStorage.getItem('theme') === 'system';
        if (themeSystemToggle) themeSystemToggle.checked = isSystemModeNow;
        syncManualSwitchLockState(isSystemModeNow);

        // Đổi công tắc thủ công -> luôn thoát khỏi chế độ "Theo giao diện hệ thống" (nếu đang
        // bật), vì người dùng vừa tự chọn rõ ràng 1 theme cụ thể.
        themeToggle.addEventListener('change', function() {
            if (themeSystemToggle) themeSystemToggle.checked = false;
            if (this.checked) {
                document.body.classList.add('light-mode');
                localStorage.setItem('theme', 'light');
            } else {
                document.body.classList.remove('light-mode');
                localStorage.setItem('theme', 'dark');
            }
        });
    }

    if (themeSystemToggle) {
        themeSystemToggle.addEventListener('change', function() {
            if (this.checked) {
                localStorage.setItem('theme', 'system');
            } else {
                // Tắt "Theo hệ thống" -> chốt lại đúng theme đang hiển thị ngay lúc tắt thành
                // 1 lựa chọn thủ công rõ ràng (light/dark), để công tắc bên cạnh hoạt động lại
                // bình thường thay vì rơi về mặc định light một cách khó hiểu.
                localStorage.setItem('theme', document.body.classList.contains('light-mode') ? 'light' : 'dark');
            }
            syncManualSwitchLockState(this.checked);
        });
    }

    // HĐH/trình duyệt đổi theme NGAY LÚC đang mở trang, trong khi đang ở chế độ "Theo hệ thống"
    // -> shared.js đã tự áp lại + bắn sự kiện 'themeChanged', ở đây chỉ cần đồng bộ lại UI công
    // tắc thủ công (vẫn đang bị khoá) cho khớp với theme mới.
    window.addEventListener('themeChanged', function() {
        if (themeToggle && themeToggle.disabled) themeToggle.checked = applyTheme();
    });

    initPlannerNotifications();
    
    // ẢNH NỀN TUỲ CHỈNH — giờ dùng chung qua bg-sync.js (đồng bộ với Dashboard + Hồ Sơ, sửa
    // 1 chỗ ở đó là cả 3 trang đổi theo). window._customBgReadyPromise được bg-sync.js tự set.
    if (window.syncCustomBackground) window.syncCustomBackground();
    else window._customBgReadyPromise = Promise.resolve();

    // Đo độ sáng ảnh nền lần đầu SAU KHI bg-sync.js đã gán xong background-image cho <body>
    // (nếu chờ luôn thì có thể đo phải ảnh nền mặc định cũ, chưa kịp đổi sang ảnh người dùng chọn).
    initAdaptiveHeaderContrast();
    (window._customBgReadyPromise || Promise.resolve()).then(scheduleTopbarContrastUpdate);

    const shareMenu = document.getElementById("share-menu-widget");
    const shareToggleBtn = document.getElementById("share-toggle-btn");
    
    if (shareToggleBtn && shareMenu) {
        shareToggleBtn.addEventListener("click", () => { shareMenu.classList.toggle("active"); });
        document.addEventListener('click', (e) => {
            if (!shareMenu.contains(e.target)) shareMenu.classList.remove("active");
        });
    }

    // ẢNH NỀN TUỲ CHỈNH — input file cũng dùng chung qua bg-sync.js (xem attachBgFileInput):
    // validate dung lượng + đọc base64 + lưu localStorage + gán vào body đều nằm ở đó.
    if (window.attachBgFileInput) window.attachBgFileInput('custom-bg-file');
});

function updateDesktopClock() {
    const timeEl = document.getElementById('live-time');
    const dateEl = document.getElementById('live-date');
    if (!timeEl || !dateEl) return;

    const now = new Date();
    timeEl.innerText = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    dateEl.innerText = now.toLocaleDateString('en-US', { weekday: 'long', month: '2-digit', day: '2-digit' }).replace(',', '');
}

// =========================================
// TỰ ĐỘNG ĐỔI MÀU CHỮ ĐỒNG HỒ + TIÊU ĐỀ HEADER THEO ĐỘ SÁNG ẢNH NỀN
// =========================================
// Đồng hồ (.clock-widget) và tiêu đề giữa (.center-title) trước giờ luôn cố định chữ trắng —
// hợp với nền tối mặc định, nhưng khi người dùng đổi ảnh nền tuỳ chỉnh (sáng màu, ví dụ ảnh
// chụp ban ngày) thì chữ trắng dễ bị mờ/khó đọc. Đoạn dưới tự lấy MẪU vùng trên cùng của ảnh
// nền hiện tại (đúng chỗ header nằm đè lên) để đo độ sáng trung bình, rồi gắn/gỡ class
// "bg-is-light" trên <body> — CSS (xem calendar-3-desktop-settings-dialog.css) dựa vào class
// này để tự chuyển chữ + text-shadow sang tông tối khi ảnh nền đủ sáng, và ngược lại.
let _bgContrastRAF = null;
function scheduleTopbarContrastUpdate() {
    if (_bgContrastRAF) return;
    _bgContrastRAF = requestAnimationFrame(() => { _bgContrastRAF = null; updateTopbarContrast(); });
}

function updateTopbarContrast() {
    const bgImage = getComputedStyle(document.body).backgroundImage;
    // backgroundImage có thể là NHIỀU lớp (gradient trang trí mặc định + url ảnh người dùng),
    // url() luôn nằm cuối cùng nếu bg-sync.js chèn thêm layer/ hoặc là lớp duy nhất nếu ảnh
    // được gán trực tiếp thay thế toàn bộ -> tìm match url(...) CUỐI CÙNG trong chuỗi cho chắc.
    const matches = [...bgImage.matchAll(/url\((['"]?)(.*?)\1\)/g)];
    if (matches.length === 0) {
        document.body.classList.remove('bg-is-light');
        return;
    }
    const url = matches[matches.length - 1][2];

    const img = new Image();
    // Cần để đọc được pixel qua canvas; ảnh từ URL ngoài không cho phép CORS sẽ khiến canvas
    // bị "tainted" -> getImageData ném lỗi, bắt ở catch bên dưới và bỏ qua an toàn (giữ mặc định).
    img.crossOrigin = 'anonymous';
    img.onload = () => {
        try {
            const SAMPLE = 24; // chỉ cần mẫu nhỏ để tính độ sáng trung bình, không cần full-res
            const canvas = document.createElement('canvas');
            canvas.width = SAMPLE; canvas.height = SAMPLE;
            const ctx = canvas.getContext('2d');
            // Chỉ lấy mẫu dải TRÊN CÙNG của ảnh (nơi .dashboard-topbar thực sự nằm đè lên) thay
            // vì trung bình cả bức ảnh — đúng ngữ cảnh hơn vì ảnh có thể sáng dưới/tối trên...
            const srcH = Math.max(1, img.naturalHeight * 0.28);
            ctx.drawImage(img, 0, 0, img.naturalWidth, srcH, 0, 0, SAMPLE, SAMPLE);
            const { data } = ctx.getImageData(0, 0, SAMPLE, SAMPLE);
            let total = 0;
            for (let i = 0; i < data.length; i += 4) {
                total += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
            }
            const avgLuminance = total / (data.length / 4); // 0 (đen) -> 255 (trắng)
            document.body.classList.toggle('bg-is-light', avgLuminance > 150);
        } catch (err) {
            console.warn('[Contrast] Không đọc được độ sáng ảnh nền (có thể do CORS):', err.message);
        }
    };
    img.onerror = () => {}; // ảnh lỗi/URL sai -> im lặng bỏ qua, giữ màu chữ mặc định
    img.src = url;
}

function initAdaptiveHeaderContrast() {
    updateTopbarContrast();
    // Theo dõi MỌI lần <body> đổi background-image (bg-sync.js gán trực tiếp qua style inline,
    // dù đổi bằng URL hay upload file) để tự đo lại độ sáng ngay khi ảnh nền thay đổi, không cần
    // sửa gì trong bg-sync.js.
    const observer = new MutationObserver(scheduleTopbarContrastUpdate);
    observer.observe(document.body, { attributes: true, attributeFilter: ['style'] });
}

// escapeHtml() và parseVNExamDate() giờ nằm ở shared.js (load trước file này trong calendar.html)

function handleSession(session) {
    const loader = document.getElementById('global-loader');
    
    // ĐÃ XÓA LỆNH TẮT LOADER SỚM Ở ĐÂY

    if (session) {
        if (currentUser && currentUser.id === session.user.id) {
            if (loader) loader.classList.add('hidden');
            return; 
        }

        currentUser = session.user;
        const meta = currentUser.user_metadata;

        // FIX "ĐỔI MÀU ACCENT KHÔNG HOẠT ĐỘNG": trang TKB trước giờ CHƯA BAO GIỜ set biến CSS
        // --accent theo tài khoản hay theo màu tự chọn — luôn dùng đúng 1 màu mặc định cứng khai
        // báo trong CSS, nên nút "Áp màu tự pha" / "Random" ở Cài Đặt dù có hoạt động cũng không
        // thấy đổi gì trên giao diện thật. Set ngay khi đăng nhập xong, đồng bộ đúng logic ưu tiên
        // với trang Dashboard (index.js): ưu tiên màu tự chọn ở Cài Đặt (customAccent), rơi về
        // màu hash ổn định theo tài khoản nếu chưa từng tự chọn (xem resolveAccentForUser ở shared.js).
        if (typeof resolveAccentForUser === 'function') {
            document.documentElement.style.setProperty('--accent', resolveAccentForUser(currentUser.id));
        }
        const emailSpan = document.getElementById('user-email-display');
        const profilePill = document.querySelector('.profile-pill');
        const displayArea = document.getElementById('profile-display-area');

        if (emailSpan && profilePill && displayArea) {
            const oldImg = displayArea.querySelector('.custom-avatar-img');
            if (oldImg) oldImg.remove();

            if (meta && meta.avatar) {
                // Vẫn gắn title = tên đã resolve (tôn trọng hide_email) lên avatar, để hover
                // vào là biết đang đăng nhập bằng ai — trước đây nhánh này bỏ qua hoàn toàn
                // resolveDisplayName(), khiến toggle "Ẩn Email công khai" vô nghĩa với tài
                // khoản đã có avatar.
                const img = document.createElement('img');
                img.src = meta.avatar;
                img.className = 'custom-avatar-img';
                img.style.cssText = 'object-fit:cover;';
                img.title = resolveDisplayName(currentUser, meta);

                displayArea.insertBefore(img, emailSpan);
                emailSpan.style.display = 'none'; 
                profilePill.classList.add('avatar-mode'); 
            } else {
                const nameToShow = resolveDisplayName(currentUser, meta);
                emailSpan.innerText = nameToShow;
                emailSpan.style.display = 'inline-block';
                profilePill.classList.remove('avatar-mode'); 
            }
        }
        
        applyTargetTabInstant();
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('main-app').style.opacity = '1';
        document.getElementById('main-app').style.pointerEvents = 'auto';
        
        sbClient.from('user_settings').select('semester_start_date').eq('user_id', currentUser.id).single()
        .then(async ({data, error}) => { 
            if(data && data.semester_start_date) {
                semesterStartDate = new Date(data.semester_start_date + 'T00:00:00');
            }
            await loadTimetable(); 
            loadExams();
            checkUpcomingPlannerNotifications();

            // Đợi thêm cả ảnh nền tuỳ chỉnh (nếu có) tải xong trước khi tắt loader — xem giải
            // thích chi tiết ở chỗ khai báo window._customBgReadyPromise phía trên. Nếu không có
            // ảnh nền thì promise này đã resolve sẵn (Promise.resolve()), không delay thêm gì cả.
            await window._customBgReadyPromise;

            // FIX BUG "1-2 KHUNG HÌNH BỊ MỜ/LOANG MÀU LÚC VỪA VÀO": #main-app fade-in mất 500ms
            // (xem transition:opacity 0.5s ở thẻ #main-app trong calendar.html), nhưng trước đây
            // màn che loader lại được cho biến mất chỉ sau 300ms kể từ lúc dữ liệu tải xong -> khi
            // mạng nhanh/dữ liệu có sẵn cache, loader biến mất SỚM HƠN lúc #main-app hiện đủ 100%
            // opacity, để lộ ra đúng khung hình "nửa vời" (mờ, loang màu) trong khoảnh khắc ngắn đó.
            // Tăng lên 550ms (>500ms) để đảm bảo #main-app LUÔN hiện trọn vẹn trước khi loader bắt
            // đầu ẩn đi, không còn khung hình "hở sáng" nào lọt ra ngoài nữa.
            // Theo yêu cầu thực tế: dù đã đợi ảnh nền + tăng lên 550ms, vẫn còn tình trạng bảng
            // TKB/blur hiện chậm hơn ảnh trong một số trường hợp (máy yếu, nhiều thẻ môn phải
            // dựng DOM to, hoặc thiết bị GPU tính backdrop-filter chậm hơn dự tính) -> tăng thêm
            // lên 900ms để có nhiều biên độ an toàn hơn nữa, chấp nhận đánh đổi loader hiện lâu
            // hơn 1 chút để đổi lấy việc không bao giờ lộ khung hình dở dang nữa.
            setTimeout(() => {
                if (loader) loader.classList.add('hidden');
            }, 900);
        });

    } else {
        currentUser = null;
        document.getElementById('auth-screen').classList.remove('hidden');
        document.getElementById('main-app').style.opacity = '0';
        document.getElementById('main-app').style.pointerEvents = 'none';
        
        // Đảm bảo tắt loader nếu đang ở trang đăng nhập
        setTimeout(() => {
            if (loader) loader.classList.add('hidden');
        }, 300);
    }
}

window.maxSemesterWeek = 20; 

let authMode = 'login';
window.switchAuthTab = function(mode) {
    if (authMode === mode) return; 
    authMode = mode;
    document.getElementById('tab-slider').style.transform = mode === 'register' ? 'translateX(100%)' : 'translateX(0)';
    document.getElementById('tab-login').classList.toggle('active', mode === 'login');
    document.getElementById('tab-register').classList.toggle('active', mode === 'register');
    
    const formContent = document.getElementById('auth-form-content');
    formContent.classList.add('fade-out');
    setTimeout(() => {
        document.getElementById('auth-submit-btn').innerText = mode === 'login' ? 'Bắt Đầu' : 'Tạo Tài Khoản';
        document.getElementById('auth-greeting').innerText = mode === 'login' ? 'Mừng bạn quay trở lại' : 'Bắt đầu hành trình mới';
        document.getElementById('auth-icon-login').style.display = mode === 'login' ? 'block' : 'none';
        document.getElementById('auth-icon-register').style.display = mode === 'register' ? 'block' : 'none';
        formContent.classList.remove('fade-out');
    }, 150);
    document.getElementById('auth-error').innerText = ''; 
}

window.handleAuth = async function(e) {
    e.preventDefault();
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const errorEl = document.getElementById('auth-error');
    errorEl.innerText = 'Đang xử lý...';

    let result = authMode === 'login' ? await sbClient.auth.signInWithPassword({ email, password }) : await sbClient.auth.signUp({ email, password });
    if (result.error) { errorEl.innerText = result.error.message; return; }

    errorEl.innerText = '';

    // ĐĂNG KÝ NHƯNG CHƯA CÓ SESSION: dự án đang bật "Confirm email" ở Supabase Auth ->
    // signUp() trả về THÀNH CÔNG (không có result.error) nhưng result.data.session vẫn là null,
    // vì tài khoản còn phải chờ người dùng bấm link xác nhận trong email mới thật sự đăng nhập
    // được. Trước đây cứ thấy "không lỗi" là redirect thẳng sang index.html -> index.js kiểm
    // tra session thấy null lại bắn NGƯỢC về calendar.html ngay lập tức, vòng vo vô nghĩa và dễ
    // gây hiểu lầm là lỗi. Giờ tách riêng case này: báo rõ cần kiểm tra email, rồi tự chuyển về
    // tab Đăng Nhập để họ quay lại đăng nhập sau khi đã xác nhận, KHÔNG redirect đi đâu cả.
    if (authMode === 'register' && !(result.data && result.data.session)) {
        await showAlert('Đăng ký thành công! Vui lòng kiểm tra email và bấm vào link xác nhận trước khi đăng nhập.', 'Xác nhận Email');
        switchAuthTab('login');
        return;
    }

    if (authMode === 'register') {
        await showAlert('Đăng ký tài khoản thành công! Bạn có thể bắt đầu sử dụng.', 'Thành công');
    }

    // ĐĂNG NHẬP/ĐĂNG KÝ THÀNH CÔNG VÀ ĐÃ CÓ SESSION NGAY (đăng nhập bình thường, hoặc đăng ký mà
    // dự án KHÔNG bật xác nhận email) -> LUÔN VỀ index.html (Dashboard), không ở lại calendar.html
    // như trước. Chỉ áp dụng ngay sau khi submit form (ở đây) — KHÔNG đụng vào handleSession(), vì
    // handleSession còn được gọi mỗi lần MỞ SẴN calendar.html khi đã đăng nhập từ trước (vd bấm
    // thẳng link TKB) -> trường hợp đó vẫn phải hiện app TKB tại chỗ, không được tự động bắn về
    // index.html mỗi lần vào trang.
    navigateWithFade('../index.html');
}

// =========================================
// 1.2. LOGIC CHO DROPDOWN MENU KÍNH MỜ
// =========================================
window.toggleProfileDropdown = function(e) {
    e.stopPropagation();
    const dropdown = document.getElementById('profile-dropdown-list');
    const container = document.getElementById('profile-dropdown-container');
    
    dropdown.classList.toggle('hidden-dropdown');
    
    // Đảo chiều mũi tên khi mở menu
    const arrow = container.querySelector('.select-arrow');
    if (arrow) {
        if (!dropdown.classList.contains('hidden-dropdown')) {
            arrow.style.transform = 'rotate(180deg)';
        } else {
            arrow.style.transform = 'none';
        }
    }
};

// Ẩn menu khi click ra ngoài
document.addEventListener('click', function(e) {
    const container = document.getElementById('profile-dropdown-container');
    const dropdown = document.getElementById('profile-dropdown-list');
    if (container && dropdown && !container.contains(e.target)) {
        dropdown.classList.add('hidden-dropdown');
        const arrow = container.querySelector('.select-arrow');
        if (arrow) arrow.style.transform = 'none';
    }
});

window.logout = async function() { 
    // Nhớ Tab hiện tại trước khi Logout
    const activeTabLi = document.querySelector('.nav-links li.active');
    if (activeTabLi) {
        const title = activeTabLi.getAttribute('title');
        let targetName = 'timetable'; 
        
        if (title.includes('Lịch Thi')) targetName = 'exams';
        else if (title.includes('Cài Đặt')) targetName = 'settings';
        else if (title.includes('Kế Hoạch')) targetName = 'planner';
        
        localStorage.setItem('targetTab', targetName);
    }

    await sbClient.auth.signOut(); 
}

window.switchTab = function(tabId, element, titleText) {
    if (element.classList.contains('active')) return; 

    const loader = document.getElementById('global-loader');
    loader.classList.remove('hidden');

    setTimeout(() => {
        // Đồng bộ trạng thái active cho MỌI nơi có nav (dock chính + nav mobile) qua data-tab
        document.querySelectorAll('[data-tab]').forEach(el => el.classList.remove('active'));
        document.querySelectorAll(`[data-tab="${tabId}"]`).forEach(el => el.classList.add('active'));

        document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
        document.getElementById(`tab-${tabId}`).classList.add('active');

        if(titleText) document.getElementById('topbar-title').innerText = titleText;

        // Icon nhỏ kế bên tiêu đề header — chỉ hiện khi đang ở tab Kế Hoạch Ngày
        const topbarIcon = document.getElementById('topbar-title-icon');
        if (topbarIcon) topbarIcon.style.display = (tabId === 'planner') ? 'flex' : 'none';

        const importLabel = document.getElementById('top-import-label');
        const importText = document.getElementById('top-import-text');
        
        if (importLabel && importText) {
            if (tabId === 'timetable') {
                importLabel.style.display = 'inline-flex';
                importLabel.setAttribute('for', 'excel-file');
                importText.innerText = 'Nhập TKB';
            } else if (tabId === 'exams') {
                importLabel.style.display = 'inline-flex';
                importLabel.setAttribute('for', 'excel-exam-file');
                importText.innerText = 'Nhập Lịch Thi';
            } else {
                importLabel.style.display = 'none';
            }
        }

        if (tabId === 'planner' && typeof initDayPlanner === 'function') {
            initDayPlanner();
            loadPlannerBlocks();
        }

        setTimeout(() => { loader.classList.add('hidden'); }, 150); 
    }, 350); 
}

function applyTargetTabInstant() {
    const target = localStorage.getItem('targetTab');
    localStorage.removeItem('targetTab'); 
    if (!target) return;

    const topbarTitleMap = { timetable: 'Thời Khóa Biểu', exams: 'Lịch Thi Học Kỳ', settings: 'Cài Đặt Workspace', planner: 'Kế Hoạch Ngày' };

    const matches = document.querySelectorAll(`[data-tab="${target}"]`);
    if (!matches.length) return;

    document.querySelectorAll('[data-tab]').forEach(el => el.classList.remove('active'));
    matches.forEach(el => el.classList.add('active'));

    document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
    const pane = document.getElementById(`tab-${target}`);
    if (pane) pane.classList.add('active');

    const topbarTitle = document.getElementById('topbar-title');
    if (topbarTitle) topbarTitle.innerText = topbarTitleMap[target];

    // Icon nhỏ kế bên tiêu đề header — chỉ hiện khi đang ở tab Kế Hoạch Ngày
    const topbarIcon = document.getElementById('topbar-title-icon');
    if (topbarIcon) topbarIcon.style.display = (target === 'planner') ? 'flex' : 'none';


    const importLabel = document.getElementById('top-import-label');
    const importText = document.getElementById('top-import-text');
    if (importLabel && importText) {
        if (target === 'timetable') {
            importLabel.style.display = 'inline-flex';
            importLabel.setAttribute('for', 'excel-file');
            importText.innerText = 'Nhập TKB';
        } else if (target === 'exams') {
            importLabel.style.display = 'inline-flex';
            importLabel.setAttribute('for', 'excel-exam-file');
            importText.innerText = 'Nhập Lịch Thi';
        } else {
            importLabel.style.display = 'none';
        }
    }

    if (target === 'planner' && typeof initDayPlanner === 'function') {
        initDayPlanner();
        loadPlannerBlocks();
    }
}

// navigateWithFade() giờ nằm ở bg-sync.js (dùng chung với index.js, tránh lặp code)

// =========================================
// 1.6b. VÀO PROFILE TỪ TKB — nhớ điểm quay về
// =========================================
window.goToProfileFromTkb = function() {
    localStorage.setItem('profileReturnTo', '../tkb/calendar.html');

    // Ghi nhớ luôn tab đang đứng (Thời Khóa Biểu/Lịch Thi/Cài Đặt) để applyTargetTabInstant()
    // tự khôi phục đúng tab đó khi quay lại, không chỉ mặc định về Thời Khóa Biểu
    const activePane = document.querySelector('.tab-pane.active');
    if (activePane && activePane.id) {
        localStorage.setItem('targetTab', activePane.id.replace('tab-', ''));
    }

    navigateWithFade('../profile/profile.html');
};

// =========================================
// 2. RENDER LƯỚI TKB & IMPORT EXCEL
// =========================================

function initWeekSelector(maxW = 20) {
    window.maxSemesterWeek = maxW;
    const selector = document.getElementById('week-selector');
    const customList = document.getElementById('week-options-list');
    if (!selector) return;

    let currentSelected = parseInt(selector.value);

    selector.innerHTML = '';
    if(customList) customList.innerHTML = '';

    // Dùng hàm calcCurrentWeekNumber() ở shared.js — CHUNG công thức với index.js (Dashboard),
    // thay vì Math.ceil trực tiếp trên mili-giây (diffTime) như trước, vốn có thể lệch 1 tuần
    // với cách tính Math.floor theo ngày ở nơi khác, đúng vào lúc nửa đêm giao giữa 2 tuần.
    const now = new Date();
    const autoCurrentWeek = calcCurrentWeekNumber(now, semesterStartDate, maxW);

    if (!currentSelected || isNaN(currentSelected)) currentSelected = autoCurrentWeek;
    if (currentSelected > maxW) currentSelected = maxW;

    for(let i = 1; i <= maxW; i++) { 
        const weekStart = new Date(semesterStartDate);
        weekStart.setDate(semesterStartDate.getDate() + (i - 1) * 7);

        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);

        const startStr = `${weekStart.getDate().toString().padStart(2, '0')}/${(weekStart.getMonth()+1).toString().padStart(2, '0')}`;
        const endStr = `${weekEnd.getDate().toString().padStart(2, '0')}/${(weekEnd.getMonth()+1).toString().padStart(2, '0')}`;

        const text = `Tuần ${i} (Từ ${startStr} đến ${endStr})`;

        const option = document.createElement('option');
        option.value = i; option.text = text;
        selector.appendChild(option);

        if(customList) {
            const li = document.createElement('li');
            li.innerText = text; li.dataset.val = i;
            if (i === currentSelected) li.classList.add('selected');
            
            li.onclick = (e) => { e.stopPropagation(); selectCustomWeek(i); };
            customList.appendChild(li);
        }
    }

    selector.value = currentSelected;
    
    const currentTextEl = document.getElementById('current-week-text');
    if(currentTextEl && selector.options[selector.selectedIndex]) {
        currentTextEl.innerText = selector.options[selector.selectedIndex].text;
    }
}

document.getElementById('excel-file').addEventListener('change', async function(e) {
    if (!currentUser) {
        showAlert("Vui lòng đăng nhập trước khi tải lên TKB!", "Yêu cầu đăng nhập");
        e.target.value = '';
        return;
    }
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(event) {
        try {
            const data = new Uint8Array(event.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const jsonArray = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

            const formattedData = [];

            // ============================================================
            // FIX: TỰ ĐỘNG DÒ LẠI "NGÀY BẮT ĐẦU HỌC KỲ" TỪ CHÍNH FILE EXCEL MỚI.
            // Trước đây semesterStartDate là mốc cũ (lưu trong user_settings, hoặc mặc định 18/05/2026).
            // Nhập TKB kỳ mới (vd bắt đầu tháng 9) không hề cập nhật lại mốc này -> "Tuần 1" vẫn bị tính
            // theo mốc tháng 5 cũ -> lịch trống trơn dù đã import đúng file. Giờ quét toàn bộ cột
            // "Thời gian học" để tìm ngày sớm nhất, lùi về đúng thứ Hai của tuần đó làm mốc "Tuần 1" mới,
            // rồi lưu lại vào Supabase để các lần đăng nhập sau vẫn giữ đúng mốc này.
            const parseVNDate = (dStr) => {
                const p = String(dStr).trim().split('/');
                if (p.length !== 3) return null;
                const y = p[2].length === 2 ? 2000 + parseInt(p[2]) : parseInt(p[2]);
                const dt = new Date(y, parseInt(p[1]) - 1, parseInt(p[0]));
                return isNaN(dt.getTime()) ? null : dt;
            };

            let earliestDate = null;
            for (let i = 0; i < jsonArray.length; i++) {
                const rangeStr = String(jsonArray[i]['Thời gian học'] || '').trim();
                if (!rangeStr.includes('đến')) continue;
                const startStr = rangeStr.split('đến')[0].trim();
                const sDate = parseVNDate(startStr);
                if (sDate && (!earliestDate || sDate < earliestDate)) earliestDate = sDate;
            }

            if (earliestDate) {
                const dow = earliestDate.getDay(); // 0 = Chủ Nhật, 1 = Thứ 2, ...
                const diffToMonday = dow === 0 ? 6 : dow - 1;
                const newSemesterStart = new Date(earliestDate);
                newSemesterStart.setDate(earliestDate.getDate() - diffToMonday);
                semesterStartDate = newSemesterStart;

                const yy = semesterStartDate.getFullYear();
                const mm = String(semesterStartDate.getMonth() + 1).padStart(2, '0');
                const dd = String(semesterStartDate.getDate()).padStart(2, '0');
                const { error: settingsErr } = await sbClient.from('user_settings')
                    .upsert({ user_id: currentUser.id, semester_start_date: `${yy}-${mm}-${dd}` }, { onConflict: 'user_id' });
                if (settingsErr) console.error('[Import] Lỗi lưu mốc học kỳ mới:', settingsErr);
            }

            const sguStartTime = { 1:"07:00", 2:"07:50", 3:"09:00", 4:"09:50", 5:"10:40", 6:"13:00", 7:"13:50", 8:"15:00", 9:"15:50", 10:"16:40", 11:"17:40", 12:"18:30", 13:"19:20", 14:"20:10" };
            const sguEndTime = { 1:"07:50", 2:"08:40", 3:"09:50", 4:"10:40", 5:"11:30", 6:"13:50", 7:"14:40", 8:"15:50", 9:"16:40", 10:"17:30", 11:"18:30", 12:"19:20", 13:"20:10", 14:"21:00" };
            
            for (let i = 0; i < jsonArray.length; i++) {
                const row = jsonArray[i];
                
                const courseCode = String(row['Mã HP'] || row['Mã MH'] || '').trim();
                const subjectName = String(row['Tên môn'] || row['Tên môn học'] || '').trim();
                const groupId = String(row['Nhóm'] || row['Nhóm tổ'] || '').trim();
                const lecturer = String(row['Giảng viên'] || '').trim();
                const room = String(row['Phòng'] || '').trim();
                const day = parseInt(row['Thứ']);
                
                if (isNaN(day) || !subjectName) continue; 
                
                let timeSlot = String(row['Tiết'] || '').trim();
                let startTiet = 0;
                let endTiet = 0;
                
                if (timeSlot) {
                    const match = timeSlot.match(/Tiết\s*(\d+)\s*-\s*(\d+)/i);
                    if (match) { startTiet = parseInt(match[1]); endTiet = parseInt(match[2]); }
                } else if (row['Tiết bắt đầu'] !== undefined && row['Số tiết'] !== undefined) {
                    startTiet = parseInt(row['Tiết bắt đầu']);
                    endTiet = startTiet + parseInt(row['Số tiết']) - 1;
                    timeSlot = `Tiết ${startTiet}-${endTiet}`;
                }

                let exactTime = String(row['Thời gian'] || '').trim();
                if (!exactTime && startTiet > 0 && endTiet > 0) {
                    if (sguStartTime[startTiet] && sguEndTime[endTiet]) {
                        exactTime = `${sguStartTime[startTiet]} -> ${sguEndTime[endTiet]}`;
                    }
                }

                let weeks = String(row['Tuần'] || row['Tuần học'] || '').trim();
                let dateRangeStr = String(row['Thời gian học'] || '').trim();
                
                if (!weeks && dateRangeStr.includes('đến') && typeof semesterStartDate !== 'undefined') {
                    try {
                        const dates = dateRangeStr.split('đến').map(s => s.trim());
                        if (dates.length === 2 && dates[0].includes('/')) {
                            const parseDate = (dStr) => {
                                const p = dStr.split('/');
                                const y = p[2].length === 2 ? 2000 + parseInt(p[2]) : parseInt(p[2]);
                                return new Date(y, parseInt(p[1]) - 1, parseInt(p[0]));
                            };
                            
                            const sDate = parseDate(dates[0]);
                            const eDate = parseDate(dates[1]);
                            
                            const msPerWeek = 7 * 24 * 60 * 60 * 1000;
                            const diffStart = Math.floor((sDate.getTime() - semesterStartDate.getTime()) / msPerWeek);
                            const diffEnd = Math.floor((eDate.getTime() - semesterStartDate.getTime()) / msPerWeek);
                            
                            let weekArr = Array(20).fill('-');
                            for (let w = Math.max(0, diffStart); w <= Math.min(19, diffEnd); w++) {
                                weekArr[w] = ((w + 1) % 10).toString(); 
                            }
                            weeks = weekArr.join('');
                        }
                    } catch (dateErr) {
                        console.warn("Bỏ qua lỗi dịch ngày tháng ở môn: ", subjectName, dateErr);
                    }
                }

                if (startTiet > 0 && endTiet >= startTiet) {
                    formattedData.push({
                        user_id: currentUser.id, 
                        name: subjectName, 
                        day: day,
                        time_slot: timeSlot, 
                        room: room, 
                        course_code: courseCode,
                        group_id: groupId, 
                        lecturer: lecturer, 
                        exact_time: exactTime, 
                        weeks: weeks
                    });
                }
            }

            if (formattedData.length === 0) {
                showAlert("Không tìm thấy dữ liệu TKB nào hợp lệ trong file.", "Lỗi dữ liệu");
                e.target.value = '';
                return;
            }

            // FIX AN TOÀN DỮ LIỆU (nghiêm trọng): trước đây XÓA sạch TKB cũ TRƯỚC rồi mới CHÈN dữ
            // liệu mới — nếu bước chèn thất bại giữa chừng (mất mạng, dữ liệu vi phạm ràng buộc DB,
            // Supabase timeout...) thì TKB cũ đã bị xóa vĩnh viễn mà không có gì thay thế, không
            // cách nào khôi phục ngoài việc còn giữ đúng file Excel cũ để nhập lại. Đảo thứ tự:
            // lưu trước danh sách ID cũ, CHÈN dữ liệu mới TRƯỚC — nếu bước này lỗi thì dữ liệu cũ
            // vẫn còn nguyên, chưa mất gì. Chỉ XÓA bản cũ (đúng theo ID đã lưu) SAU KHI chèn mới
            // thành công, nên nếu bước xóa có lỗi thì cùng lắm là hiện trùng lặp, không mất dữ liệu.
            const { data: oldRows, error: fetchOldErr } = await sbClient.from('subjects').select('id').eq('user_id', currentUser.id);
            if (fetchOldErr) throw new Error("Không đọc được TKB cũ để chuẩn bị thay thế: " + fetchOldErr.message);

            const { error: insertErr } = await sbClient.from('subjects').insert(formattedData);
            if (insertErr) throw new Error("Supabase từ chối lưu dữ liệu mới (TKB cũ vẫn còn nguyên, chưa mất gì): " + insertErr.message);

            const oldSubjectIds = (oldRows || []).map(r => r.id);
            if (oldSubjectIds.length) {
                const { error: deleteErr } = await sbClient.from('subjects').delete().in('id', oldSubjectIds);
                if (deleteErr) {
                    // Dữ liệu MỚI đã lưu an toàn — chỉ chưa dọn được bản cũ (sẽ hiện trùng lặp tạm
                    // thời). Không throw ở đây để tránh khiến người dùng tưởng nhầm là mất dữ liệu.
                    console.warn('[Import] Đã lưu TKB mới nhưng chưa xóa được TKB cũ (có thể hiện trùng, thử nhập lại lần nữa):', deleteErr.message);
                }
            }

            showAlert("Đã đồng bộ TKB thành công! Giao diện sẽ tự động cập nhật.", "Hoàn tất"); 

            // FIX: TKB mới là 1 lịch học hoàn toàn khác, không được giữ nguyên tuần đang xem dở của TKB cũ
            // (vd đang ở "Tuần 20" thì nhập TKB mới vào vẫn cứ hiện tiếp "Tuần 20" vì loadTimetable() chỉ đọc
            // lại giá trị hiện có trên #week-selector). Nên chủ động đưa selector về Tuần 1 trước khi render lại.
            const weekSelectorEl = document.getElementById('week-selector');
            if (weekSelectorEl) weekSelectorEl.value = 1;

            await loadTimetable(); 
            loadExams(); 
            e.target.value = '';
            
        } catch (err) { 
            showAlert(`Lỗi xử lý file:\n${err.message || 'Vui lòng kiểm tra lại định dạng file.'}`, "Lỗi hệ thống"); 
            console.error("Chi tiết lỗi:", err);
        }
    };
    reader.readAsArrayBuffer(file);
});

window.openModalById = function(id) {
    const sub = allLoadedSubjects.find(s => String(s.id) === String(id));
    if (sub) openModal(sub);
};

// Tải dữ liệu TKB từ Supabase — CHỈ gọi khi dữ liệu thật sự có thể đã đổi (mở trang lần đầu,
// vừa import Excel xong). Đổi tuần xem / đổi màu môn học không làm dữ liệu subjects đổi, nên
// các thao tác đó gọi renderTimetable() (không fetch mạng) thay vì gọi lại hàm này.
async function loadTimetable() {
    if (!currentUser) return;
    const { data: subjects, error } = await sbClient.from('subjects').select('*').eq('user_id', currentUser.id);
    if (error) return console.error('Lỗi tải TKB:', error);

    allLoadedSubjects = subjects || [];
    renderTimetable();
}

// Vẽ lại bảng TKB + dropdown tuần + danh sách môn (dùng cho combobox màu) từ dữ liệu ĐÃ CÓ SẴN
// trong allLoadedSubjects — không đụng mạng. Tách riêng khỏi loadTimetable() để đổi tuần/đổi
// màu môn học không phải fetch lại toàn bộ bảng subjects mỗi lần.
// =========================================
// AUTO COLOR-MATCHING CHO THANH/CỘT STICKY (thay cho "blur thuần" không ổn định)
// =========================================
// Lý do đổi cách làm: backdrop-filter blur thuần (không phủ màu) tuy "tự thích ứng" về mặt lý
// thuyết, nhưng blur một mình không đủ che chữ trắng đậm bên dưới (vẫn đọc được xuyên qua), và
// backdrop-filter + position:sticky vốn nổi tiếng render không ổn định giữa các trình duyệt/
// WebView (xem ghi chú ở đầu file CSS). Giải pháp chắc chắn hơn: CHỦ ĐỘNG dò xem ngay dưới
// thanh sticky đang là thẻ môn học nào (bằng elementFromPoint), đọc đúng màu gốc (--c1) của thẻ
// đó, rồi tô màu đó lên thanh sticky (kết hợp blur nhẹ cho mềm cạnh) -> thanh luôn đổi màu khớp
// với đúng thẻ đang bị nó che, dù cuộn dọc hay cuộn ngang.