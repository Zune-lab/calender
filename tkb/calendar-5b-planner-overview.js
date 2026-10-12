// ===== calendar-5b-planner-overview.js =====
// Nạp SAU calendar-5-planner-ui.js. Chế độ xem "Tổng quan" gọn cho Kế Hoạch Ngày:
//   - Thẻ tiến độ năm (xx% năm đã trôi qua, còn N ngày)
//   - Lưới 5 tuần, mỗi ngày tối đa 3 chip 1 dòng (thanh màu + icon tick/vòng tròn + tên),
//     phần dư hiện "+N". Hôm nay được khoanh tròn.
// Dùng lại: plannerWeekStart, plannerGetMonday, plannerFmtDateInput, plannerIsSameDate,
// PRIORITY_LEVELS, PLANNER_COLORS (calendar-4) và escapeHtml (shared.js).

const PLANNER_OVERVIEW_WEEKS = 5;      // số tuần hiển thị
const PLANNER_OVERVIEW_MAX_CHIPS = 3;  // số chip tối đa mỗi ngày (phần dư -> "+N")
const PLANNER_OVERVIEW_DOW = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']; // lưới bắt đầu từ Thứ 2

let plannerViewMode = (function () {
    try { return localStorage.getItem('plannerViewMode') === 'overview' ? 'overview' : 'grid'; }
    catch (e) { return 'grid'; }
})();
let plannerOverviewByDate = {}; // { 'YYYY-MM-DD': [ {kind:'plan'|'due', id, title, color, done, sort} ] }
let plannerOverviewBound = false;

function plannerOverviewDates() {
    const start = new Date(plannerWeekStart);
    start.setHours(0, 0, 0, 0);
    const arr = [];
    for (let i = 0; i < PLANNER_OVERVIEW_WEEKS * 7; i++) {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        arr.push(d);
    }
    return arr;
}

// ---------- Thẻ tiến độ năm ----------
function renderPlannerYearCard() {
    const el = document.getElementById('planner-year-card');
    if (!el) return;
    const now = new Date();
    const y = now.getFullYear();
    const startY = new Date(y, 0, 1), startNext = new Date(y + 1, 0, 1);
    const totalDays = Math.round((startNext - startY) / 86400000);
    const dayOfYear = Math.floor((new Date(y, now.getMonth(), now.getDate()) - startY) / 86400000) + 1;
    const pct = Math.round((dayOfYear / totalDays) * 100);
    const left = totalDays - dayOfYear;
    el.innerHTML =
        `<div class="pov-year-top"><span class="pov-year-num">${y}</span><span class="pov-year-pct">${pct}%</span></div>` +
        `<div class="pov-year-bar"><div class="pov-year-bar-fill" style="width:${pct}%"></div></div>` +
        `<div class="pov-year-bottom"><span>${pct}% năm đã trôi qua</span><span>còn ${left} ngày</span></div>`;
}

// ---------- Tải dữ liệu 5 tuần ----------
async function loadPlannerOverview() {
    if (!currentUser) return;
    const dates = plannerOverviewDates();
    const startStr = plannerFmtDateInput(dates[0]);
    const endStr = plannerFmtDateInput(dates[dates.length - 1]);

    updatePlannerOverviewLabel(dates);
    renderPlannerYearCard();

    const [plansRes, dueRes] = await Promise.all([
        sbClient.from('daily_plans').select('*')
            .eq('user_id', currentUser.id)
            .gte('plan_date', startStr).lte('plan_date', endStr)
            .order('start_min', { ascending: true }),
        sbClient.from('subject_details')
            .select('id, content, type, due_date, priority')
            .eq('user_id', currentUser.id).eq('status', 'upcoming')
            .gte('due_date', startStr).lte('due_date', endStr)
    ]);

    plannerOverviewByDate = {};
    dates.forEach(d => { plannerOverviewByDate[plannerFmtDateInput(d)] = []; });

    if (plansRes.error) {
        console.error('[PlannerOverview] Lỗi tải kế hoạch:', plansRes.error.message);
    } else {
        (plansRes.data || []).forEach(r => {
            if (!plannerOverviewByDate[r.plan_date]) return;
            plannerOverviewByDate[r.plan_date].push({
                kind: 'plan', id: r.id, title: r.title || '(không tên)',
                color: r.color || PLANNER_COLORS[0], done: !!r.is_done, sort: r.start_min || 0
            });
        });
    }
    if (dueRes.error) {
        console.error('[PlannerOverview] Lỗi tải việc tới hạn:', dueRes.error.message);
    } else {
        (dueRes.data || []).forEach(it => {
            if (!plannerOverviewByDate[it.due_date]) return;
            const info = getPriorityInfo(it.priority);
            plannerOverviewByDate[it.due_date].push({
                kind: 'due', id: it.id, title: it.content || '(không tên)',
                color: info.color, done: false, sort: -1 // việc có hạn xếp trước
            });
        });
    }

    // Trong 1 ngày: việc chưa xong lên trước, việc đã xong xuống sau, rồi theo giờ bắt đầu
    Object.values(plannerOverviewByDate).forEach(list => {
        list.sort((a, b) => (a.done - b.done) || (a.sort - b.sort));
    });
    renderPlannerOverview();
}

function updatePlannerOverviewLabel(dates) {
    const label = document.getElementById('planner-week-text');
    if (!label) return;
    const a = dates[0], b = dates[dates.length - 1];
    label.innerText = `${a.getDate()} thg ${a.getMonth() + 1} – ${b.getDate()} thg ${b.getMonth() + 1}`;
}

// ---------- Vẽ lưới ----------
function plannerOverviewChipHtml(it) {
    const icon = it.done
        ? '<i class="fas fa-circle-check pov-ico"></i>'
        : '<i class="far fa-circle pov-ico"></i>';
    return `<button type="button" class="pov-chip${it.done ? ' is-done' : ''}" style="--c:${it.color}" ` +
        `data-kind="${it.kind}" data-id="${it.id}" title="${escapeHtml(it.title)}">` +
        `${icon}<span class="pov-chip-text">${escapeHtml(it.title)}</span></button>`;
}

function renderPlannerOverview() {
    const grid = document.getElementById('planner-overview-grid');
    if (!grid) return;
    const dates = plannerOverviewDates();
    const today = new Date();

    let html = '<div class="pov-dow-row">' +
        PLANNER_OVERVIEW_DOW.map(n => `<div class="pov-dow">${n}</div>`).join('') + '</div>';

    for (let w = 0; w < PLANNER_OVERVIEW_WEEKS; w++) {
        html += '<div class="pov-week">';
        for (let i = 0; i < 7; i++) {
            const d = dates[w * 7 + i];
            const key = plannerFmtDateInput(d);
            const items = plannerOverviewByDate[key] || [];
            const shown = items.slice(0, PLANNER_OVERVIEW_MAX_CHIPS);
            const extra = items.length - shown.length;
            const isToday = plannerIsSameDate(d, today);
            const dateLabel = (d.getDate() === 1 || (w === 0 && i === 0))
                ? `${d.getDate()}<small>/${d.getMonth() + 1}</small>` : `${d.getDate()}`;
            html += `<div class="pov-day${isToday ? ' is-today' : ''}" data-date="${key}">` +
                `<button type="button" class="pov-daynum" data-date="${key}" title="Mở tuần này ở lưới giờ">${dateLabel}</button>` +
                `<div class="pov-chips">${shown.map(plannerOverviewChipHtml).join('')}</div>` +
                (extra > 0 ? `<button type="button" class="pov-more" data-date="${key}">+${extra}</button>` : '') +
                `</div>`;
        }
        html += '</div>';
    }
    grid.innerHTML = html;
}

// ---------- Tương tác ----------
function bindPlannerOverviewEvents() {
    if (plannerOverviewBound) return;
    const grid = document.getElementById('planner-overview-grid');
    if (!grid) return;
    plannerOverviewBound = true;

    grid.addEventListener('click', async (e) => {
        // Bấm số ngày hoặc "+N" -> nhảy sang lưới giờ của đúng tuần đó
        const jump = e.target.closest('.pov-daynum, .pov-more');
        if (jump) {
            const [y, m, d] = jump.dataset.date.split('-').map(Number);
            plannerWeekStart = plannerGetMonday(new Date(y, m - 1, d));
            setPlannerViewMode('grid');
            return;
        }
        // Bấm chip -> đổi trạng thái xong (kế hoạch) / hoàn thành (việc có hạn)
        const chip = e.target.closest('.pov-chip');
        if (!chip || chip.disabled) return;
        const id = parseInt(chip.dataset.id, 10);
        if (!id) return;
        chip.disabled = true;

        if (chip.dataset.kind === 'due') {
            await window.markTaskDone(id);
            loadPlannerOverview();
            return;
        }
        const dateKey = chip.closest('.pov-day').dataset.date;
        const item = (plannerOverviewByDate[dateKey] || []).find(x => x.kind === 'plan' && x.id === id);
        if (!item) { chip.disabled = false; return; }
        const next = !item.done;
        item.done = next;
        renderPlannerOverview(); // vẽ lại ngay (lạc quan), lỗi thì hoàn tác bên dưới
        const { error } = await sbClient.from('daily_plans')
            .update({ is_done: next }).eq('id', id).eq('user_id', currentUser.id);
        if (error) {
            console.error('[PlannerOverview] Lỗi lưu trạng thái xong:', error.message);
            item.done = !next;
            renderPlannerOverview();
        }
    });
}

function plannerApplyViewHint() {
    const hint = document.querySelector('.planner-header-text p');
    if (!hint) return;
    hint.innerText = plannerViewMode === 'overview'
        ? 'Bấm chip để tick xong — bấm số ngày để mở lưới giờ của tuần đó'
        : 'Kéo trên lưới để tạo việc — kéo dời (kể cả sang ngày khác) hoặc co giãn để chỉnh giờ';
}

window.setPlannerViewMode = function (mode) {
    plannerViewMode = mode === 'overview' ? 'overview' : 'grid';
    try { localStorage.setItem('plannerViewMode', plannerViewMode); } catch (e) { /* bỏ qua */ }

    const wrapper = document.getElementById('planner-wrapper');
    const overview = document.getElementById('planner-overview');
    if (wrapper) wrapper.style.display = plannerViewMode === 'overview' ? 'none' : '';
    if (overview) overview.style.display = plannerViewMode === 'overview' ? 'flex' : 'none';
    document.querySelectorAll('.planner-view-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === plannerViewMode);
    });
    plannerApplyViewHint();

    bindPlannerOverviewEvents();
    updatePlannerWeekHeader();
    updatePlannerWeekLabel();   // trả nhãn tuần về dạng thường (overview sẽ tự ghi đè nếu cần)
    loadPlannerBlocks();        // loadPlannerBlocks tự rẽ nhánh theo plannerViewMode
};

// Gọi khi vào tab Kế Hoạch để khôi phục chế độ xem đã lưu
function initPlannerViewMode() {
    bindPlannerOverviewEvents();
    const wrapper = document.getElementById('planner-wrapper');
    const overview = document.getElementById('planner-overview');
    if (wrapper) wrapper.style.display = plannerViewMode === 'overview' ? 'none' : '';
    if (overview) overview.style.display = plannerViewMode === 'overview' ? 'flex' : 'none';
    document.querySelectorAll('.planner-view-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === plannerViewMode);
    });
    plannerApplyViewHint();
}
