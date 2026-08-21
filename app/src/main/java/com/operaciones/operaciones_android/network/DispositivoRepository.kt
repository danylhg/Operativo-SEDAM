package com.operaciones.operaciones_android.network

import com.operaciones.operaciones_android.config.ApiConfig
import com.operaciones.operaciones_android.model.DispositivoItem
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException

class DispositivoRepository(
    private val http: OkHttpClient = OkHttpClient()
) {
    private fun JSONObject.safeString(key: String): String {
        if (isNull(key)) return ""
        return optString(key, "").takeUnless { it.equals("null", ignoreCase = true) } ?: ""
    }

    private fun JSONObject.positiveInt(key: String): Int? =
        optInt(key, 0).takeIf { it > 0 }

    private fun JSONObject.nullableDouble(key: String): Double? {
        if (!has(key) || isNull(key)) return null
        val value = optDouble(key, Double.NaN)
        return value.takeUnless { it.isNaN() || it.isInfinite() }
    }

    private fun JSONObject.nullableHeadingDegrees(): Double? =
        listOf("rumbo_grados", "rumboGrados", "headingDegrees", "heading", "bearing", "curso", "rumbo")
            .firstNotNullOfOrNull { key -> nullableDouble(key) }
            ?.let { ((it % 360.0) + 360.0) % 360.0 }

    fun fetchDispositivos(
        operationId: Int,
        token: String,
        onSuccess: (List<DispositivoItem>) -> Unit,
        onError: (String) -> Unit
    ) {
        val req = Request.Builder()
            .url("${ApiConfig.BASE_URL}/ops/$operationId/dispositivos-asignados")
            .get()
            .addHeader("Authorization", "Bearer $token")
            .build()

        http.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                onError("Sin conexion cargando dispositivos.")
            }

            override fun onResponse(call: Call, response: Response) {
                val bodyStr = response.body?.string() ?: ""

                try {
                    val json = JSONObject(bodyStr)
                    if (!response.isSuccessful || !json.optBoolean("ok")) {
                        onError(json.optString("mensaje", "No se pudieron cargar los dispositivos."))
                        return
                    }

                    val items = json.optJSONArray("items") ?: org.json.JSONArray()
                    val result = mutableListOf<DispositivoItem>()

                    for (i in 0 until items.length()) {
                        val d = items.optJSONObject(i) ?: continue
                        result.add(parseDispositivo(d))
                    }

                    onSuccess(result)
                } catch (e: Exception) {
                    onError("Error procesando dispositivos.")
                }
            }
        })
    }

    private fun parseDispositivo(d: JSONObject): DispositivoItem =
        DispositivoItem(
            idDispositivo = d.optInt("id_dispositivo"),
            tipo = d.safeString("tipo"),
            marca = d.safeString("marca"),
            modelo = d.safeString("modelo"),
            numeroTelefono = d.safeString("numero_telefono"),
            imei = d.safeString("imei"),
            numeroSerie = d.safeString("numero_serie"),
            sistemaOperativo = d.safeString("sistema_operativo"),
            identificadorApp = d.safeString("identificador_app"),
            estado = d.safeString("dispositivo_estado").ifBlank { d.safeString("estado") },
            idPersonal = d.positiveInt("id_personal"),
            personalApodo = d.safeString("personal_apodo"),
            personalNombre = d.safeString("personal_nombre"),
            personalApellido = d.safeString("personal_apellido"),
            personalPuesto = d.safeString("personal_puesto"),
            estadoAsignacion = d.safeString("estado_asignacion"),
            lat = d.nullableDouble("latitud"),
            lon = d.nullableDouble("longitud"),
            velocidadKmh = d.nullableDouble("velocidad_kmh"),
            rumboGrados = d.nullableHeadingDegrees(),
            precisionM = d.nullableDouble("precision_m"),
            bateriaPct = d.nullableDouble("bateria_pct"),
            ultimaActualizacion = d.safeString("ultima_actualizacion")
        )
}
