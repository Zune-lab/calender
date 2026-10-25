// =========================================================
// SGU WORKSPACE — wallpaper: trả ẢNH PNG màn hình khoá (thẻ tiến độ năm + lưới 5 tuần) luôn
// cập nhật theo dữ liệu hiện tại. Gọi bằng link riêng có token:
//   GET /functions/v1/wallpaper?t=<token>[&w=1170&h=2532][&tz=7][&accent=ff3366][&fmt=svg]
// Dùng với iOS Shortcuts (Automation hằng ngày: "Get Contents of URL" -> "Set Wallpaper") hoặc Tasker.
//
// TRIỂN KHAI (hàm này KHÔNG dùng JWT vì Shortcuts không có phiên đăng nhập — bảo mật bằng token ngẫu
// nhiên 256-bit lưu ở bảng wallpaper_tokens, xem supabase/wallpaper_setup.sql):
//   supabase functions deploy wallpaper --no-verify-jwt
// Không cần secret mới: dùng SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY Supabase tự bơm sẵn.
// =========================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { initWasm, Resvg } from "npm:@resvg/resvg-wasm@2.6.2";
import { buildWallpaperSvg, FONT_FAMILY, gridRange, type WallpaperChip } from "./render.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const WASM_URL = "https://cdn.jsdelivr.net/npm/@resvg/resvg-wasm@2.6.2/index_bg.wasm";
const FONT_URLS = [
    "https://raw.githubusercontent.com/google/fonts/main/ofl/bevietnampro/BeVietnamPro-Regular.ttf",
    "https://raw.githubusercontent.com/google/fonts/main/ofl/bevietnampro/BeVietnamPro-Bold.ttf",
];

// Khởi tạo wasm + tải font 1 lần mỗi cold start (cache ở phạm vi module)
let ready: Promise<Uint8Array[]> | null = null;
function init(): Promise<Uint8Array[]> {
    if (!ready) {
        ready = (async () => {
            await initWasm(fetch(WASM_URL));
            return await Promise.all(FONT_URLS.map(async (u) => {
                const r = await fetch(u);
                if (!r.ok) throw new Error("Không tải được font: " + u);
                return new Uint8Array(await r.arrayBuffer());
            }));
        })();
        ready.catch(() => { ready = null; }); // lỗi mạng tạm thời -> lần gọi sau thử lại
    }
    return ready;
}

const PRIORITY_COLOR: Record<string, string> = { high: "#ff4d4f", normal: "#ffb020", low: "#8b96a5" };
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

Deno.serve(async (req) => {
    const url = new URL(req.url);
    const token = url.searchParams.get("t") || "";
    if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) return notFound();

    const width = clamp(parseInt(url.searchParams.get("w") || "1170", 10) || 1170, 600, 3000);
    const height = clamp(parseInt(url.searchParams.get("h") || "2532", 10) || 2532, 800, 4000);
    const tz = clamp(parseFloat(url.searchParams.get("tz") || "7"), -12, 14);
    const accentParam = (url.searchParams.get("accent") || "").replace("#", "");
    const accent = /^[0-9a-fA-F]{6}$/.test(accentParam) ? "#" + accentParam : undefined;

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: tokRow } = await supabase.from("wallpaper_tokens").select("user_id").eq("token", token).maybeSingle();
    if (!tokRow) return notFound();
    const userId = tokRow.user_id as string;

    // "Hôm nay" theo múi giờ người dùng (mặc định Việt Nam UTC+7)
    const local = new Date(Date.now() + tz * 3600 * 1000);
    const today = local.toISOString().slice(0, 10);
    const { start, end } = gridRange(today, 5);

    const [plansRes, dueRes] = await Promise.all([
        supabase.from("daily_plans").select("title, color, is_done, plan_date, start_min")
            .eq("user_id", userId).gte("plan_date", start).lte("plan_date", end),
        supabase.from("subject_details").select("content, priority, due_date")
            .eq("user_id", userId).eq("status", "upcoming").gte("due_date", start).lte("due_date", end),
    ]);
    if (plansRes.error || dueRes.error) {
        return new Response("Lỗi tải dữ liệu", { status: 502, headers: { "Cache-Control": "no-store" } });
    }

    const items: Record<string, WallpaperChip[]> = {};
    const push = (k: string, c: WallpaperChip) => { (items[k] ??= []).push(c); };
    for (const r of plansRes.data ?? []) {
        push(r.plan_date, { title: r.title || "(không tên)", color: r.color || "#6C9BFF", done: !!r.is_done, sort: r.start_min ?? 0 });
    }
    for (const r of dueRes.data ?? []) {
        push(r.due_date, { title: r.content || "(không tên)", color: PRIORITY_COLOR[r.priority] || PRIORITY_COLOR.normal, done: false, sort: -1 });
    }

    const svg = buildWallpaperSvg({ today, items, width, height, accent });
    const headers = { "Cache-Control": "no-store" };
    if (url.searchParams.get("fmt") === "svg") {
        return new Response(svg, { headers: { ...headers, "Content-Type": "image/svg+xml; charset=utf-8" } });
    }

    try {
        const fonts = await init();
        const png = new Resvg(svg, {
            font: { fontBuffers: fonts, loadSystemFonts: false, defaultFontFamily: FONT_FAMILY },
        }).render().asPng();
        return new Response(png, { headers: { ...headers, "Content-Type": "image/png" } });
    } catch (e) {
        console.error("[wallpaper] Lỗi render PNG:", e);
        return new Response("Lỗi tạo ảnh", { status: 500, headers });
    }
});
