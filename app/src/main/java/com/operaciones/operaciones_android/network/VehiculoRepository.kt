package com.operaciones.operaciones_android.network

import com.operaciones.operaciones_android.config.ApiConfig
import com.operaciones.operaciones_android.model.VehiculoItem
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException

class VehiculoRepository(
    private val http: OkHttpClient = OkHttpClient()
) {
    private fun JSONObject.safeString(key: String): String {
        if (isNull(key)) return ""
        return optString(key, "").takeUnless { it.equals("null", ignoreCase = true) } ?: ""
    }

    private fun positiveInt(json: JSONObject, key: String): Int? {
        if (!json.has(key) || json.isNull(key)) return null
        val value = json.optInt(key, 0)
        return value.takeIf { it > 0 }
    }

    private fun JSONObject.nullableDouble(key: String): Double? {
        if (!has(key) || isNull(key)) return null
        val value = optDouble(key, Double.NaN)
        return value.takeUnless { it.isNaN() || it.isInfinite() }
    }

    private fun JSONObject.nullableHeadingDegrees(): Double? =
        listOf("rumbo_grados", "rumboGrados", "headingDegrees", "heading", "bearing", "curso", "rumbo")
            .firstNotNullOfOrNull { key -> nullableDouble(key) }
            ?.let { ((it % 360.0) + 360.0) % 360.0 }

    fun fetchVehiculos(
        operationId: Int,
        token: String,
        onSuccess: (List<VehiculoItem>) -> Unit,
        onError: (String) -> Unit
    ) {
        val req = Request.Builder()
            .url("${ApiConfig.BASE_URL}/ops/$operationId/vehiculos-asignados")
            .get()
            .addHeader("Authorization", "Bearer $token")
            .build()

        http.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                onError("Sin conexión cargando vehículos.")
            }

            override fun onResponse(call: Call, response: Response) {
                val bodyStr = response.body?.string() ?: ""

                try {
                    val json = JSONObject(bodyStr)
                    if (!response.isSuccessful || !json.optBoolean("ok")) {
                        onError(json.optString("mensaje", "No se pudieron cargar los vehículos."))
                        return
                    }

                    val items = json.optJSONArray("items") ?: org.json.JSONArray()
                    val result = mutableListOf<VehiculoItem>()

                    for (i in 0 until items.length()) {
                        val v = items.getJSONObject(i)

                        val tipoDestino = v.safeString("tipo_destino").uppercase()
                        val asignadoAApodo = v.safeString("asignado_a_apodo")
                        val grupoNombre = v.safeString("grupo_nombre")
                        val alias = v.safeString("alias")
                        val codigoInterno = v.safeString("codigo_interno")

                        val nombreVehiculo = listOf(alias)
                            .filter { it.isNotBlank() }
                            .joinToString(" ")
                            .ifBlank { codigoInterno.ifBlank { "Vehículo" } }

                        // Construir detalle basado en el tipo de destino
                        val usoEnOp = v.safeString("uso_en_operacion")
                        val detalleStr = when (tipoDestino) {
                            "PERSONAL" -> "Asignado a: $asignadoAApodo" + (if (usoEnOp.isNotBlank()) " ($usoEnOp)" else "")
                            "GRUPO" -> "Asignado a Grupo: $grupoNombre"
                            "FLOTILLA" -> "Asignado a Flotilla: $grupoNombre"
                            else -> usoEnOp
                        }

                        result.add(
                            VehiculoItem(
                                idVehiculo = v.optInt("id_vehiculo"),
                                codigoInterno = codigoInterno,
                                nombre = nombreVehiculo,
                                tipo = v.safeString("tipo"),
                                alias = alias,
                                detalle = detalleStr,
                                idPersonalAsignado = positiveInt(v, "id_personal"),
                                tipoDestino = tipoDestino,
                                asignadoAApodo = asignadoAApodo,
                                personalNombre = v.safeString("personal_nombre"),
                                personalApellido = v.safeString("personal_apellido"),
                                personalPuesto = v.safeString("personal_puesto"),
                                cetNombre = v.safeString("cet_nombre"),
                                grupoNombre = grupoNombre,
                                grupoPadreNombre = v.safeString("grupo_padre_nombre"),
                                lat = v.nullableDouble("latitud"),
                                lon = v.nullableDouble("longitud"),
                                rumboGrados = v.nullableHeadingDegrees()
                            )
                        )
                    }

                    onSuccess(result)
                } catch (e: Exception) {
                    onError("Error procesando vehículos.")
                }
            }
        })
    }
}
