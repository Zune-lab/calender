package vn.sgu.workspace.data

/** Cấu hình Supabase — CÙNG project với bản web (supabase-config.js). anon key là public; bảo mật do RLS (xem supabase/rls_policies.sql). */
object Config {
    const val SUPABASE_URL = "https://sbefenwjwqoloeyvelmq.supabase.co"
    const val SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNiZWZlbndqd3FvbG9leXZlbG1xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0MjI5NDgsImV4cCI6MjEwNTk5ODk0OH0.Fqo5APCtMm_1KIx34QGhcmp1KzMNMmiEh21S6diTOco"
}
