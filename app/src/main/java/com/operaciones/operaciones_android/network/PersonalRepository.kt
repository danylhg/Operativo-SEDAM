package com.operaciones.operaciones_android.network

import com.operaciones.operaciones_android.config.ApiConfig
import com.operaciones.operaciones_android.model.PersonalItem
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException

class PersonalRepository(
    private val http: OkHttpClient = OkHttpClient()
) {
    private fun JSONObject.safeString(key: String): String {
        if (isNull(key)) return ""
        return optString(key, "").takeUnless { it.equals("null", ignoreCase = true) } ?: ""
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

    fun fetchPersonal(
        operationId: Int,
        token: String,
        onSuccess: (List<PersonalItem>) -> Unit,
        onError: (String) -> Unit
    ) {
        val req = Request.Builder()
            .url("${ApiConfig.BASE_URL}/ops/$operationId/personal")
            .get()
            .addHeader("Authorization", "Bearer $token")
            .build()

        http.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                onError("Sin conexión cargando personal.")
            }

            override fun onResponse(call: Call, response: Response) {
                val bodyStr = response.body?.string() ?: ""

                try {
                    val json = JSONObject(bodyStr)
                    if (!response.isSuccessful || !json.optBoolean("ok")) {
                        onError(json.optString("mensaje", "No se pudo cargar el personal."))
                        return
                    }

                    val items = json.optJSONArray("items") ?: org.json.JSONArray()
                    val result = mutableListOf<PersonalItem>()

                    for (i in 0 until items.length()) {
                        val p = items.getJSONObject(i)

                        result.add(
                            PersonalItem(
                                idPersonal = p.optInt("id_personal"),
                                apodo = p.safeString("apodo"),
                                nombre = p.safeString("nombre"),
                                apellido = p.safeString("apellido"),
                                rol = p.safeString("rol"),
                                puesto = p.safeString("puesto"),
                                lat = p.nullableDouble("latitud"),
                                lon = p.nullableDouble("longitud"),
                                rumboGrados = p.nullableHeadingDegrees(),
                                grupoNombre = p.safeString("grupo_nombre"),
                                grupoApodo = p.safeString("grupo_apodo"),
                                idGrupoOperacion = p.optInt("id_grupo_operacion", -1).takeIf { it > 0 },
                                idGrupoPadre = p.optInt("grupo_padre_id", -1).takeIf { it > 0 },
                                grupoPadreNombre = p.safeString("grupo_padre_nombre"),
                                grupoPadreApodo = p.safeString("grupo_padre_apodo"),
                                idCetRef = p.optInt("id_cet_ref", -1).takeIf { it > 0 },
                                cetNombre = p.safeString("cet_nombre"),
                                cetFlotilla = p.safeString("cet_flotilla"),
                                velocidadKmh = p.nullableDouble("velocidad_kmh"),
                                frecuenciaCardiacaBpm = if (p.has("frecuencia_cardiaca_bpm") && !p.isNull("frecuencia_cardiaca_bpm")) p.optInt("frecuencia_cardiaca_bpm") else null,
                                presionBarometricaHpa = p.nullableDouble("presion_barometrica_hpa"),
                                bateriaPct = p.nullableDouble("bateria_pct"),
                                ultimaActualizacion = p.safeString("ultima_actualizacion")
                            )
                        )
                    }

                    onSuccess(result)
                } catch (e: Exception) {
                    onError("Error procesando personal.")
                }
            }
        })
    }
}
