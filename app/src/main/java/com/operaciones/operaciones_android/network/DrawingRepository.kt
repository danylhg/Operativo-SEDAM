package com.operaciones.operaciones_android.network

import com.operaciones.operaciones_android.config.ApiConfig
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

class DrawingRepository(
    private val http: OkHttpClient = OkHttpClient()
) {
    private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

    // GET /ops/:id/dibujos
    fun fetchDrawings(
        operationId: Int,
        token: String,
        onSuccess: (List<JSONObject>) -> Unit,
        onError: (String) -> Unit
    ) {
        val req = Request.Builder()
            .url("${ApiConfig.BASE_URL}/ops/$operationId/dibujos")
            .get()
            .addHeader("Authorization", "Bearer $token")
            .build()

        http.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                onError("Sin conexion cargando dibujos.")
            }

            override fun onResponse(call: Call, response: Response) {
                val body = response.body?.string() ?: return
                try {
                    val json = JSONObject(body)
                    if (!json.optBoolean("ok")) { onError("Error del servidor"); return }
                    val items = json.optJSONArray("items") ?: JSONArray()
                    val result = mutableListOf<JSONObject>()
                    for (i in 0 until items.length()) result.add(items.getJSONObject(i))
                    onSuccess(result)
                } catch (e: Exception) {
                    onError("Error parseando dibujos: ${e.message}")
                }
            }
        })
    }

    // POST /ops/:id/dibujos
    fun saveDrawing(
        operationId: Int,
        token: String,
        userData: JSONObject,
        coords: JSONArray,
        color: String,
        grosor: Double,
        onSuccess: (Int) -> Unit,   // devuelve id_dibujo
        onError: (String) -> Unit
    ) {
        val tabla = userData.optString("tabla", "usuario")
        val tipoCr = if (tabla == "personal") "PERSONAL" else "USUARIO"
        val idKey  = if (tabla == "personal") "id_personal" else "id_usuario"
        val idVal  = if (tabla == "personal") userData.optInt("id_personal") else userData.optInt("id_usuario")

        val body = JSONObject().apply {
            put("puntos",       coords)
            put("color",        color)
            put("grosor",       grosor)
            put("tipo_creador", tipoCr)
            put(idKey,          idVal)
        }.toString().toRequestBody(JSON_MEDIA)

        val req = Request.Builder()
            .url("${ApiConfig.BASE_URL}/ops/$operationId/dibujos")
            .post(body)
            .addHeader("Authorization", "Bearer $token")
            .build()

        http.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                onError("Sin conexion guardando dibujo.")
            }

            override fun onResponse(call: Call, response: Response) {
                val bodyStr = response.body?.string() ?: return
                try {
                    val json = JSONObject(bodyStr)
                    if (!json.optBoolean("ok")) { onError("Error guardando dibujo"); return }
                    val idDibujo = json.getJSONObject("dibujo").getInt("id_dibujo")
                    onSuccess(idDibujo)
                } catch (e: Exception) {
                    onError("Error parseando respuesta: ${e.message}")
                }
            }
        })
    }

    // DELETE /ops/:id/dibujos/:id_dibujo
    fun deleteDrawing(
        operationId: Int,
        idDibujo: Int,
        token: String,
        onError: (String) -> Unit = {}
    ) {
        val req = Request.Builder()
            .url("${ApiConfig.BASE_URL}/ops/$operationId/dibujos/$idDibujo")
            .delete()
            .addHeader("Authorization", "Bearer $token")
            .build()

        http.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                onError("Sin conexion eliminando dibujo.")
            }
            override fun onResponse(call: Call, response: Response) {
                // baja lógica — no necesitamos respuesta
            }
        })
    }
}
