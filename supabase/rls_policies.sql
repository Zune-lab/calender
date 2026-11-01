-- Bật Row Level Security cho các bảng dữ liệu người dùng. anon key nằm trong repo (bình thường với Supabase) nên
-- MỌI quyền truy cập thực tế do RLS quyết định. Chạy 1 lần trong SQL Editor; an toàn khi chạy lại.
-- Mỗi người chỉ đọc/ghi được dòng có user_id = auth.uid().
-- (wallpaper_tokens đã có chính sách riêng trong wallpaper_setup.sql; Edge Function dùng service role nên không bị RLS chặn.)

do $$
declare t text;
begin
  foreach t in array array['subjects','exams','subject_details','daily_plans','user_settings','push_subscriptions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own_rows" on public.%I', t);
    execute format(
      'create policy "own_rows" on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;
