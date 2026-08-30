// =========================================================
// SGU WORKSPACE — planner-push-cron
// Edge Function này được pg_cron gọi MỖI PHÚT (xem supabase_push_setup.sql).
// Việc của nó: tìm các "daily_plans" sắp bắt đầu trong 5 phút tới, chưa được báo,
// rồi bắn Web Push THẬT tới mọi thiết bị đã đăng ký (push_subscriptions) của user đó.
// Nhờ chạy phía server nên vẫn hoạt động dù trình duyệt của người dùng đang TẮT HẲN.
// =========================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// Supabase tự động bơm sẵn 2 biến môi trường này cho mọi Edge Function, không cần tự khai báo.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// 3 secret này BẮT BUỘC phải tự set bằng lệnh `supabase secrets set` (xem hướng dẫn triển khai).
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";

const NOTIF_LEAD_MIN = 5; // báo trước 5 phút, khớp với phần polling phía client (calendar.js)

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

function todayDateStr(): string {
    // Giờ Việt Nam (UTC+7) — daily_plans lưu plan_date theo giờ local của người dùng
    const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
    return now.toISOString().slice(0, 10);
}

function nowMinutesVN(): number {
    const now = new Date(Date.now() + 7 * 60 * 60 * 1000);
    return now.getUTCHours() * 60 + now.getUTCMinutes();
}

Deno.serve(async () => {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const todayStr = todayDateStr();
    const nowMin = nowMinutesVN();
    const windowEnd = nowMin + NOTIF_LEAD_MIN;

    // Lấy các việc HÔM NAY, bắt đầu trong khoảng [now, now+5phút], CHƯA được báo
    const { data: plans, error: plansErr } = await supabase
        .from("daily_plans")
        .select("id, user_id, title, start_min, plan_date")
        .eq("plan_date", todayStr)
        .eq("push_notified", false)
        .gte("start_min", nowMin)
        .lte("start_min", windowEnd);

    if (plansErr) {
        return new Response(JSON.stringify({ error: plansErr.message }), { status: 500 });
    }
    if (!plans || plans.length === 0) {
        return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
    }

    let sentCount = 0;
    const notifiedIds: string[] = [];

    for (const plan of plans) {
        const { data: subs } = await supabase
            .from("push_subscriptions")
            .select("id, endpoint, p256dh, auth")
            .eq("user_id", plan.user_id);

        if (!subs || subs.length === 0) { notifiedIds.push(plan.id); continue; }

        const h = String(Math.floor(plan.start_min / 60)).padStart(2, "0");
        const m = String(plan.start_min % 60).padStart(2, "0");
        const minsLeft = plan.start_min - nowMin;
        const body = minsLeft > 0
            ? `Còn ${minsLeft} phút nữa tới giờ — bắt đầu lúc ${h}:${m}`
            : `Đã tới giờ (${h}:${m})`;

        const payload = JSON.stringify({
            title: plan.title || "Việc chưa đặt tên",
            body,
            // Không gửi "url" cứng nữa -> sw.js sẽ tự tính đúng đường dẫn theo scope thực tế lúc
            // chạy (an toàn dù app được deploy ở domain gốc hay dưới 1 subpath như GitHub Pages).
            tag: `planner_${plan.id}`,
        });

        for (const sub of subs) {
            try {
                await webpush.sendNotification(
                    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                    payload
                );
                sentCount++;
            } catch (err) {
                // Subscription hết hạn/bị thu hồi (thường mã lỗi 404/410) -> dọn khỏi DB luôn
                if (err && (err.statusCode === 404 || err.statusCode === 410)) {
                    await supabase.from("push_subscriptions").delete().eq("id", sub.id);
                } else {
                    console.error("[planner-push-cron] Lỗi gửi push:", err);
                }
            }
        }
        notifiedIds.push(plan.id);
    }

    if (notifiedIds.length > 0) {
        await supabase.from("daily_plans").update({ push_notified: true }).in("id", notifiedIds);
    }

    return new Response(JSON.stringify({ sent: sentCount, plans: notifiedIds.length }), { status: 200 });
});