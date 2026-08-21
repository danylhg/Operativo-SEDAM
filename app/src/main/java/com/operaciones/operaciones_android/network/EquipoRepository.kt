package com.operaciones.operaciones_android.network

import com.operaciones.operaciones_android.config.ApiConfig
import com.operaciones.operaciones_android.model.EquipoItem
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException

class EquipoRepository(
    private val http: OkHttpClient = OkHttpClient()
) {
    private fun JSONObject.safeString(key: String): String {
        if (isNull(key)) return ""
        return optString(key, "").takeUnless { it.equals("null", ignoreCase = true) } ?: ""
    }

    private fun splitCsv(value: String): List<String> =
        value.split(",")
            .map { it.trim() }
            .filter { it.isNotBlank() }

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

    fun fetchEquipos(
        operationId: Int,
        token: String,
        onSuccess: (List<EquipoItem>) -> Unit,
        onError: (String) -> Unit
    ) {
        val req = Request.Builder()
            .url("${ApiConfig.BASE_URL}/ops/$operationId/equipos-asignados")
            .get()
            .addHeader("Authorization", "Bearer $token")
            .build()

        http.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                onError("Sin conexion cargando equipos.")
            }

            override fun onResponse(call: Call, response: Response) {
                val bodyStr = response.body?.string() ?: ""

                try {
                    val json = JSONObject(bodyStr)
                    if (!response.isSuccessful || !json.optBoolean("ok")) {
                        onError(json.optString("mensaje", "No se pudieron cargar los equipos."))
                        return
                    }

                    val items = json.optJSONArray("items") ?: org.json.JSONArray()
                    val result = mutableListOf<EquipoItem>()

                    for (i in 0 until items.length()) {
                        val e = items.getJSONObject(i)

                        val tipoDestino = e.safeString("tipo_destino").uppercase()
                        val personalNombre = e.safeString("asignado_a_personal").ifBlank {
                            e.safeString("personal_apodo").ifBlank { e.safeString("personal_asignado") }
                        }
                        val vehiculoCodigo = e.safeString("asignado_a_vehiculo").ifBlank {
                            e.safeString("vehiculo_asignado")
                        }
                        val vehiculoAlias = e.safeString("vehiculo_alias")
                        val vehiculoNombre = listOf(vehiculoCodigo, vehiculoAlias)
                            .filter { it.isNotBlank() }
                            .joinToString(" - ")
                        val grupoNombre = e.safeString("grupo_asignado")
                        val flotillaNombre = e.safeString("flotilla_asignada")
                        val tipoEquipo = e.safeString("tipo_equipo")
                        val gruposVinculados = when (tipoDestino) {
                            "VEHICULO" -> splitCsv(e.safeString("grupos_vinculados"))
                            "GRUPO" -> listOf(grupoNombre).filter { it.isNotBlank() }
                            else -> listOf(e.safeString("personal_grupo_nombre")).filter { it.isNotBlank() }
                        }
                        val flotillasVinculadas = when (tipoDestino) {
                            "VEHICULO" -> splitCsv(e.safeString("flotillas_vinculadas"))
                            "GRUPO" -> listOf(flotillaNombre).filter { it.isNotBlank() }
                            else -> listOf(
                                e.safeString("personal_flotilla_nombre").ifBlank {
                                    e.safeString("personal_grupo_nombre")
                                }
                            ).filter { it.isNotBlank() }
                        }

                        val asignadoA = when {
                            vehiculoNombre.isNotBlank() -> vehiculoNombre
                            personalNombre.isNotBlank() -> personalNombre
                            grupoNombre.isNotBlank() -> grupoNombre
                            flotillaNombre.isNotBlank() -> flotillaNombre
                            else -> "Sin destino"
                        }

                        val detalle = buildString {
                            val uso = e.safeString("uso_en_operacion")
                            val ns = e.safeString("numero_serie")

                            if (uso.isNotBlank()) append(uso)
                            if (uso.isNotBlank() && ns.isNotBlank()) append(" · ")
                            if (ns.isNotBlank()) append("S/N: $ns")
                        }

                        result.add(
                            EquipoItem(
                                idEquipo = e.optInt("id_equipo"),
                                numeroSerie = e.safeString("numero_serie"),
                                nombre = e.safeString("nombre").ifBlank { "Equipo" },
                                categoria = e.safeString("categoria"),
                                tipoEquipo = tipoEquipo,
                                detalle = detalle,
                                asignadoA = asignadoA,
                                tipoDestino = tipoDestino,
                                idPersonalAsignado = e.positiveInt("ueo_id_personal")
                                    ?: e.positiveInt("id_personal_asignado")
                                    ?: e.positiveInt("id_personal"),
                                idVehiculoAsignado = e.positiveInt("id_vehiculo_contexto")
                                    ?: e.positiveInt("id_vehiculo_asignado")
                                    ?: e.positiveInt("id_vehiculo"),
                                personalAsignado = personalNombre,
                                vehiculoAsignado = vehiculoNombre,
                                grupoAsignado = grupoNombre,
                                flotillaAsignada = flotillaNombre,
                                gruposVinculados = gruposVinculados,
                                flotillasVinculadas = flotillasVinculadas,
                                lat = e.nullableDouble("latitud"),
                                lon = e.nullableDouble("longitud"),
                                rumboGrados = e.nullableHeadingDegrees(),
                                ultimaActualizacion = e.safeString("ultima_actualizacion")
                            )
                        )
                    }

                    onSuccess(result)
                } catch (e: Exception) {
                    onError("Error procesando equipos.")
                }
            }
        })
    }
}
