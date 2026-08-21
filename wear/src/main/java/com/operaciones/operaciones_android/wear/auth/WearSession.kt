package com.operaciones.operaciones_android.wear.auth

import android.content.Context
import android.util.Base64
import com.operaciones.operaciones_android.wear.data.WearOperation
import com.operaciones.operaciones_android.wear.data.WearOperationStatus
import com.operaciones.operaciones_android.wear.data.WearUser
import com.operaciones.operaciones_android.wear.data.WearUserRole
import org.json.JSONObject

object WearSession {
    private const val PREFS = "sedam_wear_session"
    private const val KEY_LOGGED = "logged_in"
    private const val KEY_TOKEN = "token"
    private const val KEY_ID = "uid"
    private const val KEY_NOMBRE = "nombre"
    private const val KEY_APELLIDO = "apellido"
    private const val KEY_USERNAME = "username"
    private const val KEY_ROL = "rol"
    private const val KEY_JERARQUIA = "jerarquia"
    private const val KEY_TABLA = "tabla"

    private const val KEY_OP_ID = "op_id"
    private const val KEY_OP_CODIGO = "op_codigo"
    private const val KEY_OP_NOMBRE = "op_nombre"
    private const val KEY_OP_DESCRIPCION = "op_descripcion"
    private const val KEY_OP_PRIORIDAD = "op_prioridad"
    private const val KEY_OP_STATUS = "op_status"
    private const val KEY_OP_FECHA_INICIO = "op_fecha_inicio"
    private const val KEY_OP_FECHA_FIN = "op_fecha_fin"
    private const val KEY_OP_LAT = "op_lat"
    private const val KEY_OP_LON = "op_lon"
    private const val KEY_OP_ZOOM = "op_zoom"

    fun save(context: Context, user: WearUser, token: String, operation: WearOperation?) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean(KEY_LOGGED, true)
            .putString(KEY_TOKEN, token)
            .putInt(KEY_ID, user.id)
            .putString(KEY_NOMBRE, user.nombre)
            .putString(KEY_APELLIDO, user.apellido)
            .putString(KEY_USERNAME, user.username)
            .putString(KEY_ROL, user.rol.name)
            .putString(KEY_JERARQUIA, user.jerarquia)
            .putString(KEY_TABLA, user.tabla)
            .apply()
        saveOperation(context, operation)
    }

    fun saveOperation(context: Context, operation: WearOperation?) {
        val editor = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        if (operation == null) {
            editor.putInt(KEY_OP_ID, -1)
        } else {
            editor.putInt(KEY_OP_ID, operation.id)
                .putString(KEY_OP_CODIGO, operation.codigo)
                .putString(KEY_OP_NOMBRE, operation.nombre)
                .putString(KEY_OP_DESCRIPCION, operation.descripcion)
                .putString(KEY_OP_PRIORIDAD, operation.prioridad)
                .putString(KEY_OP_STATUS, operation.status.name)
                .putString(KEY_OP_FECHA_INICIO, operation.fechaInicio)
                .putString(KEY_OP_FECHA_FIN, operation.fechaFin)
                .putFloat(KEY_OP_LAT, operation.zonaLat.toFloat())
                .putFloat(KEY_OP_LON, operation.zonaLon.toFloat())
                .putInt(KEY_OP_ZOOM, operation.zonaZoom)
        }
        editor.apply()
    }

    fun isLoggedIn(context: Context): Boolean {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return prefs.getBoolean(KEY_LOGGED, false) &&
            isTokenValid(prefs.getString(KEY_TOKEN, "").orEmpty())
    }

    fun token(context: Context): String =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_TOKEN, "") ?: ""

    fun user(context: Context): WearUser? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!isLoggedIn(context)) return null
        return WearUser(
            id = prefs.getInt(KEY_ID, -1),
            nombre = prefs.getString(KEY_NOMBRE, "") ?: "",
            apellido = prefs.getString(KEY_APELLIDO, "") ?: "",
            username = prefs.getString(KEY_USERNAME, "") ?: "",
            rol = WearUserRole.from(prefs.getString(KEY_ROL, "CELL") ?: "CELL"),
            jerarquia = prefs.getString(KEY_JERARQUIA, "") ?: "",
            tabla = prefs.getString(KEY_TABLA, "personal") ?: "personal"
        )
    }

    fun operation(context: Context): WearOperation? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val id = prefs.getInt(KEY_OP_ID, -1)
        if (id <= 0) return null
        return WearOperation(
            id = id,
            codigo = prefs.getString(KEY_OP_CODIGO, "") ?: "",
            nombre = prefs.getString(KEY_OP_NOMBRE, "Operacion") ?: "Operacion",
            descripcion = prefs.getString(KEY_OP_DESCRIPCION, "") ?: "",
            prioridad = prefs.getString(KEY_OP_PRIORIDAD, "MEDIA") ?: "MEDIA",
            status = WearOperationStatus.from(prefs.getString(KEY_OP_STATUS, "PLANIFICADA") ?: "PLANIFICADA"),
            fechaInicio = prefs.getString(KEY_OP_FECHA_INICIO, "") ?: "",
            fechaFin = prefs.getString(KEY_OP_FECHA_FIN, "") ?: "",
            zonaLat = prefs.getFloat(KEY_OP_LAT, 0f).toDouble(),
            zonaLon = prefs.getFloat(KEY_OP_LON, 0f).toDouble(),
            zonaZoom = prefs.getInt(KEY_OP_ZOOM, 8000)
        )
    }

    fun clear(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    }

    private fun isTokenValid(token: String): Boolean {
        if (token.isBlank()) return false
        return runCatching {
            val payload = token.split('.').getOrNull(1) ?: return false
            val decoded = String(
                Base64.decode(payload, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING),
                Charsets.UTF_8
            )
            val expiresAtSeconds = JSONObject(decoded).optLong("exp", 0L)
            expiresAtSeconds > System.currentTimeMillis() / 1000L + 30L
        }.getOrDefault(false)
    }
}
