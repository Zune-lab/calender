import Foundation

/// Mô hình dữ liệu — khớp các bảng Supabase của bản web (subjects, exams, subject_details, daily_plans).
/// `id` có thể là số hoặc chuỗi tuỳ cấu hình bảng nên giải mã linh hoạt về String.
struct FlexString: Decodable {
    let value: String
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { value = "" }
        else if let s = try? c.decode(String.self) { value = s }
        else if let i = try? c.decode(Int64.self) { value = String(i) }
        else if let d = try? c.decode(Double.self) { value = String(d) }
        else if let b = try? c.decode(Bool.self) { value = String(b) }
        else { value = "" }
    }
}

struct Subject: Decodable, Identifiable, Equatable {
    var id: String
    var name: String
    var courseCode = ""
    var groupId = ""
    /// Quy ước web: Thứ 2 = 2 ... Thứ 7 = 7, Chủ nhật = 8.
    var day: Int
    var timeSlot = ""
    var room = ""
    var lecturer = ""
    var exactTime = ""
    /// Mỗi ký tự = 1 tuần; "-" hoặc " " = không học. Rỗng = học mọi tuần.
    var weeks = ""

    init(id: String, name: String, day: Int, timeSlot: String = "", room: String = "", lecturer: String = "", weeks: String = "") {
        self.id = id; self.name = name; self.day = day; self.timeSlot = timeSlot
        self.room = room; self.lecturer = lecturer; self.weeks = weeks
    }

    enum CodingKeys: String, CodingKey {
        case id, name, day, room, lecturer, weeks
        case courseCode = "course_code", groupId = "group_id", timeSlot = "time_slot", exactTime = "exact_time"
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(FlexString.self, forKey: .id).value
        name = (try? c.decode(String.self, forKey: .name)) ?? ""
        courseCode = (try? c.decode(FlexString.self, forKey: .courseCode))?.value ?? ""
        groupId = (try? c.decode(FlexString.self, forKey: .groupId))?.value ?? ""
        day = (try? c.decode(Int.self, forKey: .day)) ?? Int((try? c.decode(FlexString.self, forKey: .day))?.value ?? "") ?? 0
        timeSlot = (try? c.decode(String.self, forKey: .timeSlot)) ?? ""
        room = (try? c.decode(String.self, forKey: .room)) ?? ""
        lecturer = (try? c.decode(String.self, forKey: .lecturer)) ?? ""
        exactTime = (try? c.decode(String.self, forKey: .exactTime)) ?? ""
        weeks = (try? c.decode(String.self, forKey: .weeks)) ?? ""
    }
}

struct Exam: Decodable, Identifiable, Equatable {
    var id: String
    var subjectName = ""
    var courseCode = ""
    var examDate = ""
    var examTime = ""
    var room = ""

    init(id: String, subjectName: String = "", examDate: String = "", examTime: String = "", room: String = "") {
        self.id = id; self.subjectName = subjectName; self.examDate = examDate; self.examTime = examTime; self.room = room
    }
    enum CodingKeys: String, CodingKey {
        case id, room
        case subjectName = "subject_name", courseCode = "course_code", examDate = "exam_date", examTime = "exam_time"
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(FlexString.self, forKey: .id).value
        subjectName = (try? c.decode(String.self, forKey: .subjectName)) ?? ""
        courseCode = (try? c.decode(String.self, forKey: .courseCode)) ?? ""
        examDate = (try? c.decode(String.self, forKey: .examDate)) ?? ""
        examTime = (try? c.decode(String.self, forKey: .examTime)) ?? ""
        room = (try? c.decode(String.self, forKey: .room)) ?? ""
    }
}

struct Detail: Decodable, Identifiable, Equatable {
    var id: String
    var subjectId = ""
    /// "task" | "note" | "notification"
    var type = ""
    var content = ""
    var status = "upcoming"
    var priority = "normal"
    /// yyyy-MM-dd hoặc nil
    var dueDate: String?

    init(id: String, subjectId: String = "", type: String, content: String, status: String = "upcoming", dueDate: String? = nil) {
        self.id = id; self.subjectId = subjectId; self.type = type; self.content = content; self.status = status; self.dueDate = dueDate
    }
    enum CodingKeys: String, CodingKey {
        case id, type, content, status, priority
        case subjectId = "subject_id", dueDate = "due_date"
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(FlexString.self, forKey: .id).value
        subjectId = (try? c.decode(FlexString.self, forKey: .subjectId))?.value ?? ""
        type = (try? c.decode(String.self, forKey: .type)) ?? ""
        content = (try? c.decode(String.self, forKey: .content)) ?? ""
        status = (try? c.decode(String.self, forKey: .status)) ?? "upcoming"
        priority = (try? c.decode(String.self, forKey: .priority)) ?? "normal"
        dueDate = try? c.decode(String.self, forKey: .dueDate)
    }
}

struct Plan: Decodable, Identifiable, Equatable {
    var id: String
    var planDate = ""
    var title = ""
    var startMin = 0
    var endMin = 0
    var priority = "normal"
    var isDone = false

    enum CodingKeys: String, CodingKey {
        case id, title, priority
        case planDate = "plan_date", startMin = "start_min", endMin = "end_min", isDone = "is_done"
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(FlexString.self, forKey: .id).value
        planDate = (try? c.decode(String.self, forKey: .planDate)) ?? ""
        title = (try? c.decode(String.self, forKey: .title)) ?? ""
        startMin = (try? c.decode(Int.self, forKey: .startMin)) ?? 0
        endMin = (try? c.decode(Int.self, forKey: .endMin)) ?? 0
        priority = (try? c.decode(String.self, forKey: .priority)) ?? "normal"
        isDone = (try? c.decode(Bool.self, forKey: .isDone)) ?? false
    }
}

struct PeriodRange: Equatable { let startMin: Int; let endMin: Int }

struct UserSettingsRow: Decodable {
    let semesterStartDate: String?
    enum CodingKeys: String, CodingKey { case semesterStartDate = "semester_start_date" }
}
