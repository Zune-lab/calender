package vn.sgu.workspace.data

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Lỗi mạng (mất mạng / timeout / máy chủ 5xx) -> Repository sẽ rơi về bản offline. */
class NetworkException(message: String, cause: Throwable? = null) : Exception(message, cause)

/** Phiên hết hạn thật (refresh token bị từ chối) -> phải đăng nhập lại. */
class AuthExpiredException : Exception("Phiên đăng nhập đã hết hạn")

/** Lỗi nghiệp vụ (sai mật khẩu, 4xx...). */
class ApiException(val status: Int, message: String) : Exception(message)

/**
 * Client Supabase gọi thẳng REST (GoTrue + PostgREST) bằng OkHttp — không phụ thuộc SDK để hành vi offline/refresh
 * hoàn toàn nằm trong tầm kiểm soát. Gọi từ luồng nền (Dispatchers.IO).
 */
class SupabaseApi(private val store: SessionStore) {
    private val http = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).writeTimeout(15, TimeUnit.SECONDS).build()
    private val json = "application/json".toMediaType()

    @Volatile var session: UserSession? = store.load()
        private set

    private fun base(path: String) = Config.SUPABASE_URL + path

    private fun execute(req: Request): Pair<Int, String> {
        try {
            http.newCall(req).execute().use { r -> return r.code to (r.body?.string() ?: "") }
        } catch (e: IOException) {
            throw NetworkException("Không có kết nối mạng", e)
        }
    }

    private fun parseSession(body: String): UserSession {
        val o = JSONObject(body)
        val u = o.getJSONObject("user")
        val s = UserSession(
            userId = u.getString("id"),
            email = if (u.isNull("email")) "" else u.optString("email"),
            accessToken = o.getString("access_token"),
            refreshToken = o.getString("refresh_token"),
            expiresAt = System.currentTimeMillis() / 1000 + o.optLong("expires_in", 3600),
        )
        store.save(s); session = s
        return s
    }

    fun signIn(email: String, password: String): UserSession {
        val body = JSONObject().put("email", email).put("password", password).toString().toRequestBody(json)
        val (code, text) = execute(Request.Builder().url(base("/auth/v1/token?grant_type=password"))
            .header("apikey", Config.SUPABASE_KEY).post(body).build())
        if (code in 200..299) return parseSession(text)
        val msg = try { JSONObject(text).optString("error_description", JSONObject(text).optString("msg", "Đăng nhập thất bại")) } catch (e: Exception) { "Đăng nhập thất bại" }
        throw ApiException(code, if (code == 400) "Sai email hoặc mật khẩu" else msg)
    }

    /** Làm mới token. Mạng lỗi -> NetworkException (giữ phiên để dùng offline); bị từ chối -> AuthExpiredException. */
    @Synchronized fun refresh(): UserSession {
        val cur = session ?: throw AuthExpiredException()
        val body = JSONObject().put("refresh_token", cur.refreshToken).toString().toRequestBody(json)
        val (code, text) = execute(Request.Builder().url(base("/auth/v1/token?grant_type=refresh_token"))
            .header("apikey", Config.SUPABASE_KEY).post(body).build())
        return when {
            code in 200..299 -> parseSession(text)
            code in 400..499 -> { signOutLocal(); throw AuthExpiredException() }
            else -> throw NetworkException("Máy chủ tạm thời gián đoạn ($code)")
        }
    }

    fun signOutLocal() { store.clear(); session = null }

    fun signOut() {
        val s = session
        signOutLocal()
        if (s != null) try {
            execute(Request.Builder().url(base("/auth/v1/logout")).header("apikey", Config.SUPABASE_KEY)
                .header("Authorization", "Bearer ${s.accessToken}").post("{}".toRequestBody(json)).build())
        } catch (e: Exception) { /* offline: bỏ qua, phiên cục bộ đã xoá */ }
    }

    private fun ensureFresh(): UserSession {
        val s = session ?: throw AuthExpiredException()
        return if (s.expiresAt - 60 < System.currentTimeMillis() / 1000) refresh() else s
    }

    /** Gọi PostgREST. Tự làm mới token khi 401. method: GET/PATCH/POST/DELETE. Trả về chuỗi JSON. */
    fun rest(method: String, pathAndQuery: String, body: String? = null, prefer: String? = null): String {
        var s = ensureFresh()
        repeat(2) { attempt ->
            val b = Request.Builder().url(base("/rest/v1/$pathAndQuery"))
                .header("apikey", Config.SUPABASE_KEY).header("Authorization", "Bearer ${s.accessToken}")
                .header("Accept", "application/json")
            if (prefer != null) b.header("Prefer", prefer)
            b.method(method, body?.toRequestBody(json) ?: if (method == "GET") null else "".toRequestBody(json))
            val (code, text) = execute(b.build())
            when {
                code in 200..299 -> return text
                code == 401 && attempt == 0 -> { s = refresh(); return@repeat }
                code >= 500 -> throw NetworkException("Máy chủ tạm thời gián đoạn ($code)")
                else -> throw ApiException(code, text.take(200))
            }
        }
        throw ApiException(401, "Không xác thực được")
    }
}
