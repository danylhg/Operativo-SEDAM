package mx.sedam.movil.security

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Guarda la configuración de conexión (incluido el device_token) CIFRADA en disco
 * vía EncryptedSharedPreferences (clave maestra en el Keystore de Android).
 * Así el operador no reescribe serial/token en cada arranque.
 */
class SecureStore(context: Context) {

    private val prefs: SharedPreferences = run {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "sedam_secure_prefs",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    var server: String
        get() = prefs.getString(KEY_SERVER, "192.168.123.145") ?: "192.168.123.145"
        set(v) = prefs.edit().putString(KEY_SERVER, v).apply()

    var port: String
        get() = prefs.getString(KEY_PORT, "3000") ?: "3000"
        set(v) = prefs.edit().putString(KEY_PORT, v).apply()

    var serial: String
        get() = prefs.getString(KEY_SERIAL, "") ?: ""
        set(v) = prefs.edit().putString(KEY_SERIAL, v).apply()

    var token: String
        get() = prefs.getString(KEY_TOKEN, "") ?: ""
        set(v) = prefs.edit().putString(KEY_TOKEN, v).apply()

    fun save(server: String, port: String, serial: String, token: String) {
        prefs.edit()
            .putString(KEY_SERVER, server)
            .putString(KEY_PORT, port)
            .putString(KEY_SERIAL, serial)
            .putString(KEY_TOKEN, token)
            .apply()
    }

    private companion object {
        const val KEY_SERVER = "server"
        const val KEY_PORT = "port"
        const val KEY_SERIAL = "serial"
        const val KEY_TOKEN = "token"
    }
}
