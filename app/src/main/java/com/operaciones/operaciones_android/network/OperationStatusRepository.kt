package com.operaciones.operaciones_android.network

import com.operaciones.operaciones_android.config.ApiConfig
import com.operaciones.operaciones_android.model.Operation
import com.operaciones.operaciones_android.model.OperationStatus
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException

class OperationStatusRepository(
    private val http: OkHttpClient = OkHttpClient()
) {

    fun fetchAssignedOperation(
        userId: Int,
        token: String,
        onSuccess: (Operation?) -> Unit,
        onError: (String) -> Unit
    ) {
        val req = Request.Builder()
            .url("${ApiConfig.BASE_URL}/ops/personal/$userId")
            .get()
            .addHeader("Authorization", "Bearer $token")
            .build()

        http.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                onError("No se pudo verificar el estado.\nRevisa tu conexión.")
            }

            override fun onResponse(call: Call, response: Response) {
                val bodyStr = response.body?.string() ?: ""

                try {
                    when {
                        response.isSuccessful -> {
                            val json = JSONObject(bodyStr)
                            val opJson = json.optJSONObject("operacion")
                            if (opJson != null) {
                                onSuccess(parseOperation(opJson))
                            } else {
                                onSuccess(null)
                            }
                        }

                        response.code == 404 -> onSuccess(null)

                        else -> onError("Error del servidor (${response.code}).")
                    }
                } catch (e: Exception) {
                    onError("Error al procesar la respuesta del servidor.")
                }
            }
        })
    }

    private fun parseOperation(o: JSONObject): Operation {
        val estadoStr = o.optString("estado", "PLANIFICADA").uppercase()
        val status = try {
            OperationStatus.valueOf(estadoStr)
        } catch (_: Exception) {
            OperationStatus.PLANIFICADA
        }

        val zona = o.optJSONObject("zona")

        return Operation(
            id = o.getInt("id_operacion"),
            codigo = o.optString("codigo", ""),
            nombre = o.optString("nombre", "Sin nombre"),
            descripcion = o.optString("descripcion", ""),
            prioridad = o.optString("prioridad", "MEDIA"),
            status = status,
            fechaInicio = o.optString("fecha_inicio", ""),
            fechaFin = o.optString("fecha_fin", ""),
            zonaLat = zona?.optDouble("centroide_lat", 0.0) ?: 0.0,
            zonaLon = zona?.optDouble("centroide_lon", 0.0) ?: 0.0,
            zonaZoom = zona?.optInt("zoom_inicial", 8000) ?: 8000
        )
    }
}