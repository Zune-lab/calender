// ===== calendar-3-personalization.js =====
// Phần 3/5 của calendar.js. Nạp SAU calendar-2-timetable-modal.js.
// Nội dung: theme/ảnh nền tuỳ chỉnh, màu accent hệ thống, màu môn học, dropdown chọn tuần,
// dropdown thời gian báo trước, custom date picker, loadExams() (Lịch Thi).

// 4. SIÊU CÁ NHÂN HÓA (THEME, BACKGROUND, MÀU MÔN HỌC)
// =========================================
window.applyCustomBG = function() {
    if (window.applyBgFromUrlInput) window.applyBgFromUrlInput('custom-bg-url');
}

// Khôi phục ảnh nền mặc định: xoá customBg qua clearCustomBackground() (dùng chung bg-sync.js
// -> Dashboard/Hồ Sơ đang mở song song cũng tự cập nhật theo qua sự kiện 'storage'/'customBackgroundChange'),
// đồng thời dọn sạch ô nhập URL và input file để UI không còn hiển thị giá trị cũ.
window.resetCustomBG = function() {
    if (window.clearCustomBackground) window.clearCustomBackground();
    else localStorage.removeItem('customBg');

    const urlInput = document.getElementById('custom-bg-url');
    if (urlInput) urlInput.value = '';
    const fileInput = document.getElementById('custom-bg-file');
    if (fileInput) fileInput.value = '';
}

// Dùng chung 1 bảng preset cho cả 2 nơi (màu môn học ở #neon-color-presets và màu accent hệ
// thống ở #accent-color-presets) — trước đây mỗi hàm tự khai lại y hệt mảng này, sửa 1 màu phải
// nhớ sửa cả 2 chỗ.
const PERSONALIZATION_COLOR_PRESETS = [
    { name: 'HỒNG', color: '#FF3366', soft: 'rgba(255,51,102,0.45)' },
    { name: 'XANH', color: '#00C9FF', soft: 'rgba(0,201,255,0.45)' },
    { name: 'TÍM', color: '#9d4edd', soft: 'rgba(157,78,221,0.45)' },
    { name: 'CAM', color: '#FF9933', soft: 'rgba(255,153,51,0.45)' },
    { name: 'LỤC', color: '#38ef7d', soft: 'rgba(56,239,125,0.45)' }
];

function renderNeonColorButtons() {
    const container = document.getElementById('neon-color-presets');
    if(!container) return;

    let html = '';
    PERSONALIZATION_COLOR_PRESETS.forEach(p => {
        html += `<button class="neon-color-btn" onclick="applyPresetColor('${p.color}', this)" title="${p.name}" style="background: ${p.color}; --btn-color: ${p.color}; --btn-soft: ${p.soft};"></button>`;
    });
    container.innerHTML = html;
}

// =========================================
// "ĐỔI MÀU ACCENT HỆ THỐNG": bổ sung phần code JS còn thiếu hoàn toàn — calendar.html đã có sẵn
// khối UI (#accent-color-presets, nút "Áp màu tự pha" / "Random" / "Dùng màu mặc định theo tài
// khoản") gọi 3 hàm applyCustomAccentColor() / randomizeAccentColor() / resetAccentColor(), nhưng
// cả 3 hàm này (và việc đổ preset màu vào #accent-color-presets) chưa từng được viết -> bấm vào
// không có gì xảy ra (lỗi "not defined" âm thầm trong console). Dùng chung 1 key localStorage
// 'customAccent' — ĐÚNG với key mà shared.js (resolveAccentForUser) đã đọc, và index.js (trang
// Dashboard) cũng đọc lại y hệt, nên đổi ở đây sẽ đồng bộ sang cả Dashboard/Hồ sơ.
// =========================================
function renderAccentColorPresets() {
    const container = document.getElementById('accent-color-presets');
    if (!container) return;

    let html = '';
    PERSONALIZATION_COLOR_PRESETS.forEach(p => {
        html += `<button class="neon-color-btn" onclick="applyPresetAccentColor('${p.color}', this)" title="${p.name}" style="background: ${p.color}; --btn-color: ${p.color}; --btn-soft: ${p.soft};"></button>`;
    });
    container.innerHTML = html;
}

// Áp màu accent lên giao diện NGAY LẬP TỨC, không đụng tới localStorage — dùng khi màu đã được
// lưu/xoá ở nơi khác rồi (vd resetAccentColor gọi clearSavedAccentColor() xong chỉ cần vẽ lại UI).
function applyAccentColorToUI(hexColor) {
    document.documentElement.style.setProperty('--accent', hexColor);
    const picker = document.getElementById('custom-accent-color');
    if (picker) picker.value = hexColor;
    // Mọi lần đổi màu accent (preset / color-picker / random / reset) đều cần bỏ trạng thái
    // "active" của các nút preset trước đó -> gom về đúng 1 chỗ thay vì lặp lại ở từng hàm gọi.
    clearActivePresetSwatch();
}

// Áp dụng 1 màu accent DO NGƯỜI DÙNG TỰ CHỌN (preset / color-picker / random) — có lưu lại vào
// 'customAccent' (qua setSavedAccentColor() ở shared.js, nguồn duy nhất đọc/ghi key này) để lần
// vào sau (và các trang khác) vẫn giữ đúng màu.
function setAccentColor(hexColor) {
    applyAccentColorToUI(hexColor);
    setSavedAccentColor(hexColor);
}
function clearActivePresetSwatch() {
    document.querySelectorAll('#accent-color-presets .neon-color-btn').forEach(b => b.classList.remove('active'));
}

window.applyPresetAccentColor = function(color, btnElement) {
    setAccentColor(color);
    if (btnElement) btnElement.classList.add('active');
}

window.applyCustomAccentColor = function() {
    const picker = document.getElementById('custom-accent-color');
    if (!picker) return;
    setAccentColor(picker.value);
}

window.randomizeAccentColor = function() {
    // shiftHue() (dùng ở trang Dashboard) nằm trong index.js, KHÔNG có ở trang TKB này -> tự
    // viết 1 hàm HSL->HEX nhỏ gọn riêng, không phụ thuộc file khác, để random ra màu luôn tươi/đủ
    // sáng (tránh random RGB thô dễ ra màu xỉn, xám khó nhìn trên nền tối của app).
    const h = Math.floor(Math.random() * 360);
    const hexColor = hslToHex(h, 70, 58);
    setAccentColor(hexColor);
}

function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const toHex = x => Math.round(255 * x).toString(16).padStart(2, '0');
    return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

// QUAY VỀ mặc định theo tài khoản (hash ổn định ở shared.js) — gỡ hẳn 'customAccent' rồi chỉ vẽ
// lại UI, KHÔNG gọi setAccentColor() (tránh ghi lại 'customAccent' rồi phải xoá lần 2 ngay sau).
window.resetAccentColor = function() {
    clearSavedAccentColor();
    clearActivePresetSwatch();
    if (typeof resolveAccentForUser === 'function' && currentUser) {
        applyAccentColorToUI(resolveAccentForUser(currentUser.id));
    }
}

window.applyPresetColor = function(color, btnElement) {
    const subject = document.getElementById('subject-color-select').value;
    if(!subject) { showAlert("Vui lòng chọn một môn học từ danh sách ở trên trước khi chọn màu!", "Chưa chọn môn"); return; }

    document.querySelectorAll('.neon-color-btn').forEach(b => b.classList.remove('active'));
    if(btnElement) btnElement.classList.add('active');

    saveSubjectColor(subject, color);

    document.getElementById('custom-subject-color').value = color;
    renderTimetable();
}

window.applySubjectColor = function() {
    const subject = document.getElementById('subject-color-select').value;
    const color = document.getElementById('custom-subject-color').value;
    
    if(!subject) { showAlert("Vui lòng chọn một môn học từ danh sách để đổi màu!", "Chưa chọn môn"); return; }

    document.querySelectorAll('.neon-color-btn').forEach(b => b.classList.remove('active'));

    saveSubjectColor(subject, color);

    renderTimetable();
}

window.resetSubjectColors = function() {
    localStorage.removeItem('subjectCustomColors');
    renderTimetable();
}

window.resetPersonalization = function() {
    if (window.clearCustomBackground) window.clearCustomBackground();
    else localStorage.removeItem('customBg');
    clearSavedAccentColor();
    localStorage.removeItem('subjectCustomColors');
    location.reload(); 
}

// =========================================
// 8. LOGIC CHỌN TUẦN CAO CẤP (CUSTOM DROPDOWN)
// =========================================
window.toggleWeekDropdown = function(e) {
    if(e) e.stopPropagation();
    const container = document.getElementById('week-dropdown-container');
    const dropdown = document.getElementById('week-options-list');
    
    dropdown.classList.toggle('hidden-dropdown');
    container.classList.toggle('open'); 
    
    if(!dropdown.classList.contains('hidden-dropdown')) {
        const activeLi = dropdown.querySelector('li.selected');
        if (activeLi) {
            dropdown.scrollTop = activeLi.offsetTop - dropdown.clientHeight / 2 + activeLi.clientHeight / 2;
        }
    }
}

window.selectCustomWeek = function(val) {
    const selector = document.getElementById('week-selector');
    selector.value = val;

    const selectedOption = Array.from(selector.options).find(opt => parseInt(opt.value) === parseInt(val));
    if(selectedOption) {
        document.getElementById('current-week-text').innerText = selectedOption.text;
    }

    const listItems = document.querySelectorAll('#week-options-list li');
    listItems.forEach(li => li.classList.remove('selected'));
    
    const activeLi = Array.from(listItems).find(li => parseInt(li.dataset.val) === parseInt(val));
    if(activeLi) activeLi.classList.add('selected');

    document.getElementById('week-options-list').classList.add('hidden-dropdown');
    document.getElementById('week-dropdown-container').classList.remove('open');
    
    renderTimetable();
}

window.changeWeek = function(step) {
    const selector = document.getElementById('week-selector');
    if (!selector) return;
    
    let currentWeek = parseInt(selector.value);
    let newWeek = currentWeek + step;
    const maxW = window.maxSemesterWeek || 20; 
    
    if (newWeek >= 1 && newWeek <= maxW) {
        selectCustomWeek(newWeek);
    }
}

document.addEventListener('click', function(e) {
    const container = document.getElementById('week-dropdown-container');
    const dropdown = document.getElementById('week-options-list');
    if (container && dropdown && !container.contains(e.target)) {
        dropdown.classList.add('hidden-dropdown');
        container.classList.remove('open');
    }
});

// =========================================
// 8.1. CUSTOM DROPDOWN CHO "THỜI GIAN BÁO TRƯỚC" (thay <select> mặc định xấu)
// Tái dùng đúng bộ class custom-select-container/custom-dropdown-list đã có sẵn cho ô chọn
// Tuần học ở trên — <select id="planner-notif-lead-select"> gốc vẫn còn (đã ẩn đi), nên
// onchange="savePlannerNotifLead(...)" cũ không cần đổi gì.
function initNotifLeadCustomSelect() {
    const nativeSelect = document.getElementById('planner-notif-lead-select');
    const list = document.getElementById('notif-lead-options-list');
    const currentTextEl = document.getElementById('notif-lead-current-text');
    if (!nativeSelect || !list) return;

    list.innerHTML = '';
    Array.from(nativeSelect.options).forEach(opt => {
        const li = document.createElement('li');
        li.innerText = opt.text; li.dataset.val = opt.value;
        if (opt.value === nativeSelect.value) li.classList.add('selected');
        li.onclick = (e) => { e.stopPropagation(); selectNotifLeadOption(opt.value); };
        list.appendChild(li);
    });

    const selectedOpt = nativeSelect.options[nativeSelect.selectedIndex];
    if (currentTextEl && selectedOpt) currentTextEl.innerText = selectedOpt.text;
}

// Đo khoảng trống PHÍA TRÊN và PHÍA DƯỚI trigger, tính theo khung chứa gần nhất có thể cuộn/
// giới hạn tầm nhìn (modal, khung cài đặt, hay khung dashboard chính) thay vì cả viewport trình
// duyệt — vì các popup này luôn nằm lồng trong 1 khung kính (glass panel) cố định kích thước.
// Nếu bên dưới không đủ chỗ chứa hết panel MÀ bên trên lại đang rộng hơn bên dưới -> gắn class
// "flip-up" để CSS đổi hướng mở lên trên; ngược lại giữ nguyên hành vi mở xuống như cũ.
function positionFlipUpIfNeeded(triggerEl, panelEl, gap = 12) {
    const scroller = triggerEl.closest('.settings-wrapper, .popup-panel, .modal, .main-glass-dashboard') || document.body;
    const scrollerRect = scroller.getBoundingClientRect();
    const triggerRect = triggerEl.getBoundingClientRect();
    const panelH = panelEl.scrollHeight || panelEl.offsetHeight;
    const spaceBelow = scrollerRect.bottom - triggerRect.bottom;
    const spaceAbove = triggerRect.top - scrollerRect.top;
    const flip = spaceBelow < panelH + gap && spaceAbove > spaceBelow;
    panelEl.classList.toggle('flip-up', flip);
    return flip;
}

window.toggleNotifLeadDropdown = function(e) {
    if (e) e.stopPropagation();
    const container = document.getElementById('notif-lead-dropdown-container');
    const list = document.getElementById('notif-lead-options-list');
    if (!container || !list) return;

    const isOpening = list.classList.contains('hidden-dropdown');
    if (isOpening) {
        // FIX BUG "MỞ XUỐNG ĐÈ LÊN NÚT KHÔI PHỤC GIAO DIỆN MẶC ĐỊNH BÊN DƯỚI": ô này nằm gần cuối
        // trang Cài Đặt, dưới nó không còn đủ chỗ cho cả 5 dòng lựa chọn. Bỏ ẩn TRƯỚC để đo đúng
        // chiều cao thật (lúc ẩn, .hidden-dropdown ép max-height về 0 nên đo sẽ ra sai), rồi mới
        // quyết định lật hướng.
        list.classList.remove('hidden-dropdown');
        positionFlipUpIfNeeded(container, list, 16);
        container.classList.add('open');
    } else {
        list.classList.add('hidden-dropdown');
        container.classList.remove('open');
    }
};

window.selectNotifLeadOption = function(val) {
    const nativeSelect = document.getElementById('planner-notif-lead-select');
    const list = document.getElementById('notif-lead-options-list');
    const currentTextEl = document.getElementById('notif-lead-current-text');
    if (!nativeSelect) return;

    nativeSelect.value = val;
    // FIX: đổi .value bằng JS không tự bắn 'change' -> phải bắn tay để onchange="savePlannerNotifLead"
    // gắn sẵn trên thẻ <select> gốc vẫn chạy y hệt như khi người dùng chọn option thật.
    nativeSelect.dispatchEvent(new Event('change'));

    const selectedOpt = Array.from(nativeSelect.options).find(o => o.value === String(val));
    if (currentTextEl && selectedOpt) currentTextEl.innerText = selectedOpt.text;

    if (list) {
        list.querySelectorAll('li').forEach(li => li.classList.toggle('selected', li.dataset.val === String(val)));
        list.classList.add('hidden-dropdown');
    }
    const container = document.getElementById('notif-lead-dropdown-container');
    if (container) container.classList.remove('open');
};

document.addEventListener('click', function(e) {
    const container = document.getElementById('notif-lead-dropdown-container');
    const list = document.getElementById('notif-lead-options-list');
    if (container && list && !container.contains(e.target)) {
        list.classList.add('hidden-dropdown');
        container.classList.remove('open');
    }
});

// =========================================
// 8.2. CUSTOM DATE PICKER (thay <input type="date"> mặc định xấu — lịch xám do trình duyệt/
// hệ điều hành tự vẽ, CSS không thể can thiệp vào bên trong được). Giữ nguyên <input type="date">
// gốc (chỉ ẩn đi), viết đè lên đúng .value của nó mỗi khi chọn ngày -> mọi chỗ code cũ đọc
// dueDateInput.value (addDetail, v.v.) không cần sửa gì thêm.
function initCustomDatePicker(inputId) {
    const nativeInput = document.getElementById(inputId);
    if (!nativeInput || nativeInput.dataset.cdpInit) return;
    nativeInput.dataset.cdpInit = '1';
    nativeInput.style.display = 'none';

    const wrapper = document.createElement('div');
    wrapper.className = 'custom-date-wrapper';
    nativeInput.parentNode.insertBefore(wrapper, nativeInput);
    wrapper.appendChild(nativeInput);

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-date-trigger';
    trigger.title = nativeInput.title || 'Chọn hạn';
    trigger.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="4"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg><span class="custom-date-trigger-text">Hạn...</span>`;
    wrapper.appendChild(trigger);

    const panel = document.createElement('div');
    panel.className = 'custom-date-panel hidden-dropdown';
    wrapper.appendChild(panel);

    let viewDate = new Date(); viewDate.setDate(1);
    const monthNames = ['Tháng 1','Tháng 2','Tháng 3','Tháng 4','Tháng 5','Tháng 6','Tháng 7','Tháng 8','Tháng 9','Tháng 10','Tháng 11','Tháng 12'];

    function renderPanel() {
        const y = viewDate.getFullYear(), m = viewDate.getMonth();
        const firstDay = new Date(y, m, 1);
        const startOffset = (firstDay.getDay() + 6) % 7; // Thứ 2 = cột đầu tiên
        const daysInMonth = new Date(y, m + 1, 0).getDate();
        const tStr = plannerFmtDateInput(new Date());
        const selected = nativeInput.value;

        let daysHtml = '';
        for (let i = 0; i < startOffset; i++) daysHtml += `<span class="cdp-day cdp-empty"></span>`;
        for (let d = 1; d <= daysInMonth; d++) {
            const dStr = plannerFmtDateInput(new Date(y, m, d));
            const isPast = dStr < tStr;
            const isToday = dStr === tStr;
            const isSelected = dStr === selected;
            daysHtml += `<button type="button" class="cdp-day${isPast ? ' cdp-past' : ''}${isToday ? ' cdp-today' : ''}${isSelected ? ' cdp-selected' : ''}" ${isPast ? 'disabled' : ''} data-date="${dStr}">${d}</button>`;
        }

        panel.innerHTML = `
            <div class="cdp-header">
                <button type="button" class="cdp-nav" data-nav="-1" aria-label="Tháng trước">‹</button>
                <span class="cdp-month-label">${monthNames[m]} ${y}</span>
                <button type="button" class="cdp-nav" data-nav="1" aria-label="Tháng sau">›</button>
            </div>
            <div class="cdp-weekdays"><span>T2</span><span>T3</span><span>T4</span><span>T5</span><span>T6</span><span>T7</span><span>CN</span></div>
            <div class="cdp-days">${daysHtml}</div>
            <div class="cdp-footer">
                <button type="button" class="cdp-footer-btn" data-action="clear">Xóa</button>
                <button type="button" class="cdp-footer-btn cdp-footer-today" data-action="today">Hôm nay</button>
            </div>
        `;
    }

    function updateTriggerText() {
        const span = trigger.querySelector('.custom-date-trigger-text');
        if (nativeInput.value) {
            const [y, m, d] = nativeInput.value.split('-');
            span.textContent = `${d}/${m}`;
            trigger.classList.add('has-value');
        } else {
            span.textContent = 'Hạn...';
            trigger.classList.remove('has-value');
        }
    }

    function setValue(dStr) {
        nativeInput.value = dStr || '';
        nativeInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function openPanel() {
        if (nativeInput.value) {
            const [y, m] = nativeInput.value.split('-').map(Number);
            viewDate = new Date(y, m - 1, 1);
        } else {
            const n = new Date(); viewDate = new Date(n.getFullYear(), n.getMonth(), 1);
        }
        renderPanel();
        panel.classList.remove('hidden-dropdown');
        document.querySelectorAll('.custom-date-panel').forEach(p => { if (p !== panel) p.classList.add('hidden-dropdown'); });
        // FIX BUG "LỊCH MỞ XUỐNG ĐÈ LÊN Ô NHẬP GHI CHÚ/CÔNG VIỆC BÊN DƯỚI": nút "Hạn..." nằm sát
        // ngay trên ô nhập text trong modal chi tiết môn học, mà bảng lịch khá cao -> đo trước
        // khoảng trống trong khung modal rồi tự lật lên mở phía trên nếu không đủ chỗ bên dưới.
        positionFlipUpIfNeeded(wrapper, panel, 14);
    }
    function closePanel() { panel.classList.add('hidden-dropdown'); }

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (panel.classList.contains('hidden-dropdown')) openPanel(); else closePanel();
    });

    panel.addEventListener('click', (e) => {
        e.stopPropagation();
        const navBtn = e.target.closest('.cdp-nav');
        if (navBtn) { viewDate.setMonth(viewDate.getMonth() + parseInt(navBtn.dataset.nav)); renderPanel(); return; }

        const dayBtn = e.target.closest('.cdp-day:not(.cdp-empty):not(.cdp-past)');
        if (dayBtn) { setValue(dayBtn.dataset.date); closePanel(); return; }

        const actionBtn = e.target.closest('[data-action]');
        if (actionBtn) {
            if (actionBtn.dataset.action === 'clear') { setValue(''); closePanel(); }
            else if (actionBtn.dataset.action === 'today') { setValue(plannerFmtDateInput(new Date())); closePanel(); }
        }
    });

    document.addEventListener('click', (e) => { if (!wrapper.contains(e.target)) closePanel(); });

    // Bắt mọi thay đổi giá trị (kể cả reset "dueDateInput.value = ''" ở addDetail) để đồng bộ
    // lại chữ hiển thị trên nút bấm — không chỉ riêng chọn ngày từ chính lịch này.
    nativeInput.addEventListener('change', () => { updateTriggerText(); renderPanel(); });

    updateTriggerText();
}


document.getElementById('excel-exam-file').addEventListener('change', async function(e) {
    if (!currentUser) {
        showAlert("Vui lòng đăng nhập trước khi tải lên Lịch thi!", "Yêu cầu đăng nhập");
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
            const jsonArray = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { raw: false, defval: "" });

            const formattedData = [];
            
            for (let i = 0; i < jsonArray.length; i++) {
                const row = jsonArray[i];
                let courseCode = String(row['Mã MH'] || '').trim();
                if (courseCode.endsWith('.0')) courseCode = courseCode.slice(0, -2);
                
                const subjectName = String(row['Tên môn học'] || '').trim();
                let examDate = String(row['Ngày thi'] || '').trim();
                let examTime = String(row['Giờ bắt đầu'] || '').trim();
                const room = String(row['Phòng thi'] || '').trim();
                
                if (!subjectName || subjectName.toLowerCase().includes('kỳ thi')) continue; 
                
                if (examDate.includes('00:00:30') || examDate.includes('-')) {
                    examDate = examDate.split(' ')[0];
                    // FIX: trước đây cứ thấy dấu "-" là giả định chuỗi luôn ở dạng ISO
                    // (YYYY-MM-DD) rồi đảo ngược mù quáng thành DD/MM/YYYY — nếu Excel lỡ xuất
                    // ra dạng DD-MM-YYYY (cột định dạng Text) thì bị đảo sai. Dùng chung hàm
                    // parseVNExamDate() để tự nhận diện đúng thành phần NĂM (dựa độ dài 4 số)
                    // rồi tự build lại chuỗi DD/MM/YYYY chuẩn, không phụ thuộc vị trí.
                    const parsed = parseVNExamDate(examDate);
                    if (parsed) {
                        const dd = String(parsed.getDate()).padStart(2, '0');
                        const mm = String(parsed.getMonth() + 1).padStart(2, '0');
                        examDate = `${dd}/${mm}/${parsed.getFullYear()}`;
                    }
                }

                formattedData.push({
                    user_id: currentUser.id, 
                    subject_name: subjectName, 
                    course_code: courseCode,
                    exam_date: examDate,
                    exam_time: examTime,
                    room: room
                });
            }

            if (formattedData.length === 0) {
                showAlert("Không tìm thấy dữ liệu Lịch Thi hợp lệ.", "Lỗi dữ liệu");
                e.target.value = '';
                return;
            }

            // FIX AN TOÀN DỮ LIỆU (nghiêm trọng) — cùng lỗi như bên Nhập TKB: đảo thứ tự thành
            // CHÈN dữ liệu mới TRƯỚC, chỉ XÓA lịch thi cũ (theo đúng ID đã lưu) SAU KHI chèn mới
            // thành công, để lỡ bước chèn thất bại giữa chừng thì lịch thi cũ vẫn còn nguyên.
            const { data: oldExamRows, error: fetchOldErr } = await sbClient.from('exams').select('id').eq('user_id', currentUser.id);
            if (fetchOldErr) throw new Error("Không đọc được Lịch Thi cũ để chuẩn bị thay thế: " + fetchOldErr.message);

            const { error: insertErr } = await sbClient.from('exams').insert(formattedData);
            if (insertErr) throw new Error("Supabase từ chối lưu dữ liệu mới (Lịch Thi cũ vẫn còn nguyên, chưa mất gì): " + insertErr.message);

            const oldExamIds = (oldExamRows || []).map(r => r.id);
            if (oldExamIds.length) {
                const { error: deleteErr } = await sbClient.from('exams').delete().in('id', oldExamIds);
                if (deleteErr) {
                    console.warn('[Import] Đã lưu Lịch Thi mới nhưng chưa xóa được bản cũ (có thể hiện trùng, thử nhập lại lần nữa):', deleteErr.message);
                }
            }

            showAlert("Đã đồng bộ Lịch Thi thành công!", "Hoàn tất"); 
            loadExams();
            e.target.value = ''; 
            
        } catch (err) { 
            showAlert(`Lỗi xử lý file:\n${err.message}`, "Lỗi hệ thống"); 
            console.error(err);
        }
    };
    reader.readAsArrayBuffer(file);
});

window.loadExams = async function() {
    if (!currentUser) return;
    const { data, error } = await sbClient.from('exams').select('*').eq('user_id', currentUser.id);
    if (error) return console.error('Lỗi tải Lịch Thi:', error);
    let exams = data;

    // FIX: tự động XÓA HẲN các môn thi đã thi xong quá 14 ngày (2 tuần) khỏi bảng exams,
    // tránh danh sách phình to mãi với những kỳ thi cũ đã qua từ lâu.
    if (exams && exams.length) {
        const cleanupToday = new Date(); cleanupToday.setHours(0, 0, 0, 0);
        const staleIds = [];
        exams = exams.filter(exam => {
            const d = parseVNExamDate(exam.exam_date);
            if (d) {
                const daysSince = Math.floor((cleanupToday - d) / (1000 * 60 * 60 * 24));
                if (daysSince > 14) { staleIds.push(exam.id); return false; }
            }
            return true;
        });
        if (staleIds.length) {
            // Xóa ngầm dưới nền, không cần đợi -> danh sách hiển thị (đã filter ở trên) mượt ngay,
            // không phải chờ round-trip mạng.
            sbClient.from('exams').delete().in('id', staleIds).then(({ error: delErr }) => {
                if (delErr) console.warn('[Exams] Lỗi tự xóa lịch thi cũ:', delErr.message);
            });
        }
    }
    
    const wrapper = document.getElementById('exams-wrapper'); 
    if (!wrapper) return;
    wrapper.innerHTML = ''; 

    if (!exams || exams.length === 0) {
        wrapper.innerHTML = `
            <div style="height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; opacity: 0.6; min-height: 400px;">
                <div style="width: 100px; height: 100px; border-radius: 50%; background: rgba(150,150,150,0.05); display: flex; align-items: center; justify-content: center; margin-bottom: 20px; box-shadow: inset 0 0 20px rgba(150,150,150,0.05);">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line><path d="M9 16l2 2 4-4"></path></svg>
                </div>
                <h5 style="font-size: 1.2rem; font-weight: 500; margin-bottom: 8px; color: var(--text-main);">Chưa có lịch thi nào</h5>
                <p style="font-size: 0.95rem; color: var(--text-muted);">Nhấn nút <strong style="color:var(--text-main);">"Nhập Lịch Thi" ở góc trên bên phải</strong> để đồng bộ dữ liệu.</p>
            </div>
        `;
        return;
    }

    exams.sort((a, b) => {
        const ta = parseVNExamDate(a.exam_date)?.getTime() ?? 0;
        const tb = parseVNExamDate(b.exam_date)?.getTime() ?? 0;
        return ta - tb;
    });

    let html = '<div class="exam-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 24px; padding: 10px 4px 40px 4px;">';    
    const today = new Date();
    today.setHours(0,0,0,0);
    
    const gradientColors = [ ['#FF3366', '#FF9933'], ['#00C9FF', '#92FE9D'], ['#9d4edd', '#E100FF'], ['#11998e', '#38ef7d'], ['#FDBB2D', '#22C1C3'] ];
    
    const subjectColorMap = {}; 
    let colorIndex = 0;
    allLoadedSubjects.forEach(sub => {
        const baseName = sub.name.split('-')[0].split('(')[0].trim().toLowerCase();
        if (!subjectColorMap[baseName]) { 
            subjectColorMap[baseName] = gradientColors[colorIndex % gradientColors.length][0]; 
            colorIndex++; 
        }
    });

    const savedSubjectColors = getSavedSubjectColors();

    exams.forEach(exam => {
        const examDateObj = parseVNExamDate(exam.exam_date);

        let countdownHtml = '';
        if (examDateObj) {
            const diffTime = examDateObj - today;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            // Tính chính xác còn bao nhiêu PHÚT tới giờ thi (ghép ngày thi + giờ bắt đầu thật),
            // để cảnh báo khẩn khi sắp tới giờ, không chỉ dựa vào so sánh ngày
            let minutesUntilExam = null;
            const timeMatch = String(exam.exam_time || '').match(/(\d{1,2}):(\d{2})/);
            if (timeMatch) {
                const examDateTime = new Date(examDateObj);
                examDateTime.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2]), 0, 0);
                minutesUntilExam = (examDateTime - new Date()) / 60000;
            }

            if (minutesUntilExam !== null && minutesUntilExam > 0 && minutesUntilExam <= 30) {
                const minutesLeft = Math.ceil(minutesUntilExam);
                countdownHtml = `<div class="exam-countdown urgent">⚠ CÒN ${minutesLeft} PHÚT NỮA!</div>`;
            } else if (diffDays === 0 && minutesUntilExam !== null && minutesUntilExam <= 0) {
                // Đã qua giờ thi trong hôm nay -> không còn đúng để hiện "Thi vào hôm nay!" nữa
                countdownHtml = `<div class="exam-countdown past">Đã thi xong</div>`;
            } else if (diffDays === 0) {
                countdownHtml = `<div class="exam-countdown today">Thi vào hôm nay!</div>`;
            } else if (diffDays > 0) {
                countdownHtml = `<div class="exam-countdown upcoming">Còn ${diffDays} ngày</div>`;
            } else {
                countdownHtml = `<div class="exam-countdown past">Đã kết thúc</div>`;
            }
        }
        
        const baseName = exam.subject_name.split('-')[0].split('(')[0].trim().toLowerCase();
        let c1 = '#FF3366'; 
        
        if (savedSubjectColors[baseName]) {
            c1 = savedSubjectColors[baseName]; 
        } else if (window.globalSubjectColors && window.globalSubjectColors[baseName]) {
            c1 = window.globalSubjectColors[baseName];
        } else if (subjectColorMap[baseName]) {
            c1 = subjectColorMap[baseName]; 
        }

        html += `
            <div class="exam-card" style="--c1: ${c1};">
                ${countdownHtml}
                <div class="exam-course-code">Mã MH: ${escapeHtml(exam.course_code)}</div>
                <h4>${escapeHtml(exam.subject_name)}</h4>
                
                <div class="exam-info-container">
                    <div class="exam-info-row">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                        <span><strong>Ngày thi:</strong> ${escapeHtml(exam.exam_date)}</span>
                    </div>
                    <div class="exam-info-row">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                        <span><strong>Giờ bắt đầu:</strong> <span class="highlight-time">${escapeHtml(exam.exam_time)}</span></span>
                    </div>
                    <div class="exam-info-row">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                        <span><strong>Phòng thi:</strong> <span class="highlight-room">${escapeHtml(exam.room)}</span></span>
                    </div>
                </div>
            </div>
        `;
    });
    html += '</div>';
    wrapper.innerHTML = html;
}

