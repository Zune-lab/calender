// ===== calendar-2-timetable-modal.js =====
// Phần 2/5 của calendar.js. Nạp SAU calendar-1-core.js.
// Nội dung: tô màu tự động thanh sticky, renderTimetable(), popup môn học (openModal),
// loadSubjectDetails(), ghi chú/công việc, thùng rác, priority picker.

function hexToRgba(hex, alpha) {
    // alpha 0.1: 0.32 vẫn còn rõ quá theo phản hồi thực tế -> hạ tiếp xuống rất nhẹ, chỉ đủ
    // ánh sắc màu thẻ lên thanh sticky một chút chứ không tạo thành mảng màu rõ rệt.
    hex = (hex || '').trim().replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const num = parseInt(hex, 16);
    // FIX BUG "THANH BLUR MÀU TÍM DÙ NỀN ĐANG ĐEN": trước đây cột nào KHÔNG có thẻ môn học ngay
    // dưới (ô trống) thì rơi vào nhánh fallback "tím nền mặc định app" (rgba(94,23,235,...)) một
    // cách CỨNG, bất kể nền thật của trang đang là màu/ảnh gì. Với tuần có nhiều ô trống (như ảnh
    // thực tế), phần lớn dải gradient của thanh sticky bị áp màu tím giả này, khiến nó nhìn tím rõ
    // rệt dù nền thật đang đen (hoặc trắng ở light mode, hoặc ảnh tuỳ chỉnh). Đổi thành "transparent"
    // — ô trống thì KHÔNG bịa màu, cứ để trong suốt cho nền THẬT phía sau (đen/trắng/ảnh) tự lộ ra
    // qua lớp blur, đúng như yêu cầu "phải lấy theo màu của bg" thay vì luôn ngả tím.
    if (!hex || isNaN(num)) return 'transparent';
    const r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function updateStickyTint() {
    const wrapper = document.getElementById('timetable-wrapper');
    const bar = document.getElementById('sticky-header-bg');
    const table = wrapper && wrapper.querySelector('.timetable-table');
    if (!wrapper || !bar || !table) return;

    const wrapRect = wrapper.getBoundingClientRect();
    if (wrapRect.width === 0 || wrapRect.height === 0) return;

    // elementFromPoint() trả về đúng phần tử TRÊN CÙNG tại toạ độ đó — nếu điểm dò rơi ngay vào
    // vùng chính thanh sticky/th đang che (z-index cao hơn thẻ môn học), nó sẽ trả về CHÍNH thanh
    // sticky đó chứ không "nhìn xuyên" được xuống thẻ môn học phía sau. Tắt tạm pointer-events
    // của các phần tử sticky trong lúc dò, xong bật lại ngay, để elementFromPoint "nhìn xuyên"
    // được đúng xuống thẻ môn học thật sự đang nằm bên dưới.
    const headRow = table.querySelector('thead tr');
    const ths = headRow ? Array.from(headRow.children) : [];
    const firstCells = Array.from(table.querySelectorAll('tbody td:first-child'));
    const toggled = [bar, ...ths, ...firstCells];
    toggled.forEach(el => { el.style.pointerEvents = 'none'; });

    try {
        // ---- 1) Thanh "THỨ 2..CN": dò màu từng cột Thứ, ghép thành gradient ngang khớp vị trí ----
        if (ths.length) {
            const sampleY = wrapRect.top + 46; // ngay dưới mép thanh mờ, nơi đỉnh thẻ môn học lộ ra
            const stops = ths.map(th => {
                const r = th.getBoundingClientRect();
                const cx = Math.min(Math.max(r.left + r.width / 2, wrapRect.left + 1), wrapRect.right - 1);
                const el = (sampleY >= wrapRect.top && sampleY <= wrapRect.bottom) ? document.elementFromPoint(cx, sampleY) : null;
                const cardTd = el ? el.closest('.subject-card-td') : null;
                const c1 = cardTd ? getComputedStyle(cardTd).getPropertyValue('--c1') : '';
                const pct = ((cx - wrapRect.left) / wrapRect.width) * 100;
                return `${hexToRgba(c1, 0.1)} ${pct.toFixed(1)}%`;
            });
            bar.style.setProperty('--auto-tint', `linear-gradient(90deg, ${stops.join(', ')})`);
        }

        // ---- 2) Cột "Tiết" sticky bên trái (chỉ có tác dụng khi bảng đang cuộn ngang trên mobile) ----
        firstCells.forEach(cell => {
            const r = cell.getBoundingClientRect();
            if (r.bottom < wrapRect.top || r.top > wrapRect.bottom) { cell.style.setProperty('--auto-tint-cell', 'transparent'); return; }
            const x = r.right + 8; // nhìn ngay sang nội dung đang cuộn tới ngay sau cột Tiết
            const y = Math.min(Math.max(r.top + r.height / 2, wrapRect.top + 1), wrapRect.bottom - 1);
            const el = document.elementFromPoint(x, y);
            const cardTd = el ? el.closest('.subject-card-td') : null;
            const c1 = cardTd ? getComputedStyle(cardTd).getPropertyValue('--c1') : '';
            cell.style.setProperty('--auto-tint-cell', cardTd ? hexToRgba(c1, 0.1) : 'transparent');
        });
    } finally {
        toggled.forEach(el => { el.style.pointerEvents = ''; });
    }
}

let _tintRaf = null;
function requestTintUpdate() {
    if (_tintRaf) return;
    _tintRaf = requestAnimationFrame(() => { _tintRaf = null; updateStickyTint(); });
}


function renderTimetable() {
    const safeSubjects = allLoadedSubjects || [];

    let actualMaxW = 1;
    if (safeSubjects.length > 0) {
        safeSubjects.forEach(sub => {
            if (sub.weeks) {
                for (let i = sub.weeks.length - 1; i >= 0; i--) {
                    if (sub.weeks[i] !== '-' && sub.weeks[i] !== ' ') {
                        if (i + 1 > actualMaxW) actualMaxW = i + 1;
                        break;
                    }
                }
            }
        });
    } else {
        actualMaxW = 20; 
    }

    let maxW = actualMaxW < 20 ? actualMaxW + 1 : actualMaxW;

    // FIX: trước đây chỉ rebuild khi SỐ LƯỢNG tuần (maxW) đổi khác — nếu import TKB mới nhưng
    // tình cờ ra cùng số tuần với TKB cũ (chỉ semesterStartDate đổi), dropdown vẫn giữ nguyên
    // nhãn "Từ dd/mm đến dd/mm" của ngày CŨ dù bảng TKB bên dưới đã hiển thị đúng dữ liệu mới.
    // Nay thêm semesterStartDate vào chữ ký so sánh để rebuild đúng mọi trường hợp.
    const customList = document.getElementById('week-options-list');
    const weekSelectorSig = `${maxW}|${semesterStartDate.getTime()}`;
    if (customList && (window._lastWeekSelectorSig !== weekSelectorSig || customList.children.length === 0)) {
        window._lastWeekSelectorSig = weekSelectorSig;
        initWeekSelector(maxW);
    }

    const wrapper = document.getElementById('timetable-wrapper'); 
    // FIX: trước đây xoá SẠCH cả wrapper (`wrapper.innerHTML = ''`) mỗi lần render — xoá luôn cả
    // thanh kính mờ cố định (#sticky-header-bg) vừa được tách riêng ra ở trên, làm mất hết tác
    // dụng chống-giật-blur của nó (lại bị tạo mới từ đầu mỗi lần, y hệt bug cũ). Giờ chỉ xoá đúng
    // phần nội dung bảng bên trong #timetable-table-container, không đụng gì đến thanh mờ nữa.
    const tableContainer = document.getElementById('timetable-table-container');
    const stickyBarEl = document.getElementById('sticky-header-bg');
    tableContainer.innerHTML = '';

    if (safeSubjects.length === 0) {
        if (stickyBarEl) stickyBarEl.style.display = 'none'; // không có bảng -> ẩn thanh mờ (không có gì để "dính" phía trên)
        tableContainer.innerHTML = '<div class="empty-state">Chưa có TKB. Bấm Nhập Excel để đưa lịch học vào khung giữa.</div>';
        return;
    }

    const selector = document.getElementById('week-selector');
    const selectedWeekNum = selector ? parseInt(selector.value) : 1;
    const weekIndex = selectedWeekNum - 1;

    const prevBtn = document.getElementById('prev-week-btn');
    const nextBtn = document.getElementById('next-week-btn');
    if (prevBtn) {
        prevBtn.style.opacity = selectedWeekNum <= 1 ? '0.2' : '1';
        prevBtn.style.pointerEvents = selectedWeekNum <= 1 ? 'none' : 'auto';
    }
    if (nextBtn) {
        nextBtn.style.opacity = selectedWeekNum >= maxW ? '0.2' : '1';
        nextBtn.style.pointerEvents = selectedWeekNum >= maxW ? 'none' : 'auto';
    }

    if (selectedWeekNum > actualMaxW) {
        if (stickyBarEl) stickyBarEl.style.display = 'none';
        tableContainer.innerHTML = `
            <div style="height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; opacity: 0.95; text-align: center; padding: 20px; animation: fadeInSlide 0.5s ease-out forwards;">
                <div style="width: 100px; height: 100px; border-radius: 50%; background: linear-gradient(135deg, rgba(10, 132, 255, 0.2), rgba(0, 201, 255, 0.05)); display: flex; align-items: center; justify-content: center; margin-bottom: 25px; border: 1px solid rgba(10, 132, 255, 0.3); box-shadow: 0 0 30px rgba(10, 132, 255, 0.15);">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#0A84FF" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><path d="M9 12l2 2 4-4"></path></svg>
                </div>
                <h4 style="font-size: 1.65rem; font-weight: 700; color: var(--text-main); margin-bottom: 12px; letter-spacing: -0.5px;">Hoàn thành chương trình học!</h4>
                <p style="font-size: 1.05rem; color: var(--text-muted); max-width: 450px; line-height: 1.6;">Lịch học chính thức của bạn đã kết thúc. Hãy theo dõi mục <strong style="color: var(--accent);">Lịch Thi</strong> và dành thời gian ôn tập thật tốt nhé!</p>
            </div>
        `;
        return; 
    }

    const matrix = {};
    for (let t = 1; t <= 14; t++) {
        matrix[t] = {};
        for (let d = 2; d <= 8; d++) {
            matrix[t][d] = { status: 'empty', duration: 1, data: null };
        }
    }

    const renderedCards = new Set();
    safeSubjects.forEach(sub => {
        if (sub.weeks && sub.weeks.length > weekIndex) {
            const weekChar = sub.weeks.charAt(weekIndex);
            if (weekChar === '-' || weekChar === ' ' || !weekChar) { return; }
        }

        const match = (sub.time_slot || '').match(/Tiết\s*(\d+)\s*-\s*(\d+)/i);
        if (match) {
            let startTiet = parseInt(match[1]); 
            let endTiet = parseInt(match[2]);
            if (startTiet > endTiet) { const temp = startTiet; startTiet = endTiet; endTiet = temp; }

            const uniqueKey = `${sub.day}-${startTiet}-${endTiet}-${sub.course_code}`;
            if (renderedCards.has(uniqueKey)) return; 
            renderedCards.add(uniqueKey);

            const duration = endTiet - startTiet + 1;
            matrix[startTiet][sub.day] = { status: 'start', duration: duration, data: sub };
            for (let t = startTiet + 1; t <= endTiet; t++) {
                matrix[t][sub.day] = { status: 'covered' };
            }
        }
    });

    const currentWeekMonday = new Date(semesterStartDate);
    currentWeekMonday.setDate(semesterStartDate.getDate() + weekIndex * 7);

    // FIX: Tô sáng đúng cột "Thứ" của ngày hôm nay thật (nếu tuần đang xem có chứa hôm nay),
    // để mở TKB lên là thấy ngay hôm nay là thứ mấy, không phải dò từng cột.
    const realToday = new Date();
    realToday.setHours(0, 0, 0, 0);

    let tableHtml = `<table class="timetable-table"><thead><tr>`;
    tableHtml += `<th>Tiết</th>`;
    
    for(let d = 2; d <= 8; d++) {
        const currentDate = new Date(currentWeekMonday);
        currentDate.setDate(currentWeekMonday.getDate() + (d - 2));
        currentDate.setHours(0, 0, 0, 0);
        const dateStr = `${currentDate.getDate().toString().padStart(2, '0')}/${(currentDate.getMonth()+1).toString().padStart(2, '0')}`;
        
        const dayName = d === 8 ? 'Chủ Nhật' : `Thứ ${d}`;
        const isToday = currentDate.getTime() === realToday.getTime();
        tableHtml += `<th class="${isToday ? 'current-day-th' : ''}" data-day-col="${d}">${dayName}<br><span class="date-sub">${dateStr}</span></th>`;
    }
    tableHtml += `<th>Giờ</th></tr></thead><tbody>`;

    const timeMap = { 1:"07:00", 2:"07:50", 3:"09:00", 4:"09:50", 5:"10:40", 6:"13:00", 7:"13:50", 8:"15:00", 9:"15:50", 10:"16:40", 11:"17:40", 12:"18:30", 13:"19:20", 14:"20:10" };
    const gradientColors = [ ['#FF3366', '#FF9933'], ['#00C9FF', '#92FE9D'], ['#9d4edd', '#E100FF'], ['#11998e', '#38ef7d'], ['#FDBB2D', '#22C1C3'] ];
    const subjectColorMap = {}; let colorIndex = 0;
    
    window.globalSubjectColors = {};

    const savedSubjectColors = getSavedSubjectColors();

    for (let t = 1; t <= 14; t++) {
        tableHtml += `<tr><td class="grid-time">Tiết ${t}</td>`;

        for (let d = 2; d <= 8; d++) {
            const slot = matrix[t][d];

            if (slot.status === 'start') {
                const sub = slot.data;
                const baseName = sub.name.split('-')[0].split('(')[0].trim().toLowerCase();
                
                if (!subjectColorMap[baseName]) { subjectColorMap[baseName] = gradientColors[colorIndex % gradientColors.length]; colorIndex++; }
                let c1, c2;
                if (savedSubjectColors[baseName]) { c1 = savedSubjectColors[baseName]; c2 = savedSubjectColors[baseName]; } 
                else { c1 = subjectColorMap[baseName][0]; c2 = subjectColorMap[baseName][1]; }
                
                window.globalSubjectColors[baseName] = c1;
                
                const customColorStyle = `style="--c1: ${c1}; --c2: ${c2};"`;
                const rawName = sub.name.split('(')[0].trim();
                // FIX: ngưỡng cũ là 70 -> môn như "Phân tích thiết kế hướng đối tượng" + phòng + GV
                // (~46 ký tự) KHÔNG BAO GIỜ được xếp vào .large dù tên đã khá dài. Hạ ngưỡng xuống 45
                // để các môn tên dài tầm trung cũng được áp style .large (chữ nhỏ, gọn hơn).
                const contentLength = rawName.length + (sub.room || '').length + (sub.lecturer || '').length;

                tableHtml += `
                    <td rowspan="${slot.duration}" class="subject-card-td ${contentLength > 45 ? 'large' : 'compact'}" ${customColorStyle} onclick="window.openModalById('${sub.id}')">
                        <div class="card-title-area">
                            <h4 title="${escapeHtml(rawName)}">${escapeHtml(rawName)} <br><span class="course-code">${escapeHtml(sub.course_code || 'N/A')}</span></h4>
                        </div>
                        <p class="info-text">Nhóm: ${escapeHtml(sub.group_id || 'N/A')}</p>
                        <p class="info-text">Phòng: ${escapeHtml(sub.room || 'N/A')}</p>
                        <p class="info-text">GV: ${escapeHtml(sub.lecturer || 'N/A')}</p>
                        <p class="info-text time-text">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                            ${escapeHtml(sub.exact_time ? sub.exact_time : `Tiết ${t}-${t + slot.duration - 1}`)}
                        </p>
                    </td>
                `;
            } else if (slot.status === 'empty') {
                tableHtml += `<td class="empty-td"></td>`;
            }
        }
        tableHtml += `<td class="grid-time time-col"><strong>${timeMap[t]}</strong></td></tr>`;
    }

    tableHtml += `</tbody></table>`;
    // FIX: chỉ thay nội dung <table> trong container riêng, KHÔNG còn ghi đè lên toàn bộ wrapper
    // nữa (trước đây `wrapper.innerHTML = tableHtml` xoá luôn cả thanh kính mờ cố định ở trên).
    tableContainer.innerHTML = tableHtml;
    if (stickyBarEl) stickyBarEl.style.display = ''; // có bảng thật -> đảm bảo thanh mờ đang hiện (phòng trường hợp tuần trước đó là empty-state/hết chương trình đã ẩn nó đi)

    // FIX BUG "THANH MỜ KHÔNG PHỦ HẾT CÁC THỨ KHI MÀN HÌNH NHỎ":
    // .sticky-glass-bar chỉ là 1 div trang trí nằm TRƯỚC <table>, không tự động rộng bằng
    // <table> thật bên trong khi bảng phải cuộn ngang (mobile). Ở đây đo scrollWidth THẬT của
    // bảng rồi gán thẳng làm width (px) cho thanh mờ, cộng thêm đúng phần "tràn ra ngoài" do
    // margin-left:-20px / margin-right:-28px (bleed ra viền cong 2 bên) để thanh mờ luôn phủ
    // trọn đủ cả 7 cột Thứ 2 -> Chủ Nhật dù đang cuộn ngang tới đâu, không riêng gì phần khung
    // nhìn ban đầu. Dùng ResizeObserver thay vì chỉ nghe "resize" để bắt được cả các trường hợp
    // đổi kích thước không phải do resize cửa sổ (đổi tab, mở/đóng sidebar, xoay màn hình, v.v.).
    const tableEl = tableContainer.querySelector('.timetable-table');
    if (stickyBarEl && tableEl) {
        const syncStickyBarWidth = () => {
            const bleedLeft = 20;  // khớp với margin-left: -20px
            const bleedRight = 28; // khớp với margin-right: -28px
            stickyBarEl.style.width = (tableEl.scrollWidth + bleedLeft + bleedRight) + 'px';
        };
        syncStickyBarWidth();

        if (_stickyBarResizeObserver) { _stickyBarResizeObserver.disconnect(); }
        _stickyBarResizeObserver = new ResizeObserver(() => { syncStickyBarWidth(); requestTintUpdate(); });
        _stickyBarResizeObserver.observe(wrapper);
        _stickyBarResizeObserver.observe(tableEl);
    }

    wrapper.onscroll = function() {
        const bar = document.getElementById('sticky-header-bg');
        if (bar) {
            if (this.scrollTop > 2) bar.classList.add('scrolled');
            else bar.classList.remove('scrolled');
        }
        requestTintUpdate();
    };

    setTimeout(() => {
        const bar = document.getElementById('sticky-header-bg');
        if (bar && wrapper.scrollTop > 2) {
            bar.classList.add('scrolled');
        }
        updateStickyTint();
    }, 50);

    // FIX: Nếu tuần đang xem có chứa "hôm nay" -> tự cuộn ngang wrapper để cột đó lọt vào giữa
    // màn hình ngay khi mở TKB, tránh phải tự vuốt/dò từng cột trên điện thoại.
    const todayTh = wrapper.querySelector('.current-day-th');
    if (todayTh) {
        requestAnimationFrame(() => {
            const targetLeft = todayTh.offsetLeft - (wrapper.clientWidth / 2) + (todayTh.offsetWidth / 2);
            wrapper.scrollLeft = Math.max(0, targetLeft);
        });
    }

    const uniqueSubjects = [...new Set(safeSubjects.map(s => s.name.split('-')[0].split('(')[0].trim().toLowerCase()))];
    const selectEl = document.getElementById('subject-color-select');
    if(selectEl) {
        selectEl.innerHTML = '<option value="" style="color:#000;">-- Chọn môn học --</option>';
        uniqueSubjects.forEach(sub => {
            const displayName = sub.charAt(0).toUpperCase() + sub.slice(1);
            // FIX BẢO MẬT (XSS): sub/displayName lấy trực tiếp từ subject.name (dữ liệu import từ
            // Excel — do người dùng tự đưa vào, không đáng tin) nhưng trước đây bị nối thẳng vào
            // innerHTML mà KHÔNG escapeHtml() như mọi chỗ khác trong file này. Nếu tên môn học chứa
            // ký tự đặc biệt kiểu `"><img src=x onerror=...>` sẽ thực thi script ngay khi mở tab Cài
            // Đặt. escapeHtml() đã có sẵn ở shared.js, dùng lại cho cả value và text hiển thị.
            selectEl.innerHTML += `<option value="${escapeHtml(sub)}" style="color:#000;">${escapeHtml(displayName)}</option>`;
        });
    }
}

// =========================================
// 3. POPUP, ĐỒNG BỘ DỮ LIỆU & LOGIC THÙNG RÁC
// =========================================
// FIX BUG "DỌN RÁC/XÓA HẾT/KHÔI PHỤC TẤT CẢ KHÔNG XÓA HẾT": 1 môn học thường có NHIỀU dòng
// trong bảng subjects (mỗi buổi học/thứ trong tuần là 1 dòng riêng, id khác nhau, cùng tên môn).
// loadSubjectDetails() gom hết dữ liệu theo TẤT CẢ id liên quan (relatedSubjectIds) để hiển thị
// đủ dù ghi chú được thêm lúc mở modal từ buổi nào — nhưng trước đây các hàm xử lý HÀNG LOẠT
// (emptyTrashBin/clearAllActiveItems/restoreAllTrashItems) lại chỉ lọc đúng 1 subject_id đang mở
// (currentSubjectId). Hệ quả: ghi chú/công việc được thêm lúc mở modal từ 1 buổi khác của CÙNG
// môn sẽ không bị xóa/khôi phục dù người dùng bấm "Dọn rác"/"Xóa hết"/"Khôi phục tất cả" — số đếm
// không về 0, dữ liệu "ma" cứ quay lại ở lần mở sau. Lưu lại đủ danh sách id liên quan mỗi lần mở/
// tải lại modal để các hàm bulk-action dùng `.in()` thay vì `.eq()` với 1 id duy nhất.
let currentRelatedSubjectIds = [];

async function openModal(subject) {
    currentSubjectId = subject.id; 
    document.getElementById('modal-subject-name').innerText = subject.name;

    let dateRangeText = 'Chưa xác định';
    if (subject.weeks && typeof semesterStartDate !== 'undefined') {
        let startWeekIndex = -1; let endWeekIndex = -1;
        for (let i = 0; i < subject.weeks.length; i++) {
            if (subject.weeks[i] !== '-' && subject.weeks[i] !== ' ') {
                if (startWeekIndex === -1) startWeekIndex = i; 
                endWeekIndex = i; 
            }
        }
        if (startWeekIndex !== -1 && endWeekIndex !== -1) {
            const subjectStartDate = new Date(semesterStartDate);
            subjectStartDate.setDate(semesterStartDate.getDate() + (startWeekIndex * 7) + (subject.day - 2));
            const subjectEndDate = new Date(semesterStartDate);
            subjectEndDate.setDate(semesterStartDate.getDate() + (endWeekIndex * 7) + (subject.day - 2));
            const formatD = (d) => `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth()+1).toString().padStart(2, '0')}/${d.getFullYear()}`;
            dateRangeText = `${formatD(subjectStartDate)} đến ${formatD(subjectEndDate)}`;
        }
    }

    document.getElementById('modal-subject-meta').innerHTML = `
        <div class="meta-badge"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg> <strong>Mã HP:</strong> ${escapeHtml(subject.course_code || 'N/A')}</div>
        <div class="meta-badge"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg> <strong>Nhóm:</strong> ${escapeHtml(subject.group_id || 'N/A')}</div>
        <div class="meta-badge"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg> <strong>GV:</strong> ${escapeHtml(subject.lecturer || 'N/A')}</div>
        <div class="meta-badge"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> <strong>Giờ học:</strong> ${escapeHtml(subject.exact_time || 'N/A')}</div>
        <div class="meta-badge" style="width: 100%;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg> <strong>Thời hạn:</strong> ${escapeHtml(dateRangeText)}</div>
        <div class="meta-badge" style="width: 100%;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg> <strong>Phòng:</strong> ${escapeHtml(subject.room || 'N/A')}</div>
    `;

    document.getElementById('notes-list').innerHTML = '<li style="opacity: 0.4; justify-content: center; font-style: italic;">Đang đồng bộ...</li>';
    document.getElementById('notes-trash').innerHTML = ''; document.getElementById('tasks-upcoming').innerHTML = ''; document.getElementById('tasks-done').innerHTML = ''; document.getElementById('tasks-trash').innerHTML = '';
    
    document.getElementById('subject-modal').classList.remove('hidden');

    const baseName = subject.name.split('-')[0].split('(')[0].trim().toLowerCase();
    const relatedSubjectIds = allLoadedSubjects.filter(s => s.name.split('-')[0].split('(')[0].trim().toLowerCase() === baseName).map(s => s.id);
    currentRelatedSubjectIds = relatedSubjectIds;
    await loadSubjectDetails(relatedSubjectIds);
}

const closeModal = () => { document.getElementById('subject-modal').classList.add('hidden'); currentSubjectId = null; currentRelatedSubjectIds = []; };
document.getElementById('close-modal-btn').addEventListener('click', closeModal);
document.getElementById('subject-modal').addEventListener('click', function(e) { if (e.target === this) closeModal(); });

async function loadSubjectDetails(relatedSubjectIds) {
    const { data, error } = await sbClient.from('subject_details').select('*').in('subject_id', relatedSubjectIds).eq('user_id', currentUser.id);
    if (error) return console.error(error);

    const lists = { notes: document.getElementById('notes-list'), notesTrash: document.getElementById('notes-trash'), tasksUp: document.getElementById('tasks-upcoming'), tasksDone: document.getElementById('tasks-done'), tasksTrash: document.getElementById('tasks-trash') };
    Object.values(lists).forEach(el => el.innerHTML = '');
    
    let counts = { notesActive: 0, notesTrash: 0, tasksTrash: 0 }; 

    // MỤC 3: sắp xếp Quan trọng lên trước, rồi tới Bình thường, Không quan trọng lắm — trong cùng
    // 1 mức thì việc có Hạn gần nhất lên trước (để "nhận biết cái nào cần làm trước" đúng yêu cầu).
    const sortedData = [...data].sort((a, b) => {
        const pa = getPriorityInfo(a.priority).order, pb = getPriorityInfo(b.priority).order;
        if (pa !== pb) return pa - pb;
        if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
        if (a.due_date) return -1;
        if (b.due_date) return 1;
        return 0;
    });

    sortedData.forEach(item => {
        const li = document.createElement('li');
        const originSub = allLoadedSubjects.find(s => s.id === item.subject_id);
        // FIX: trước đây in thẳng "Thứ ${originSub.day}" -> lớp học Chủ Nhật (day = 8) bị hiện sai thành "Thứ 8".
        const originDayLabel = originSub ? (originSub.day === 8 ? 'Chủ Nhật' : `Thứ ${originSub.day}`) : '';
        let originHtml = originSub ? `<span class="origin-tag"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> Ghi tại: ${escapeHtml(originDayLabel)}, ${escapeHtml(originSub.time_slot)}</span>` : '';

        // MỤC 3: chấm màu + nhãn ưu tiên, và badge Hạn (đỏ nếu đã quá hạn)
        const pInfo = getPriorityInfo(item.priority);
        const priorityHtml = `<span class="priority-dot" style="background:${pInfo.color}" title="${pInfo.label}"></span>`;
        let dueHtml = '';
        if (item.due_date) {
            const todayStr = plannerFmtDateInput(new Date());
            const isOverdue = item.due_date < todayStr && item.status === 'upcoming';
            const [y, m, d] = item.due_date.split('-');
            dueHtml = `<span class="due-date-badge${isOverdue ? ' overdue' : ''}">Hạn: ${d}/${m}${isOverdue ? ' (quá hạn)' : ''}</span>`;
        }

        const isDeleted = item.status === 'deleted';
        const actionBtn = isDeleted 
            ? `<button class="action-btn restore" onclick="restoreDetail('${item.id}')" title="Khôi phục"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg></button>
               <button class="action-btn delete" onclick="hardDeleteDetail('${item.id}')" title="Xóa vĩnh viễn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>`
            : `<button class="action-btn delete" onclick="deleteDetail('${item.id}')" title="Chuyển vào thùng rác"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path></svg></button>`;
        const innerContent = `
            <div class="item-content"><span class="text">${priorityHtml}${escapeHtml(item.content)}</span>${dueHtml}${originHtml}</div>
            <div class="item-actions">${actionBtn}</div>
        `;

        if (item.type === 'note' || item.type === 'notification') {
            li.innerHTML = innerContent;
            if (isDeleted) { 
                lists.notesTrash.appendChild(li); counts.notesTrash++; 
            } else { 
                lists.notes.appendChild(li); counts.notesActive++; 
            }
        } else if (item.type === 'task') {
            if (isDeleted) {
                li.innerHTML = innerContent; lists.tasksTrash.appendChild(li); counts.tasksTrash++;
            } else if (item.status === 'upcoming') {
                li.innerHTML = `
                    <div class="item-content"><span class="text">${priorityHtml}${escapeHtml(item.content)}</span>${dueHtml}${originHtml}</div>
                    <div class="item-actions" style="opacity: 1;">
                        ${actionBtn}
                        <input type="checkbox" class="mac-checkbox" onchange="markTaskDone('${item.id}')">
                    </div>`;
                lists.tasksUp.appendChild(li);
            } else {
                li.innerHTML = `
                    <div class="item-content"><span class="text" style="text-decoration: line-through; opacity: 0.5;">${priorityHtml}${escapeHtml(item.content)}</span>${dueHtml}${originHtml}</div>
                    <div class="item-actions" style="opacity: 1;">
                        ${actionBtn}
                        <input type="checkbox" class="mac-checkbox" checked onchange="unmarkTask('${item.id}')">
                    </div>`;
                lists.tasksDone.appendChild(li);
            }
        }
    });

    document.getElementById('notes-trash-count').innerText = `(${counts.notesTrash})`;
    document.getElementById('tasks-trash-count').innerText = `(${counts.tasksTrash})`;

    const noteTrashToggle = document.getElementById('notes-trash-toggle');
    const noteTrashWrapper = document.getElementById('notes-trash-wrapper');
    const noteTrashList = document.getElementById('notes-trash'); 
    const noteTrashActions = document.getElementById('notes-trash-actions');

    if (noteTrashToggle && noteTrashWrapper) {
        if (noteTrashList) noteTrashList.classList.remove('hidden-trash'); 
        if (counts.notesTrash === 0) {
            noteTrashToggle.style.opacity = '0.3';
            noteTrashToggle.style.pointerEvents = 'none'; 
            noteTrashWrapper.classList.add('hidden-trash'); 
            if (noteTrashActions) noteTrashActions.classList.add('hidden-trash');
        } else {
            noteTrashToggle.style.opacity = '1';
            noteTrashToggle.style.pointerEvents = 'auto'; 
        }
    }

    const taskTrashToggle = document.getElementById('tasks-trash-toggle');
    const taskTrashWrapper = document.getElementById('tasks-trash-wrapper');
    const taskTrashList = document.getElementById('tasks-trash');
    const taskTrashActions = document.getElementById('tasks-trash-actions'); 

    if (taskTrashToggle && taskTrashWrapper) {
        if (taskTrashList) taskTrashList.classList.remove('hidden-trash');
        if (counts.tasksTrash === 0) {
            taskTrashToggle.style.opacity = '0.3';
            taskTrashToggle.style.pointerEvents = 'none';
            taskTrashWrapper.classList.add('hidden-trash');
            if (taskTrashActions) taskTrashActions.classList.add('hidden-trash'); 
        } else {
            taskTrashToggle.style.opacity = '1';
            taskTrashToggle.style.pointerEvents = 'auto';
        }
    }

    const notesClearAllBtn = document.getElementById('notes-clear-all-btn');
    if (notesClearAllBtn) {
        if (counts.notesActive === 0) {
            notesClearAllBtn.classList.add('hidden-trash');
        } else {
            notesClearAllBtn.classList.remove('hidden-trash');
        }
    }
}

window.handleEnter = function(e, type) {
    if (e.key === 'Enter') {
        e.preventDefault(); 
        addDetail(type);
    }
}

window.emptyTrashBin = async function(btnElement, type) {
    if (btnElement.classList.contains('delete')) return; 
    
    const isConfirmed = await showConfirm(`Bạn có chắc chắn muốn dọn sạch thùng rác ${type === 'note' ? 'ghi chú' : 'công việc'}? Hành động này không thể hoàn tác!`, 'Xác nhận dọn rác');
    if (!isConfirmed) return;

    btnElement.classList.add('delete');
    
    setTimeout(async () => {
        const { error } = await sbClient
            .from('subject_details')
            .delete()
            .in('subject_id', currentRelatedSubjectIds)
            .eq('user_id', currentUser.id)
            .eq('type', type)
            .eq('status', 'deleted');
        
        if (error) {
            showAlert("Lỗi khi dọn thùng rác: " + error.message, "Lỗi kết nối");
        } else {
            reloadCurrentModal();
        }
        // FIX BUG "NÚT DỌN RÁC BỊ KẸT VĨNH VIỄN SAU LẦN BẤM ĐẦU TIÊN": trước đây class 'delete'
        // (điều khiển animation thùng rác + dấu tick của nút) chỉ được gỡ ở nhánh LỖI — nếu xóa
        // THÀNH CÔNG (nhánh else) thì class này không bao giờ được gỡ. Vì #notes-empty-btn /
        // #tasks-empty-btn là 2 nút TĨNH DUY NHẤT dùng chung cho MỌI popup môn học (không được
        // tạo lại mỗi lần mở modal), hậu quả là: (1) nút bị kẹt vĩnh viễn ở khung hình "đã xong"
        // (dấu tick) thay vì trở lại icon thùng rác bình thường, và (2) guard
        // `if (btnElement.classList.contains('delete')) return;` ở đầu hàm chặn đứng MỌI lần bấm
        // "Dọn rác" tiếp theo (ở BẤT KỲ môn học nào) trong suốt phiên làm việc, cho tới khi tải
        // lại toàn bộ trang. Gỡ 'delete' ở CẢ 2 nhánh (giống đúng cách clearAllActiveItems() /
        // restoreAllTrashItems() đang làm với class 'animating' của chúng) để nút luôn reset lại
        // đúng trạng thái sau mỗi lần dùng, dùng được nhiều lần liên tiếp.
        btnElement.classList.remove('delete');
    }, 2800);
}

window.toggleTrash = function(wrapperId, btnId) { 
    document.getElementById(wrapperId).classList.toggle('hidden-trash'); 
    if (btnId) document.getElementById(btnId).classList.toggle('hidden-trash');
}

window.clearAllActiveItems = async function(btnElement, type) {
    if (btnElement.classList.contains('animating')) return; 

    const typeName = type === 'note' ? 'ghi chú' : 'công việc';
    const isConfirmed = await showConfirm(`Bạn có muốn chuyển TẤT CẢ ${typeName} đang hiển thị vào thùng rác không?`, 'Xác nhận xóa');
    if (!isConfirmed) return;

    btnElement.classList.add('animating');

    setTimeout(async () => {
        const { error } = await sbClient
            .from('subject_details')
            .update({ status: 'deleted' }) 
            .in('subject_id', currentRelatedSubjectIds)
            .eq('user_id', currentUser.id)
            .eq('type', type)
            .eq('status', 'upcoming');
        
        if (error) showAlert("Lỗi khi dọn dẹp: " + error.message, "Lỗi kết nối");
        btnElement.classList.remove('animating'); 
        reloadCurrentModal(); 
    }, 1200);
}

window.restoreAllTrashItems = async function(btnElement, type) {
    if (btnElement.classList.contains('animating')) return;

    const typeName = type === 'note' ? 'ghi chú' : 'công việc';
    const isConfirmed = await showConfirm(`Bạn có muốn khôi phục TẤT CẢ ${typeName} từ thùng rác không?`, 'Khôi phục hàng loạt');
    if (!isConfirmed) return;

    btnElement.classList.add('animating');

    setTimeout(async () => {
        const { error } = await sbClient
            .from('subject_details')
            .update({ status: 'upcoming' }) 
            .in('subject_id', currentRelatedSubjectIds)
            .eq('user_id', currentUser.id)
            .eq('type', type)
            .eq('status', 'deleted'); 
        
        if (error) showAlert("Lỗi khi khôi phục: " + error.message, "Lỗi kết nối");
        btnElement.classList.remove('animating'); 
        reloadCurrentModal(); 
    }, 600);
}

// Đọc mức ưu tiên đang được chọn (nút .active) trong 1 bộ .priority-selector theo id container
function getSelectedPriority(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return 'normal';
    const activeBtn = container.querySelector('.priority-btn.active');
    return (activeBtn && activeBtn.dataset.priority) || 'normal';
}

// Chọn 1 mức ưu tiên trong bộ chọn — dùng chung cho note/task/planner (gọi qua onclick trực tiếp
// trên từng nút, xem event delegation gắn ở initPriorityPickers() bên dưới)
function selectPriorityBtn(container, btn) {
    container.querySelectorAll('.priority-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
}

function initPriorityPickers() {
    document.querySelectorAll('.priority-selector').forEach(container => {
        if (container.dataset.wired) return; // tránh gắn listener trùng nếu hàm này lỡ được gọi lại
        container.dataset.wired = '1';
        container.addEventListener('click', (e) => {
            const btn = e.target.closest('.priority-btn');
            if (!btn || !container.contains(btn)) return;
            selectPriorityBtn(container, btn);
        });
    });
}

window.addDetail = async function(type) {
    const inputId = type === 'note' ? 'new-note' : 'new-task';
    const input = document.getElementById(inputId);
    const content = input.value.trim();
    if (!content || !currentSubjectId) return;

    const priority = getSelectedPriority(type === 'note' ? 'note-priority-selector' : 'task-priority-selector');
    const dueDateInput = document.getElementById(type === 'note' ? 'note-due-date' : 'task-due-date');
    const dueDate = (dueDateInput && dueDateInput.value) ? dueDateInput.value : null;

    // FIX: chặn thêm ở đây (không chỉ dựa vào min= trên input) để phòng trường hợp trình duyệt
    // cũ/WebView không hỗ trợ thuộc tính min trên input[type=date] -> vẫn có thể gõ tay/dán
    // ngày quá khứ vào. Ngày hạn không được sớm hơn hôm nay.
    if (dueDate && dueDate < plannerFmtDateInput(new Date())) {
        showAlert("Hạn không được chọn ngày trong quá khứ.", "Ngày không hợp lệ");
        return;
    }

    const { error } = await sbClient.from('subject_details').insert([{
        subject_id: currentSubjectId, user_id: currentUser.id, type: type, content: content,
        status: 'upcoming', priority: priority, due_date: dueDate
    }]);
    if (!error) {
        input.value = '';
        if (dueDateInput) { dueDateInput.value = ''; dueDateInput.dispatchEvent(new Event('change', { bubbles: true })); }
        // Reset về "Bình thường" sau khi thêm xong, cho lần thêm tiếp theo
        const selCont = document.getElementById(type === 'note' ? 'note-priority-selector' : 'task-priority-selector');
        if (selCont) {
            const normalBtn = selCont.querySelector('.priority-btn[data-priority="normal"]');
            if (normalBtn) selectPriorityBtn(selCont, normalBtn);
        }
        reloadCurrentModal();
    } else {
        showAlert("Lỗi khi thêm: " + error.message + " (Bạn đã thêm cột 'priority'/'due_date' vào bảng subject_details trong Supabase chưa?)", "Lỗi kết nối");
        console.error(error);
    }
}

// FIX HARDENING (phòng thủ theo chiều sâu): các hàm update/delete theo id bên dưới trước đây
// chỉ lọc `.eq('id', id)`, hoàn toàn phó mặc việc "id đó có đúng của user đang đăng nhập không"
// cho Row Level Security phía Supabase tự lo. Nếu RLS lỡ cấu hình thiếu ở bảng subject_details
// (hoặc tắt nhầm khi debug), bất kỳ ai đăng nhập cũng có thể sửa/xóa dữ liệu của tài khoản khác
// chỉ cần đoán/biết đúng UUID. Thêm `.eq('user_id', currentUser.id)` vào mọi câu lệnh — không
// đổi hành vi bình thường (id hiển thị luôn đã thuộc đúng user rồi), chỉ chặn thêm 1 lớp an toàn.
window.deleteDetail = async function(id) {
    const { error } = await sbClient.from('subject_details').update({ status: 'deleted' }).eq('id', id).eq('user_id', currentUser.id);
    if (error) { showAlert("Lỗi khi xóa: " + error.message, "Lỗi kết nối"); console.error(error); } 
    else reloadCurrentModal();
}

window.hardDeleteDetail = async function(id) {
    const isConfirmed = await showConfirm('Bạn có chắc chắn muốn xóa vĩnh viễn mục này không? Dữ liệu sẽ mất hoàn toàn và không thể khôi phục.', 'Cảnh báo xóa vĩnh viễn');
    if (!isConfirmed) return;
    
    const { error } = await sbClient.from('subject_details').delete().eq('id', id).eq('user_id', currentUser.id);
    
    if (error) { 
        showAlert("Lỗi khi xóa vĩnh viễn: " + error.message, "Lỗi kết nối"); 
        console.error(error); 
    } else {
        reloadCurrentModal();
    }
}

window.restoreDetail = async function(id) {
    const { error } = await sbClient.from('subject_details').update({ status: 'upcoming' }).eq('id', id).eq('user_id', currentUser.id);
    if (error) { showAlert("Lỗi khôi phục: " + error.message, "Lỗi kết nối"); console.error(error); } 
    else reloadCurrentModal();
}

window.markTaskDone = async function(id) {
    const { error } = await sbClient.from('subject_details').update({ status: 'done' }).eq('id', id).eq('user_id', currentUser.id);
    if (error) { showAlert("Lỗi cập nhật task: " + error.message, "Lỗi kết nối"); console.error(error); } 
    else reloadCurrentModal();
}

window.unmarkTask = async function(id) {
    const { error } = await sbClient.from('subject_details').update({ status: 'upcoming' }).eq('id', id).eq('user_id', currentUser.id);
    if (error) { showAlert("Lỗi cập nhật task: " + error.message, "Lỗi kết nối"); console.error(error); } 
    else reloadCurrentModal();
}

async function reloadCurrentModal() { 
    const subject = allLoadedSubjects.find(s => s.id === currentSubjectId);
    if (!subject) return;

    const baseName = subject.name.split('-')[0].split('(')[0].trim().toLowerCase();
    const relatedSubjectIds = allLoadedSubjects.filter(s => s.name.split('-')[0].split('(')[0].trim().toLowerCase() === baseName).map(s => s.id);
    currentRelatedSubjectIds = relatedSubjectIds;

    await loadSubjectDetails(relatedSubjectIds); 
}

// =========================================