package vn.sgu.workspace.ui

import android.app.DatePickerDialog
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import vn.sgu.workspace.core.Hero
import vn.sgu.workspace.core.MAX_SEMESTER_WEEKS
import vn.sgu.workspace.core.Subject
import vn.sgu.workspace.core.activeSubjectCount
import vn.sgu.workspace.core.baseSubjectLabel
import vn.sgu.workspace.core.computeHero
import vn.sgu.workspace.core.currentWeekIndex
import vn.sgu.workspace.core.daySessions
import vn.sgu.workspace.core.distinctSubjectCount
import vn.sgu.workspace.core.fmtMinutesHM
import vn.sgu.workspace.core.examStart
import vn.sgu.workspace.core.sortByDue
import vn.sgu.workspace.core.visibleExams
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

private val DMY = DateTimeFormatter.ofPattern("dd/MM/yyyy")
private val DM = DateTimeFormatter.ofPattern("dd/MM")
private val DAY_NAMES = mapOf(2 to "Thứ Hai", 3 to "Thứ Ba", 4 to "Thứ Tư", 5 to "Thứ Năm", 6 to "Thứ Sáu", 7 to "Thứ Bảy", 8 to "Chủ Nhật")

@Composable
fun LoginScreen(loading: Boolean, message: String?, onLogin: (String, String) -> Unit) {
    var email by remember { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center) {
        Text("SGU Workspace", style = MaterialTheme.typography.headlineLarge)
        Text("Đăng nhập bằng tài khoản đang dùng trên web", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(bottom = 24.dp))
        OutlinedTextField(email, { email = it }, label = { Text("Email") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(pass, { pass = it }, label = { Text("Mật khẩu") }, singleLine = true,
            visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth().padding(top = 8.dp))
        if (message != null) Text(message, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp))
        Button(onClick = { onLogin(email, pass) }, enabled = !loading && email.isNotBlank() && pass.isNotBlank(),
            modifier = Modifier.fillMaxWidth().padding(top = 16.dp)) {
            if (loading) CircularProgressIndicator(Modifier.padding(2.dp), strokeWidth = 2.dp) else Text("Đăng nhập")
        }
    }
}

private enum class Tab(val label: String, val icon: String) {
    Today("Hôm nay", "🏠"), Timetable("TKB", "📅"), Exams("Lịch thi", "📝"), Plans("Kế hoạch", "✅"), Settings("Cài đặt", "⚙")
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen(vm: AppViewModel, state: UiState) {
    var tab by remember { mutableStateOf(Tab.Today) }
    val snack = remember { SnackbarHostState() }
    // Giờ hiện tại cập nhật mỗi 30s -> hero/đếm ngược luôn đúng, và TỰ ĐỔI TUẦN khi qua nửa đêm (tuần tính lại từ `now`).
    var now by remember { mutableStateOf(LocalDateTime.now()) }
    LaunchedEffect(Unit) { while (true) { delay(30_000); now = LocalDateTime.now() } }
    LaunchedEffect(state.message) { state.message?.let { snack.showSnackbar(it); vm.consumeMessage() } }

    Scaffold(
        snackbarHost = { SnackbarHost(snack) },
        bottomBar = {
            NavigationBar {
                Tab.entries.forEach { t ->
                    NavigationBarItem(selected = tab == t, onClick = { tab = t },
                        icon = { Text(t.icon) }, label = { Text(t.label, maxLines = 1) })
                }
            }
        },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            if (state.snapshot?.offline == true) {
                Text("⚠ Đang offline — xem dữ liệu đã lưu (chỉ đọc)", modifier = Modifier.fillMaxWidth().padding(8.dp),
                    textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.tertiary)
            }
            PullToRefreshBox(isRefreshing = state.loading, onRefresh = { vm.refresh() }, modifier = Modifier.fillMaxSize()) {
                val snap = state.snapshot
                if (snap == null) {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        if (state.loading) CircularProgressIndicator() else Text("Chưa có dữ liệu — kéo xuống để tải lại")
                    }
                } else when (tab) {
                    Tab.Today -> TodayScreen(snap.subjects, snap.exams, snap.details, snap.semesterStart, now)
                    Tab.Timetable -> TimetableScreen(snap.subjects, snap.semesterStart, now.toLocalDate())
                    Tab.Exams -> ExamsScreen(snap.exams, now)
                    Tab.Plans -> PlansScreen(vm, state)
                    Tab.Settings -> SettingsScreen(vm, state, snap.semesterStart)
                }
            }
        }
    }
}

@Composable
private fun TodayScreen(
    subjects: List<Subject>, exams: List<vn.sgu.workspace.core.Exam>, details: List<vn.sgu.workspace.core.Detail>,
    semesterStart: LocalDate, now: LocalDateTime,
) {
    val today = now.toLocalDate()
    val wi = currentWeekIndex(today, semesterStart)
    val hero = computeHero(now, subjects, semesterStart)
    val nameById = subjects.associate { it.id to baseSubjectLabel(it.name) }
    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    when (hero) {
                        is Hero.Ongoing -> {
                            Text("ĐANG DIỄN RA", style = MaterialTheme.typography.labelMedium)
                            Text(baseSubjectLabel(hero.subject.name), style = MaterialTheme.typography.headlineSmall)
                            Text("${fmtMinutesHM(hero.range.startMin)}–${fmtMinutesHM(hero.range.endMin)} · Phòng ${hero.subject.room.ifBlank { "—" }}")
                            Text("Còn ${hero.minsLeft} phút · GV: ${hero.subject.lecturer.ifBlank { "—" }}")
                        }
                        is Hero.Next -> {
                            val whenText = when {
                                hero.date == today -> "Hôm nay, còn ${hero.minsUntil} phút nữa"
                                hero.date == today.plusDays(1) -> "Ngày mai"
                                else -> "${DAY_NAMES[hero.subject.day]} ${hero.date.format(DM)}"
                            }
                            Text("BUỔI SẮP TỚI", style = MaterialTheme.typography.labelMedium)
                            Text(baseSubjectLabel(hero.subject.name), style = MaterialTheme.typography.headlineSmall)
                            Text("$whenText · ${fmtMinutesHM(hero.range.startMin)}–${fmtMinutesHM(hero.range.endMin)}")
                            Text("Phòng ${hero.subject.room.ifBlank { "—" }} · GV: ${hero.subject.lecturer.ifBlank { "—" }}")
                        }
                        is Hero.NotStarted -> Text("Kỳ học bắt đầu ngày ${hero.startDate.format(DMY)}", style = MaterialTheme.typography.titleMedium)
                        Hero.Ended -> Text("Kỳ học đã kết thúc", style = MaterialTheme.typography.titleMedium)
                        Hero.NoSubjects -> Text("Chưa có thời khóa biểu — nhập TKB trên web", style = MaterialTheme.typography.titleMedium)
                        Hero.NothingAhead -> Text("Không còn buổi học nào phía trước", style = MaterialTheme.typography.titleMedium)
                    }
                }
            }
        }
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Stat("Môn học", distinctSubjectCount(subjects).toString(), Modifier.weight(1f))
                Stat("Buổi học tuần này", activeSubjectCount(subjects, wi).toString(), Modifier.weight(1f))
                Stat("Môn thi", visibleExams(exams, today).size.toString(), Modifier.weight(1f))
            }
        }
        item { Text("Sắp tới hạn", style = MaterialTheme.typography.titleMedium) }
        val due = sortByDue(details.filter { it.type == "task" }, today).take(5)
        if (due.isEmpty()) item { Text("Không có công việc nào có hạn.") }
        items(due) { d ->
            val days = d.dueDate?.take(10)?.let { java.time.temporal.ChronoUnit.DAYS.between(today, LocalDate.parse(it)) } ?: 0
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp)) {
                    Text(d.content, style = MaterialTheme.typography.bodyLarge)
                    Text("${nameById[d.subjectId] ?: ""} · " + when {
                        days < 0 -> "trễ ${-days} ngày"
                        days == 0L -> "hạn hôm nay"
                        else -> "còn $days ngày"
                    }, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

@Composable
private fun Stat(label: String, value: String, modifier: Modifier) {
    Card(modifier) {
        Column(Modifier.padding(12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(value, style = MaterialTheme.typography.headlineMedium)
            Text(label, style = MaterialTheme.typography.labelSmall, textAlign = TextAlign.Center)
        }
    }
}

@Composable
private fun TimetableScreen(subjects: List<Subject>, semesterStart: LocalDate, today: LocalDate) {
    val current = currentWeekIndex(today, semesterStart).coerceIn(0, MAX_SEMESTER_WEEKS - 1)
    var week by remember(current) { mutableIntStateOf(current) }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton({ if (week > 0) week-- }, enabled = week > 0) { Text("‹") }
            val monday = semesterStart.plusWeeks(week.toLong())
            Text("Tuần ${week + 1} · ${monday.format(DM)}–${monday.plusDays(6).format(DM)}", style = MaterialTheme.typography.titleMedium)
            TextButton({ if (week < MAX_SEMESTER_WEEKS - 1) week++ }, enabled = week < MAX_SEMESTER_WEEKS - 1) { Text("›") }
        }
        LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            (2..8).forEach { day ->
                val sessions = daySessions(subjects, week, day)
                val date = semesterStart.plusWeeks(week.toLong()).plusDays((day - 2).toLong())
                item { Text("${DAY_NAMES[day]} ${date.format(DM)}" + if (date == today) "  · hôm nay" else "", style = MaterialTheme.typography.titleSmall) }
                if (sessions.isEmpty()) item { Text("Không có lịch", style = MaterialTheme.typography.bodySmall) }
                items(sessions) { (s, r) ->
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(12.dp)) {
                            Text(baseSubjectLabel(s.name), style = MaterialTheme.typography.titleMedium)
                            Text("${fmtMinutesHM(r.startMin)}–${fmtMinutesHM(r.endMin)} · ${s.timeSlot}")
                            Text("Phòng ${s.room.ifBlank { "—" }} · GV: ${s.lecturer.ifBlank { "—" }}", style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ExamsScreen(exams: List<vn.sgu.workspace.core.Exam>, now: LocalDateTime) {
    val list = visibleExams(exams, now.toLocalDate())
    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (list.isEmpty()) item { Text("Chưa có lịch thi.") }
        items(list) { e ->
            val start = examStart(e)
            val over = start != null && start.isBefore(now)
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp)) {
                    Text(e.subjectName, style = MaterialTheme.typography.titleMedium)
                    Text("${e.examDate} · ${e.examTime.ifBlank { "—" }} · Phòng ${e.room.ifBlank { "—" }}")
                    if (over) Text("Đã thi", style = MaterialTheme.typography.labelSmall)
                }
            }
        }
    }
}

@Composable
private fun PlansScreen(vm: AppViewModel, state: UiState) {
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton({ vm.loadPlans(state.plansDate.minusDays(1)) }) { Text("‹") }
            Text(state.plansDate.format(DMY), style = MaterialTheme.typography.titleMedium)
            TextButton({ vm.loadPlans(state.plansDate.plusDays(1)) }) { Text("›") }
        }
        if (state.plansOffline) Text("Đang xem bản đã lưu", Modifier.padding(horizontal = 16.dp), style = MaterialTheme.typography.bodySmall)
        LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (state.plans.isEmpty()) item { Text("Chưa có kế hoạch cho ngày này.") }
            items(state.plans) { p ->
                Card(Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = p.isDone, onCheckedChange = { vm.togglePlan(p) })
                        Column(Modifier.padding(start = 8.dp)) {
                            Text(p.title.ifBlank { "(không tên)" }, style = MaterialTheme.typography.titleSmall)
                            Text("${fmtMinutesHM(p.startMin)}–${fmtMinutesHM(p.endMin)}", style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SettingsScreen(vm: AppViewModel, state: UiState, semesterStart: LocalDate) {
    val ctx = LocalContext.current
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Tài khoản", style = MaterialTheme.typography.titleMedium)
        Text(state.email)
        Text("Đầu học kỳ: ${semesterStart.format(DMY)}")
        OutlinedButton(onClick = {
            DatePickerDialog(ctx, { _, y, m, d -> vm.saveSemesterStart(LocalDate.of(y, m + 1, d)) },
                semesterStart.year, semesterStart.monthValue - 1, semesterStart.dayOfMonth).show()
        }) { Text("Đổi ngày bắt đầu học kỳ") }
        Text("Dữ liệu được lưu trên máy để xem khi mất mạng. Đăng xuất sẽ xoá dữ liệu này.", style = MaterialTheme.typography.bodySmall)
        Button(onClick = { vm.logout() }) { Text("Đăng xuất") }
    }
}
