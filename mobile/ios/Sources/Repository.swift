import Foundation

/// Dữ liệu cho Dashboard / TKB / Lịch thi. `offline` = đang hiển thị bản đã lưu.
struct Snapshot {
    var subjects: [Subject]
    var exams: [Exam]
    var details: [Detail]
    var semesterStart: Date
    var offline: Bool
    /// Lần lưu cũ nhất trong số bản đã dùng (chỉ có nghĩa khi offline).
    var cachedAt: Date?
}

final class Repository {
    let api: SupabaseAPI
    private let cache = OfflineCache()
    init(api: SupabaseAPI) { self.api = api }

    private struct Read { let data: Data; let fromCache: Bool; let cachedAt: Date? }

    private func userId() async throws -> String {
        guard let s = await api.session else { throw APIError.authExpired }
        return s.userId
    }

    /// Một lần đọc có dự phòng offline: thành công -> lưu bản sao; lỗi mạng -> dùng bản đã lưu (nếu có).
    private func read(_ key: String, _ query: String) async throws -> Read {
        let id = try await userId()
        do {
            let data = try await api.rest("GET", query)
            cache.put(id, key, data)
            return Read(data: data, fromCache: false, cachedAt: nil)
        } catch APIError.network {
            guard let hit = cache.get(id, key) else { throw APIError.network }
            return Read(data: hit.0, fromCache: true, cachedAt: hit.1)
        }
    }

    func loadSnapshot() async throws -> Snapshot {
        let id = try await userId()
        let subjects = try await read("subjects", "subjects?select=*&user_id=eq.\(id)")
        let exams = try? await read("exams", "exams?select=*&user_id=eq.\(id)")
        let details = try? await read("details-upcoming", "subject_details?select=*&user_id=eq.\(id)&status=eq.upcoming")
        let settings = try? await read("settings", "user_settings?select=semester_start_date&user_id=eq.\(id)")

        let dec = JSONDecoder()
        let rows: [UserSettingsRow] = settings.flatMap { try? dec.decode([UserSettingsRow].self, from: $0.data) } ?? []
        // Chưa có cài đặt: mặc định Thứ Hai tuần này (giống bản web)
        let start = parseISODate(rows.first?.semesterStartDate) ?? mondayOf(Date())

        let used = [subjects] + [exams, details, settings].compactMap { $0 }
        return Snapshot(
            subjects: (try? dec.decode([Subject].self, from: subjects.data)) ?? [],
            exams: exams.flatMap { try? dec.decode([Exam].self, from: $0.data) } ?? [],
            details: details.flatMap { try? dec.decode([Detail].self, from: $0.data) } ?? [],
            semesterStart: start,
            offline: used.contains { $0.fromCache },
            cachedAt: used.compactMap { $0.cachedAt }.min()
        )
    }

    /// Kế hoạch 1 ngày (cache theo ngày). Trả (danh sách, đang offline?).
    func loadPlans(_ date: Date) async throws -> ([Plan], Bool) {
        let id = try await userId()
        let d = isoString(date)
        let r = try await read("plans:\(d)", "daily_plans?select=*&user_id=eq.\(id)&plan_date=eq.\(d)&order=start_min.asc")
        return ((try? JSONDecoder().decode([Plan].self, from: r.data)) ?? [], r.fromCache)
    }

    /// Tick/bỏ tick hoàn thành (cần mạng; offline sẽ ném .network để UI báo).
    func setPlanDone(_ planId: String, done: Bool) async throws {
        let id = try await userId()
        _ = try await api.rest("PATCH", "daily_plans?id=eq.\(planId)&user_id=eq.\(id)", body: ["is_done": done], prefer: "return=minimal")
    }

    /// Lưu mốc đầu kỳ học (upsert theo user_id, giống bản web).
    func saveSemesterStart(_ date: Date) async throws {
        let id = try await userId()
        _ = try await api.rest("POST", "user_settings?on_conflict=user_id",
                               body: ["user_id": id, "semester_start_date": isoString(date)],
                               prefer: "resolution=merge-duplicates,return=minimal")
    }

    func signOut() async {
        await api.signOut()
        cache.clearAll() // xoá dữ liệu offline của tài khoản khỏi thiết bị
    }
}
