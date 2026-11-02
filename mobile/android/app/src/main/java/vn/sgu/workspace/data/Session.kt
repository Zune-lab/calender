package vn.sgu.workspace.data

import android.content.Context

/** Phiên đăng nhập lưu trong bộ nhớ riêng của app (sandbox, các app khác không đọc được). */
data class UserSession(
    val userId: String,
    val email: String,
    val accessToken: String,
    val refreshToken: String,
    /** epoch giây */
    val expiresAt: Long,
)

class SessionStore(context: Context) {
    private val prefs = context.getSharedPreferences("sgu_session", Context.MODE_PRIVATE)

    fun load(): UserSession? {
        val id = prefs.getString("userId", null) ?: return null
        return UserSession(
            userId = id,
            email = prefs.getString("email", "") ?: "",
            accessToken = prefs.getString("access", "") ?: "",
            refreshToken = prefs.getString("refresh", "") ?: "",
            expiresAt = prefs.getLong("expiresAt", 0L),
        )
    }

    fun save(s: UserSession) {
        prefs.edit().putString("userId", s.userId).putString("email", s.email)
            .putString("access", s.accessToken).putString("refresh", s.refreshToken)
            .putLong("expiresAt", s.expiresAt).apply()
    }

    fun clear() { prefs.edit().clear().apply() }
}
