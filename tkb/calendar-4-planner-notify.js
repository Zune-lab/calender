// ===== calendar-4-planner-notify.js =====
// Phần 4/5 của calendar.js. Nạp SAU calendar-3-personalization.js.
// Nội dung: hằng số Kế Hoạch Ngày (PLANNER_HOUR_PX, PRIORITY_LEVELS...), đăng ký thông báo
// đẩy (push), thông báo theo phút (checkUpcomingPlannerNotifications), thông báo theo hạn
// (checkUpcomingDeadlineNotifications). initDayPlanner() nằm ở file kế tiếp và dùng các
// hằng số/hàm khai báo trong file này.

// =========================================
// 8. KẾ HOẠCH NGÀY (DAY PLANNER) — XEM CẢ TUẦN
//    Kéo/vẽ trực tiếp trên từng cột ngày (Thứ 2 -> Chủ Nhật) để tạo việc.
//    Mỗi khối gắn với 1 ngày cụ thể (plan_date), lưu Supabase bảng "daily_plans".
// =========================================
const PLANNER_HOUR_PX = 64;       // chiều cao 1 giờ trên lưới (px) — phải khớp với calendar.css
const PLANNER_SNAP_MIN = 15;      // bước làm tròn khi kéo (phút)
const PLANNER_MIN_DURATION = 15;  // độ dài tối thiểu 1 khối việc (phút)
const PLANNER_COLORS = ['#6C9BFF', '#4C7DFF', '#FF7A93', '#F5528C', '#3FC1A9', '#1DA88A', '#FFAE63', '#FF8A3D', '#B18AF5', '#8C5CF2', '#5FCBEB', '#2FA9D6', '#F5CC5C', '#E8A33D', '#8FE3A8', '#E86C6C', '#C9A0FF', '#7FD3C6'];
const PLANNER_DAY_NAMES = ['Chủ Nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']; // index = Date.getDay()

let plannerWeekStart = plannerGetMonday(new Date());
let plannerBlocksByDate = {};   // { 'YYYY-MM-DD': [ {id,title,start_min,end_min,color} ] }
let plannerDrag = null;
let plannerEditingDraft = null; // { id, dateStr, title, start_min, end_min, color }
let plannerNowTimer = null;
let plannerBuilt = false;

// =========================================
// 8b. THÔNG BÁO CHO KẾ HOẠCH — 2 LỚP SONG SONG
//    Lớp 1 (LOCAL POLL): JS trong tab tự kiểm tra mỗi 30s -> phản hồi tức thì khi đang mở app.
//    Lớp 2 (PUSH THẬT): đăng ký Service Worker + Push Subscription, server (Supabase Edge
//    Function + pg_cron) sẽ bắn Web Push tới máy bạn -> nhận được kể cả khi tắt hẳn trình duyệt.
// =========================================
const PLANNER_NOTIF_POLL_MS = 30000;   // tần suất kiểm tra phía client (30s)

// MỤC 2: THỜI GIAN BÁO TRƯỚC CHO KẾ HOẠCH — GIỜ CÓ THỂ TỰ TÙY CHỈNH (Cài Đặt Workspace)
// Trước đây bị cố định cứng "const PLANNER_NOTIF_LEAD_MIN = 5". Giờ đọc từ localStorage, người
// dùng chọn ở Cài Đặt (savePlannerNotifLead), mặc định vẫn là 5 phút nếu chưa từng chọn.
function getPlannerNotifLeadMin() {
    const v = parseInt(localStorage.getItem('plannerNotifLeadMin'), 10);
    return Number.isFinite(v) && v > 0 ? v : 5;
}
window.savePlannerNotifLead = function(minutes) {
    localStorage.setItem('plannerNotifLeadMin', minutes);
};

// MỤC 3: 3 MỨC ĐỘ QUAN TRỌNG — DÙNG CHUNG CHO GHI CHÚ/CÔNG VIỆC (subject_details) VÀ KẾ HOẠCH
// NGÀY (daily_plans). leadDays quyết định báo trước bao nhiêu ngày so với "hạn" (due_date với
// ghi chú/công việc, hoặc plan_date với việc trong Kế Hoạch).
const PRIORITY_LEVELS = {
    high:   { label: 'Quan trọng',           color: '#ff4d4f', leadDays: 7, order: 0 },
    normal: { label: 'Bình thường',          color: '#ffb020', leadDays: 5, order: 1 },
    low:    { label: 'Không quan trọng lắm', color: '#8b96a5', leadDays: 3, order: 2 }
};
function getPriorityInfo(key) { return PRIORITY_LEVELS[key] || PRIORITY_LEVELS.normal; }
let plannerNotifTimer = null;
// TIẾNG CHUÔNG BÁO ĐÚNG GIỜ (giống báo thức/Google Calendar) — xem chi tiết ở mục "CHUÔNG BÁO
// ĐÚNG GIỜ" phía dưới. AudioContext phải được tạo/resume trong 1 cử chỉ bấm thật của người
// dùng thì mới phát được ở lần gọi sau (browser chặn tự phát âm thanh không do người dùng bấm).
let plannerAlarmAudioCtx = null;

// Khóa công khai VAPID — an toàn khi để lộ ở client (chỉ khóa RIÊNG TƯ mới cần giữ bí mật,
// khóa đó nằm trong Edge Function secrets, không xuất hiện ở đây).
const PLANNER_PUSH_VAPID_PUBLIC_KEY = 'BNxj9bZH3u_IXBvcohC9BGIToPpzwFJ5bbU2ukd1O7W_2rwLY9dHQ-6qPnnCEF_kh7rskNJ-myLraXerYXietfg';

function plannerUrlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

async function plannerRegisterServiceWorker() {
    if (!('serviceWorker' in navigator)) return null;
    try {
        return await navigator.serviceWorker.register('../sw.js');
    } catch (e) {
        console.warn('[PlannerPush] Không đăng ký được Service Worker:', e.message);
        return null;
    }
}

async function plannerSubscribePush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    const reg = await plannerRegisterServiceWorker();
    if (!reg) return false;

    try {
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
            sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: plannerUrlBase64ToUint8Array(PLANNER_PUSH_VAPID_PUBLIC_KEY),
            });
        }
        const json = sub.toJSON();
        const { error } = await sbClient.from('push_subscriptions').upsert({
            user_id: currentUser.id,
            endpoint: json.endpoint,
            p256dh: json.keys.p256dh,
            auth: json.keys.auth,
        }, { onConflict: 'endpoint' });
        if (error) { console.warn('[PlannerPush] Lỗi lưu subscription:', error.message); return false; }
        return true;
    } catch (e) {
        console.warn('[PlannerPush] Không đăng ký được push:', e.message);
        return false;
    }
}

async function plannerUnsubscribePush() {
    if (!('serviceWorker' in navigator)) return;
    try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg) return;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
            await sbClient.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
            await sub.unsubscribe();
        }
    } catch (e) { console.warn('[PlannerPush] Lỗi hủy đăng ký push:', e.message); }
}

function plannerNotifEnabled() {
    return localStorage.getItem('plannerNotifEnabled') === '1';
}

function plannerNotifStatusText() {
    if (typeof Notification === 'undefined') return 'Trình duyệt này không hỗ trợ thông báo.';
    if (Notification.permission === 'denied') return 'Bạn đã chặn quyền thông báo — vào cài đặt trình duyệt để bật lại.';
    if (Notification.permission === 'granted' && plannerNotifEnabled()) return 'Đang bật — báo Kế Hoạch trước ' + getPlannerNotifLeadMin() + ' phút, và báo Hạn Ghi chú/Công việc theo mức ưu tiên. Hoạt động kể cả khi tắt trình duyệt.';
    return 'Đang tắt.';
}

function renderPlannerNotifStatus(customMessage) {
    const el = document.getElementById('planner-notif-status');
    if (el) el.innerText = customMessage || plannerNotifStatusText();
}

function initPlannerNotifications() {
    const toggle = document.getElementById('planner-notif-toggle');
    if (!toggle) return;

    const supported = typeof Notification !== 'undefined';
    if (!supported) {
        toggle.disabled = true;
        renderPlannerNotifStatus();
        return;
    }

    toggle.checked = plannerNotifEnabled() && Notification.permission === 'granted';
    renderPlannerNotifStatus();

    toggle.addEventListener('change', async function () {
        if (this.checked) {
            // FIX: nhiều trình duyệt CHẶN hộp thoại xin quyền Notification khi trang đang chạy
            // trong iframe (vd khung xem trước nhúng của VS Code/editor) -> requestPermission()
            // ném lỗi hoặc treo im lặng, khiến toggle bật lên rồi tự bật lại về OFF ngay lập tức,
            // nhìn giống như "không bật được". Bọc try/catch để bắt đúng trường hợp này và báo rõ.
            if (window.self !== window.top) {
                this.checked = false;
                renderPlannerNotifStatus('Không thể xin quyền thông báo trong khung xem trước nhúng (iframe). Hãy mở trang này ở một tab trình duyệt bình thường (không qua VS Code/editor) rồi bật lại.');
                return;
            }
            try {
                let perm = Notification.permission;
                if (perm === 'default') {
                    perm = await Notification.requestPermission();
                }
                if (perm === 'granted') {
                    localStorage.setItem('plannerNotifEnabled', '1');
                    // Tạo AudioContext NGAY TRONG cử chỉ bấm này (bắt buộc — trình duyệt chặn phát
                    // âm thanh không do người dùng chủ động bấm). Giữ lại để tái dùng lúc chuông
                    // reo sau này, dù lúc đó chỉ chạy từ setInterval (không có cử chỉ bấm mới).
                    try {
                        plannerAlarmAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
                    } catch (e) { console.warn('[PlannerAlarm] Trình duyệt không hỗ trợ Web Audio:', e.message); }
                    startPlannerNotifPolling();
                    await plannerSubscribePush(); // đăng ký nhận Push thật từ server (chạy nền được)
                    // Thông báo xác nhận nhẹ để người dùng biết đã bật thành công
                    new Notification('Đã bật thông báo', { body: 'Mình sẽ báo trước ' + getPlannerNotifLeadMin() + ' phút cho việc trong Kế Hoạch Ngày, và báo Hạn cho Ghi chú/Công việc theo mức ưu tiên — kể cả khi bạn tắt trình duyệt.' });
                } else {
                    this.checked = false;
                    localStorage.setItem('plannerNotifEnabled', '0');
                }
            } catch (e) {
                this.checked = false;
                localStorage.setItem('plannerNotifEnabled', '0');
                renderPlannerNotifStatus('Không xin được quyền thông báo: ' + e.message + ' (thử mở trang ở tab trình duyệt bình thường thay vì khung xem trước nhúng)');
                return;
            }
        } else {
            localStorage.setItem('plannerNotifEnabled', '0');
            stopPlannerNotifPolling();
            await plannerUnsubscribePush();
        }
        renderPlannerNotifStatus();
    });

    // Nếu trước đó người dùng đã bật và quyền vẫn còn -> tự chạy lại poll + đảm bảo push
    // subscription vẫn còn hiệu lực ngay khi mở app, không cần bật tay lại mỗi lần.
    if (plannerNotifEnabled() && Notification.permission === 'granted') {
        startPlannerNotifPolling();
        plannerSubscribePush();
        // Lần này KHÔNG có cử chỉ bấm mới (trang vừa tải lại) -> AudioContext tạo ra sẽ ở trạng
        // thái "suspended" (bị khoá). Lắng nghe cú click ĐẦU TIÊN bất kỳ ở đâu trên trang (mở
        // modal, đổi tab, v.v.) để âm thầm resume() ngay khi có cơ hội, không cần người dùng
        // phải bật/tắt lại thông báo mới có chuông.
        try {
            plannerAlarmAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) { /* trình duyệt không hỗ trợ, bỏ qua — chuông sẽ không phát được nhưng thông báo chữ vẫn hoạt động bình thường */ }
        const unlockPlannerAlarm = () => {
            if (plannerAlarmAudioCtx && plannerAlarmAudioCtx.state === 'suspended') plannerAlarmAudioCtx.resume();
        };
        document.addEventListener('click', unlockPlannerAlarm, { once: true });
        document.addEventListener('keydown', unlockPlannerAlarm, { once: true });
    }
}

function startPlannerNotifPolling() {
    if (plannerNotifTimer) return; // đã chạy rồi, tránh chạy trùng nhiều interval
    checkUpcomingPlannerNotifications(); // kiểm tra ngay 1 lần, không đợi đủ 30s đầu tiên
    checkUpcomingDeadlineNotifications(); // MỤC 3: kiểm tra luôn thông báo theo Hạn (ngày)
    checkPlannerAlarmArrival(); // FIX: hàm chuông báo đúng giờ đã viết sẵn nhưng bị BỎ QUÊN, chưa
    // từng được gọi ở đâu cả -> chuông không bao giờ kêu dù code đã có đủ. Nối vào đây, chạy
    // cùng nhịp với 2 hàm kiểm tra kia (ngay lần đầu + lặp lại mỗi 30s bên dưới).
    plannerNotifTimer = setInterval(() => {
        checkUpcomingPlannerNotifications();
        checkUpcomingDeadlineNotifications();
        checkPlannerAlarmArrival();
    }, PLANNER_NOTIF_POLL_MS);
}

function stopPlannerNotifPolling() {
    if (plannerNotifTimer) { clearInterval(plannerNotifTimer); plannerNotifTimer = null; }
}

function plannerNotifiedSet() {
    try { return new Set(JSON.parse(localStorage.getItem('plannerNotifiedIds') || '[]')); }
    catch (e) { return new Set(); }
}

// =========================================
// CHUÔNG BÁO ĐÚNG GIỜ (giống báo thức/Google Calendar) — TÁCH RIÊNG khỏi thông báo "báo trước
// N phút" ở checkUpcomingPlannerNotifications() phía dưới, vì đó là 2 khái niệm khác nhau:
//   - "Báo trước N phút" (đã có từ trước): 1 thông báo CHỮ im lặng, bắn sớm trong khoảng
//     [0, N phút] TRƯỚC giờ bắt đầu, chỉ bắn ĐÚNG 1 LẦN mỗi việc/ngày.
//   - "Chuông báo đúng giờ" (MỚI): phát tiếng chuông + thông báo riêng, bắn đúng lúc GIỜ THẬT
//     đã điểm (không phải trước đó), y như báo thức thật.
// Dùng bộ nhớ đã lưu (plannerAlarmFiredIds) riêng, không dùng chung set với "báo trước N phút"
// ở trên, để 2 cơ chế không đụng/chặn lẫn nhau.
// GIỚI HẠN: chuông chỉ phát được khi TAB ĐANG MỞ (kể cả chạy nền, không cần đang xem trang này)
// vì Web Audio API cần trình duyệt đang chạy để phát âm thanh tuỳ chỉnh. Khi tắt hẳn trình
// duyệt, vẫn nhận được thông báo hệ thống qua Push (sw.js) như bình thường, kèm âm thanh mặc
// định của hệ điều hành (không tuỳ biến được vì đó là giới hạn chung của Web Push, không phải
// thiếu sót ở đây).
// =========================================
function plannerAlarmFiredSet() {
    try { return new Set(JSON.parse(localStorage.getItem('plannerAlarmFiredIds') || '[]')); }
    catch (e) { return new Set(); }
}
function plannerSaveAlarmFiredSet(set) {
    const todayStr = plannerFmtDateInput(new Date());
    const kept = [...set].filter(key => key.startsWith(todayStr + '_'));
    localStorage.setItem('plannerAlarmFiredIds', JSON.stringify(kept));
}

// Phát 3 tiếng "tinh" ngắn liên tiếp bằng Web Audio (không cần file âm thanh ngoài nào).
function playPlannerAlarmSound() {
    if (!plannerAlarmAudioCtx) return;
    if (plannerAlarmAudioCtx.state === 'suspended') plannerAlarmAudioCtx.resume();
    const ctx = plannerAlarmAudioCtx;
    [0, 0.35, 0.7].forEach(offset => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880; // note A5 — âm "tinh" quen thuộc kiểu chuông báo
        const t0 = ctx.currentTime + offset;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02);   // vào nhanh
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28); // tắt dần, tránh tiếng "tách" khó chịu
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.3);
    });
}

// Kiểm tra mọi việc hôm nay xem có việc nào VỪA ĐIỂM đúng giờ bắt đầu chưa (cho phép trễ tối đa
// 1 phút so với lúc poll thực sự chạy, vì poll cách nhau 30s — đủ để không bỏ lỡ mốc chính xác
// dù JS timer có thể trôi vài giây). Chỉ báo ĐÚNG 1 LẦN mỗi việc/ngày.
async function checkPlannerAlarmArrival() {
    if (!currentUser || !plannerNotifEnabled() || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

    const now = new Date();
    const todayStr = plannerFmtDateInput(now);
    const nowMin = now.getHours() * 60 + now.getMinutes();

    const { data, error } = await sbClient.from('daily_plans')
        .select('id, title, start_min, is_done')
        .eq('user_id', currentUser.id)
        .eq('plan_date', todayStr);
    if (error || !data) return;

    const fired = plannerAlarmFiredSet();
    let changed = false;

    data.forEach(b => {
        if (b.is_done) return; // việc đã tick xong rồi thì khỏi báo thức nữa
        const key = `${todayStr}_${b.id}`;
        if (nowMin >= b.start_min && nowMin <= b.start_min + 1 && !fired.has(key)) {
            try {
                new Notification('⏰ Đến giờ: ' + (b.title || 'Việc chưa đặt tên'), {
                    body: `Bắt đầu lúc ${plannerFmtHM(b.start_min)}`,
                    tag: 'alarm_' + key,
                    requireInteraction: true, // giữ nguyên trên màn hình tới khi người dùng bấm tắt, giống báo thức thật
                });
            } catch (e) { console.warn('[PlannerAlarm] Không bắn được thông báo:', e.message); }
            playPlannerAlarmSound();
            fired.add(key);
            changed = true;
        }
    });

    if (changed) plannerSaveAlarmFiredSet(fired);
}

function plannerClearNotifiedFor(dateStr, id) {
    const set = plannerNotifiedSet();
    if (set.delete(`${dateStr}_${id}`)) plannerSaveNotifiedSet(set);
}

function plannerSaveNotifiedSet(set) {
    // Chỉ giữ lại mốc của HÔM NAY để tránh localStorage phình to vô hạn theo thời gian
    const todayStr = plannerFmtDateInput(new Date());
    const kept = [...set].filter(key => key.startsWith(todayStr + '_'));
    localStorage.setItem('plannerNotifiedIds', JSON.stringify(kept));
}

async function checkUpcomingPlannerNotifications() {
    if (!currentUser || !plannerNotifEnabled() || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

    const now = new Date();
    const todayStr = plannerFmtDateInput(now);
    const nowMin = now.getHours() * 60 + now.getMinutes();

    const { data, error } = await sbClient.from('daily_plans')
        .select('id, title, start_min, end_min')
        .eq('user_id', currentUser.id)
        .eq('plan_date', todayStr);

    if (error || !data) return;

    const notified = plannerNotifiedSet();
    let changed = false;

    data.forEach(b => {
        const minsUntil = b.start_min - nowMin;
        const key = `${todayStr}_${b.id}`;
        // Báo khi còn 0-5 phút nữa (kể cả khi vừa mới bắt đầu, phòng trường hợp máy đang tắt/app
        // đang đóng đúng lúc mốc 5 phút trôi qua), và chỉ báo ĐÚNG 1 LẦN cho mỗi việc mỗi ngày.
        if (minsUntil <= getPlannerNotifLeadMin() && minsUntil >= -1 && !notified.has(key)) {
            const body = minsUntil > 0
                ? `Còn ${minsUntil} phút nữa tới giờ — bắt đầu lúc ${plannerFmtHM(b.start_min)}`
                : `Đã tới giờ (${plannerFmtHM(b.start_min)})`;
            try {
                new Notification(b.title || 'Việc chưa đặt tên', { body, tag: key });
            } catch (e) { console.warn('[PlannerNotif] Không bắn được thông báo:', e.message); }
            notified.add(key);
            changed = true;
        }
    });

    if (changed) plannerSaveNotifiedSet(notified);
}

// =========================================
// MỤC 3: THÔNG BÁO THEO "HẠN" (NGÀY) DỰA TRÊN MỨC ƯU TIÊN
// Khác với checkUpcomingPlannerNotifications (báo theo PHÚT, cho việc có giờ cụ thể hôm nay),
// hàm này báo theo NGÀY — áp dụng cho: (1) Ghi chú/Công việc có đặt "Hạn" (subject_details.due_date),
// và (2) việc trong Kế Hoạch Ngày (daily_plans, dùng plan_date làm "hạn"). Số ngày báo trước tuỳ
// theo mức ưu tiên (PRIORITY_LEVELS.leadDays: quan trọng=7, bình thường=5, không quan trọng lắm=3).
// Dùng CHUNG kênh thông báo (Notification API) và điều kiện bật/tắt với Kế Hoạch (plannerNotifEnabled()).
// =========================================
function deadlineNotifiedSet() {
    try { return new Set(JSON.parse(localStorage.getItem('deadlineNotifiedIds') || '[]')); }
    catch (e) { return new Set(); }
}
function deadlineSaveNotifiedSet(set) {
    // Key ở đây có dạng `detail_${todayStr}_${id}` hoặc `plan_${todayStr}_${id}` (khác với
    // plannerSaveNotifiedSet ở trên, key không có prefix) -> phải dùng includes(`_${todayStr}_`)
    // để khớp cả 2 prefix, KHÔNG được dùng startsWith(todayStr + '_') vì nó luôn sai (xoá sạch
    // set mỗi lần lưu, khiến thông báo "Hạn" bắn lặp lại mỗi 30 giây thay vì 1 lần/ngày).
    const todayStr = plannerFmtDateInput(new Date());
    const kept = [...set].filter(key => key.includes(`_${todayStr}_`));
    localStorage.setItem('deadlineNotifiedIds', JSON.stringify(kept));
}
function daysBetweenDateStrings(fromStr, toStr) {
    return Math.round((new Date(toStr + 'T00:00:00') - new Date(fromStr + 'T00:00:00')) / 86400000);
}

async function checkUpcomingDeadlineNotifications() {
    if (!currentUser || !plannerNotifEnabled() || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

    const todayStr = plannerFmtDateInput(new Date());
    const notified = deadlineNotifiedSet();
    let changed = false;

    // (1) Ghi chú / Công việc có đặt Hạn
    const { data: details, error: detailsErr } = await sbClient.from('subject_details')
        .select('id, content, type, due_date, priority')
        .eq('user_id', currentUser.id)
        .eq('status', 'upcoming')
        .not('due_date', 'is', null);

    if (!detailsErr && details) {
        details.forEach(item => {
            const daysUntil = daysBetweenDateStrings(todayStr, item.due_date);
            const leadDays = getPriorityInfo(item.priority).leadDays;
            const key = `detail_${todayStr}_${item.id}`;
            if (daysUntil >= 0 && daysUntil <= leadDays && !notified.has(key)) {
                const label = item.type === 'task' ? 'Công việc' : 'Ghi chú';
                const body = daysUntil === 0
                    ? `Hôm nay là hạn chót! (${getPriorityInfo(item.priority).label})`
                    : `Còn ${daysUntil} ngày nữa tới hạn — ${getPriorityInfo(item.priority).label}`;
                try {
                    new Notification(`${label}: ${item.content}`, { body, tag: key });
                } catch (e) { console.warn('[DeadlineNotif] Không bắn được thông báo:', e.message); }
                notified.add(key);
                changed = true;
            }
        });
    }

    // (2) Việc trong Kế Hoạch Ngày — dùng plan_date làm "hạn". Chỉ cần xét trong vòng tối đa số
    // ngày của mức ưu tiên cao nhất (hiện là 7 ngày) kể từ hôm nay.
    const maxLeadDays = Math.max(...Object.values(PRIORITY_LEVELS).map(p => p.leadDays));
    const futureLimit = new Date();
    futureLimit.setDate(futureLimit.getDate() + maxLeadDays);
    const { data: plans, error: plansErr } = await sbClient.from('daily_plans')
        .select('id, title, plan_date, priority')
        .eq('user_id', currentUser.id)
        .gte('plan_date', todayStr)
        .lte('plan_date', plannerFmtDateInput(futureLimit));

    if (!plansErr && plans) {
        plans.forEach(item => {
            const daysUntil = daysBetweenDateStrings(todayStr, item.plan_date);
            const leadDays = getPriorityInfo(item.priority).leadDays;
            const key = `plan_${todayStr}_${item.id}`;
            if (daysUntil >= 0 && daysUntil <= leadDays && !notified.has(key)) {
                const body = daysUntil === 0
                    ? `Hôm nay là ngày đã lên kế hoạch! (${getPriorityInfo(item.priority).label})`
                    : `Còn ${daysUntil} ngày nữa — ${getPriorityInfo(item.priority).label}`;
                try {
                    new Notification(`Kế hoạch: ${item.title || 'Việc chưa đặt tên'}`, { body, tag: key });
                } catch (e) { console.warn('[DeadlineNotif] Không bắn được thông báo:', e.message); }
                notified.add(key);
                changed = true;
            }
        });
    }

    if (changed) deadlineSaveNotifiedSet(notified);
}

function plannerGetMonday(date) {
    const d = new Date(date);
    const day = d.getDay(); // 0=CN ... 6=T7
    const diff = (day === 0 ? -6 : 1 - day);
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
}
function plannerFmtDateInput(d) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
function plannerFmtHM(min) {
    min = Math.max(0, Math.min(1440, Math.round(min)));
    const h = Math.floor(min / 60), m = min % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function plannerIsSameDate(a, b) { return plannerFmtDateInput(a) === plannerFmtDateInput(b); }
function plannerSnap(min) { return Math.round(min / PLANNER_SNAP_MIN) * PLANNER_SNAP_MIN; }
function plannerPxToMin(px) { return Math.max(0, Math.min(1440, (px / PLANNER_HOUR_PX) * 60)); }
// plannerEscapeText() đã bị xóa (dùng đúng escapeHtml() ở shared.js thay thế) — trước đây file
// này tự viết lại 1 bản escape HTML riêng (qua trick innerText -> innerHTML) làm CÙNG một việc
// escapeHtml() đã làm, chỉ khác cách triển khai. 2 bản riêng biệt dễ lệch nhau nếu sau này chỉ
// sửa đúng 1 chỗ (y hệt lý do escapeHtml/parseVNExamDate/ACCENT_POOL... đã được gom về shared.js
// trước đó). shared.js được nạp TRƯỚC mọi file calendar-*.js trong calendar.html nên escapeHtml()
// luôn có sẵn ở đây.
function plannerWeekDates() {
    const arr = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(plannerWeekStart);
        d.setDate(d.getDate() + i);
        arr.push(d);
    }
    return arr;
}