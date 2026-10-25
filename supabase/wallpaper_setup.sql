-- =========================================================
-- Ảnh nền màn hình khoá — bảng lưu token riêng của từng người dùng.
-- Chạy 1 lần trong Supabase SQL Editor, sau đó deploy:
--   supabase functions deploy wallpaper --no-verify-jwt
-- Token là bí mật (ai có link là xem được thẻ năm + lịch của bạn): app cho phép Tạo lại để thu hồi link cũ.
-- =========================================================
create table if not exists public.wallpaper_tokens (
    user_id    uuid primary key references auth.users(id) on delete cascade,
    token      text not null unique check (token ~ '^[A-Za-z0-9_-]{32,64}$'),
    created_at timestamptz not null default now()
);

alter table public.wallpaper_tokens enable row level security;

-- Mỗi người chỉ đọc/tạo/đổi/xoá token CỦA MÌNH (Edge Function dùng service role nên không cần policy riêng)
drop policy if exists "wallpaper_tokens_own" on public.wallpaper_tokens;
create policy "wallpaper_tokens_own" on public.wallpaper_tokens
    for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
