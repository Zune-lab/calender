package vn.sgu.workspace.core

import java.time.DateTimeException
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.temporal.ChronoUnit

/**
 * Logic thuần (không phụ thuộc Android) — PORT TỪ shared.js / index.js của bản web, giữ cùng quy tắc
 * để web và app luôn ra cùng kết quả. Có test ở src/test.
 */

const val MAX_SEMESTER_WEEKS = 20

/** Lưới giờ SGU (giống SGU_PERIOD_TIMES trong shared.js). */
val SGU_PERIOD_TIMES: Map<Int, Pair<String, String>> = mapOf(
    1 to ("07:00" to "07:50"), 2 to ("07:50" to "08:40"), 3 to ("09:00" to "09:50"), 4 to ("09:50" to "10:40"),
    5 to ("10:40" to "11:30"), 6 to ("13:00" to "13:50"), 7 to ("13:50" to "14:40"), 8 to ("15:00" to "15:50"),
    9 to ("15:50" to "16:40"), 10 to ("16:40" to "17:30"), 11 to ("17:40" to "18:30"), 12 to ("18:30" to "19:20"),
    13 to ("19:20" to "20:10"), 14 to ("20:10" to "21:00"),
)

private fun hmToMinutes(hm: String): Int { val (h, m) = hm.split(":").map { it.toInt() }; return h * 60 + m }
fun sguPeriodStartMin(p: Int): Int? = SGU_PERIOD_TIMES[p]?.let { hmToMinutes(it.first) }
fun sguPeriodEndMin(p: Int): Int? = SGU_PERIOD_TIMES[p]?.let { hmToMinutes(it.second) }

fun fmtMinutesHM(min: Int): String {
    val m = min.coerceIn(0, 1440)
    return "%02d:%02d".format(m / 60, m % 60)
}

private val PERIOD_RE = Regex("""Tiết\s*(\d+)(?:\s*-\s*(\d+))?""", RegexOption.IGNORE_CASE)

/** "Tiết 1-3" -> 07:00–09:50. null nếu không đọc được. */
fun parsePeriodRange(timeSlot: String): PeriodRange? {
    val m = PERIOD_RE.find(timeSlot) ?: return null
    val startP = m.groupValues[1].toInt()
    val endP = m.groupValues[2].ifEmpty { m.groupValues[1] }.toInt()
    val s = sguPeriodStartMin(startP) ?: return null
    val e = sguPeriodEndMin(endP) ?: return null
    return PeriodRange(s, e)
}

fun baseSubjectLabel(name: String): String = name.split("-")[0].split("(")[0].trim()
fun baseSubjectKey(name: String): String = baseSubjectLabel(name).lowercase()

/** Thứ theo quy ước web: Thứ 2 = 2 ... Thứ 7 = 7, Chủ nhật = 8. */
fun webDay(date: LocalDate): Int = date.dayOfWeek.value + 1

fun calendarDayDiff(a: LocalDate, b: LocalDate): Long = ChronoUnit.DAYS.between(b, a)

/** Chỉ số tuần học (0-indexed); -1 nếu kỳ học chưa bắt đầu. Cùng công thức currentWeekIndex() của web. */
fun currentWeekIndex(today: LocalDate, semesterStart: LocalDate): Int {
    val diff = calendarDayDiff(today, semesterStart)
    return if (diff < 0) -1 else (diff / 7).toInt()
}

/** Thứ Hai của tuần chứa `d` — mốc kỳ học mặc định khi chưa có cài đặt. */
fun mondayOf(d: LocalDate): LocalDate = d.minusDays((d.dayOfWeek.value - 1).toLong())

fun isSubjectActiveInWeek(sub: Subject, weekIndex: Int): Boolean {
    val w = sub.weeks
    if (w.isBlank()) return true
    if (weekIndex < 0 || weekIndex >= w.length) return false
    val ch = w[weekIndex]
    return ch != '-' && ch != ' '
}

/** "dd/MM/yyyy", "dd/MM/yy" hoặc "yyyy-MM-dd"; từ chối ngày không có thật (31/02). */
fun parseVNExamDate(str: String?): LocalDate? {
    if (str.isNullOrBlank()) return null
    val p = str.trim().split(Regex("[-/]"))
    if (p.size != 3) return null
    return try {
        val day: Int
        val month: Int
        var year: Int
        if (p[0].length == 4) { year = p[0].toInt(); month = p[1].toInt(); day = p[2].toInt() }
        else { day = p[0].toInt(); month = p[1].toInt(); year = p[2].toInt(); if (year < 100) year += 2000 }
        LocalDate.of(year, month, day)
    } catch (e: NumberFormatException) { null } catch (e: DateTimeException) { null }
}

private val CLOCK_RE = Regex("""(\d{1,2})\s*[:hHgG.]\s*(\d{2})""")
fun parseClockMinutes(str: String?): Int? {
    val m = CLOCK_RE.find(str ?: "") ?: return null
    val h = m.groupValues[1].toInt()
    val mi = m.groupValues[2].toInt()
    return if (h > 23 || mi > 59) null else h * 60 + mi
}

fun examStart(exam: Exam): LocalDateTime? {
    val d = parseVNExamDate(exam.examDate) ?: return null
    val m = parseClockMinutes(exam.examTime) ?: return null
    return d.atTime(m / 60, m % 60)
}

/** Các buổi của 1 ngày (tuần weekIndex, thứ `day` theo quy ước web), sắp theo giờ. */
fun daySessions(subjects: List<Subject>, weekIndex: Int, day: Int): List<Pair<Subject, PeriodRange>> =
    subjects.filter { it.day == day && isSubjectActiveInWeek(it, weekIndex) }
        .mapNotNull { s -> parsePeriodRange(s.timeSlot)?.let { s to it } }
        .sortedBy { it.second.startMin }

sealed class Hero {
    object NoSubjects : Hero()
    data class NotStarted(val startDate: LocalDate) : Hero()
    object Ended : Hero()
    data class Ongoing(val subject: Subject, val range: PeriodRange, val minsLeft: Int) : Hero()
    /** minsUntil chỉ có nghĩa khi date == hôm nay. */
    data class Next(val subject: Subject, val range: PeriodRange, val date: LocalDate, val minsUntil: Int?) : Hero()
    object NothingAhead : Hero()
}

/** Trạng thái hero của Dashboard (buổi đang học / buổi sắp tới). Tuần tính LẠI từ `now` mỗi lần. */
fun computeHero(now: LocalDateTime, subjects: List<Subject>, semesterStart: LocalDate): Hero {
    if (subjects.isEmpty()) return Hero.NoSubjects
    val today = now.toLocalDate()
    val wi = currentWeekIndex(today, semesterStart)
    if (wi < 0) return Hero.NotStarted(semesterStart)
    if (wi >= MAX_SEMESTER_WEEKS) return Hero.Ended
    val nowMin = now.hour * 60 + now.minute

    daySessions(subjects, wi, webDay(today))
        .firstOrNull { nowMin >= it.second.startMin && nowMin < it.second.endMin }
        ?.let { return Hero.Ongoing(it.first, it.second, it.second.endMin - nowMin) }

    for (offset in 0 until MAX_SEMESTER_WEEKS * 7) {
        val date = today.plusDays(offset.toLong())
        val w = currentWeekIndex(date, semesterStart)
        if (w >= MAX_SEMESTER_WEEKS) break
        var sessions = daySessions(subjects, w, webDay(date))
        if (offset == 0) sessions = sessions.filter { it.second.startMin > nowMin }
        sessions.firstOrNull()?.let {
            return Hero.Next(it.first, it.second, date, if (offset == 0) it.second.startMin - nowMin else null)
        }
    }
    return Hero.NothingAhead
}

/** Việc/ghi chú còn hạn lên trước (gần nhất trước); trễ hạn xếp sau (mới trễ trước). */
fun sortByDue(details: List<Detail>, today: LocalDate): List<Detail> {
    fun days(d: Detail): Long? = d.dueDate?.take(10)?.let { s ->
        try { calendarDayDiff(LocalDate.parse(s), today) } catch (e: Exception) { null }
    }
    return details.filter { it.status == "upcoming" && days(it) != null }
        .sortedWith { a, b ->
            val da = days(a)!!
            val db = days(b)!!
            when {
                (da < 0) != (db < 0) -> if (da < 0) 1 else -1
                da < 0 -> db.compareTo(da)
                else -> da.compareTo(db)
            }
        }
}

fun distinctSubjectCount(subjects: List<Subject>): Int = subjects.map { baseSubjectKey(it.name) }.toSet().size
fun activeSubjectCount(subjects: List<Subject>, weekIndex: Int): Int =
    if (weekIndex < 0) 0 else subjects.count { isSubjectActiveInWeek(it, weekIndex) }

/** Môn thi hiển thị: bỏ môn đã thi quá 14 ngày (web xoá hẳn khỏi DB; app chỉ ẩn để không ghi dữ liệu). */
fun visibleExams(exams: List<Exam>, today: LocalDate): List<Exam> =
    exams.filter { e -> parseVNExamDate(e.examDate)?.let { calendarDayDiff(today, it) <= 14 } ?: true }
        .sortedWith(compareBy({ parseVNExamDate(it.examDate) ?: LocalDate.MAX }, { parseClockMinutes(it.examTime) ?: 0 }))
