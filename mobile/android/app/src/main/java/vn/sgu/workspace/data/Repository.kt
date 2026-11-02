package vn.sgu.workspace.data

import org.json.JSONArray
import org.json.JSONObject
import vn.sgu.workspace.core.Detail
import vn.sgu.workspace.core.Exam
import vn.sgu.workspace.core.Plan
import vn.sgu.workspace.core.Subject
import vn.sgu.workspace.core.mondayOf
import java.time.LocalDate

/** Dữ liệu cho Dashboard / TKB / Lịch thi. `offline` = đang hiển thị bản đã lưu. */
data class Snapshot(
    val subjects: List<Subject>,
    val exams: List<Exam>,
    val details: List<Detail>,
    val semesterStart: LocalDate,
    val offline: Boolean,
    /** epoch ms của lần lưu cũ nhất trong số bản đã dùng (chỉ có nghĩa khi offline) */
    val cachedAt: Long? = null,
)

private fun JSONObject.s(k: String): String = if (isNull(k) || !has(k)) "" else opt(k).toString()
private fun JSONObject.sOrNull(k: String): String? = if (isNull(k) || !has(k)) null else opt(k).toString()

internal fun parseSubjects(json: String): List<Subject> = JSONArray(json).let { a ->
    (0 until a.length()).map { a.getJSONObject(it) }.map { o ->
        Subject(o.s("id"), o.s("name"), o.s("course_code"), o.s("group_id"), o.optInt("day", 0),
            o.s("time_slot"), o.s("room"), o.s("lecturer"), o.s("exact_time"), o.s("weeks"))
    }
}

internal fun parseExams(json: String): List<Exam> = JSONArray(json).let { a ->
    (0 until a.length()).map { a.getJSONObject(it) }.map { o ->
        Exam(o.s("id"), o.s("subject_name"), o.s("course_code"), o.s("exam_date"), o.s("exam_time"), o.s("room"))
    }
}

internal fun parseDetails(json: String): List<Detail> = JSONArray(json).let { a ->
    (0 until a.length()).map { a.getJSONObject(it) }.map { o ->
        Detail(o.s("id"), o.s("subject_id"), o.s("type"), o.s("content"), o.s("status").ifEmpty { "upcoming" },
            o.s("priority").ifEmpty { "normal" }, o.sOrNull("due_date"))
    }
}

internal fun parsePlans(json: String): List<Plan> = JSONArray(json).let { a ->
    (0 until a.length()).map { a.getJSONObject(it) }.map { o ->
        Plan(o.s("id"), o.s("plan_date"), o.s("title"), o.optInt("start_min", 0), o.optInt("end_min", 0),
            o.s("color"), o.s("priority").ifEmpty { "normal" }, o.optBoolean("is_done", false))
    }
}

class Repository(private val api: SupabaseApi, private val cache: OfflineCache) {
    private val uid get() = api.session?.userId ?: throw AuthExpiredException()

    /** Một lần đọc có dự phòng offline: thành công -> lưu bản sao; lỗi mạng -> dùng bản đã lưu (nếu có). */
    private class Read(val json: String, val fromCache: Boolean, val cachedAt: Long?)

    private fun read(key: String, query: String): Read {
        val id = uid
        return try {
            val text = api.rest("GET", query)
            cache.put(id, key, text)
            Read(text, false, null)
        } catch (e: NetworkException) {
            val hit = cache.get(id, key) ?: throw e
            Read(hit.first, true, hit.second)
        }
    }

    fun loadSnapshot(): Snapshot {
        val id = uid
        val subjects = read("subjects", "subjects?select=*&user_id=eq.$id")
        val exams = try { read("exams", "exams?select=*&user_id=eq.$id") } catch (e: NetworkException) { null }
        val details = try { read("details-upcoming", "subject_details?select=*&user_id=eq.$id&status=eq.upcoming") } catch (e: NetworkException) { null }
        val settings = try { read("settings", "user_settings?select=semester_start_date&user_id=eq.$id") } catch (e: NetworkException) { null }

        val start = settings?.let {
            val a = JSONArray(it.json)
            if (a.length() > 0 && !a.getJSONObject(0).isNull("semester_start_date"))
                try { LocalDate.parse(a.getJSONObject(0).getString("semester_start_date").take(10)) } catch (e: Exception) { null } else null
        } ?: mondayOf(LocalDate.now()) // chưa có cài đặt: mặc định Thứ Hai tuần này (giống bản web)

        val used = listOfNotNull(subjects, exams, details, settings)
        val offline = used.any { it.fromCache }
        return Snapshot(
            subjects = parseSubjects(subjects.json),
            exams = exams?.let { parseExams(it.json) } ?: emptyList(),
            details = details?.let { parseDetails(it.json) } ?: emptyList(),
            semesterStart = start,
            offline = offline,
            cachedAt = used.mapNotNull { it.cachedAt }.minOrNull(),
        )
    }

    /** Kế hoạch 1 ngày (cache theo ngày). Trả (danh sách, đang offline?). */
    fun loadPlans(date: LocalDate): Pair<List<Plan>, Boolean> {
        val id = uid
        val r = read("plans:$date", "daily_plans?select=*&user_id=eq.$id&plan_date=eq.$date&order=start_min.asc")
        return parsePlans(r.json) to r.fromCache
    }

    /** Tick/bỏ tick hoàn thành (cần mạng; offline sẽ ném NetworkException để UI báo). */
    fun setPlanDone(planId: String, done: Boolean) {
        val id = uid
        api.rest("PATCH", "daily_plans?id=eq.$planId&user_id=eq.$id", JSONObject().put("is_done", done).toString(), prefer = "return=minimal")
    }

    /** Lưu mốc đầu kỳ học (upsert theo user_id, giống bản web). */
    fun saveSemesterStart(date: LocalDate) {
        val id = uid
        val body = JSONObject().put("user_id", id).put("semester_start_date", date.toString()).toString()
        api.rest("POST", "user_settings?on_conflict=user_id", body, prefer = "resolution=merge-duplicates,return=minimal")
    }

    fun signOut() {
        api.signOut()
        cache.clearAll() // xoá dữ liệu offline của tài khoản khỏi thiết bị
    }
}
