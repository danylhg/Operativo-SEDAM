package mx.sedam.movil

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.delay
import mx.sedam.movil.ui.login.LoginScreen
import mx.sedam.movil.ui.login.LoginState
import mx.sedam.movil.ui.login.LoginViewModel
import mx.sedam.movil.ui.map.MapScreen
import mx.sedam.movil.ui.session.ConnectedScreen
import mx.sedam.movil.ui.theme.Gold
import mx.sedam.movil.ui.theme.NavyDeep
import mx.sedam.movil.ui.theme.SteelText
import mx.sedam.movil.ui.theme.White
import mx.sedam.movil.ui.theme.SedamTheme

/** Duración de la pantalla "enlace establecido" antes de pasar al mapa. */
private const val CONNECTED_DWELL_MS = 2800L

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            SedamTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    val vm: LoginViewModel = viewModel()
                    val state by vm.state.collectAsStateWithLifecycle()

                    if (state is LoginState.Authenticated) {
                        AuthenticatedFlow(onLogout = { vm.reset() })
                    } else {
                        LoginScreen(vm)
                    }
                }
            }
        }
    }
}

/**
 * Tras autenticar: pantalla de enlace unos segundos y luego el mapa. Tanto el
 * botón de cerrar sesión como el botón físico "atrás" piden confirmación y, si
 * se acepta, cierran el enlace y vuelven al login. `remember` se reinicia al
 * salir de este subárbol.
 */
@Composable
private fun AuthenticatedFlow(onLogout: () -> Unit) {
    var showMap by remember { mutableStateOf(false) }
    var confirmLogout by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        delay(CONNECTED_DWELL_MS)
        showMap = true
    }

    // "Atrás" no cierra la app: pide cerrar sesión para volver al inicio.
    BackHandler { confirmLogout = true }

    Crossfade(targetState = showMap, animationSpec = tween(600), label = "connected-map") { onMap ->
        if (onMap) MapScreen(onLogout = { confirmLogout = true }) else ConnectedScreen()
    }

    if (confirmLogout) {
        LogoutDialog(
            onConfirm = { confirmLogout = false; onLogout() },
            onDismiss = { confirmLogout = false },
        )
    }
}

@Composable
private fun LogoutDialog(onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = NavyDeep,
        titleContentColor = White,
        textContentColor = SteelText,
        title = { Text("¿Cerrar sesión?", fontWeight = FontWeight.Bold, letterSpacing = 1.sp) },
        text = { Text("Se cerrará el enlace cifrado y volverás a la pantalla de acceso.") },
        confirmButton = {
            TextButton(onClick = onConfirm) {
                Text("CERRAR SESIÓN", color = Gold, fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("CANCELAR", color = SteelText, letterSpacing = 1.sp)
            }
        },
    )
}
