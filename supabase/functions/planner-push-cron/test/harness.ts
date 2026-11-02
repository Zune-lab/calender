// Chạy: cd supabase/functions/planner-push-cron/test && deno run -A --import-map import_map.json harness.ts  (Supabase + web-push giả lập, đồng hồ cố định giờ VN)
import { DB, sentLog } from "./fake_supabase.ts";
Deno.env.set("SUPABASE_URL", "http://x"); Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "k");
Deno.env.set("VAPID_PUBLIC_KEY", "p"); Deno.env.set("VAPID_PRIVATE_KEY", "q");
let fixed = 0; const realNow = Date.now; Date.now = () => fixed;
const vn = (h: number, m: number) => { fixed = Date.UTC(2026, 10, 2, h - 7, m); };   // 02/11/2026 giờ VN
let handler: (r: Request) => Promise<Response>;
(Deno as any).serve = (h: any) => { handler = h; return {}; };
await import("../index.ts");
const call = async (body: any = {}, jwt?: string) => (await handler(new Request("http://x", { method: "POST", headers: jwt ? { Authorization: "Bearer " + jwt } : {}, body: JSON.stringify(body) }))).json();
let fails = 0; const ok = (c: boolean, m: string) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
const all: any[] = []; const take = () => { const s = sentLog.splice(0); all.push(...s); return s; };

DB.push_subscriptions = [{ id: "s1", user_id: "u1", endpoint: "https://push/ok", p256dh: "a", auth: "b" }];
DB.user_settings = [{ user_id: "u1", notif_lead_min: 15 }];
DB.daily_plans = [
  { id: "p1", user_id: "u1", title: "Học bài", start_min: 480, plan_date: "2026-11-02", is_done: false, push_notified: false, push_alarm_notified: false, priority: "normal" },
  { id: "p2", user_id: "u1", title: "Đã xong", start_min: 481, plan_date: "2026-11-02", is_done: true, push_notified: false, push_alarm_notified: false, priority: "normal" },
  { id: "p3", user_id: "u1", title: "Ngày mai sớm", start_min: 5, plan_date: "2026-11-03", is_done: false, push_notified: false, push_alarm_notified: false, priority: "high" },
  { id: "p4", user_id: "u1", title: "Tuần sau", start_min: 600, plan_date: "2026-11-05", is_done: false, push_notified: false, push_alarm_notified: false, priority: "normal" },
];
DB.subject_details = [
  { id: "d1", user_id: "u1", type: "task", content: "Nộp báo cáo", priority: "high", due_date: "2026-11-04", status: "upcoming" },
  { id: "d2", user_id: "u1", type: "note", content: "Xa quá", priority: "low", due_date: "2026-11-09", status: "upcoming" },
  { id: "d3", user_id: "u1", type: "task", content: "Hạn hôm nay", priority: "normal", due_date: "2026-11-02", status: "upcoming" },
];
DB.push_log = [];

vn(7, 40); await call(); let s = take();
ok(s.filter((x) => x.tag.startsWith('planner_') || x.tag.startsWith('alarm_')).length === 0, "07:40 (còn 20' > lead 15') chưa báo việc kế hoạch");
vn(7, 46); await call(); s = take();
ok(s.some((x) => x.tag === "planner_p1" && x.body.includes("Còn 14 phút")), "07:46 báo trước theo lead 15' của user (không phải 5')");
ok(!s.some((x) => x.tag.includes("p2")), "việc đã xong không bị báo");
vn(7, 47); await call(); ok(take().filter((x) => x.tag === "planner_p1").length === 0, "07:47 không báo lặp");
vn(8, 1); await call(); s = take();
ok(s.some((x) => x.tag === "alarm_2026-11-02_p1" && x.title.startsWith("⏰")), "08:01 chuông đúng giờ (trễ 1' vẫn trong 5')");
vn(8, 2); await call(); ok(take().filter((x) => x.tag.startsWith("alarm_")).length === 0, "chuông không lặp");
// báo hạn đã chạy từ 07:40 (khung ban ngày, mỗi 5') -> kiểm tra trên toàn bộ log
vn(9, 0); await call(); take();
const tags = all.map((x) => x.tag);
ok(tags.includes("detail_2026-11-04_d1_lead"), "báo hạn việc ưu tiên cao còn 2 ngày");
ok(tags.includes("detail_2026-11-02_d3_due"), "báo việc hạn hôm nay (due)");
ok(!tags.some((t) => t.includes("d2")), "việc low còn 7 ngày (>3) chưa báo");
ok(tags.includes("plan_2026-11-03_p3_lead"), "việc kế hoạch ngày mai (high) báo hạn");
ok(tags.includes("plan_2026-11-05_p4_lead"), "việc kế hoạch 3 ngày tới (normal=5) báo hạn");
ok(tags.filter((t) => t === "detail_2026-11-04_d1_lead").length === 1, "mỗi mốc hạn chỉ gửi đúng 1 lần dù cron chạy nhiều lần");
vn(9, 5); await call(); ok(take().filter((x) => x.tag.startsWith("detail_") || x.tag.startsWith("plan_")).length === 0, "09:05 không báo hạn lặp");
vn(9, 1); await call(); take();
vn(23, 0); DB.push_log = []; await call(); ok(take().filter((x) => x.tag.startsWith("detail_")).length === 0, "23:00 không báo hạn ban đêm");
// qua nửa đêm: 23:57 thấy việc 00:05 ngày mai (lead 15)
vn(23, 50); await call(); s = take();
ok(s.some((x) => x.tag === "planner_p3" && x.body.includes("Còn 15 phút")), "23:50 báo việc 00:05 ngày mai (qua nửa đêm)");
// subscription chết bị dọn
DB.push_subscriptions.push({ id: "s2", user_id: "u1", endpoint: "https://push/dead", p256dh: "a", auth: "b" });
DB.daily_plans.push({ id: "p5", user_id: "u1", title: "X", start_min: 1435, plan_date: "2026-11-02", is_done: false, push_notified: false, push_alarm_notified: false, priority: "normal" });
vn(23, 45); await call(); take();
ok(!DB.push_subscriptions.some((x) => x.id === "s2"), "subscription 410 bị xoá khỏi DB");
// test mode
let r = await call({ test: true }, "user-jwt");
ok(r.ok === true && r.delivered === 1, "gửi thử cho đúng người gọi");
ok((await call({ test: true }, "bad")).reason === "not_signed_in", "gửi thử không JWT hợp lệ bị từ chối");
ok(take().every((x) => x.tag === "sgu-test"), "chỉ gửi tag sgu-test");
console.log(fails ? `${fails} FAILED` : "ALL PASSED"); Deno.exit(fails ? 1 : 0);
