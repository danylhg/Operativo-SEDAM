package mx.sedam.movil.ui.login

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import mx.sedam.movil.data.SessionRepository
import mx.sedam.movil.security.SecureStore

/** Estados del flujo de login (ver máquina de estados del diseño). */
sealed interface LoginState {
    data object Idle : LoginState
    data object Connecting : LoginState
    data object Handshake : LoginState
    data object Authenticated : LoginState
    data class Error(val message: String) : LoginState
}

/** Campos del formulario, precargados desde el almacén seguro. */
data class LoginForm(
    val server: String,
    val port: String,
    val serial: String,
    val token: String,
)

class LoginViewModel(app: Application) : AndroidViewModel(app) {

    private val store = SecureStore(app)
    private val repo = SessionRepository

    private val _state = MutableStateFlow<LoginState>(LoginState.Idle)
    val state: StateFlow<LoginState> = _state.asStateFlow()

    private val _form = MutableStateFlow(
        LoginForm(store.server, store.port, store.serial, store.token)
    )
    val form: StateFlow<LoginForm> = _form.asStateFlow()

    private var timeoutJob: Job? = null

    fun onFormChange(form: LoginForm) { _form.value = form }

    fun connect() {
        val f = _form.value
        if (f.server.isBlank() || f.serial.isBlank()) {
            _state.value = LoginState.Error("Servidor y número de serie son obligatorios")
            return
        }
        val port = f.port.toIntOrNull() ?: run {
            _state.value = LoginState.Error("Puerto inválido")
            return
        }

        _state.value = LoginState.Connecting

        repo.socket.onPublicKey = { pem ->
            _state.value = LoginState.Handshake
            runCatching { repo.socket.sendAesKey(repo.crypto.generateAndWrapKey(pem)) }
                .onFailure { fail("Error en cifrado: ${it.message}") }
        }
        repo.socket.onReady = { ok ->
            if (ok) {
                store.save(f.server, f.port, f.serial, f.token)
                cancelTimeout()
                _state.value = LoginState.Authenticated
            } else {
                fail("El servidor rechazó el canal cifrado")
            }
        }
        repo.socket.onError = { fail(mapError(it)) }

        repo.socket.connect(f.server, port, f.serial.trim(), f.token)

        // El backend cierra el socket a los 15 s si no completamos el handshake.
        timeoutJob = viewModelScope.launch {
            delay(15_000)
            if (_state.value is LoginState.Connecting || _state.value is LoginState.Handshake) {
                fail("Tiempo de espera agotado (¿serial no autorizado o token inválido?)")
            }
        }
    }

    fun reset() {
        cancelTimeout()
        repo.disconnect()
        _state.value = LoginState.Idle
    }

    private fun fail(msg: String) {
        cancelTimeout()
        repo.disconnect()
        _state.value = LoginState.Error(msg)
    }

    private fun cancelTimeout() { timeoutJob?.cancel(); timeoutJob = null }

    private fun mapError(raw: String): String = when {
        raw.contains("certificate", true) || raw.contains("trust", true) ->
            "Certificado no confiable (revisa la CA en network_security_config)"
        raw.contains("timeout", true) -> "El servidor no respondió"
        else -> "No se pudo conectar: $raw"
    }

    override fun onCleared() {
        cancelTimeout()
        super.onCleared()
    }
}
