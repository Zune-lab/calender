package vn.sgu.workspace.core

/** Mô hình dữ liệu — khớp các bảng Supabase của bản web (subjects, exams, subject_details, daily_plans). */
data class Subject(
    val id: String,
    val name: String,
    val courseCode: String = "",
    val groupId: String = "",
    /** Quy ước web: Thứ 2 = 2 ... Thứ 7 = 7, Chủ nhật = 8. */
    val day: Int,
    val timeSlot: String = "",
    val room: String = "",
    val lecturer: String = "",
    val exactTime: String = "",
    /** Mỗi ký tự = 1 tuần của học kỳ; '-' hoặc ' ' = không học. Rỗng = học mọi tuần. */
    val weeks: String = "",
)

data class Exam(
    val id: String,
    val subjectName: String,
    val courseCode: String = "",
    val examDate: String = "",
    val examTime: String = "",
    val room: String = "",
)

data class Detail(
    val id: String,
    val subjectId: String,
    /** "task" | "note" | "notification" */
    val type: String,
    val content: String,
    val status: String = "upcoming",
    val priority: String = "normal",
    /** yyyy-MM-dd hoặc null */
    val dueDate: String? = null,
)

data class Plan(
    val id: String,
    val planDate: String,
    val title: String,
    val startMin: Int,
    val endMin: Int,
    val color: String = "",
    val priority: String = "normal",
    val isDone: Boolean = false,
)

data class PeriodRange(val startMin: Int, val endMin: Int)
