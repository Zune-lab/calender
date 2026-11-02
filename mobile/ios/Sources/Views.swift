import SwiftUI

private let dayNames: [Int: String] = [2: "Thứ Hai", 3: "Thứ Ba", 4: "Thứ Tư", 5: "Thứ Năm", 6: "Thứ Sáu", 7: "Thứ Bảy", 8: "Chủ Nhật"]

private func fmtDM(_ d: Date) -> String {
    let c = gregorian.dateComponents([.day, .month], from: d)
    return String(format: "%02d/%02d", c.day ?? 0, c.month ?? 0)
}
private func fmtDMY(_ d: Date) -> String {
    let c = gregorian.dateComponents([.day, .month, .year], from: d)
    return String(format: "%02d/%02d/%04d", c.day ?? 0, c.month ?? 0, c.year ?? 0)
}
private func roomText(_ s: Subject) -> String { s.room.isEmpty ? "—" : s.room }
private func lecturerText(_ s: Subject) -> String { s.lecturer.isEmpty ? "—" : s.lecturer }

struct LoginView: View {
    @EnvironmentObject var model: AppModel
    @State private var email = ""
    @State private var password = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Spacer()
            Text("SGU Workspace").font(.largeTitle).bold()
            Text("Đăng nhập bằng tài khoản đang dùng trên web").foregroundStyle(.secondary)
            TextField("Email", text: $email)
                .textInputAutocapitalization(.never).keyboardType(.emailAddress).autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)
            SecureField("Mật khẩu", text: $password).textFieldStyle(.roundedBorder)
            if let m = model.message { Text(m).foregroundStyle(.red).font(.callout) }
            Button {
                Task { await model.login(email: email, password: password) }
            } label: {
                Group { if model.loading { ProgressView() } else { Text("Đăng nhập").bold() } }
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .disabled(model.loading || email.isEmpty || password.isEmpty)
            Spacer()
        }
        .padding(24)
    }
}

struct MainView: View {
    @EnvironmentObject var model: AppModel
    /// Giờ hiện tại cập nhật mỗi 30s -> hero/đếm ngược luôn đúng và TỰ ĐỔI TUẦN khi qua nửa đêm (tuần tính lại từ `now`).
    @State private var now = Date()
    private let timer = Timer.publish(every: 30, on: .main, in: .common).autoconnect()

    var body: some View {
        TabView {
            tab(Text("Hôm nay")) { snap in TodayView(snap: snap, now: now) }
                .tabItem { Label("Hôm nay", systemImage: "house") }
            tab(Text("TKB")) { snap in TimetableView(snap: snap, today: gregorian.startOfDay(for: now)) }
                .tabItem { Label("TKB", systemImage: "calendar") }
            tab(Text("Lịch thi")) { snap in ExamsView(exams: snap.exams, now: now) }
                .tabItem { Label("Lịch thi", systemImage: "doc.text") }
            PlansView().tabItem { Label("Kế hoạch", systemImage: "checklist") }
            tab(Text("Cài đặt")) { snap in SettingsView(semesterStart: snap.semesterStart) }
                .tabItem { Label("Cài đặt", systemImage: "gearshape") }
        }
        .onReceive(timer) { now = $0 }
        .alert("Thông báo", isPresented: Binding(get: { model.message != nil && model.snapshot != nil }, set: { if !$0 { model.message = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(model.message ?? "") }
    }

    /// Khung chung: banner offline + kéo để tải lại + trạng thái chưa có dữ liệu.
    private func tab<T: View>(_ title: Text, @ViewBuilder content: @escaping (Snapshot) -> T) -> some View {
        NavigationStack {
            VStack(spacing: 0) {
                if model.snapshot?.offline == true {
                    Text("⚠ Đang offline — xem dữ liệu đã lưu (chỉ đọc)")
                        .font(.footnote).frame(maxWidth: .infinity).padding(8).background(Color.orange.opacity(0.2))
                }
                if let snap = model.snapshot {
                    content(snap)
                } else if model.loading {
                    ProgressView().frame(maxHeight: .infinity)
                } else {
                    Text(model.message ?? "Chưa có dữ liệu — kéo xuống để tải lại").foregroundStyle(.secondary)
                        .padding().frame(maxHeight: .infinity)
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .refreshable { await model.refresh() }
        }
    }
}

struct TodayView: View {
    let snap: Snapshot
    let now: Date

    var body: some View {
        let today = gregorian.startOfDay(for: now)
        let wi = currentWeekIndex(today: today, semesterStart: snap.semesterStart)
        let nameById = Dictionary(snap.subjects.map { ($0.id, baseSubjectLabel($0.name)) }, uniquingKeysWith: { a, _ in a })
        let due = Array(sortByDue(snap.details.filter { $0.type == "task" }, today: today).prefix(5))
        List {
            Section { heroCard(computeHero(now: now, subjects: snap.subjects, semesterStart: snap.semesterStart), today: today) }
            Section {
                HStack {
                    stat("Môn học", distinctSubjectCount(snap.subjects))
                    stat("Buổi tuần này", activeSubjectCount(snap.subjects, weekIndex: wi))
                    stat("Môn thi", visibleExams(snap.exams, today: today).count)
                }
            }
            Section("Sắp tới hạn") {
                if due.isEmpty { Text("Không có công việc nào có hạn.").foregroundStyle(.secondary) }
                ForEach(due) { d in
                    let days = parseISODate(d.dueDate).map { calendarDayDiff($0, today) } ?? 0
                    VStack(alignment: .leading, spacing: 2) {
                        Text(d.content)
                        Text("\(nameById[d.subjectId] ?? "") · " + (days < 0 ? "trễ \(-days) ngày" : days == 0 ? "hạn hôm nay" : "còn \(days) ngày"))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private func stat(_ label: String, _ value: Int) -> some View {
        VStack { Text("\(value)").font(.title).bold(); Text(label).font(.caption2).multilineTextAlignment(.center) }
            .frame(maxWidth: .infinity)
    }

    @ViewBuilder private func heroCard(_ hero: Hero, today: Date) -> some View {
        switch hero {
        case .ongoing(let s, let r, let left):
            VStack(alignment: .leading, spacing: 4) {
                Text("ĐANG DIỄN RA").font(.caption).foregroundStyle(.secondary)
                Text(baseSubjectLabel(s.name)).font(.title2).bold()
                Text("\(fmtMinutesHM(r.startMin))–\(fmtMinutesHM(r.endMin)) · Phòng \(roomText(s))")
                Text("Còn \(left) phút · GV: \(lecturerText(s))")
            }
        case .next(let s, let r, let date, let until):
            let whenText: String = {
                if calendarDayDiff(date, today) == 0 { return "Hôm nay, còn \(until ?? 0) phút nữa" }
                if calendarDayDiff(date, today) == 1 { return "Ngày mai" }
                return "\(dayNames[s.day] ?? "") \(fmtDM(date))"
            }()
            VStack(alignment: .leading, spacing: 4) {
                Text("BUỔI SẮP TỚI").font(.caption).foregroundStyle(.secondary)
                Text(baseSubjectLabel(s.name)).font(.title2).bold()
                Text("\(whenText) · \(fmtMinutesHM(r.startMin))–\(fmtMinutesHM(r.endMin))")
                Text("Phòng \(roomText(s)) · GV: \(lecturerText(s))")
            }
        case .notStarted(let d): Text("Kỳ học bắt đầu ngày \(fmtDMY(d))").font(.headline)
        case .ended: Text("Kỳ học đã kết thúc").font(.headline)
        case .noSubjects: Text("Chưa có thời khóa biểu — nhập TKB trên web").font(.headline)
        case .nothingAhead: Text("Không còn buổi học nào phía trước").font(.headline)
        }
    }
}

struct TimetableView: View {
    let snap: Snapshot
    let today: Date
    @State private var week: Int? = nil

    var body: some View {
        let current = min(max(currentWeekIndex(today: today, semesterStart: snap.semesterStart), 0), maxSemesterWeeks - 1)
        let w = week ?? current
        let monday = addDays(snap.semesterStart, w * 7)
        List {
            Section {
                HStack {
                    Button { week = max(0, w - 1) } label: { Image(systemName: "chevron.left") }.disabled(w == 0)
                    Spacer()
                    Text("Tuần \(w + 1) · \(fmtDM(monday))–\(fmtDM(addDays(monday, 6)))").font(.headline)
                    Spacer()
                    Button { week = min(maxSemesterWeeks - 1, w + 1) } label: { Image(systemName: "chevron.right") }.disabled(w == maxSemesterWeeks - 1)
                }
                .buttonStyle(.borderless)
            }
            ForEach(2...8, id: \.self) { day in
                let date = addDays(monday, day - 2)
                let sessions = daySessions(snap.subjects, weekIndex: w, day: day)
                Section("\(dayNames[day] ?? "") \(fmtDM(date))" + (calendarDayDiff(date, today) == 0 ? " · hôm nay" : "")) {
                    if sessions.isEmpty { Text("Không có lịch").foregroundStyle(.secondary).font(.footnote) }
                    ForEach(sessions, id: \.0.id) { (s, r) in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(baseSubjectLabel(s.name)).font(.headline)
                            Text("\(fmtMinutesHM(r.startMin))–\(fmtMinutesHM(r.endMin)) · \(s.timeSlot)")
                            Text("Phòng \(roomText(s)) · GV: \(lecturerText(s))").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }
}

struct ExamsView: View {
    let exams: [Exam]
    let now: Date

    var body: some View {
        let list = visibleExams(exams, today: gregorian.startOfDay(for: now))
        List {
            if list.isEmpty { Text("Chưa có lịch thi.").foregroundStyle(.secondary) }
            ForEach(list) { e in
                VStack(alignment: .leading, spacing: 2) {
                    Text(e.subjectName).font(.headline)
                    Text("\(e.examDate) · \(e.examTime.isEmpty ? "—" : e.examTime) · Phòng \(e.room.isEmpty ? "—" : e.room)")
                    if let st = examStart(e), st < now { Text("Đã thi").font(.caption2).foregroundStyle(.secondary) }
                }
            }
        }
    }
}

struct PlansView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        Button { Task { await model.loadPlans(addDays(model.plansDate, -1)) } } label: { Image(systemName: "chevron.left") }
                        Spacer()
                        Text(fmtDMY(model.plansDate)).font(.headline)
                        Spacer()
                        Button { Task { await model.loadPlans(addDays(model.plansDate, 1)) } } label: { Image(systemName: "chevron.right") }
                    }
                    .buttonStyle(.borderless)
                    if model.plansOffline { Text("Đang xem bản đã lưu").font(.caption).foregroundStyle(.secondary) }
                }
                if model.plans.isEmpty { Text("Chưa có kế hoạch cho ngày này.").foregroundStyle(.secondary) }
                ForEach(model.plans) { p in
                    Button { Task { await model.togglePlan(p) } } label: {
                        HStack {
                            Image(systemName: p.isDone ? "checkmark.circle.fill" : "circle")
                            VStack(alignment: .leading) {
                                Text(p.title.isEmpty ? "(không tên)" : p.title).strikethrough(p.isDone)
                                Text("\(fmtMinutesHM(p.startMin))–\(fmtMinutesHM(p.endMin))").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                    .foregroundStyle(.primary)
                }
            }
            .navigationTitle("Kế hoạch")
            .navigationBarTitleDisplayMode(.inline)
            .refreshable { await model.loadPlans(model.plansDate) }
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject var model: AppModel
    let semesterStart: Date
    @State private var picked = Date()

    var body: some View {
        List {
            Section("Tài khoản") { Text(model.email) }
            Section("Học kỳ") {
                Text("Đầu học kỳ: \(fmtDMY(semesterStart))")
                DatePicker("Đổi ngày bắt đầu", selection: $picked, displayedComponents: .date)
                Button("Lưu ngày bắt đầu") { Task { await model.saveSemesterStart(picked) } }
            }
            Section {
                Text("Dữ liệu được lưu trên máy để xem khi mất mạng. Đăng xuất sẽ xoá dữ liệu này.").font(.footnote)
                Button("Đăng xuất", role: .destructive) { Task { await model.logout() } }
            }
        }
        .onAppear { picked = semesterStart }
    }
}
