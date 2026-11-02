package vn.sgu.workspace.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import vn.sgu.workspace.core.Plan
import vn.sgu.workspace.data.ApiException
import vn.sgu.workspace.data.AuthExpiredException
import vn.sgu.workspace.data.NetworkException
import vn.sgu.workspace.data.OfflineCache
import vn.sgu.workspace.data.Repository
import vn.sgu.workspace.data.SessionStore
import vn.sgu.workspace.data.Snapshot
import vn.sgu.workspace.data.SupabaseApi
import java.time.LocalDate

data class UiState(
    val loggedIn: Boolean = false,
    val email: String = "",
    val loading: Boolean = false,
    val message: String? = null,
    val snapshot: Snapshot? = null,
    val plansDate: LocalDate = LocalDate.now(),
    val plans: List<Plan> = emptyList(),
    val plansOffline: Boolean = false,
)

class AppViewModel(app: Application) : AndroidViewModel(app) {
    private val api = SupabaseApi(SessionStore(app))
    private val repo = Repository(api, OfflineCache(app.filesDir))
    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    init {
        val s = api.session
        if (s != null) {
            _state.value = _state.value.copy(loggedIn = true, email = s.email)
            refresh()
        }
    }

    private fun handle(e: Throwable) {
        when (e) {
            is AuthExpiredException -> {
                viewModelScope.launch(Dispatchers.IO) { repo.signOut() } // xoá phiên + bản sao offline khỏi thiết bị
                _state.value = UiState(message = "Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại")
            }
            is NetworkException -> _state.value = _state.value.copy(loading = false,
                message = if (_state.value.snapshot == null) "Chưa có dữ liệu đã lưu. Hãy kết nối mạng để tải lần đầu." else null)
            is ApiException -> _state.value = _state.value.copy(loading = false, message = e.message)
            else -> _state.value = _state.value.copy(loading = false, message = e.message ?: "Có lỗi xảy ra")
        }
    }

    fun login(email: String, password: String) {
        _state.value = _state.value.copy(loading = true, message = null)
        viewModelScope.launch {
            try {
                val s = withContext(Dispatchers.IO) { api.signIn(email.trim(), password) }
                _state.value = _state.value.copy(loggedIn = true, email = s.email)
                refresh()
            } catch (e: NetworkException) {
                _state.value = _state.value.copy(loading = false, message = "Không có mạng — cần kết nối để đăng nhập lần đầu")
            } catch (e: Throwable) { handle(e) }
        }
    }

    /** Tải lại dữ liệu chính (có dự phòng offline) + kế hoạch của ngày đang xem. */
    fun refresh() {
        _state.value = _state.value.copy(loading = true, message = null)
        viewModelScope.launch {
            try {
                val snap = withContext(Dispatchers.IO) { repo.loadSnapshot() }
                _state.value = _state.value.copy(snapshot = snap, loading = false)
                loadPlans(_state.value.plansDate)
            } catch (e: Throwable) { handle(e) }
        }
    }

    fun loadPlans(date: LocalDate) {
        _state.value = _state.value.copy(plansDate = date)
        viewModelScope.launch {
            try {
                val (plans, off) = withContext(Dispatchers.IO) { repo.loadPlans(date) }
                if (_state.value.plansDate == date) _state.value = _state.value.copy(plans = plans, plansOffline = off)
            } catch (e: NetworkException) {
                _state.value = _state.value.copy(plans = emptyList(), plansOffline = true)
            } catch (e: Throwable) { handle(e) }
        }
    }

    fun togglePlan(plan: Plan) {
        viewModelScope.launch {
            try {
                withContext(Dispatchers.IO) { repo.setPlanDone(plan.id, !plan.isDone) }
                loadPlans(_state.value.plansDate)
            } catch (e: NetworkException) {
                _state.value = _state.value.copy(message = "Đang offline — chỉ xem được, chưa thể đánh dấu hoàn thành")
            } catch (e: Throwable) { handle(e) }
        }
    }

    fun saveSemesterStart(date: LocalDate) {
        viewModelScope.launch {
            try {
                withContext(Dispatchers.IO) { repo.saveSemesterStart(date) }
                refresh()
            } catch (e: NetworkException) {
                _state.value = _state.value.copy(message = "Đang offline — chưa thể đổi mốc học kỳ")
            } catch (e: Throwable) { handle(e) }
        }
    }

    fun consumeMessage() { _state.value = _state.value.copy(message = null) }

    fun logout() {
        viewModelScope.launch {
            withContext(Dispatchers.IO) { repo.signOut() }
            _state.value = UiState()
        }
    }
}
