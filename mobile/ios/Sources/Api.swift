import Foundation

enum APIError: Error {
    /// Mất mạng / timeout / máy chủ 5xx -> Repository rơi về bản offline.
    case network
    /// Refresh token bị từ chối -> phải đăng nhập lại.
    case authExpired
    case http(Int, String)

    var message: String {
        switch self {
        case .network: return "Không có kết nối mạng"
        case .authExpired: return "Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại"
        case .http(_, let m): return m
        }
    }
}

/// Client Supabase gọi thẳng REST (GoTrue + PostgREST) bằng URLSession — không phụ thuộc SDK để hành vi offline/refresh
/// nằm hoàn toàn trong tầm kiểm soát. `actor` để việc làm mới token không bị chạy song song.
actor SupabaseAPI {
    private(set) var session: UserSession? = SessionStore.load()
    private let urlSession: URLSession = {
        let c = URLSessionConfiguration.default
        c.timeoutIntervalForRequest = 15
        c.waitsForConnectivity = false // offline thì báo lỗi ngay để dùng cache, không treo chờ mạng
        return URLSession(configuration: c)
    }()

    private func send(_ req: URLRequest) async throws -> (Int, Data) {
        do {
            let (data, resp) = try await urlSession.data(for: req)
            return ((resp as? HTTPURLResponse)?.statusCode ?? 0, data)
        } catch is URLError {
            throw APIError.network
        }
    }

    private func authRequest(_ path: String, _ body: [String: Any]) throws -> URLRequest {
        var r = URLRequest(url: URL(string: Config.supabaseURL + path)!)
        r.httpMethod = "POST"
        r.setValue(Config.supabaseKey, forHTTPHeaderField: "apikey")
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = try JSONSerialization.data(withJSONObject: body)
        return r
    }

    private func parseSession(_ data: Data) throws -> UserSession {
        guard let o = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let at = o["access_token"] as? String, let rt = o["refresh_token"] as? String,
              let u = o["user"] as? [String: Any], let id = u["id"] as? String else { throw APIError.http(0, "Phản hồi đăng nhập không hợp lệ") }
        let expiresIn = (o["expires_in"] as? Double) ?? 3600
        let s = UserSession(userId: id, email: (u["email"] as? String) ?? "", accessToken: at, refreshToken: rt,
                            expiresAt: Date().timeIntervalSince1970 + expiresIn)
        SessionStore.save(s); session = s
        return s
    }

    func signIn(email: String, password: String) async throws -> UserSession {
        let (code, data) = try await send(try authRequest("/auth/v1/token?grant_type=password", ["email": email, "password": password]))
        if (200..<300).contains(code) { return try parseSession(data) }
        throw APIError.http(code, code == 400 ? "Sai email hoặc mật khẩu" : "Đăng nhập thất bại")
    }

    /// Mạng lỗi -> .network (giữ phiên để dùng offline); bị từ chối -> .authExpired.
    func refresh() async throws -> UserSession {
        guard let cur = session else { throw APIError.authExpired }
        let (code, data) = try await send(try authRequest("/auth/v1/token?grant_type=refresh_token", ["refresh_token": cur.refreshToken]))
        switch code {
        case 200..<300: return try parseSession(data)
        case 400..<500: signOutLocal(); throw APIError.authExpired
        default: throw APIError.network
        }
    }

    func signOutLocal() { SessionStore.clear(); session = nil }

    func signOut() async {
        let s = session
        signOutLocal()
        guard let s else { return }
        if var r = try? authRequest("/auth/v1/logout", [:]) {
            r.setValue("Bearer \(s.accessToken)", forHTTPHeaderField: "Authorization")
            _ = try? await send(r) // offline: bỏ qua, phiên cục bộ đã xoá
        }
    }

    private func ensureFresh() async throws -> UserSession {
        guard let s = session else { throw APIError.authExpired }
        return s.expiresAt - 60 < Date().timeIntervalSince1970 ? try await refresh() : s
    }

    /// Gọi PostgREST. Tự làm mới token khi 401. method: GET/PATCH/POST/DELETE.
    func rest(_ method: String, _ pathAndQuery: String, body: [String: Any]? = nil, prefer: String? = nil) async throws -> Data {
        var s = try await ensureFresh()
        for attempt in 0..<2 {
            var r = URLRequest(url: URL(string: Config.supabaseURL + "/rest/v1/" + pathAndQuery)!)
            r.httpMethod = method
            r.setValue(Config.supabaseKey, forHTTPHeaderField: "apikey")
            r.setValue("Bearer \(s.accessToken)", forHTTPHeaderField: "Authorization")
            r.setValue("application/json", forHTTPHeaderField: "Accept")
            if let prefer { r.setValue(prefer, forHTTPHeaderField: "Prefer") }
            if let body {
                r.setValue("application/json", forHTTPHeaderField: "Content-Type")
                r.httpBody = try JSONSerialization.data(withJSONObject: body)
            }
            let (code, data) = try await send(r)
            if (200..<300).contains(code) { return data }
            if code == 401 && attempt == 0 { s = try await refresh(); continue }
            if code >= 500 { throw APIError.network }
            throw APIError.http(code, String(data: data.prefix(200), encoding: .utf8) ?? "")
        }
        throw APIError.http(401, "Không xác thực được")
    }
}
