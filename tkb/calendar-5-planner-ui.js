// ===== calendar-5-planner-ui.js =====
// Phần 5/5 của calendar.js. Nạp SAU calendar-4-planner-notify.js (dùng chung các hằng số/hàm
// khai báo ở đó, ví dụ PLANNER_HOUR_PX, plannerFmtDateInput...).
// Nội dung: dựng lưới tuần Kế Hoạch Ngày, kéo-thả tạo/sửa/xoá khối việc, popup sửa việc.

function initDayPlanner() {
    const header = document.getElementById('planner-week-header');
    const hoursCol = document.getElementById('planner-hours-col');
    const tracksWrap = document.getElementById('planner-week-tracks');
    if (!header || !hoursCol || !tracksWrap) return;

    if (!plannerBuilt) {
        plannerBuilt = true;

        let hoursHtml = '';
        for (let h = 0; h < 24; h++) {
            hoursHtml += `<div class="planner-hour-label" style="height:${PLANNER_HOUR_PX}px;">${String(h).padStart(2, '0')}:00</div>`;
        }
        hoursCol.innerHTML = hoursHtml;

        // 7 ô header + 7 cột ngày (Thứ 2 -> Chủ Nhật)
        let headerHtml = '';
        let tracksHtml = '';
        for (let i = 0; i < 7; i++) {
            headerHtml += `<div class="planner-day-header" id="planner-dh-${i}"><span class="dh-name"></span><span class="dh-date"></span></div>`;
            tracksHtml += `<div class="planner-day-col" id="planner-col-${i}" data-index="${i}" style="height:${24 * PLANNER_HOUR_PX}px;"></div>`;
        }
        header.insertAdjacentHTML('beforeend', headerHtml);
        tracksWrap.innerHTML = tracksHtml;

        tracksWrap.addEventListener('pointerdown', onPlannerTracksPointerDown);

        buildPlannerColorSwatches();

        const saveBtn = document.getElementById('planner-editor-save');
        const delBtn = document.getElementById('planner-editor-delete');
        const titleInput = document.getElementById('planner-editor-title');
        const startInput = document.getElementById('planner-editor-start');
        const endInput = document.getElementById('planner-editor-end');
        if (saveBtn) saveBtn.addEventListener('click', savePlannerEditor);
        if (delBtn) delBtn.addEventListener('click', deletePlannerEditorBlock);
        [titleInput, startInput, endInput].forEach(inp => {
            if (!inp) return;
            inp.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); savePlannerEditor(); }
                if (e.key === 'Escape') { e.preventDefault(); closePlannerEditor(); }
            });
        });

        if (plannerNowTimer) clearInterval(plannerNowTimer);
        plannerNowTimer = setInterval(renderPlannerNowLine, 60000);
    }

    updatePlannerWeekHeader();
    updatePlannerWeekLabel();
}

function buildPlannerColorSwatches() {
    const wrap = document.getElementById('planner-editor-colors');
    if (!wrap || wrap.dataset.built) return;
    wrap.dataset.built = '1';
    wrap.innerHTML = PLANNER_COLORS.map(c => `<button type="button" class="planner-color-swatch" data-color="${c}" style="--sw-color:${c}"></button>`).join('');
    wrap.querySelectorAll('.planner-color-swatch').forEach(btn => {
        btn.addEventListener('click', () => {
            wrap.querySelectorAll('.planner-color-swatch').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });
}

function updatePlannerWeekHeader() {
    const dates = plannerWeekDates();
    const today = new Date();
    dates.forEach((d, i) => {
        const cell = document.getElementById(`planner-dh-${i}`);
        const col = document.getElementById(`planner-col-${i}`);
        if (!cell || !col) return;
        const isToday = plannerIsSameDate(d, today);
        cell.querySelector('.dh-name').innerText = PLANNER_DAY_NAMES[d.getDay()];
        cell.querySelector('.dh-date').innerText = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
        cell.classList.toggle('is-today', isToday);
        col.classList.toggle('is-today-col', isToday);
        col.dataset.date = plannerFmtDateInput(d);
    });
}

function updatePlannerWeekLabel() {
    const label = document.getElementById('planner-week-text');
    if (!label) return;
    const dates = plannerWeekDates();
    const start = dates[0], end = dates[6];
    const today = new Date();
    const isThisWeek = plannerIsSameDate(plannerGetMonday(today), plannerWeekStart);
    const rangeText = `${String(start.getDate()).padStart(2, '0')}/${String(start.getMonth() + 1).padStart(2, '0')} - ${String(end.getDate()).padStart(2, '0')}/${String(end.getMonth() + 1).padStart(2, '0')}`;
    label.innerText = isThisWeek ? `Tuần này, ${rangeText}` : `Tuần ${rangeText}`;
}

window.changePlannerWeek = function(delta) {
    const d = new Date(plannerWeekStart);
    d.setDate(d.getDate() + delta * 7);
    plannerWeekStart = d;
    updatePlannerWeekHeader();
    updatePlannerWeekLabel();
    loadPlannerBlocks();
};

window.goToPlannerThisWeek = function() {
    plannerWeekStart = plannerGetMonday(new Date());
    updatePlannerWeekHeader();
    updatePlannerWeekLabel();
    loadPlannerBlocks();
};

async function loadPlannerBlocks() {
    if (!currentUser) return;
    const tracksWrap = document.getElementById('planner-week-tracks');
    if (!tracksWrap) return;
    closePlannerEditor();

    const dates = plannerWeekDates();
    const startStr = plannerFmtDateInput(dates[0]);
    const endStr = plannerFmtDateInput(dates[6]);

    const { data, error } = await sbClient.from('daily_plans')
        .select('*')
        .eq('user_id', currentUser.id)
        .gte('plan_date', startStr)
        .lte('plan_date', endStr)
        .order('start_min', { ascending: true });

    plannerBlocksByDate = {};
    dates.forEach(d => { plannerBlocksByDate[plannerFmtDateInput(d)] = []; });

    if (error) {
        console.error('[Planner] Lỗi tải kế hoạch tuần:', error.message);
    } else {
        (data || []).forEach(r => {
            const key = r.plan_date;
            if (!plannerBlocksByDate[key]) plannerBlocksByDate[key] = [];
            plannerBlocksByDate[key].push({ id: r.id, title: r.title || '', start_min: r.start_min, end_min: r.end_min, color: r.color || PLANNER_COLORS[0], priority: r.priority || 'normal', is_done: !!r.is_done });
        });
    }
    renderPlannerBlocks();
    renderPlannerNowLine();
}

function renderPlannerNowLine() {
    document.querySelectorAll('.planner-now-line').forEach(el => el.remove());
    const dates = plannerWeekDates();
    const today = new Date();
    const idx = dates.findIndex(d => plannerIsSameDate(d, today));
    if (idx === -1) return;
    const col = document.getElementById(`planner-col-${idx}`);
    if (!col) return;
    const min = today.getHours() * 60 + today.getMinutes();
    const line = document.createElement('div');
    line.className = 'planner-now-line';
    line.style.top = ((min / 60) * PLANNER_HOUR_PX) + 'px';
    line.innerHTML = '<span></span>';
    col.appendChild(line);
}

function renderPlannerBlocks() {
    let totalBlocks = 0;
    for (let i = 0; i < 7; i++) {
        const col = document.getElementById(`planner-col-${i}`);
        if (!col) continue;
        col.querySelectorAll('.planner-block').forEach(el => el.remove());
        const dateStr = col.dataset.date;
        const blocks = plannerBlocksByDate[dateStr] || [];
        totalBlocks += blocks.length;
        blocks.forEach(b => col.appendChild(buildPlannerBlockEl(b, dateStr)));
    }
    const emptyHint = document.getElementById('planner-empty-hint');
    if (emptyHint) emptyHint.classList.toggle('is-hidden', totalBlocks > 0);
    renderPlannerNowLine();
}

function buildPlannerBlockEl(b, dateStr) {
    const el = document.createElement('div');
    const durationMin = b.end_min - b.start_min;
    el.className = 'planner-block' + (durationMin <= 40 ? ' is-compact' : '') + (b.is_done ? ' is-done' : '');
    el.dataset.id = b.id;
    el.dataset.date = dateStr;
    positionPlannerBlockEl(el, b.start_min, b.end_min);
    el.style.setProperty('--block-color', b.color);
    el.innerHTML = `
        <div class="planner-block-handle top" data-handle="top"></div>
        <button type="button" class="planner-block-check${b.is_done ? ' checked' : ''}" title="${b.is_done ? 'Đánh dấu chưa xong' : 'Đánh dấu đã xong'}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
        </button>
        <div class="planner-block-body">
            <span class="planner-block-time">${plannerFmtHM(b.start_min)} - ${plannerFmtHM(b.end_min)}</span>
            <span class="planner-block-title"><span class="priority-dot" style="background:${getPriorityInfo(b.priority).color}" title="${getPriorityInfo(b.priority).label}"></span>${escapeHtml(b.title) || 'Việc chưa đặt tên'}</span>
        </div>
        <div class="planner-block-handle bottom" data-handle="bottom"></div>
    `;
    el.querySelector('.planner-block-body').addEventListener('pointerdown', (e) => onPlannerBlockPointerDown(e, b.id, dateStr, 'move'));
    el.querySelectorAll('.planner-block-handle').forEach(h => {
        h.addEventListener('pointerdown', (e) => onPlannerBlockPointerDown(e, b.id, dateStr, h.dataset.handle === 'top' ? 'resize-top' : 'resize-bottom'));
    });
    // Nút tick "đã xong": chặn pointerdown nổi bọt lên .planner-block-body (nếu không chặn, bấm vào
    // nút sẽ bị hiểu nhầm thành bắt đầu KÉO/DI CHUYỂN khối, vì body có listener pointerdown riêng).
    const checkBtn = el.querySelector('.planner-block-check');
    checkBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    checkBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePlannerBlockDone(b.id, dateStr, checkBtn); });
    return el;
}

// Bật/tắt trạng thái "đã xong" cho 1 việc trong Kế Hoạch Ngày — cập nhật UI ngay (lạc quan),
// lưu lên Supabase cột "is_done" của bảng daily_plans; nếu lưu lỗi thì tự khôi phục lại UI cũ.
// LƯU Ý: bảng "daily_plans" cần có sẵn cột "is_done" (boolean, mặc định false) — nếu bảng gốc
// chưa có cột này, cần thêm trong Supabase (SQL: alter table daily_plans add column is_done
// boolean not null default false;) trước khi tính năng này hoạt động được.
async function togglePlannerBlockDone(blockId, dateStr, checkBtn) {
    const block = (plannerBlocksByDate[dateStr] || []).find(b => b.id === blockId);
    if (!block) return;
    const nextDone = !block.is_done;
    block.is_done = nextDone;
    const blockEl = checkBtn.closest('.planner-block');
    blockEl.classList.toggle('is-done', nextDone);
    checkBtn.classList.toggle('checked', nextDone);
    checkBtn.title = nextDone ? 'Đánh dấu chưa xong' : 'Đánh dấu đã xong';

    const { error } = await sbClient.from('daily_plans').update({ is_done: nextDone }).eq('id', blockId).eq('user_id', currentUser.id);
    if (error) {
        console.error('[Planner] Lỗi lưu trạng thái đã xong:', error.message);
        block.is_done = !nextDone;
        blockEl.classList.toggle('is-done', block.is_done);
        checkBtn.classList.toggle('checked', block.is_done);
        checkBtn.title = block.is_done ? 'Đánh dấu chưa xong' : 'Đánh dấu đã xong';
    }
}

function positionPlannerBlockEl(el, startMin, endMin) {
    el.style.top = ((startMin / 60) * PLANNER_HOUR_PX) + 'px';
    el.style.height = Math.max(20, ((endMin - startMin) / 60) * PLANNER_HOUR_PX) + 'px';
    const durationMin = endMin - startMin;
    el.classList.toggle('is-compact', durationMin <= 40);
}

// ---- Tự cuộn khung khi kéo gần sát mép (trên/dưới/trái/phải) ----
const PLANNER_EDGE_ZONE = 46;      // px tính từ mép khung, vào vùng này là bắt đầu tự cuộn
const PLANNER_MAX_SCROLL_SPD = 16; // tốc độ cuộn tối đa (px/khung hình)
let plannerAutoScrollVX = 0, plannerAutoScrollVY = 0, plannerAutoScrollRAF = null;

function plannerUpdateAutoScroll(clientX, clientY) {
    const wrapper = document.getElementById('planner-wrapper');
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();

    let vy = 0;
    if (clientY < rect.top + PLANNER_EDGE_ZONE) {
        vy = -PLANNER_MAX_SCROLL_SPD * (1 - Math.max(0, clientY - rect.top) / PLANNER_EDGE_ZONE);
    } else if (clientY > rect.bottom - PLANNER_EDGE_ZONE) {
        vy = PLANNER_MAX_SCROLL_SPD * (1 - Math.max(0, rect.bottom - clientY) / PLANNER_EDGE_ZONE);
    }
    let vx = 0;
    if (clientX < rect.left + PLANNER_EDGE_ZONE) {
        vx = -PLANNER_MAX_SCROLL_SPD * (1 - Math.max(0, clientX - rect.left) / PLANNER_EDGE_ZONE);
    } else if (clientX > rect.right - PLANNER_EDGE_ZONE) {
        vx = PLANNER_MAX_SCROLL_SPD * (1 - Math.max(0, rect.right - clientX) / PLANNER_EDGE_ZONE);
    }

    plannerAutoScrollVX = vx;
    plannerAutoScrollVY = vy;
    if ((vx !== 0 || vy !== 0) && !plannerAutoScrollRAF) {
        plannerAutoScrollRAF = requestAnimationFrame(plannerAutoScrollStep);
    }
}

function plannerAutoScrollStep() {
    plannerAutoScrollRAF = null;
    if (!plannerDrag) return; // đã thả tay ra rồi thì dừng
    const wrapper = document.getElementById('planner-wrapper');
    if (!wrapper) return;
    if (plannerAutoScrollVY !== 0) wrapper.scrollTop += plannerAutoScrollVY;
    if (plannerAutoScrollVX !== 0) wrapper.scrollLeft += plannerAutoScrollVX;
    if (plannerAutoScrollVY !== 0 || plannerAutoScrollVX !== 0) {
        if (plannerDrag.mode === 'create') plannerRecalcCreateDrag(plannerDrag.lastClientY);
        else plannerRecalcBlockDrag(plannerDrag.lastClientX, plannerDrag.lastClientY);
        plannerAutoScrollRAF = requestAnimationFrame(plannerAutoScrollStep);
    }
}

function plannerStopAutoScroll() {
    plannerAutoScrollVX = 0; plannerAutoScrollVY = 0;
    if (plannerAutoScrollRAF) { cancelAnimationFrame(plannerAutoScrollRAF); plannerAutoScrollRAF = null; }
}

// ---- Tạo khối mới: kéo (hoặc chạm giữ + vuốt) trên 1 cột ngày trống ----
function onPlannerTracksPointerDown(e) {
    if (e.target.closest('.planner-block')) return; // đã có handler riêng cho khối đang tồn tại
    if (e.button !== undefined && e.button !== 0) return;
    const col = e.target.closest('.planner-day-col');
    if (!col) return;
    e.preventDefault();

    const rect = col.getBoundingClientRect();
    const dateStr = col.dataset.date;
    const startMin = plannerSnap(plannerPxToMin(e.clientY - rect.top));

    const existingCount = (plannerBlocksByDate[dateStr] || []).length;
    const tempEl = document.createElement('div');
    tempEl.className = 'planner-block planner-block-drafting';
    tempEl.style.setProperty('--block-color', PLANNER_COLORS[existingCount % PLANNER_COLORS.length]);
    positionPlannerBlockEl(tempEl, startMin, startMin + PLANNER_SNAP_MIN);
    col.appendChild(tempEl);

    plannerDrag = { mode: 'create', col, dateStr, originStart: startMin, el: tempEl, moved: false, lastClientX: e.clientX, lastClientY: e.clientY };

    window.addEventListener('pointermove', onPlannerTracksPointerMove);
    window.addEventListener('pointerup', onPlannerTracksPointerUp, { once: true });
}

function plannerRecalcCreateDrag(clientY) {
    const rect = plannerDrag.col.getBoundingClientRect(); // lấy live để không lệch nếu khung vừa tự cuộn
    const currentMin = plannerSnap(plannerPxToMin(clientY - rect.top));
    let start = Math.min(plannerDrag.originStart, currentMin);
    let end = Math.max(plannerDrag.originStart, currentMin);
    if (end - start < PLANNER_SNAP_MIN) end = start + PLANNER_SNAP_MIN;
    if (Math.abs(currentMin - plannerDrag.originStart) >= PLANNER_SNAP_MIN) plannerDrag.moved = true;
    plannerDrag.finalStart = start;
    plannerDrag.finalEnd = end;
    positionPlannerBlockEl(plannerDrag.el, start, end);
}

function onPlannerTracksPointerMove(e) {
    if (!plannerDrag || plannerDrag.mode !== 'create') return;
    plannerDrag.lastClientX = e.clientX; plannerDrag.lastClientY = e.clientY;
    plannerUpdateAutoScroll(e.clientX, e.clientY);
    plannerRecalcCreateDrag(e.clientY);
}

function onPlannerTracksPointerUp(e) {
    window.removeEventListener('pointermove', onPlannerTracksPointerMove);
    plannerStopAutoScroll();
    if (!plannerDrag || plannerDrag.mode !== 'create') return;
    const { el, dateStr } = plannerDrag;

    let start = plannerDrag.finalStart !== undefined ? plannerDrag.finalStart : plannerDrag.originStart;
    let end = plannerDrag.finalEnd !== undefined ? plannerDrag.finalEnd : plannerDrag.originStart + 60;
    if (!plannerDrag.moved) end = Math.min(1440, start + 60); // chỉ bấm (không kéo) -> mặc định khối 1 tiếng

    el.remove();
    plannerDrag = null;

    const existingCount = (plannerBlocksByDate[dateStr] || []).length;
    openPlannerEditor({ id: null, dateStr, title: '', start_min: start, end_min: end, color: PLANNER_COLORS[existingCount % PLANNER_COLORS.length] }, e);
}

// ---- Kéo dời / co giãn khối đã có (kéo dọc = đổi giờ, kéo ngang khi "move" = đổi sang ngày khác) ----
function onPlannerBlockPointerDown(e, blockId, dateStr, mode) {
    e.stopPropagation();
    e.preventDefault();
    const block = (plannerBlocksByDate[dateStr] || []).find(b => b.id === blockId);
    if (!block) return;
    const col = document.getElementById(`planner-col-${plannerWeekDates().findIndex(d => plannerFmtDateInput(d) === dateStr)}`);
    if (!col) return;
    const rect = col.getBoundingClientRect();
    const el = col.querySelector(`.planner-block[data-id="${blockId}"]`);
    if (!el) return;

    plannerDrag = {
        mode, col, currentCol: col, el, blockId, dateStr, currentDateStr: dateStr,
        originStart: block.start_min, originEnd: block.end_min,
        pointerStartMin: plannerPxToMin(e.clientY - rect.top),
        moved: false, lastClientX: e.clientX, lastClientY: e.clientY
    };
    if (mode === 'move') el.classList.add('is-dragging');

    window.addEventListener('pointermove', onPlannerBlockPointerMove);
    window.addEventListener('pointerup', onPlannerBlockPointerUp, { once: true });
}

function plannerRecalcBlockDrag(clientX, clientY) {
    // Đang dời khối ngang qua cột ngày khác -> chuyển khối sang cột đó ngay khi đang kéo (chỉ áp dụng cho "move")
    if (plannerDrag.mode === 'move') {
        for (let i = 0; i < 7; i++) {
            const c = document.getElementById(`planner-col-${i}`);
            if (!c) continue;
            const r = c.getBoundingClientRect();
            if (clientX >= r.left && clientX < r.right) {
                if (c.dataset.date !== plannerDrag.currentDateStr) {
                    c.appendChild(plannerDrag.el);
                    plannerDrag.currentCol = c;
                    plannerDrag.currentDateStr = c.dataset.date;
                    plannerDrag.moved = true;
                }
                break;
            }
        }
    }

    const liveRect = plannerDrag.currentCol.getBoundingClientRect(); // lấy live để không lệch nếu khung vừa tự cuộn
    const currentMin = plannerPxToMin(clientY - liveRect.top);
    const delta = plannerSnap(currentMin - plannerDrag.pointerStartMin);
    if (delta !== 0) plannerDrag.moved = true;

    let start = plannerDrag.originStart, end = plannerDrag.originEnd;
    if (plannerDrag.mode === 'move') {
        const duration = plannerDrag.originEnd - plannerDrag.originStart;
        start = Math.max(0, Math.min(1440 - duration, plannerDrag.originStart + delta));
        end = start + duration;
    } else if (plannerDrag.mode === 'resize-top') {
        start = Math.max(0, Math.min(plannerDrag.originEnd - PLANNER_MIN_DURATION, plannerDrag.originStart + delta));
        end = plannerDrag.originEnd;
    } else if (plannerDrag.mode === 'resize-bottom') {
        end = Math.min(1440, Math.max(plannerDrag.originStart + PLANNER_MIN_DURATION, plannerDrag.originEnd + delta));
        start = plannerDrag.originStart;
    }
    plannerDrag.finalStart = start;
    plannerDrag.finalEnd = end;
    positionPlannerBlockEl(plannerDrag.el, start, end);
    const timeSpan = plannerDrag.el.querySelector('.planner-block-time');
    if (timeSpan) timeSpan.innerText = `${plannerFmtHM(start)} - ${plannerFmtHM(end)}`;
}

function onPlannerBlockPointerMove(e) {
    if (!plannerDrag || plannerDrag.mode === 'create') return;
    plannerDrag.lastClientX = e.clientX; plannerDrag.lastClientY = e.clientY;
    plannerUpdateAutoScroll(e.clientX, e.clientY);
    plannerRecalcBlockDrag(e.clientX, e.clientY);
}

async function onPlannerBlockPointerUp(e) {
    window.removeEventListener('pointermove', onPlannerBlockPointerMove);
    plannerStopAutoScroll();
    if (!plannerDrag || plannerDrag.mode === 'create') { plannerDrag = null; return; }
    if (plannerDrag.el) plannerDrag.el.classList.remove('is-dragging');

    const { blockId, dateStr, moved, currentDateStr } = plannerDrag;
    const finalDateStr = currentDateStr || dateStr;
    const block = (plannerBlocksByDate[dateStr] || []).find(b => b.id === blockId);

    if (!moved) {
        // Không kéo -> xem như bấm vào khối để mở popover chỉnh sửa
        plannerDrag = null;
        if (block) openPlannerEditor({ ...block, dateStr }, e);
        return;
    }

    const start = plannerDrag.finalStart, end = plannerDrag.finalEnd;
    plannerDrag = null;
    if (!block) return;

    block.start_min = start;
    block.end_min = end;

    const dateChanged = finalDateStr !== dateStr;
    if (dateChanged) {
        // Chuyển khối sang mảng dữ liệu của ngày mới + vẽ lại toàn bộ để gắn đúng sự kiện theo ngày mới
        plannerBlocksByDate[dateStr] = (plannerBlocksByDate[dateStr] || []).filter(b => b.id !== blockId);
        if (!plannerBlocksByDate[finalDateStr]) plannerBlocksByDate[finalDateStr] = [];
        plannerBlocksByDate[finalDateStr].push(block);
        renderPlannerBlocks();
    }

    const updatePayload = { start_min: start, end_min: end };
    if (dateChanged) updatePayload.plan_date = finalDateStr;

    const { error } = await sbClient.from('daily_plans')
        .update(updatePayload)
        .eq('id', blockId)
        .eq('user_id', currentUser.id);
    if (error) console.error('[Planner] Lỗi cập nhật việc:', error.message);
}

// ---- Popover đặt tên / chỉnh sửa / xóa ----
function openPlannerEditor(block, e) {
    plannerEditingDraft = block;

    const editor = document.getElementById('planner-editor');
    const inner = editor.querySelector('.planner-editor-inner');
    const titleInput = document.getElementById('planner-editor-title');
    const dayLabelEl = document.getElementById('planner-editor-daylabel');
    const startInput = document.getElementById('planner-editor-start');
    const endInput = document.getElementById('planner-editor-end');
    const deleteBtn = document.getElementById('planner-editor-delete');
    const colorsWrap = document.getElementById('planner-editor-colors');

    const dObj = new Date(block.dateStr + 'T00:00:00');
    dayLabelEl.innerText = `${PLANNER_DAY_NAMES[dObj.getDay()]}, ${String(dObj.getDate()).padStart(2, '0')}/${String(dObj.getMonth() + 1).padStart(2, '0')}`;
    startInput.value = plannerFmtHM(block.start_min);
    endInput.value = plannerFmtHM(block.end_min);
    titleInput.value = block.title || '';
    deleteBtn.style.display = block.id ? 'flex' : 'none';

    colorsWrap.querySelectorAll('.planner-color-swatch').forEach(sw => {
        sw.classList.toggle('active', sw.dataset.color.toLowerCase() === (block.color || '').toLowerCase());
    });

    // MỤC 3: hiện đúng mức ưu tiên đã lưu (mặc định "Bình thường" nếu là việc mới/chưa từng set)
    const priorityWrap = document.getElementById('planner-editor-priority');
    if (priorityWrap) {
        const targetPriority = block.priority || 'normal';
        priorityWrap.querySelectorAll('.priority-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.priority === targetPriority);
        });
    }

    editor.classList.remove('hidden');

    // Đo kích thước THẬT của popup sau khi hiện ra (khác nhau giữa desktop 250px và mobile tới 280px),
    // thay vì đoán cứng 250x300 -> tránh popup (và hàng chọn màu bên trong) bị tràn ra ngoài màn hình.
    // FIX BUG "KHÔNG THẤY ĐƯỢC NÚT Ở DƯỚI (Không quan trọng lắm / Lưu)": trước đây dùng
    // getBoundingClientRect() để đo — nhưng popup có animation "plannerPopIn" bắt đầu bằng
    // transform: scale(0.94), và getBoundingClientRect() BỊ ẢNH HƯỞNG bởi transform (trả về kích
    // thước đã bị co lại theo scale tại đúng thời điểm animation vừa chạy được 1 khung hình) ->
    // popH đo được NHỎ HƠN THẬT ~6%, khiến phép tính vị trí lầm tưởng popup lùn hơn thực tế, không
    // chừa đủ chỗ -> phần dưới cùng (mới thêm hàng chọn ưu tiên nên popup cao hơn trước) bị tràn ra
    // ngoài màn hình, không cuộn/thấy được. offsetWidth/offsetHeight đo đúng kích thước LAYOUT
    // THẬT của phần tử, KHÔNG bị ảnh hưởng bởi transform, nên luôn chính xác bất kể animation.
    // FIX BUG "TRÀN RA NGOÀI, KHÔNG THẤY/CUỘN ĐƯỢC NÚT LƯU": trước đây kẹp toạ độ theo
    // window.innerWidth/innerHeight — SAI hệ quy chiếu. .planner-editor-inner là position:fixed,
    // nhưng .main-glass-dashboard (cha bọc ngoài) có backdrop-filter, mà theo spec CSS,
    // backdrop-filter (giống transform/filter) biến chính ancestor đó thành containing block MỚI
    // cho mọi con cháu position:fixed bên trong nó — tức toạ độ left/top thực chất được tính theo
    // khung .main-glass-dashboard (nhỏ hơn, lệch vị trí so với viewport thật), KHÔNG còn theo cả
    // trình duyệt như suy nghĩ thông thường về position:fixed nữa. Đã vậy .main-glass-dashboard
    // còn có overflow:hidden nên phần "tràn" bị cắt cụt hẳn (không cuộn được) chứ không phải chỉ
    // lấn ra ngoài rìa — khớp đúng lỗi trong ảnh chụp.
    // -> Đo đúng khung chứa thật (getBoundingClientRect của .main-glass-dashboard) và quy đổi toạ
    // độ con trỏ (vốn tính theo viewport) sang toạ độ TƯƠNG ĐỐI trong khung đó trước khi kẹp, để
    // nếu không đủ chỗ phía dưới thì popup tự "chạy lên" bên trong đúng khung nhìn thấy được.
    const containingEl = document.querySelector('.main-glass-dashboard') || document.body;
    const cRect = containingEl.getBoundingClientRect();

    const pad = 12;
    const popW = inner.offsetWidth || 250;
    const popH = inner.offsetHeight || 300;
    const clientX = (e && e.clientX) || (cRect.left + cRect.width / 2);
    const clientY = (e && e.clientY) || (cRect.top + cRect.height / 2);

    // FIX BUG "POPUP CHE MẤT THANH HEADER KHI BẤM GẦN GÓC MÀN HÌNH": trước đây popup luôn
    // được CĂN GIỮA theo điểm bấm (x = relX - popW/2, y = relY - 20) rồi mới KẸP (clamp) cho
    // không tràn ra ngoài khung chứa. Cách này ổn khi bấm ở giữa màn hình, nhưng hễ bấm gần
    // SÁT một góc/cạnh nào đó (vd góc trên-phải như trong ảnh chụp) thì phép kẹp buộc popup
    // phải "dí" cứng vào đúng cái góc chật đó -> đè lên header hoặc các phần tử khác ở góc đó,
    // thay vì tự tránh sang chỗ rộng hơn.
    // Giờ ĐỔI CÁCH: xác định điểm bấm đang thuộc NỬA nào của khung chứa (trái/phải, trên/dưới)
    // -> suy ra popup đang GẦN/SÁT góc nào -> cho popup "mọc" ngược về phía CÒN LẠI (phía đối
    // diện, rộng rãi hơn) thay vì đè lên đúng góc chật đó. Áp dụng chung cho cả 2 trường hợp gọi
    // hàm này (kéo-thả tạo việc mới & bấm sửa việc đã có), vì cả 2 đều dùng chung khối code này.
    const relX = clientX - cRect.left;
    const relY = clientY - cRect.top;
    const nearRightEdge = relX > cRect.width / 2;   // bấm ở nửa phải -> đang sát góc/cạnh phải -> mọc sang trái
    const nearBottomEdge = relY > cRect.height / 2;  // bấm ở nửa dưới -> đang sát góc/cạnh dưới -> mọc lên trên

    const gap = 10; // khoảng hở nhỏ giữa điểm bấm và popup, để không đè thẳng lên ngón tay/con trỏ
    let x = nearRightEdge ? (relX - popW - gap) : (relX + gap);
    let y = nearBottomEdge ? (relY - popH - gap) : (relY + gap);

    // Vẫn giữ kẹp làm lưới an toàn cuối cùng, phòng khi khung chứa quá nhỏ (mobile hẹp) khiến
    // popup không đủ chỗ ở cả 2 phía.
    x = Math.max(pad, Math.min(cRect.width - popW - pad, x));
    y = Math.max(pad, Math.min(cRect.height - popH - pad, y));
    inner.style.left = x + 'px';
    inner.style.top = y + 'px';

    setTimeout(() => titleInput.focus(), 60);
    setTimeout(() => document.addEventListener('pointerdown', onOutsidePlannerEditorClick), 0);
}

function plannerParseHM(value) {
    if (!value) return null;
    const [h, m] = value.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
}

function onOutsidePlannerEditorClick(e) {
    const editor = document.getElementById('planner-editor');
    if (!editor || editor.classList.contains('hidden')) return;
    if (editor.contains(e.target)) return;
    savePlannerEditor();
}

function closePlannerEditor() {
    const editor = document.getElementById('planner-editor');
    if (!editor) return;
    editor.classList.add('hidden');
    document.removeEventListener('pointerdown', onOutsidePlannerEditorClick);
    plannerEditingDraft = null;
}

async function savePlannerEditor() {
    if (!plannerEditingDraft) return;
    const titleInput = document.getElementById('planner-editor-title');
    const startInput = document.getElementById('planner-editor-start');
    const endInput = document.getElementById('planner-editor-end');
    const colorsWrap = document.getElementById('planner-editor-colors');
    const priorityWrap = document.getElementById('planner-editor-priority');
    const activeSwatch = colorsWrap.querySelector('.planner-color-swatch.active');
    const activePriorityBtn = priorityWrap ? priorityWrap.querySelector('.priority-btn.active') : null;
    const title = titleInput.value.trim();
    const color = activeSwatch ? activeSwatch.dataset.color : plannerEditingDraft.color;
    const priority = activePriorityBtn ? activePriorityBtn.dataset.priority : (plannerEditingDraft.priority || 'normal');
    const draft = plannerEditingDraft;

    // Đọc giờ người dùng tự gõ — nếu bỏ trống hoặc sai thì giữ nguyên giờ cũ của khối
    let start = plannerParseHM(startInput.value);
    let end = plannerParseHM(endInput.value);
    if (start === null) start = draft.start_min;
    if (end === null) end = draft.end_min;
    start = Math.max(0, Math.min(1439, start));
    end = Math.max(0, Math.min(1440, end));
    if (end - start < PLANNER_MIN_DURATION) end = Math.min(1440, start + PLANNER_MIN_DURATION);

    closePlannerEditor();

    if (!title && !draft.id) return; // tạo mới nhưng không đặt tên -> bỏ qua, không lưu khối rỗng

    if (draft.id) {
        const local = (plannerBlocksByDate[draft.dateStr] || []).find(b => b.id === draft.id);
        if (local) { local.title = title; local.color = color; local.start_min = start; local.end_min = end; local.priority = priority; }
        renderPlannerBlocks();
        const { error } = await sbClient.from('daily_plans').update({ title, color, start_min: start, end_min: end, priority, push_notified: false }).eq('id', draft.id).eq('user_id', currentUser.id);
        if (error) console.error('[Planner] Lỗi lưu việc:', error.message);
        plannerClearNotifiedFor(draft.dateStr, draft.id); // giờ vừa đổi -> cho phép báo lại nếu lọt khung 5 phút
    } else {
        const { data, error } = await sbClient.from('daily_plans').insert([{
            user_id: currentUser.id, plan_date: draft.dateStr, title,
            start_min: start, end_min: end, color, priority
        }]).select().single();
        if (error) { console.error('[Planner] Lỗi tạo việc mới:', error.message); return; }
        if (!plannerBlocksByDate[draft.dateStr]) plannerBlocksByDate[draft.dateStr] = [];
        plannerBlocksByDate[draft.dateStr].push({ id: data.id, title: data.title, start_min: data.start_min, end_min: data.end_min, color: data.color, priority: data.priority || 'normal', is_done: !!data.is_done });
        renderPlannerBlocks();
    }
    checkUpcomingPlannerNotifications(); // báo ngay nếu việc vừa lưu đã lọt sẵn khung nhắc 5 phút
}


async function deletePlannerEditorBlock() {
    if (!plannerEditingDraft || !plannerEditingDraft.id) { closePlannerEditor(); return; }
    const id = plannerEditingDraft.id;
    const dateStr = plannerEditingDraft.dateStr;
    closePlannerEditor();

    if (plannerBlocksByDate[dateStr]) {
        plannerBlocksByDate[dateStr] = plannerBlocksByDate[dateStr].filter(b => b.id !== id);
    }
    renderPlannerBlocks();
    const { error } = await sbClient.from('daily_plans').delete().eq('id', id).eq('user_id', currentUser.id);
    if (error) console.error('[Planner] Lỗi xóa việc:', error.message);
}