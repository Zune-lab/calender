// =========================================================
// SGU WORKSPACE — vẽ ảnh nền MÀN HÌNH KHOÁ (SVG) từ dữ liệu Kế Hoạch.
// Hàm thuần (không phụ thuộc Deno/DOM) để vừa chạy trong Edge Function vừa test được bằng Node.
// Bố cục: nửa trên để TRỐNG cho đồng hồ/widget của hệ điều hành; thẻ tiến độ năm + lưới 5 tuần
// (mỗi ngày tối đa 3 chip) nằm ở nửa dưới, chừa đáy cho nút đèn pin/camera.
// =========================================================

export interface WallpaperChip { title: string; color: string; done: boolean; sort: number }
export interface WallpaperInput {
    today: string;                       // 'YYYY-MM-DD' theo múi giờ người dùng
    items: Record<string, WallpaperChip[]>; // key 'YYYY-MM-DD'
    width?: number; height?: number;
    weeks?: number;                      // số tuần hiển thị (mặc định 5)
    accent?: string;                     // màu nhấn '#RRGGBB'
}

const MONTHS_VN = ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'];
const DOW = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
export const FONT_FAMILY = 'Be Vietnam Pro';

const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const safeColor = (c: string, fb: string) => /^#[0-9a-fA-F]{6}$/.test(c || '') ? c : fb;
const utc = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fmt = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const clip = (t: string, max: number) => { const a = Array.from(String(t || '').trim()); return a.length > max ? a.slice(0, max - 1).join('') + '…' : a.join(''); };

// Thứ Hai của tuần chứa ngày `s`
export function mondayOf(s: string): string {
    const d = utc(s); const dow = (d.getUTCDay() + 6) % 7; // T2=0
    return fmt(addDays(d, -dow));
}

export function gridRange(today: string, weeks = 5): { start: string; end: string } {
    const start = mondayOf(today);
    return { start, end: fmt(addDays(utc(start), weeks * 7 - 1)) };
}

export function buildWallpaperSvg(input: WallpaperInput): string {
    const W = input.width || 1170;
    const H = input.height || 2532;
    const weeks = input.weeks || 5;
    const accent = safeColor(input.accent || '', '#FF3366');
    const today = utc(input.today);
    const y = today.getUTCFullYear();

    // --- tiến độ năm ---
    const startY = Date.UTC(y, 0, 1), startNext = Date.UTC(y + 1, 0, 1);
    const totalDays = Math.round((startNext - startY) / 86400000);
    const dayOfYear = Math.floor((today.getTime() - startY) / 86400000) + 1;
    const pct = Math.round((dayOfYear / totalDays) * 100);
    const left = totalDays - dayOfYear;

    const pad = Math.round(W * 0.052);
    const cardW = W - pad * 2;
    // khối nội dung neo ở ~38% chiều cao, chừa ~9% đáy
    const top = Math.round(H * 0.385);
    const bottomLimit = Math.round(H * 0.905);

    const out: string[] = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT_FAMILY}">`);
    out.push(`<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="#141a2b"/><stop offset="0.55" stop-color="#0b0f1a"/><stop offset="1" stop-color="#07090f"/></linearGradient>
<radialGradient id="glow" cx="0.2" cy="0.1" r="0.8"><stop offset="0" stop-color="${accent}" stop-opacity="0.38"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
<linearGradient id="bar" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${accent}"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.85"/></linearGradient>
</defs>`);
    out.push(`<rect width="${W}" height="${H}" fill="url(#bg)"/><rect width="${W}" height="${H}" fill="url(#glow)"/>`);

    // --- thẻ năm ---
    const yearH = Math.round(W * 0.2);
    out.push(`<rect x="${pad}" y="${top}" width="${cardW}" height="${yearH}" rx="44" fill="#ffffff" fill-opacity="0.09" stroke="#ffffff" stroke-opacity="0.14" stroke-width="2"/>`);
    out.push(`<text x="${pad + 44}" y="${top + 92}" font-size="68" font-weight="700" fill="#fff">${y}</text>`);
    out.push(`<text x="${pad + cardW - 44}" y="${top + 92}" font-size="68" font-weight="700" fill="${accent}" text-anchor="end">${pct}%</text>`);
    const barX = pad + 44, barW = cardW - 88, barY = top + 122;
    out.push(`<rect x="${barX}" y="${barY}" width="${barW}" height="14" rx="7" fill="#ffffff" fill-opacity="0.16"/>`);
    out.push(`<rect x="${barX}" y="${barY}" width="${Math.max(14, Math.round(barW * pct / 100))}" height="14" rx="7" fill="url(#bar)"/>`);
    out.push(`<text x="${barX}" y="${top + yearH - 26}" font-size="27" fill="#fff" fill-opacity="0.6">${pct}% năm đã trôi qua</text>`);
    out.push(`<text x="${barX + barW}" y="${top + yearH - 26}" font-size="27" fill="#fff" fill-opacity="0.6" text-anchor="end">còn ${left} ngày</text>`);

    // --- lưới tuần ---
    const gridTop = top + yearH + 34;
    const gridH = bottomLimit - gridTop;
    out.push(`<rect x="${pad}" y="${gridTop}" width="${cardW}" height="${gridH}" rx="44" fill="#ffffff" fill-opacity="0.07" stroke="#ffffff" stroke-opacity="0.12" stroke-width="2"/>`);

    const gx = pad + 18, gw = cardW - 36, colW = gw / 7;
    const start = utc(mondayOf(input.today));
    const mA = MONTHS_VN[start.getUTCMonth()], endD = addDays(start, weeks * 7 - 1), mB = MONTHS_VN[endD.getUTCMonth()];
    out.push(`<text x="${pad + 34}" y="${gridTop + 62}" font-size="34" font-weight="700" fill="#fff">${esc(mA === mB ? mA : mA + ' – ' + mB)}</text>`);
    DOW.forEach((n, i) => out.push(`<text x="${gx + colW * i + colW / 2}" y="${gridTop + 118}" font-size="24" fill="#fff" fill-opacity="0.5" text-anchor="middle">${n}</text>`));

    const rowsTop = gridTop + 138;
    const rowH = (gridH - 138 - 16) / weeks;
    const chipFont = Math.max(17, Math.min(23, Math.round(colW * 0.145)));
    const maxChars = Math.max(5, Math.floor((colW - 30) / (chipFont * 0.58)));
    const chipH = Math.max(26, Math.min(34, Math.round((rowH - 62) / 3)));

    for (let w = 0; w < weeks; w++) {
        const ry = rowsTop + rowH * w;
        if (w > 0) out.push(`<line x1="${gx + 8}" y1="${ry}" x2="${gx + gw - 8}" y2="${ry}" stroke="#fff" stroke-opacity="0.08" stroke-width="2"/>`);
        for (let i = 0; i < 7; i++) {
            const d = addDays(start, w * 7 + i), key = fmt(d);
            const cx = gx + colW * i, mid = cx + colW / 2;
            const isToday = key === input.today;
            const label = (d.getUTCDate() === 1 || (w === 0 && i === 0)) ? `${d.getUTCDate()}/${d.getUTCMonth() + 1}` : String(d.getUTCDate());
            if (isToday) out.push(`<circle cx="${mid}" cy="${ry + 34}" r="26" fill="${accent}"/>`);
            out.push(`<text x="${mid}" y="${ry + 44}" font-size="${label.length > 2 ? 24 : 29}" font-weight="${isToday ? 700 : 400}" fill="#fff" fill-opacity="${isToday ? 1 : (key < input.today ? 0.45 : 0.9)}" text-anchor="middle">${label}</text>`);
            const list = (input.items[key] || []).slice().sort((a, b) => (Number(a.done) - Number(b.done)) || (a.sort - b.sort));
            const shown = list.slice(0, 3), extra = list.length - shown.length;
            shown.forEach((c, k) => {
                const cy = ry + 68 + k * (chipH + 5);
                const col = safeColor(c.color, accent);
                out.push(`<rect x="${cx + 7}" y="${cy}" width="${colW - 14}" height="${chipH}" rx="9" fill="${col}" fill-opacity="${c.done ? 0.1 : 0.22}"/>`);
                out.push(`<rect x="${cx + 7}" y="${cy + 4}" width="5" height="${chipH - 8}" rx="2.5" fill="${col}" fill-opacity="${c.done ? 0.45 : 1}"/>`);
                out.push(`<text x="${cx + 19}" y="${cy + chipH / 2 + chipFont * 0.35}" font-size="${chipFont}" fill="#fff" fill-opacity="${c.done ? 0.4 : 0.95}">${esc(clip(c.title, maxChars))}</text>`);
            });
            // "+N" đặt cạnh số ngày (đặt dưới chip thì đè lên đường kẻ hàng kế tiếp)
            if (extra > 0) out.push(`<text x="${cx + colW - 12}" y="${ry + 40}" font-size="21" font-weight="700" fill="${accent}" text-anchor="end">+${extra}</text>`);
        }
    }
    out.push('</svg>');
    return out.join('\n');
}
