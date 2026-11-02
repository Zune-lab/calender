import Foundation
import Security

struct UserSession: Codable, Equatable {
    var userId: String
    var email: String
    var accessToken: String
    var refreshToken: String
    /// epoch giây
    var expiresAt: TimeInterval
}

/// Phiên đăng nhập lưu trong Keychain (mã hoá bởi hệ điều hành, không đọc được từ app khác).
enum SessionStore {
    private static let service = "vn.sgu.workspace"
    private static let account = "session"

    private static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    static func load() -> UserSession? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return try? JSONDecoder().decode(UserSession.self, from: data)
    }

    static func save(_ s: UserSession) {
        guard let data = try? JSONEncoder().encode(s) else { return }
        SecItemDelete(query as CFDictionary)
        var q = query
        q[kSecValueData as String] = data
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(q as CFDictionary, nil)
    }

    static func clear() { SecItemDelete(query as CFDictionary) }
}

/// Bản sao dữ liệu để xem OFFLINE: mỗi truy vấn đọc thành công được lưu nguyên JSON theo từng tài khoản
/// (Application Support, loại khỏi iCloud backup). Đăng xuất thì xoá (clearAll).
final class OfflineCache {
    private let root: URL

    init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        root = base.appendingPathComponent("offline", isDirectory: true)
    }

    private func fileURL(_ userId: String, _ key: String) -> URL {
        let safeUser = userId.filter { $0.isLetter || $0.isNumber || $0 == "-" }
        let safeKey = String(key.map { ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" || $0 == ".") ? $0 : "_" })
        return root.appendingPathComponent(safeUser, isDirectory: true).appendingPathComponent(safeKey + ".json")
    }

    func put(_ userId: String, _ key: String, _ data: Data) {
        var url = fileURL(userId, key)
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        if (try? data.write(to: url, options: .atomic)) != nil {
            var rv = URLResourceValues(); rv.isExcludedFromBackup = true
            try? url.setResourceValues(rv)
        }
    }

    func get(_ userId: String, _ key: String) -> (Data, Date)? {
        let url = fileURL(userId, key)
        guard let data = try? Data(contentsOf: url) else { return nil }
        let date = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? Date()
        return (data, date)
    }

    func clearAll() { try? FileManager.default.removeItem(at: root) }
}
