package vn.sgu.workspace.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.LocalDateTime

class LogicTest {
    // 2026-05-18 là Thứ Hai
    private val start = LocalDate.of(2026, 5, 18)
    private fun sub(day: Int, slot: String, weeks: String = "", name: String = "Lập trình Web - N1") =
        Subject(id = "$day$slot", name = name, day = day, timeSlot = slot, weeks = weeks, room = "A101")

    @Test fun periodRange() {
        assertEquals(PeriodRange(420, 590), parsePeriodRange("Tiết 1-3"))
        assertEquals(PeriodRange(540, 590), parsePeriodRange("tiết 3"))
        assertNull(parsePeriodRange("Tiết 99"))
        assertNull(parsePeriodRange("abc"))
    }

    @Test fun webDayAndWeek() {
        assertEquals(2, webDay(LocalDate.of(2026, 5, 18)))   // Thứ Hai
        assertEquals(8, webDay(LocalDate.of(2026, 5, 24)))   // Chủ nhật
        assertEquals(-1, currentWeekIndex(LocalDate.of(2026, 5, 17), start))
        assertEquals(0, currentWeekIndex(LocalDate.of(2026, 5, 24), start))
        assertEquals(1, currentWeekIndex(LocalDate.of(2026, 5, 25), start)) // qua nửa đêm CN -> T2: sang tuần mới
        assertEquals(LocalDate.of(2026, 5, 18), mondayOf(LocalDate.of(2026, 5, 24)))
    }

    @Test fun activeInWeek() {
        val s = sub(2, "Tiết 1-3", weeks = "12-4")
        assertTrue(isSubjectActiveInWeek(s, 0))
        assertFalse(isSubjectActiveInWeek(s, 2))
        assertFalse(isSubjectActiveInWeek(s, 9))
        assertTrue(isSubjectActiveInWeek(sub(2, "Tiết 1", weeks = ""), 15))
    }

    @Test fun examDates() {
        assertEquals(LocalDate.of(2026, 6, 5), parseVNExamDate("05/06/2026"))
        assertEquals(LocalDate.of(2026, 6, 5), parseVNExamDate("05-06-26"))
        assertEquals(LocalDate.of(2026, 6, 5), parseVNExamDate("2026-06-05"))
        assertNull(parseVNExamDate("31/02/2026"))
        assertEquals(450, parseClockMinutes("7h30"))
        assertEquals(450, parseClockMinutes("07:30"))
        assertNull(parseClockMinutes("25:00"))
    }

    @Test fun heroOngoingAndNext() {
        val subs = listOf(sub(2, "Tiết 1-3"), sub(2, "Tiết 6-8", name = "Cơ sở dữ liệu"))
        val mon = LocalDate.of(2026, 5, 18)
        val ongoing = computeHero(mon.atTime(8, 0), subs, start)
        assertTrue(ongoing is Hero.Ongoing && ongoing.minsLeft == 590 - 480)
        val next = computeHero(mon.atTime(10, 0), subs, start)
        assertTrue(next is Hero.Next && next.subject.name == "Cơ sở dữ liệu" && next.minsUntil == 180)
        // hết buổi cuối thứ Hai -> buổi sắp tới là thứ Hai tuần sau
        val after = computeHero(mon.atTime(20, 0), subs, start)
        assertTrue(after is Hero.Next && after.date == LocalDate.of(2026, 5, 25) && after.minsUntil == null)
    }

    @Test fun heroEdgeCases() {
        val subs = listOf(sub(2, "Tiết 1-3"))
        assertTrue(computeHero(LocalDateTime.of(2026, 5, 1, 9, 0), subs, start) is Hero.NotStarted)
        assertTrue(computeHero(LocalDateTime.of(2027, 5, 1, 9, 0), subs, start) is Hero.Ended)
        assertTrue(computeHero(LocalDateTime.of(2026, 5, 18, 9, 0), emptyList(), start) is Hero.NoSubjects)
        // đúng giờ hết tiết (09:50) thì không còn "đang học"
        val atEnd = computeHero(LocalDateTime.of(2026, 5, 18, 9, 50), subs, start)
        assertTrue(atEnd is Hero.Next)
    }

    @Test fun dueSorting() {
        val today = LocalDate.of(2026, 6, 10)
        fun d(id: String, due: String) = Detail(id, "1", "task", id, dueDate = due)
        val sorted = sortByDue(listOf(d("old", "2026-05-01"), d("soon", "2026-06-11"), d("recentLate", "2026-06-09"), d("later", "2026-06-20")), today)
        assertEquals(listOf("soon", "later", "recentLate", "old"), sorted.map { it.id })
    }

    @Test fun examsVisibility() {
        val today = LocalDate.of(2026, 6, 30)
        val list = visibleExams(listOf(
            Exam("a", "Cũ", examDate = "01/06/2026"),
            Exam("b", "Sắp", examDate = "05/07/2026", examTime = "07:30"),
            Exam("c", "Sớm hơn", examDate = "05/07/2026", examTime = "07:00"),
        ), today)
        assertEquals(listOf("c", "b"), list.map { it.id })
    }

    @Test fun baseName() {
        assertEquals("Lập trình Web", baseSubjectLabel("Lập trình Web - N1"))
        assertEquals("lập trình web", baseSubjectKey("Lập trình Web (TH)"))
        assertEquals(2, distinctSubjectCount(listOf(sub(2, "Tiết 1"), sub(3, "Tiết 2"), sub(3, "Tiết 3", name = "Toán"))))
    }
}
