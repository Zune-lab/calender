package vn.sgu.workspace

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.Color
import vn.sgu.workspace.ui.AppViewModel
import vn.sgu.workspace.ui.LoginScreen
import vn.sgu.workspace.ui.MainScreen

class MainActivity : ComponentActivity() {
    private val vm: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            // Màu nhấn #FF3366 và nền #08090C giống bản web
            val scheme = if (isSystemInDarkTheme())
                darkColorScheme(primary = Color(0xFFFF3366), background = Color(0xFF08090C), surface = Color(0xFF08090C))
            else lightColorScheme(primary = Color(0xFFFF3366))
            MaterialTheme(colorScheme = scheme) {
                Surface {
                    val state by vm.state.collectAsState()
                    if (state.loggedIn) MainScreen(vm, state)
                    else LoginScreen(state.loading, state.message) { e, p -> vm.login(e, p) }
                }
            }
        }
    }
}
