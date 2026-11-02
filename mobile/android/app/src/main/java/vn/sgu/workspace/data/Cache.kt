package vn.sgu.workspace.data

import java.io.File

/**
 * Bản sao dữ liệu để xem OFFLINE: mỗi truy vấn đọc thành công được lưu nguyên JSON vào filesDir/offline/<userId>/.
 * Theo từng tài khoản; đăng xuất thì xoá (clearAll).
 */
class OfflineCache(private val root: File) {
    private fun file(userId: String, key: String) =
        File(File(root, "offline/${userId.filter { it.isLetterOrDigit() || it == '-' }}"), key.replace(Regex("[^A-Za-z0-9_.-]"), "_") + ".json")

    fun put(userId: String, key: String, json: String) {
        try {
            val f = file(userId, key)
            f.parentFile?.mkdirs()
            val tmp = File(f.path + ".tmp")
            tmp.writeText(json)
            tmp.renameTo(f) // ghi nguyên tử: mất điện giữa chừng không để lại file hỏng
        } catch (e: Exception) { /* hết bộ nhớ: bỏ qua, app vẫn chạy online */ }
    }

    fun get(userId: String, key: String): Pair<String, Long>? {
        val f = file(userId, key)
        return if (f.exists()) try { f.readText() to f.lastModified() } catch (e: Exception) { null } else null
    }

    fun clearAll() { File(root, "offline").deleteRecursively() }
}
