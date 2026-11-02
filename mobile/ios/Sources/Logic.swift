import Foundation

// Logic thuần — PORT TỪ shared.js / index.js của bản web (và khớp 1-1 với Logic.kt bên Android) để web, Android, iOS
// luôn ra cùng kết quả. Có test ở Tests/LogicTests.swift.

let maxSemesterWeeks = 20

/// Lưới giờ SGU (giống SGU_PERIOD_TIMES trong shared.js).
let sguPeriodTimes: [Int: (String, String)] = [
    1: ("07:00", "07:50"), 2: ("07:50", "08:40"), 3: ("09:00", "09:50"), 4: ("09:50", "10:40"),
    5: ("10:40", "11:30"), 6: ("13:00", "13:50"), 7: ("13:50", "14:40"), 8: ("15:00", "15:50"),
    9: ("15:50", "16:40"), 10: ("16:40", "17:30"), 11: ("17:40", "18:30"), 12: ("18:30", "19:20"),
    13: ("19:20", "20:10"), 14: ("20:10", "21:00"),
]

/// Lịch Gregorian dùng cho mọi phép tính ngày (tách khỏi lịch/locale của người dùng, vd lịch Phật giáo ở Thái).
let gregorian: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.firstWeekday = 2
    return c
}()

private func hmToMinutes(_ hm: String) -> Int {
    let p = hm.split(separator: ":").compactMap { Int($0) }
    return p[0] * 60 + p[1]
}
func sguPeriodStartMin(_ p: Int) -> Int? { sguPeriodTimes[p].map { hmToMinutes($0.0) } }
func sguPeriodEndMin(_ p: Int) -> Int? { sguPeriodTimes[p].map { hmToMinutes($0.1) } }

func fmtMinutesHM(_ minutes: Int) -> String {
    let m = max(0, min(1440, minutes))
    return String(format: "%02d:%02d", m / 60, m % 60)
}

private func captures(_ pattern: String, in s: String, options: NSRegularExpression.Options = []) -> [String?]? {
    guard let re = try? NSRegularExpression(pattern: pattern, options: options) else { return nil }
    let ns = s as NSString
    guard let m = re.firstMatch(in: s, range: NSRange(location: 0, length: ns.length)) else { return nil }
    return (1..<m.numberOfRanges).map { i in
        let r = m.range(at: i)
        return r.location == NSNotFound ? nil : ns.substring(with: r)
    }
}

/// "Tiết 1-3" -> 07:00–09:50. nil nếu không đọc được.
func parsePeriodRange(_ timeSlot: String) -> PeriodRange? {
    guard let g = captures(#"Tiết\s*(\d+)(?:\s*-\s*(\d+))?"#, in: timeSlot, options: .caseInsensitive),
          let a = g[0], let startP = Int(a) else { return nil }
    let endP = g.count > 1 ? (g[1].flatMap { Int($0) } ?? startP) : startP
    guard let s = sguPeriodStartMin(startP), let e = sguPeriodEndMin(endP) else { return nil }
    return PeriodRange(startMin: s, endMin: e)
}

func baseSubjectLabel(_ name: String) -> String {
    let first = name.components(separatedBy: "-")[0].components(separatedBy: "(")[0]
    return first.trimmingCharacters(in: .whitespacesAndNewlines)
}
func baseSubjectKey(_ name: String) -> String { baseSubjectLabel(name).lowercased() }

func makeDate(_ y: Int, _ m: Int, _ d: Int) -> Date? {
    var dc = DateComponents(); dc.year = y; dc.month = m; dc.day = d
    guard let date = gregorian.date(from: dc) else { return nil }
    // Từ chối ngày không có thật (31/02 sẽ "tràn" sang tháng sau)
    let back = gregorian.dateComponents([.year, .month, .day], from: date)
    return (back.year == y && back.month == m && back.day == d) ? date : nil
}

/// Thứ theo quy ước web: Thứ 2 = 2 ... Thứ 7 = 7, Chủ nhật = 8.
func webDay(_ date: Date) -> Int {
    let w = gregorian.component(.weekday, from: date) // Chủ nhật = 1 ... Thứ 7 = 7
    return w == 1 ? 8 : w
}

func calendarDayDiff(_ a: Date, _ b: Date) -> Int {
    gregorian.dateComponents([.day], from: gregorian.startOfDay(for: b), to: gregorian.startOfDay(for: a)).day ?? 0
}

func addDays(_ d: Date, _ n: Int) -> Date { gregorian.date(byAdding: .day, value: n, to: d) ?? d }

/// Chỉ số tuần học (0-indexed); -1 nếu kỳ học chưa bắt đầu. Cùng công thức currentWeekIndex() của web.
func currentWeekIndex(today: Date, semesterStart: Date) -> Int {
    let diff = calendarDayDiff(today, semesterStart)
    return diff < 0 ? -1 : diff / 7
}

/// Thứ Hai của tuần chứa `d` — mốc kỳ học mặc định khi chưa có cài đặt.
func mondayOf(_ d: Date) -> Date {
    let w = gregorian.component(.weekday, from: d)
    return addDays(gregorian.startOfDay(for: d), -((w + 5) % 7))
}

func isSubjectActiveInWeek(_ sub: Subject, _ weekIndex: Int) -> Bool {
    let w = Array(sub.weeks)
    if sub.weeks.trimmingCharacters(in: .whitespaces).isEmpty { return true }
    if weekIndex < 0 || weekIndex >= w.count { return false }
    return w[weekIndex] != "-" && w[weekIndex] != " "
}

/// "dd/MM/yyyy", "dd/MM/yy" hoặc "yyyy-MM-dd".
func parseVNExamDate(_ str: String?) -> Date? {
    guard let str = str?.trimmingCharacters(in: .whitespaces), !str.isEmpty else { return nil }
    let p = str.split(whereSeparator: { $0 == "-" || $0 == "/" }).map(String.init)
    guard p.count == 3, let a = Int(p[0]), let b = Int(p[1]), var c = Int(p[2]) else { return nil }
    if p[0].count == 4 { return makeDate(a, b, c) }
    if c < 100 { c += 2000 }
    return makeDate(c, b, a)
}

/// Ngày dạng yyyy-MM-dd (chỉ lấy 10 ký tự đầu, chấp nhận cả chuỗi timestamp).
func parseISODate(_ str: String?) -> Date? {
    guard let s = str, s.count >= 10 else { return nil }
    let p = String(s.prefix(10)).split(separator: "-").compactMap { Int($0) }
    return p.count == 3 ? makeDate(p[0], p[1], p[2]) : nil
}

func isoString(_ d: Date) -> String {
    let c = gregorian.dateComponents([.year, .month, .day], from: d)
    return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
}

func parseClockMinutes(_ str: String?) -> Int? {
    guard let g = captures(#"(\d{1,2})\s*[:hHgG.]\s*(\d{2})"#, in: str ?? ""),
          let hs = g[0], let ms = g[1], let h = Int(hs), let m = Int(ms), h <= 23, m <= 59 else { return nil }
    return h * 60 + m
}

func examStart(_ exam: Exam) -> Date? {
    guard let d = parseVNExamDate(exam.examDate), let m = parseClockMinutes(exam.examTime) else { return nil }
    return gregorian.date(bySettingHour: m / 60, minute: m % 60, second: 0, of: d)
}

/// Các buổi của 1 ngày (tuần weekIndex, thứ `day` theo quy ước web), sắp theo giờ.
func daySessions(_ subjects: [Subject], weekIndex: Int, day: Int) -> [(Subject, PeriodRange)] {
    subjects.filter { $0.day == day && isSubjectActiveInWeek($0, weekIndex) }
        .compactMap { s in parsePeriodRange(s.timeSlot).map { (s, $0) } }
        .sorted { $0.1.startMin < $1.1.startMin }
}

enum Hero {
    case noSubjects
    case notStarted(Date)
    case ended
    case ongoing(Subject, PeriodRange, minsLeft: Int)
    /// minsUntil chỉ có nghĩa khi date là hôm nay.
    case next(Subject, PeriodRange, date: Date, minsUntil: Int?)
    case nothingAhead
}

/// Trạng thái hero của Dashboard (buổi đang học / buổi sắp tới). Tuần tính LẠI từ `now` mỗi lần.
func computeHero(now: Date, subjects: [Subject], semesterStart: Date) -> Hero {
    if subjects.isEmpty { return .noSubjects }
    let today = gregorian.startOfDay(for: now)
    let wi = currentWeekIndex(today: today, semesterStart: semesterStart)
    if wi < 0 { return .notStarted(semesterStart) }
    if wi >= maxSemesterWeeks { return .ended }
    let hc = gregorian.dateComponents([.hour, .minute], from: now)
    let nowMin = (hc.hour ?? 0) * 60 + (hc.minute ?? 0)

    if let cur = daySessions(subjects, weekIndex: wi, day: webDay(today))
        .first(where: { nowMin >= $0.1.startMin && nowMin < $0.1.endMin }) {
        return .ongoing(cur.0, cur.1, minsLeft: cur.1.endMin - nowMin)
    }
    for offset in 0..<(maxSemesterWeeks * 7) {
        let date = addDays(today, offset)
        let w = currentWeekIndex(today: date, semesterStart: semesterStart)
        if w >= maxSemesterWeeks { break }
        var sessions = daySessions(subjects, weekIndex: w, day: webDay(date))
        if offset == 0 { sessions = sessions.filter { $0.1.startMin > nowMin } }
        if let f = sessions.first {
            return .next(f.0, f.1, date: date, minsUntil: offset == 0 ? f.1.startMin - nowMin : nil)
        }
    }
    return .nothingAhead
}

/// Việc/ghi chú còn hạn lên trước (gần nhất trước); trễ hạn xếp sau (mới trễ trước).
func sortByDue(_ details: [Detail], today: Date) -> [Detail] {
    func days(_ d: Detail) -> Int? { parseISODate(d.dueDate).map { calendarDayDiff($0, today) } }
    return details.filter { $0.status == "upcoming" && days($0) != nil }
        .sorted { a, b in
            let da = days(a)!, db = days(b)!
            if (da < 0) != (db < 0) { return db < 0 }   // còn hạn trước, trễ hạn sau
            return da < 0 ? da > db : da < db            // trễ: mới trễ trước; còn hạn: gần nhất trước
        }
}

func distinctSubjectCount(_ subjects: [Subject]) -> Int { Set(subjects.map { baseSubjectKey($0.name) }).count }
func activeSubjectCount(_ subjects: [Subject], weekIndex: Int) -> Int {
    weekIndex < 0 ? 0 : subjects.filter { isSubjectActiveInWeek($0, weekIndex) }.count
}

/// Môn thi hiển thị: bỏ môn đã thi quá 14 ngày (web xoá hẳn khỏi DB; app chỉ ẩn để không ghi dữ liệu).
func visibleExams(_ exams: [Exam], today: Date) -> [Exam] {
    exams.filter { e in parseVNExamDate(e.examDate).map { calendarDayDiff(today, $0) <= 14 } ?? true }
        .sorted { a, b in
            let da = parseVNExamDate(a.examDate) ?? .distantFuture, db = parseVNExamDate(b.examDate) ?? .distantFuture
            if da != db { return da < db }
            return (parseClockMinutes(a.examTime) ?? 0) < (parseClockMinutes(b.examTime) ?? 0)
        }
}
