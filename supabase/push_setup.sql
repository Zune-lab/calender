-- =========================================================
-- THIẾT LẬP THÔNG BÁO PUSH CHẠY NỀN (không cần mở app)
-- Chạy 1 lần trong Supabase > SQL Editor (an toàn khi chạy lại). Thứ tự làm:
--   1) Chạy file này.
--   2) Deploy function:   supabase functions deploy planner-push-cron
--   3) Đặt secret (email THẬT — iPhone/Apple từ chối subject giả):
--        supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:email-that@cua-ban.com
--   4) Trên iPhone: Safari > Chia sẻ > "Thêm vào Màn hình chính", mở app TỪ ICON đó, vào Cài đặt > bật Thông báo, bấm "Gửi thử".
-- =========================================================

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Thiết bị nhận push (mỗi thiết bị/trình duyệt 1 dòng)
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

-- Cờ chống báo lặp cho việc trong Kế Hoạch Ngày: báo trước + chuông đúng giờ (2 mốc riêng)
alter table public.daily_plans add column if not exists push_notified       boolean not null default false;
alter table public.daily_plans add column if not exists push_alarm_notified boolean not null default false;

-- Số phút báo trước người dùng chọn ở Cài đặt (trước đây chỉ lưu trên máy nên server không biết, luôn báo 5 phút)
alter table public.user_settings add column if not exists notif_lead_min integer;

-- Nhật ký đã báo HẠN (chống báo lặp). Chỉ Edge Function (service role) ghi/đọc nên bật RLS và KHÔNG tạo policy nào.
create table if not exists public.push_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  key     text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.push_log enable row level security;

-- RLS cho bảng thiết bị (chỉ thấy/sửa thiết bị của mình)
alter table public.push_subscriptions enable row level security;
drop policy if exists "own_rows" on public.push_subscriptions;
create policy "own_rows" on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Lịch chạy: MỖI PHÚT gọi Edge Function. (anon key là public, đủ để qua kiểm tra JWT của Edge Function.)
select cron.unschedule(jobid) from cron.job where jobname = 'planner-push-cron';
select cron.schedule('planner-push-cron', '* * * * *', $$
  select net.http_post(
    url     := 'https://sbefenwjwqoloeyvelmq.supabase.co/functions/v1/planner-push-cron',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNiZWZlbndqd3FvbG9leXZlbG1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0MjI5NDgsImV4cCI6MjEwNTk5ODk0OH0.Fqo5APCtMm_1KIx34QGhcmp1KzMNMmiEh21S6diTOco'),
    body    := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
$$);

-- KIỂM TRA SAU KHI CHẠY (bỏ comment để xem):
--   select * from cron.job where jobname = 'planner-push-cron';                       -- job có tồn tại, active = true
--   select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
--   select status_code, content from net._http_response order by created desc limit 5; -- 200 = function chạy OK; 401/404 = sai URL/chưa deploy
--   select count(*) from public.push_subscriptions;                                   -- > 0 sau khi bật thông báo trên máy
