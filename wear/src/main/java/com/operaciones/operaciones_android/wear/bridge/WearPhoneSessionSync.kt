package com.operaciones.operaciones_android.wear.bridge

import android.content.Context
import com.operaciones.operaciones_android.wear.auth.WearSession
import com.operaciones.operaciones_android.wear.config.WearApiConfig
import com.operaciones.operaciones_android.wear.data.WearOperation
import com.operaciones.operaciones_android.wear.data.WearOperationStatus
import com.operaciones.operaciones_android.wear.data.WearUser
import com.operaciones.operaciones_android.wear.data.WearUserRole
import org.json.JSONObject

object WearPhoneSessionSync {
    const val PATH_SESSION_REQUEST = "/sedam/session/request"
    const val PATH_SESSION_SYNC = "/sedam/session/sync"
    const val PATH_SESSION_ERROR = "/sedam/session/error"

    fun apply(context: Context, payload: JSONObject): Boolean {
        payload.optString("api_base_url", "")
            .takeIf { it.isNotBlank() }
            ?.let { WearApiConfig.saveBaseUrl(context, it) }

        val token = payload.optString("token", "")
        val userJson = payload.optJSONObject("usuario")
        if (token.isBlank() || userJson == null) return false

        val tabla = userJson.optString("tabla", "personal")
        val id = if (tabla == "personal") {
            userJson.optInt("id_personal", 0).takeIf { it > 0 }
                ?: userJson.optInt("id_usuario", 0)
        } else {
            userJson.optInt("id_usuario", 0)
        }

        if (id <= 0) return false

        val user = WearUser(
            id = id,
            nombre = userJson.optString("nombre", ""),
            apellido = userJson.optString("apellido", ""),
            username = userJson.optString("username", ""),
            rol = WearUserRole.from(userJson.optString("rol", "CELL")),
            jerarquia = userJson.optString("puesto", ""),
            tabla = tabla
        )

        val operation = payload.optJSONObject("operacion")
            ?.takeIf { it.optInt("id_operacion", -1) > 0 }
            ?.let { WearOperation.fromJson(it) }

        if (operation?.status != WearOperationStatus.ACTIVA) {
            WearSession.clear(context)
            return false
        }

        WearSession.save(context, user, token, operation)
        return true
    }
}
