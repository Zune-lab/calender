// =========================================================
// SGU WORKSPACE — planner-push-cron
// pg_cron gọi Edge Function này MỖI PHÚT (xem supabase/push_setup.sql). Toàn bộ thông báo chạy PHÍA SERVER nên nhận được
// kể cả khi app/trình duyệt đã tắt hẳn — người dùng KHÔNG cần mở app:
//   1) Báo trước N phút cho việc trong Kế Hoạch Ngày (N = user_settings.notif_lead_min, mặc định 5)
//   2) Chuông "⏰ Đến giờ" đúng giờ bắt đầu
//   3) Báo HẠN cho Ghi chú/Công việc (và việc kế hoạch các ngày sau) theo mức ưu tiên: 1 lần khi vào cửa sổ báo trước + 1 lần đúng ngày hạn
// Ngoài ra: POST {"test": true} kèm JWT người dùng -> gửi 1 thông báo thử tới thiết bị của chính người đó (nút "Gửi thử" ở Cài đặt).
// Tag thông báo trùng với client (planner_<id>, alarm_<ngày>_<id>, detail_..., plan_...) nên nếu app đang mở thì chỉ hiện 1 thông báo.
// =========================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
// QUAN TRỌNG cho iPhone: Apple (APNs web push) từ chối VAPID subject giả. Hãy `supabase secrets set VAPID_SUBJECT=mailto:<email thật của bạn>`.
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const DEFAULT_LEAD_MIN = 5;
// Giống PRIORITY_LEVELS trong shared.js (đổi ở đâu thì đổi cả 2 nơi)
const PRIORITY: Record<string, { label: string; leadDays: number }> = {
    high: { label: "Quan trọng", leadDays: 7 },
    normal: { label: "Bình thường", leadDays: 5 },
    low: { label: "Không quan trọng lắm", leadDays: 3 },
};
const prio = (k?: string) => PRIORITY[k ?? ""] ?? PRIORITY.normal;
const MAX_LEAD_DAYS = 7;

// Báo Hạn chỉ trong khung giờ ban ngày (VN) để không đánh thức người dùng lúc nửa đêm; chạy mỗi 5 phút cho nhẹ DB.
const DEADLINE_FROM_MIN = 7 * 60;
const DEADLINE_TO_MIN = 22 * 60;

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Giờ Việt Nam (UTC+7): 1 "đồng hồ VN" cho cả ngày lẫn phút để 2 giá trị luôn khớp nhau.
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
function vnClock() {
    const now = new Date(Date.now() + VN_OFFSET_MS);
    return { dateStr: now.toISOString().slice(0, 10), minutes: now.getUTCHours() * 60 + now.getUTCMinutes() };
}
const addDaysStr = (dateStr: string, n: number) =>
    new Date(Date.parse(dateStr + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const dayDiff = (a: string, b: string) => Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86400000);
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

type Sub = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };
type Outcome = { delivered: number; transient: boolean; errors: number[] };

// Gửi 1 payload tới mọi thiết bị của user; dọn subscription chết (404/410).
// TTL ngắn: thông báo "sắp tới giờ" mà tới trễ hàng giờ thì vô nghĩa -> để push service bỏ luôn thay vì giao muộn.
async function sendToSubs(supabase: any, subs: Sub[], payload: object, ttl: number): Promise<Outcome> {
    const body = JSON.stringify(payload);
    const results = await Promise.allSettled(subs.map((s) =>
        webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: ttl, urgency: "high" })
    ));
    const out: Outcome = { delivered: 0, transient: false, errors: [] };
    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === "fulfilled") { out.delivered++; continue; }
        const code = (r.reason as { statusCode?: number })?.statusCode ?? 0;
        out.errors.push(code);
        if (code === 404 || code === 410) await supabase.from("push_subscriptions").delete().eq("id", subs[i].id);
        else { out.transient = true; console.error("[push] lỗi gửi:", code, (r.reason as Error)?.message); }
    }
    return out;
}

async function loadSubs(supabase: any, userIds: string[]): Promise<Map<string, Sub[]>> {
    const map = new Map<string, Sub[]>();
    if (!userIds.length) return map;
    const { data, error } = await supabase.from("push_subscriptions").select("id, user_id, endpoint, p256dh, auth").in("user_id", userIds);
    if (error) throw new Error("push_subscriptions: " + error.message);
    for (const s of data ?? []) { const l = map.get(s.user_id) ?? []; l.push(s); map.set(s.user_id, l); }
    return map;
}

async function loadLeads(supabase: any, userIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (!userIds.length) return map;
    const { data } = await supabase.from("user_settings").select("user_id, notif_lead_min").in("user_id", userIds);
    for (const r of data ?? []) if (Number.isFinite(r.notif_lead_min) && r.notif_lead_min > 0) map.set(r.user_id, r.notif_lead_min);
    return map;
}

// ---------- 1 + 2: việc trong Kế Hoạch Ngày (báo trước + đúng giờ) ----------
async function planReminders(supabase: any, todayStr: string, nowMin: number) {
    const tomorrowStr = addDaysStr(todayStr, 1);
    const { data: plans, error } = await supabase.from("daily_plans")
        .select("id, user_id, title, start_min, plan_date, push_notified, push_alarm_notified")
        .eq("is_done", false).in("plan_date", [todayStr, tomorrowStr])
        .or("push_notified.eq.false,push_alarm_notified.eq.false");
    if (error) throw new Error("daily_plans: " + error.message);
    if (!plans?.length) return { sent: 0 };

    const userIds = [...new Set<string>(plans.map((p: any) => p.user_id))];
    const [subsByUser, leads] = await Promise.all([loadSubs(supabase, userIds), loadLeads(supabase, userIds)]);

    const leadDone: string[] = [];
    const alarmDone: string[] = [];
    let sent = 0;

    for (const p of plans) {
        const minsLeft = (p.plan_date === todayStr ? p.start_min : p.start_min + 1440) - nowMin;
        const lead = leads.get(p.user_id) ?? DEFAULT_LEAD_MIN;
        const subs = subsByUser.get(p.user_id) ?? [];
        const title = p.title || "Việc chưa đặt tên";

        // Báo trước: trong cửa sổ [0, lead] phút. Đã trễ giờ (minsLeft<0) mà chưa báo -> bỏ qua, chỉ đánh dấu (chuông đúng giờ lo).
        if (!p.push_notified) {
            if (minsLeft < 0) leadDone.push(p.id);
            else if (minsLeft <= lead) {
                if (!subs.length) leadDone.push(p.id);
                else {
                    const body = minsLeft > 0 ? `Còn ${minsLeft} phút nữa tới giờ — bắt đầu lúc ${hm(p.start_min)}` : `Đã tới giờ (${hm(p.start_min)})`;
                    const o = await sendToSubs(supabase, subs, { title, body, tag: `planner_${p.id}` }, 600);
                    sent += o.delivered;
                    if (o.delivered > 0 || !o.transient) leadDone.push(p.id);
                }
            }
        }
        // Chuông đúng giờ: cho phép trễ tối đa 5 phút (cron bị trễ nhịp). Tag giống client để không hiện 2 lần.
        if (!p.push_alarm_notified && minsLeft <= 0) {
            if (minsLeft < -5 || !subs.length) alarmDone.push(p.id);
            else {
                const o = await sendToSubs(supabase, subs,
                    { title: "⏰ Đến giờ: " + title, body: `Bắt đầu lúc ${hm(p.start_min)}`, tag: `alarm_${p.plan_date}_${p.id}` }, 600);
                sent += o.delivered;
                if (o.delivered > 0 || !o.transient) alarmDone.push(p.id);
            }
        }
    }
    if (leadDone.length) await supabase.from("daily_plans").update({ push_notified: true }).in("id", leadDone);
    if (alarmDone.length) await supabase.from("daily_plans").update({ push_alarm_notified: true }).in("id", alarmDone);
    return { sent };
}

// ---------- 3: báo HẠN (ghi chú/công việc + việc kế hoạch các ngày sau) ----------
type Pending = { userId: string; key: string; title: string; body: string };

async function deadlineReminders(supabase: any, todayStr: string) {
    const horizon = addDaysStr(todayStr, MAX_LEAD_DAYS);
    const [det, pl] = await Promise.all([
        supabase.from("subject_details").select("id, user_id, type, content, priority, due_date")
            .eq("status", "upcoming").gte("due_date", todayStr).lte("due_date", horizon),
        supabase.from("daily_plans").select("id, user_id, title, priority, plan_date")
            .eq("is_done", false).gt("plan_date", todayStr).lte("plan_date", horizon),
    ]);
    if (det.error) throw new Error("subject_details: " + det.error.message);
    if (pl.error) throw new Error("daily_plans(hạn): " + pl.error.message);

    const pending: Pending[] = [];
    for (const d of det.data ?? []) {
        const due = String(d.due_date).slice(0, 10);
        const days = dayDiff(due, todayStr);
        const info = prio(d.priority);
        if (days < 0 || days > info.leadDays) continue;
        const label = d.type === "task" ? "Công việc" : "Ghi chú";
        pending.push({
            userId: d.user_id,
            key: `detail_${due}_${d.id}_${days === 0 ? "due" : "lead"}`,
            title: `${label}: ${d.content || "(không có nội dung)"}`,
            body: days === 0 ? `Hôm nay là hạn chót! (${info.label})` : `Còn ${days} ngày nữa tới hạn — ${info.label}`,
        });
    }
    for (const p of pl.data ?? []) {
        const days = dayDiff(p.plan_date, todayStr);
        const info = prio(p.priority);
        if (days <= 0 || days > info.leadDays) continue;
        pending.push({
            userId: p.user_id, key: `plan_${p.plan_date}_${p.id}_lead`,
            title: `Kế hoạch: ${p.title || "Việc chưa đặt tên"}`, body: `Còn ${days} ngày nữa — ${info.label}`,
        });
    }
    if (!pending.length) return { sent: 0 };

    // Chống báo lặp: ghi mốc vào push_log TRƯỚC; chỉ dòng chèn MỚI (chưa từng gửi) mới được gửi.
    const { data: fresh, error: logErr } = await supabase.from("push_log")
        .upsert(pending.map((p) => ({ user_id: p.userId, key: p.key })), { onConflict: "user_id,key", ignoreDuplicates: true })
        .select("user_id, key");
    if (logErr) throw new Error("push_log: " + logErr.message);
    const freshSet = new Set((fresh ?? []).map((r: any) => `${r.user_id}|${r.key}`));
    const toSend = pending.filter((p) => freshSet.has(`${p.userId}|${p.key}`));
    if (!toSend.length) return { sent: 0 };

    const subsByUser = await loadSubs(supabase, [...new Set(toSend.map((p) => p.userId))]);
    let sent = 0;
    for (const p of toSend) {
        const subs = subsByUser.get(p.userId) ?? [];
        if (!subs.length) continue; // chưa đăng ký thiết bị: giữ mốc đã ghi (không báo dồn khi họ bật sau)
        const o = await sendToSubs(supabase, subs, { title: p.title, body: p.body, tag: p.key }, 6 * 3600);
        sent += o.delivered;
        // Lỗi tạm thời trên mọi thiết bị -> xoá mốc để lần chạy sau (5 phút nữa) thử lại
        if (o.delivered === 0 && o.transient) await supabase.from("push_log").delete().eq("user_id", p.userId).eq("key", p.key);
    }
    return { sent };
}

// ---------- Gửi thử cho chính người gọi ----------
async function handleTest(supabase: any, req: Request) {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u, error } = await supabase.auth.getUser(jwt);
    if (error || !u?.user) return json({ ok: false, reason: "not_signed_in" }, 401);
    const subsByUser = await loadSubs(supabase, [u.user.id]);
    const subs = subsByUser.get(u.user.id) ?? [];
    if (!subs.length) return json({ ok: false, reason: "no_subscription", subscriptions: 0 });
    const o = await sendToSubs(supabase, subs, {
        title: "Thông báo thử ✅", body: "Server gửi được push tới máy bạn — không cần mở app vẫn nhận được.", tag: "sgu-test",
    }, 300);
    return json({ ok: o.delivered > 0, subscriptions: subs.length, delivered: o.delivered, errors: o.errors });
}

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    let body: any = {};
    try { body = await req.json(); } catch { /* cron gọi body rỗng */ }

    try {
        if (body?.test) return await handleTest(supabase, req);

        const { dateStr: todayStr, minutes: nowMin } = vnClock();
        const out: Record<string, unknown> = {};
        out.plans = await planReminders(supabase, todayStr, nowMin);
        // Khung giờ ban ngày + mỗi 5 phút
        if (nowMin >= DEADLINE_FROM_MIN && nowMin < DEADLINE_TO_MIN && nowMin % 5 === 0) {
            out.deadlines = await deadlineReminders(supabase, todayStr);
        }
        // Dọn nhật ký cũ (>30 ngày) mỗi đêm lúc 03:00
        if (nowMin === 3 * 60) {
            await supabase.from("push_log").delete().lt("sent_at", new Date(Date.now() - 30 * 86400000).toISOString());
        }
        return json(out);
    } catch (e) {
        console.error("[planner-push-cron]", e);
        return json({ error: (e as Error).message }, 500);
    }
});
