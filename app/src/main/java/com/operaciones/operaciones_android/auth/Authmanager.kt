package com.operaciones.operaciones_android.auth

import android.content.Context
import android.util.Base64
import com.operaciones.operaciones_android.model.User
import com.operaciones.operaciones_android.model.UserRole
import org.json.JSONObject

object AuthManager {

    private const val PREFS         = "sedam_session"
    private const val KEY_LOGGED    = "logged_in"
    private const val KEY_TOKEN     = "token"
    private const val KEY_ID        = "uid"
    private const val KEY_NOMBRE    = "nombre"
    private const val KEY_APELLIDO  = "apellido"
    private const val KEY_USERNAME  = "username"
    private const val KEY_ROL       = "rol"
    private const val KEY_JERARQUIA = "jerarquia"
    private const val KEY_TABLA     = "tabla"
    private const val KEY_ID_DISPOSITIVO = "id_dispositivo"
    private const val KEY_SESSION_EXPIRES_AT = "session_expires_at"
    private const val SESSION_DURATION_MS = 4 * 60 * 60 * 1000L

    fun saveSession(context: Context, user: User, token: String = "") {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean(KEY_LOGGED,    true)
            .putString(KEY_TOKEN,      token)
            .putInt(KEY_ID,            user.id)
            .putString(KEY_NOMBRE,     user.nombre)
            .putString(KEY_APELLIDO,   user.apellido)
            .putString(KEY_USERNAME,   user.username)
            .putString(KEY_ROL,        user.rol.name)
            .putString(KEY_JERARQUIA,  user.jerarquia)
            .putString(KEY_TABLA,      user.tabla)
            .putInt(KEY_ID_DISPOSITIVO, user.idDispositivo ?: -1)
            .putLong(KEY_SESSION_EXPIRES_AT, tokenExpirationMillis(token))
            .apply()
    }

    fun isLoggedIn(context: Context) =
        isSessionValid(context)

    fun isSessionValid(context: Context): Boolean {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!prefs.getBoolean(KEY_LOGGED, false)) return false
        val token = prefs.getString(KEY_TOKEN, "").orEmpty()
        if (token.isBlank()) return false
        val expiresAt = prefs.getLong(KEY_SESSION_EXPIRES_AT, 0L)
            .takeIf { it > 0L }
            ?: tokenExpirationMillis(token).also {
                prefs.edit().putLong(KEY_SESSION_EXPIRES_AT, it).apply()
            }
        if (System.currentTimeMillis() < expiresAt) return true
        logout(context)
        return false
    }

    fun getCurrentUser(context: Context): User? {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!isSessionValid(context)) return null

        val rolStr = p.getString(KEY_ROL, "") ?: ""
        val rol = try { UserRole.valueOf(rolStr) } catch (_: Exception) { return null }

        return User(
            id        = p.getInt(KEY_ID, -1),
            nombre    = p.getString(KEY_NOMBRE,    "") ?: "",
            apellido  = p.getString(KEY_APELLIDO,  "") ?: "",
            username  = p.getString(KEY_USERNAME,  "") ?: "",
            rol       = rol,
            jerarquia = p.getString(KEY_JERARQUIA, "") ?: "",
            tabla     = p.getString(KEY_TABLA,     "personal") ?: "personal",
            idDispositivo = p.getInt(KEY_ID_DISPOSITIVO, -1).takeIf { it > 0 }
        )
    }

    fun getToken(context: Context): String =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_TOKEN, "") ?: ""

    fun logout(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    }

    private fun tokenExpirationMillis(token: String): Long {
        val fallback = System.currentTimeMillis() + SESSION_DURATION_MS
        return runCatching {
            val payload = token.split('.').getOrNull(1) ?: return@runCatching fallback
            val decoded = String(Base64.decode(payload, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING))
            JSONObject(decoded).optLong("exp", 0L)
                .takeIf { it > 0L }
                ?.times(1000L)
                ?: fallback
        }.getOrDefault(fallback)
    }
}
