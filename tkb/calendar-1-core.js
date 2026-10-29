// ===== calendar-1-core.js =====
// Phần 1/5 của calendar.js (tách file để dễ bảo trì, mỗi file < 1000 dòng).
// Nội dung: Custom dialog, đăng nhập/chuyển tab, dropdown menu, nút quay lại từ Profile,
// khởi tạo tuần học, loadTimetable().
// LƯU Ý: các file được nạp bằng nhiều thẻ <script> KHÔNG dùng module, nên vẫn chia sẻ chung
// 1 global scope — PHẢI giữ đúng thứ tự nạp trong calendar.html:
// calendar-1-core.js -> calendar-2-timetable-modal.js -> calendar-3-personalization.js
// -> calendar-4-planner-notify.js -> calendar-5-planner-ui.js

// SUPABASE_URL / SUPABASE_KEY giờ nằm ở supabase-config.js (load trước file này trong
// calendar.html), không khai báo riêng ở đây nữa — sửa 1 chỗ là mọi trang đổi theo.
// Không gọi window.supabase.createClient() ngay ở top-level nữa — nếu CDN Supabase load lỗi/chậm
// (mạng yếu, bị chặn), việc này sẽ ném lỗi ngay lúc parse file và crash toàn bộ calendar.js trước
// khi bất kỳ dòng nào khác kịp chạy. Dời việc khởi tạo có kiểm tra vào bên trong DOMContentLoaded
// (đồng bộ với cách profile.js đang xử lý sự cố này).
// URL thư viện nạp THEO NHU CẦU (không còn chặn trang lúc khởi động bằng ~1.2MB script ít khi dùng)
const XLSX_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const HTML2CANVAS_CDN_URL = 'https://cdn.jsdelivr.net/npm/html2canvas-pro@2.4.2/dist/html2canvas-pro.min.js';
let sbClient = null;

let currentUser = null;
let currentSubjectId = null;
let allLoadedSubjects = []; 

// getSavedSubjectColors() / saveSubjectColor() giờ nằm ở shared.js (dùng chung với
// index.js và profile.js, tránh mỗi nơi tự JSON.parse localStorage riêng)

let semesterStartDate = defaultSemesterStartDate(); // local midnight (shared.js)

// FIX BUG "THANH MỜ KHÔNG PHỦ HẾT CÁC THỨ": lưu ResizeObserver để hủy bản cũ mỗi lần render lại
// bảng TKB, tránh tạo nhiều observer chồng chéo gây rò rỉ bộ nhớ.
let _stickyBarResizeObserver = null;

// =========================================
// 0. CUSTOM DIALOG LOGIC (THAY THẾ ALERT/CONFIRM)
// =========================================
// Hộp thoại dùng chung. Cải tiến so với bản cũ:
//  - Xếp HÀNG ĐỢI: gọi liên tiếp (vd lỗi + thông báo) không còn làm 2 hộp thoại giẫm lên cùng 1 cặp
//    nút (trước đây bấm "Đồng ý" ở hộp sau lại resolve luôn cả hộp trước -> xác nhận xoá bị trả
//    lời nhầm).
//  - Nội dung được ESCAPE HTML: thông báo lỗi của Supabase thường trích nguyên giá trị người dùng
//    nhập/nhập từ Excel (vd `invalid input syntax ... "<img onerror=...>"`) -> trước đây gán thẳng
//    vào innerHTML là lỗ hổng XSS chỉ cần mở 1 file Excel được tạo sẵn. Chỉ đổi \n thành <br>.
//  - Phím Esc đóng hộp thoại (Hủy với hộp xác nhận).
let _dialogQueue = Promise.resolve();
window.showCustomDialog = function(message, isConfirm = false, title = "Thông báo") {
    const run = () => new Promise((resolve) => {
        const overlay = document.getElementById('custom-dialog-overlay');
        const titleEl = document.getElementById('custom-dialog-title');
        const msgEl = document.getElementById('custom-dialog-msg');
        const cancelBtn = document.getElementById('custom-dialog-cancel');
        const okBtn = document.getElementById('custom-dialog-ok');

        titleEl.textContent = title;
        msgEl.innerHTML = escapeHtml(message).replace(/\n/g, '<br>');
        cancelBtn.style.display = isConfirm ? 'inline-flex' : 'none';
        overlay.classList.remove('hidden');

        const onOk = () => finish(true);
        const onCancel = () => finish(false);
        const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); finish(isConfirm ? false : true); } };
        function finish(result) {
            overlay.classList.add('hidden');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            document.removeEventListener('keydown', onKey, true);
            resolve(result);
        }
        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        document.addEventListener('keydown', onKey, true);
        okBtn.focus();
    });
    const p = _dialogQueue.then(run);
    _dialogQueue = p.catch(() => {});
    return p;
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
    sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    sbClient.auth.getSession().then(({ data: { session } }) => { handleSession(session); });
    sbClient.auth.onAuthStateChange((_event, session) => { handleSession(session); });

    updateDesktopClock();
    setInterval(() => { if (!document.hidden) updateDesktopClock(); }, 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) updateDesktopClock(); });

    // Làm mới badge "Còn X phút nữa!" mỗi 60s CHỈ bằng cách vẽ lại từ dữ liệu đã tải (không gọi
    // Supabase mỗi phút như trước — dữ liệu lịch thi không đổi theo thời gian, chỉ có chữ đếm ngược đổi).
    setInterval(() => {
        const examsPane = document.getElementById('tab-exams');
        if (!document.hidden && examsPane && examsPane.classList.contains('active') && typeof renderExamsFromCache === 'function') {
            renderExamsFromCache();
        }
    }, 60000);
    renderNeonColorButtons();
    renderAccentColorPresets();
    initPriorityPickers();

    // FIX: 2 ô chọn "Hạn" (note-due-date, task-due-date) trước đây không giới hạn gì, người
    // dùng bấm vào lịch có thể chọn lùi về NGÀY ĐÃ QUA (vô lý vì hạn công việc/ghi chú không
    // thể ở quá khứ). Set min = đúng ngày hôm nay -> trình duyệt tự khoá, không cho bấm chọn
    // ngày trước đó trong lịch popup nữa (chỉ chọn được hôm nay trở đi).
    const todayInputStr = fmtLocalDate(new Date());
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
        const isSystemModeNow = localStorage.getItem(STORAGE_KEYS.theme) === 'system';
        if (themeSystemToggle) themeSystemToggle.checked = isSystemModeNow;
        syncManualSwitchLockState(isSystemModeNow);

        // Đổi công tắc thủ công -> luôn thoát khỏi chế độ "Theo giao diện hệ thống" (nếu đang
        // bật), vì người dùng vừa tự chọn rõ ràng 1 theme cụ thể.
        themeToggle.addEventListener('change', function() {
            if (themeSystemToggle) themeSystemToggle.checked = false;
            setThemePreference(this.checked ? 'light' : 'dark');
        });
    }

    if (themeSystemToggle) {
        themeSystemToggle.addEventListener('change', function() {
            // Tắt "Theo hệ thống" -> chốt lại đúng theme đang hiển thị ngay lúc tắt thành
            // 1 lựa chọn thủ công rõ ràng (light/dark), để công tắc bên cạnh hoạt động lại bình thường.
            setThemePreference(this.checked ? 'system' : (document.body.classList.contains('light-mode') ? 'light' : 'dark'));
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
    // Tự format HH:MM — toLocaleTimeString('en-US', {hour12:false}) hiện "24:05" thay vì "00:05" ở Chrome.
    timeEl.innerText = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
    // Hiển thị tiếng Việt, đúng thứ tự ngày/tháng: "Thứ Hai, 12/10"
    const VN_WEEKDAYS = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
    dateEl.innerText = `${VN_WEEKDAYS[now.getDay()]}, ${fmtDM(now)}`;
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

    // Dùng chung bộ đo của bg-sync.js (chỉ lấy dải TRÊN CÙNG ~28% — đúng chỗ .dashboard-topbar nằm đè).
    // Ảnh CORS không đọc được pixel / ảnh lỗi -> null -> giữ màu chữ mặc định.
    if (!window.measureImageStats) return;
    window.measureImageStats(url, 0.28).then((st) => {
        if (st) document.body.classList.toggle('bg-is-light', st.luminance > 150);
    });
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
            // Cùng 1 người (sự kiện auth lặp lại: INITIAL_SESSION, TOKEN_REFRESHED, SIGNED_IN khi quay lại
            // tab...) -> chỉ cập nhật bản user mới nhất. KHÔNG tắt loader ở đây: lần tải đầu có thể còn
            // đang dang dở, tắt sớm sẽ lộ khung hình dở dang (đúng lỗi "khung hình mờ" đã từng sửa ở dưới).
            currentUser = session.user;
            return;
        }

        currentUser = session.user;
        const meta = currentUser.user_metadata;
        // Cho các module tách file (vd ảnh nền màn hình khoá) tự khởi tạo lại theo NGƯỜI DÙNG MỚI
        (window.onUserSessionStart || []).forEach((fn) => { try { fn(); } catch (e) { console.warn('[Session] hook lỗi:', e.message); } });

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

            if (meta && meta.avatar && isSafeImageSrc(meta.avatar)) {
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
        
        (async () => {
            try {
                // maybeSingle(): chưa có dòng cài đặt là bình thường (không retry/không báo lỗi)
                const { data, error } = await withRetry(() => sbClient.from('user_settings').select('semester_start_date').eq('user_id', currentUser.id).maybeSingle());
                if (error) {
                    // Không chặn cả trang chỉ vì lỗi mốc ngày bắt đầu kỳ học — dùng tạm giá trị mặc định
                    // (semesterStartDate khai báo sẵn ở đầu file) và vẫn tiếp tục tải TKB/Lịch thi bên dưới.
                    console.error('Lỗi tải cài đặt học kỳ:', error);
                } else if (data && data.semester_start_date) {
                    semesterStartDate = parseLocalDateStr(data.semester_start_date) || semesterStartDate;
                }
                await loadTimetable();
                loadExams();
                checkUpcomingPlannerNotifications();
                // Đợi thêm cả ảnh nền tuỳ chỉnh (nếu có) tải xong trước khi tắt loader.
                await Promise.race([window._customBgReadyPromise, new Promise((r) => setTimeout(r, 4000))]);
            } catch (err) {
                console.error('[TKB] Lỗi khi tải dữ liệu ban đầu:', err);
            } finally {
                // finally: trước đây nếu loadTimetable() ném lỗi thì dòng tắt loader bị bỏ qua -> kẹt màn
                // hình loading vĩnh viễn. 900ms để #main-app (fade-in 500ms) kịp hiện trọn vẹn trước khi
                // loader ẩn đi, không lộ khung hình mờ/loang màu lúc vừa vào.
                window.hideGlobalLoader(900);
            }
        })();

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

window.maxSemesterWeek = MAX_SEMESTER_WEEKS; 

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
    const submitBtn = document.getElementById('auth-submit-btn');
    if (submitBtn) submitBtn.disabled = true; // chống bấm đúp khi mạng chậm (đăng ký 2 lần / bị giới hạn tốc độ)

    let result;
    try {
        const cleanEmail = email.trim();
        result = authMode === 'login' ? await sbClient.auth.signInWithPassword({ email: cleanEmail, password }) : await sbClient.auth.signUp({ email: cleanEmail, password });
    } catch (err) {
        result = { error: { message: 'Không kết nối được máy chủ. Vui lòng kiểm tra mạng rồi thử lại.' } };
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
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
        localStorage.setItem(STORAGE_KEYS.targetTab, activeTabLi.dataset.tab || 'timetable');
    }

    await removePushSubscriptionFor(sbClient); // trước signOut để còn quyền xoá subscription
    await sbClient.auth.signOut(); 
}

// Tiêu đề header theo từng tab (trước đây khai báo riêng trong applyTargetTabInstant, còn switchTab
// nhận từ onclick của HTML -> 2 nguồn có thể lệch nhau).
const TAB_TITLES = { timetable: 'Thời Khóa Biểu', exams: 'Lịch Thi Học Kỳ', settings: 'Cài Đặt Workspace', planner: 'Kế Hoạch Ngày' };

// Áp trạng thái giao diện của 1 tab (active nav, pane, tiêu đề, nút Nhập, khởi tạo Kế Hoạch).
// Dùng chung cho chuyển tab bằng tay (switchTab) và nhảy tab lúc mở trang (applyTargetTabInstant) —
// trước đây 2 hàm này chép nguyên khối logic giống hệt nhau.
function applyTabState(tabId, titleText) {
    document.querySelectorAll('[data-tab]').forEach(el => el.classList.remove('active'));
    document.querySelectorAll(`[data-tab="${tabId}"]`).forEach(el => el.classList.add('active'));

    document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
    const pane = document.getElementById(`tab-${tabId}`);
    if (pane) pane.classList.add('active');

    const title = titleText || TAB_TITLES[tabId];
    const topbarTitle = document.getElementById('topbar-title');
    if (topbarTitle && title) topbarTitle.innerText = title;

    // Icon nhỏ kế bên tiêu đề header — chỉ hiện khi đang ở tab Kế Hoạch Ngày
    const topbarIcon = document.getElementById('topbar-title-icon');
    if (topbarIcon) topbarIcon.style.display = (tabId === 'planner') ? 'flex' : 'none';

    const importLabel = document.getElementById('top-import-label');
    const importText = document.getElementById('top-import-text');
    if (importLabel && importText) {
        const importConfig = {
            timetable: { forId: 'excel-file', text: 'Nhập TKB' },
            exams: { forId: 'excel-exam-file', text: 'Nhập Lịch Thi' },
        }[tabId];
        if (importConfig) {
            importLabel.style.display = 'inline-flex';
            importLabel.setAttribute('for', importConfig.forId);
            importText.innerText = importConfig.text;
        } else {
            importLabel.style.display = 'none';
        }
    }

    if (tabId === 'planner' && typeof initDayPlanner === 'function') {
        initDayPlanner();
        loadPlannerBlocks();
    }
}

window.switchTab = function(tabId, element, titleText) {
    if (element.classList.contains('active')) return; 

    const loader = document.getElementById('global-loader');
    loader.classList.remove('hidden');

    setTimeout(() => {
        applyTabState(tabId, titleText);
        setTimeout(() => { loader.classList.add('hidden'); }, 150); 
    }, 350); 
}

function applyTargetTabInstant() {
    const target = localStorage.getItem(STORAGE_KEYS.targetTab);
    localStorage.removeItem(STORAGE_KEYS.targetTab); 
    if (!target || !document.querySelector(`[data-tab="${target}"]`)) return;
    applyTabState(target);
}

// navigateWithFade() giờ nằm ở bg-sync.js (dùng chung với index.js, tránh lặp code)

// =========================================
// 1.6b. VÀO PROFILE TỪ TKB — nhớ điểm quay về
// =========================================
window.goToProfileFromTkb = function() {
    localStorage.setItem(STORAGE_KEYS.profileReturnTo, '../tkb/calendar.html');

    // Ghi nhớ luôn tab đang đứng (Thời Khóa Biểu/Lịch Thi/Cài Đặt) để applyTargetTabInstant()
    // tự khôi phục đúng tab đó khi quay lại, không chỉ mặc định về Thời Khóa Biểu
    const activePane = document.querySelector('.tab-pane.active');
    if (activePane && activePane.id) {
        localStorage.setItem(STORAGE_KEYS.targetTab, activePane.id.replace('tab-', ''));
    }

    navigateWithFade('../profile/profile.html');
};

// =========================================
// 2. RENDER LƯỚI TKB & IMPORT EXCEL
// =========================================

function initWeekSelector(maxW = MAX_SEMESTER_WEEKS) {
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

        const text = `Tuần ${i} (Từ ${fmtDM(weekStart)} đến ${fmtDM(weekEnd)})`;

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
            await loadScriptOnce(XLSX_CDN_URL, 'XLSX');
            const data = new Uint8Array(event.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const jsonArray = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
            let pendingSemesterStart = null; // chỉ GHI (biến toàn cục + DB) sau khi chèn TKB mới thành công

            const formattedData = [];

            // ============================================================
            // FIX: TỰ ĐỘNG DÒ LẠI "NGÀY BẮT ĐẦU HỌC KỲ" TỪ CHÍNH FILE EXCEL MỚI.
            // Trước đây semesterStartDate là mốc cũ (lưu trong user_settings, hoặc mặc định 18/05/2026).
            // Nhập TKB kỳ mới (vd bắt đầu tháng 9) không hề cập nhật lại mốc này -> "Tuần 1" vẫn bị tính
            // theo mốc tháng 5 cũ -> lịch trống trơn dù đã import đúng file. Giờ quét toàn bộ cột
            // "Thời gian học" để tìm ngày sớm nhất, lùi về đúng thứ Hai của tuần đó làm mốc "Tuần 1" mới,
            // rồi lưu lại vào Supabase để các lần đăng nhập sau vẫn giữ đúng mốc này.
            // parseVNExamDate() (shared.js): cùng 1 bộ phân tích ngày cho TKB + Lịch thi, có kiểm tra ngày
            // thật (trước đây ở đây có 2 bản parse riêng không validate: "31/02" hay chuỗi rác -> Invalid Date).
            let earliestDate = null;
            for (let i = 0; i < jsonArray.length; i++) {
                const rangeStr = String(jsonArray[i]['Thời gian học'] || '').trim();
                if (!rangeStr.includes('đến')) continue;
                const startStr = rangeStr.split('đến')[0].trim();
                const sDate = parseVNExamDate(startStr);
                if (sDate && (!earliestDate || sDate < earliestDate)) earliestDate = sDate;
            }

            if (earliestDate) {
                const dow = earliestDate.getDay(); // 0 = Chủ Nhật, 1 = Thứ 2, ...
                const diffToMonday = dow === 0 ? 6 : dow - 1;
                const newSemesterStart = new Date(earliestDate);
                newSemesterStart.setDate(earliestDate.getDate() - diffToMonday);
                // KHÔNG ghi ngay: trước đây mốc mới được lưu vào DB TRƯỚC khi biết file có hợp lệ/chèn
                // thành công không -> import lỗi vẫn làm lệch toàn bộ số tuần của TKB CŨ còn nguyên.
                pendingSemesterStart = newSemesterStart;
            }
            const effectiveSemesterStart = pendingSemesterStart || semesterStartDate;

            for (let i = 0; i < jsonArray.length; i++) {
                const row = jsonArray[i];
                
                const courseCode = String(row['Mã HP'] || row['Mã MH'] || '').trim();
                const subjectName = String(row['Tên môn'] || row['Tên môn học'] || '').trim();
                const groupId = String(row['Nhóm'] || row['Nhóm tổ'] || '').trim();
                const lecturer = String(row['Giảng viên'] || '').trim();
                const room = String(row['Phòng'] || '').trim();
                const rawDay = String(row['Thứ'] ?? '').trim();
                const day = /^(cn|chủ nhật)$/i.test(rawDay) ? 8 : parseInt(rawDay, 10);

                // Thứ phải là 2..8 (8 = Chủ Nhật) — giá trị khác làm bảng TKB ném lỗi lúc vẽ
                if (isNaN(day) || day < 2 || day > 8 || !subjectName) continue; 
                
                let timeSlot = String(row['Tiết'] || '').trim();
                let startTiet = 0;
                let endTiet = 0;
                
                if (timeSlot) {
                    const match = timeSlot.match(/Tiết\s*(\d+)\s*-\s*(\d+)/i);
                    if (match) { startTiet = parseInt(match[1], 10); endTiet = parseInt(match[2], 10); }
                } else if (row['Tiết bắt đầu'] !== undefined && row['Số tiết'] !== undefined) {
                    startTiet = parseInt(row['Tiết bắt đầu'], 10);
                    endTiet = startTiet + parseInt(row['Số tiết'], 10) - 1;
                    timeSlot = `Tiết ${startTiet}-${endTiet}`;
                }

                let exactTime = String(row['Thời gian'] || '').trim();
                if (!exactTime && startTiet > 0 && endTiet > 0) {
                    if (sguPeriodStartText(startTiet) && sguPeriodEndText(endTiet)) {
                        exactTime = `${sguPeriodStartText(startTiet)} -> ${sguPeriodEndText(endTiet)}`;
                    }
                }

                let weeks = String(row['Tuần'] || row['Tuần học'] || '').trim();
                let dateRangeStr = String(row['Thời gian học'] || '').trim();
                
                if (!weeks && dateRangeStr.includes('đến')) {
                    const dates = dateRangeStr.split('đến').map(s => s.trim());
                    const sDate = dates.length === 2 ? parseVNExamDate(dates[0]) : null;
                    const eDate = dates.length === 2 ? parseVNExamDate(dates[1]) : null;
                    if (sDate && eDate) {
                        // Số NGÀY LỊCH / 7 (calendarDayDiff) thay vì chênh mili-giây: không lệch khi qua giờ mùa hè.
                        const diffStart = Math.floor(calendarDayDiff(sDate, effectiveSemesterStart) / 7);
                        const diffEnd = Math.floor(calendarDayDiff(eDate, effectiveSemesterStart) / 7);

                        const weekArr = Array(MAX_SEMESTER_WEEKS).fill('-');
                        for (let w = Math.max(0, diffStart); w <= Math.min(MAX_SEMESTER_WEEKS - 1, diffEnd); w++) {
                            weekArr[w] = ((w + 1) % 10).toString(); 
                        }
                        weeks = weekArr.join('');
                    }
                }

                if (startTiet >= 1 && endTiet >= startTiet && endTiet <= SGU_PERIOD_COUNT) { // lưới tiết chỉ có 1..SGU_PERIOD_COUNT
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

            // ĐỒNG BỘ GIỮ NGUYÊN ID (thay cho "xoá hết rồi tạo lại"): buổi nào trong file khớp với buổi cũ thì
            // GIỮ dòng cũ (chỉ cập nhật nếu phòng/GV/tuần... đổi) nên ghi chú, bài tập, thùng rác gắn vào id đó
            // KHÔNG hề bị đụng tới — nhập lại đúng TKB cũ là không thêm/xoá dòng nào. Thứ tự an toàn:
            // (1) chèn buổi mới, (2) cập nhật buổi giữ lại, (3) chỉ với buổi cũ KHÔNG còn trong file mới:
            // chuyển ghi chú sang buổi cùng môn nếu có, rồi mới xoá; còn ghi chú mà không chuyển được thì GIỮ LẠI.
            const SUBJECT_COLS = 'id, name, course_code, group_id, day, time_slot, room, lecturer, exact_time, weeks';
            const { data: oldRows, error: fetchOldErr } = await sbClient.from('subjects').select(SUBJECT_COLS).eq('user_id', currentUser.id);
            if (fetchOldErr) throw new Error("Không đọc được TKB cũ để chuẩn bị đồng bộ: " + fetchOldErr.message);

            const plan = planSubjectSync(oldRows || [], formattedData);

            let insertedRows = [];
            if (plan.toInsert.length) {
                const ins = await sbClient.from('subjects').insert(plan.toInsert).select('id, name, course_code, group_id, day, time_slot');
                if (ins.error) throw new Error("Supabase từ chối lưu buổi học mới (TKB cũ vẫn còn nguyên, chưa mất gì): " + ins.error.message);
                insertedRows = ins.data || [];
            }

            // Buổi giữ lại: chỉ gửi UPDATE cho dòng thật sự có thay đổi. Lỗi ở đây KHÔNG gây mất dữ liệu (dòng cũ còn nguyên).
            const SYNC_FIELDS = ['name', 'course_code', 'group_id', 'day', 'time_slot', 'room', 'lecturer', 'exact_time', 'weeks'];
            const same = (a, b) => String(a == null ? '' : a) === String(b == null ? '' : b);
            let updatedCount = 0, updateFailed = 0;
            await Promise.all(plan.matches.map(async ({ oldRow, newRow }) => {
                const patch = {};
                SYNC_FIELDS.forEach((f) => { if (!same(oldRow[f], newRow[f])) patch[f] = newRow[f]; });
                if (!Object.keys(patch).length) return;
                const { error: upErr } = await sbClient.from('subjects').update(patch).eq('id', oldRow.id).eq('user_id', currentUser.id);
                if (upErr) { updateFailed++; console.warn('[Import] Không cập nhật được buổi', oldRow.id, upErr.message); }
                else updatedCount++;
            }));

            // Buổi cũ không còn trong file mới: ghi chú (nếu có) chuyển sang buổi cùng môn trong TKB mới.
            const finalRows = plan.matches.map(({ oldRow, newRow }) => ({ ...newRow, id: oldRow.id })).concat(insertedRows);
            const goneIds = plan.unmatchedOld.map(r => r.id);
            const keepOldIds = new Set();
            if (goneIds.length) {
                const remap = buildSubjectIdRemap(plan.unmatchedOld, finalRows);
                // Đọc theo trang (.range): PostgREST mặc định chỉ trả tối đa 1000 dòng/lần, đọc 1 lần có thể bỏ sót.
                const withDetails = new Set();
                let detailErr = null;
                for (let from = 0; ; from += 1000) {
                    const { data: page, error } = await sbClient.from('subject_details')
                        .select('subject_id').eq('user_id', currentUser.id).in('subject_id', goneIds).range(from, from + 999);
                    if (error) { detailErr = error; break; }
                    (page || []).forEach(r => withDetails.add(r.subject_id));
                    if (!page || page.length < 1000) break;
                }
                if (detailErr) {
                    // Không biết buổi nào có ghi chú -> giữ nguyên toàn bộ buổi cũ còn thừa còn hơn mất dữ liệu
                    goneIds.forEach(id => keepOldIds.add(id));
                    console.warn('[Import] Không đọc được ghi chú để chuyển sang TKB mới, giữ lại bản cũ:', detailErr.message);
                } else {
                    await Promise.all([...withDetails].map(async (oldId) => {
                        const newId = remap.get(oldId);
                        if (newId === undefined) { keepOldIds.add(oldId); return; }
                        const { error: moveErr } = await sbClient.from('subject_details')
                            .update({ subject_id: newId }).eq('subject_id', oldId).eq('user_id', currentUser.id);
                        if (moveErr) { keepOldIds.add(oldId); console.warn('[Import] Không chuyển được ghi chú của môn', oldId, moveErr.message); }
                    }));
                }
            }

            const idsToDelete = goneIds.filter(id => !keepOldIds.has(id));
            if (idsToDelete.length) {
                const { error: deleteErr } = await sbClient.from('subjects').delete().in('id', idsToDelete).eq('user_id', currentUser.id);
                if (deleteErr) console.warn('[Import] Đã lưu TKB mới nhưng chưa xóa được buổi cũ không còn dùng (nhập lại lần nữa để dọn):', deleteErr.message);
            }
            const keptNote = keepOldIds.size
                ? `\n\nLưu ý: ${keepOldIds.size} buổi học cũ không còn trong TKB mới nhưng vẫn có ghi chú/bài tập nên được giữ lại (có thể hiện trùng) để không mất dữ liệu.`
                : '';
            const summary = `\n\nGiữ nguyên ${plan.matches.length - updatedCount - updateFailed} buổi, cập nhật ${updatedCount}, thêm mới ${insertedRows.length}, bỏ ${idsToDelete.length}.`
                + (updateFailed ? `\n${updateFailed} buổi chưa cập nhật được thông tin mới (dữ liệu cũ vẫn còn, nhập lại để thử lại).` : '');

            if (pendingSemesterStart) {
                semesterStartDate = pendingSemesterStart;
                const ymd = fmtLocalDate(semesterStartDate);
                const { error: settingsErr } = await sbClient.from('user_settings')
                    .upsert({ user_id: currentUser.id, semester_start_date: ymd }, { onConflict: 'user_id' });
                if (settingsErr) console.error('[Import] Lỗi lưu mốc học kỳ mới:', settingsErr);
            }

            showAlert("Đã đồng bộ TKB thành công! Ghi chú và bài tập của các môn vẫn được giữ nguyên." + summary + keptNote, "Hoàn tất"); 

            // FIX: TKB mới là 1 lịch học hoàn toàn khác, không được giữ nguyên tuần đang xem dở của TKB cũ
            // (vd đang ở "Tuần 20" thì nhập TKB mới vào vẫn cứ hiện tiếp "Tuần 20" vì loadTimetable() chỉ đọc
            // lại giá trị hiện có trên #week-selector). Nên chủ động đưa selector về Tuần 1 trước khi render lại.
            const weekSelectorEl = document.getElementById('week-selector');
            if (weekSelectorEl) weekSelectorEl.value = 1;

            await loadTimetable(); 
            loadExams(); 
            
        } catch (err) { 
            showAlert(`Lỗi xử lý file:\n${err.message || 'Vui lòng kiểm tra lại định dạng file.'}`, "Lỗi hệ thống"); 
            console.error("Chi tiết lỗi:", err);
        } finally {
            e.target.value = '';
        }
    };
    reader.onerror = () => { showAlert('Không đọc được file này.', 'Lỗi đọc file'); e.target.value = ''; };
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
    const { data: subjects, error } = await withRetry(() =>
        sbClient.from('subjects').select('*').eq('user_id', currentUser.id)
    );
    if (error) {
        console.error('Lỗi tải TKB:', error);
        window.showAlert && window.showAlert(
            "Không thể tải Thời Khóa Biểu do máy chủ đang tạm thời gián đoạn. Vui lòng thử tải lại trang sau ít phút.",
            "Lỗi kết nối"
        );
        return;
    }

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