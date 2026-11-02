import XCTest
@testable import SGUWorkspace

/// Mirror của LogicTest.kt bên Android: cùng đầu vào, cùng kết quả mong đợi.
final class LogicTests: XCTestCase {
    private func d(_ y: Int, _ m: Int, _ day: Int, _ h: Int = 0, _ min: Int = 0) -> Date {
        gregorian.date(from: DateComponents(year: y, month: m, day: day, hour: h, minute: min))!
    }
    private let start = gregorian.date(from: DateComponents(year: 2026, month: 5, day: 18))! // Thứ Hai
    private func sub(_ day: Int, _ slot: String, weeks: String = "", name: String = "Lập trình Web - N1") -> Subject {
        Subject(id: "\(day)\(slot)", name: name, day: day, timeSlot: slot, room: "A101", weeks: weeks)
    }

    func testPeriodRange() {
        XCTAssertEqual(parsePeriodRange("Tiết 1-3"), PeriodRange(startMin: 420, endMin: 590))
        XCTAssertEqual(parsePeriodRange("tiết 3"), PeriodRange(startMin: 540, endMin: 590))
        XCTAssertNil(parsePeriodRange("Tiết 99"))
        XCTAssertNil(parsePeriodRange("abc"))
    }

    func testWebDayAndWeek() {
        XCTAssertEqual(webDay(d(2026, 5, 18)), 2)   // Thứ Hai
        XCTAssertEqual(webDay(d(2026, 5, 24)), 8)   // Chủ nhật
        XCTAssertEqual(currentWeekIndex(today: d(2026, 5, 17), semesterStart: start), -1)
        XCTAssertEqual(currentWeekIndex(today: d(2026, 5, 24), semesterStart: start), 0)
        XCTAssertEqual(currentWeekIndex(today: d(2026, 5, 25), semesterStart: start), 1) // CN -> T2: sang tuần mới
        XCTAssertEqual(mondayOf(d(2026, 5, 24)), d(2026, 5, 18))
    }

    func testActiveInWeek() {
        let s = sub(2, "Tiết 1-3", weeks: "12-4")
        XCTAssertTrue(isSubjectActiveInWeek(s, 0))
        XCTAssertFalse(isSubjectActiveInWeek(s, 2))
        XCTAssertFalse(isSubjectActiveInWeek(s, 9))
        XCTAssertTrue(isSubjectActiveInWeek(sub(2, "Tiết 1", weeks: ""), 15))
    }

    func testExamDates() {
        XCTAssertEqual(parseVNExamDate("05/06/2026"), d(2026, 6, 5))
        XCTAssertEqual(parseVNExamDate("05-06-26"), d(2026, 6, 5))
        XCTAssertEqual(parseVNExamDate("2026-06-05"), d(2026, 6, 5))
        XCTAssertNil(parseVNExamDate("31/02/2026"))
        XCTAssertEqual(parseClockMinutes("7h30"), 450)
        XCTAssertEqual(parseClockMinutes("07:30"), 450)
        XCTAssertNil(parseClockMinutes("25:00"))
    }

    func testHeroOngoingAndNext() {
        let subs = [sub(2, "Tiết 1-3"), sub(2, "Tiết 6-8", name: "Cơ sở dữ liệu")]
        guard case .ongoing(_, _, let left) = computeHero(now: d(2026, 5, 18, 8, 0), subjects: subs, semesterStart: start) else { return XCTFail("expected ongoing") }
        XCTAssertEqual(left, 590 - 480)
        guard case .next(let s, _, _, let until) = computeHero(now: d(2026, 5, 18, 10, 0), subjects: subs, semesterStart: start) else { return XCTFail("expected next") }
        XCTAssertEqual(s.name, "Cơ sở dữ liệu"); XCTAssertEqual(until, 180)
        guard case .next(_, _, let date, let u2) = computeHero(now: d(2026, 5, 18, 20, 0), subjects: subs, semesterStart: start) else { return XCTFail("expected next week") }
        XCTAssertEqual(date, d(2026, 5, 25)); XCTAssertNil(u2)
    }

    func testHeroEdgeCases() {
        let subs = [sub(2, "Tiết 1-3")]
        if case .notStarted = computeHero(now: d(2026, 5, 1, 9, 0), subjects: subs, semesterStart: start) {} else { XCTFail() }
        if case .ended = computeHero(now: d(2027, 5, 1, 9, 0), subjects: subs, semesterStart: start) {} else { XCTFail() }
        if case .noSubjects = computeHero(now: d(2026, 5, 18, 9, 0), subjects: [], semesterStart: start) {} else { XCTFail() }
        if case .next = computeHero(now: d(2026, 5, 18, 9, 50), subjects: subs, semesterStart: start) {} else { XCTFail("đúng giờ hết tiết thì không còn đang học") }
    }

    func testDueSorting() {
        func det(_ id: String, _ due: String) -> Detail { Detail(id: id, subjectId: "1", type: "task", content: id, dueDate: due) }
        let sorted = sortByDue([det("old", "2026-05-01"), det("soon", "2026-06-11"), det("recentLate", "2026-06-09"), det("later", "2026-06-20")], today: d(2026, 6, 10))
        XCTAssertEqual(sorted.map { $0.id }, ["soon", "later", "recentLate", "old"])
    }

    func testExamsVisibility() {
        let list = visibleExams([
            Exam(id: "a", subjectName: "Cũ", examDate: "01/06/2026"),
            Exam(id: "b", subjectName: "Sắp", examDate: "05/07/2026", examTime: "07:30"),
            Exam(id: "c", subjectName: "Sớm hơn", examDate: "05/07/2026", examTime: "07:00"),
        ], today: d(2026, 6, 30))
        XCTAssertEqual(list.map { $0.id }, ["c", "b"])
    }

    func testBaseName() {
        XCTAssertEqual(baseSubjectLabel("Lập trình Web - N1"), "Lập trình Web")
        XCTAssertEqual(baseSubjectKey("Lập trình Web (TH)"), "lập trình web")
        XCTAssertEqual(distinctSubjectCount([sub(2, "Tiết 1"), sub(3, "Tiết 2"), sub(3, "Tiết 3", name: "Toán")]), 2)
    }
}
