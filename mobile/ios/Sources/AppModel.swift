import Foundation

@MainActor
final class AppModel: ObservableObject {
    @Published var loggedIn = false
    @Published var email = ""
    @Published var loading = false
    @Published var message: String?
    @Published var snapshot: Snapshot?
    @Published var plansDate = gregorian.startOfDay(for: Date())
    @Published var plans: [Plan] = []
    @Published var plansOffline = false

    private let api = SupabaseAPI()
    private lazy var repo = Repository(api: api)

    init() {
        if let s = SessionStore.load() {
            loggedIn = true
            email = s.email
            Task { await refresh() }
        }
    }

    private func handle(_ error: Error) {
        loading = false
        switch error {
        case APIError.authExpired:
            Task { await repo.signOut() } // xoá phiên + bản sao offline khỏi thiết bị
            loggedIn = false; snapshot = nil; plans = []
            message = APIError.authExpired.message
        case APIError.network:
            message = snapshot == nil ? "Chưa có dữ liệu đã lưu. Hãy kết nối mạng để tải lần đầu." : nil
        case let e as APIError:
            message = e.message
        default:
            message = error.localizedDescription
        }
    }

    func login(email: String, password: String) async {
        loading = true; message = nil
        do {
            let s = try await api.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password)
            loggedIn = true; self.email = s.email
            await refresh()
        } catch APIError.network {
            loading = false
            message = "Không có mạng — cần kết nối để đăng nhập lần đầu"
        } catch { handle(error) }
    }

    /// Tải lại dữ liệu chính (có dự phòng offline) + kế hoạch của ngày đang xem.
    func refresh() async {
        loading = true; message = nil
        do {
            snapshot = try await repo.loadSnapshot()
            loading = false
            await loadPlans(plansDate)
        } catch { handle(error) }
    }

    func loadPlans(_ date: Date) async {
        plansDate = date
        do {
            let (list, off) = try await repo.loadPlans(date)
            if plansDate == date { plans = list; plansOffline = off }
        } catch APIError.network {
            plans = []; plansOffline = true
        } catch { handle(error) }
    }

    func togglePlan(_ plan: Plan) async {
        do {
            try await repo.setPlanDone(plan.id, done: !plan.isDone)
            await loadPlans(plansDate)
        } catch APIError.network {
            message = "Đang offline — chỉ xem được, chưa thể đánh dấu hoàn thành"
        } catch { handle(error) }
    }

    func saveSemesterStart(_ date: Date) async {
        do {
            try await repo.saveSemesterStart(date)
            await refresh()
        } catch APIError.network {
            message = "Đang offline — chưa thể đổi mốc học kỳ"
        } catch { handle(error) }
    }

    func logout() async {
        await repo.signOut()
        loggedIn = false; snapshot = nil; plans = []; email = ""
    }
}
