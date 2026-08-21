package com.operaciones.operaciones_android.network

import android.content.ContentResolver
import android.net.Uri
import com.operaciones.operaciones_android.config.ApiConfig
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.BufferedSink
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.URLEncoder

class ChatRepository(
    private val http: OkHttpClient = OkHttpClient()
) {

    fun getMessages(
        operationId: Int,
        token: String,
        onSuccess: (JSONArray) -> Unit,
        onError: (String) -> Unit
    ) {
        val req = Request.Builder()
            .url("${ApiConfig.BASE_URL}/ops/$operationId/chat/messages")
            .get()
            .addHeader("Authorization", "Bearer $token")
            .build()

        http.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                onError("Fallo HTTP real: ${e.message}")
            }

            override fun onResponse(call: Call, response: Response) {
                val bodyStr = response.body?.string() ?: ""

                try {
                    android.util.Log.d("CHAT_HTTP", "GET code=${response.code}")
                    android.util.Log.d("CHAT_HTTP", "GET body=$bodyStr")

                    val json = JSONObject(bodyStr)

                    if (!response.isSuccessful) {
                        onError(json.optString("mensaje", "Error HTTP ${response.code}"))
                        return
                    }

                    if (!json.optBoolean("ok")) {
                        onError(json.optString("mensaje", "Error cargando chat"))
                        return
                    }

                    val items = json.optJSONArray("items") ?: JSONArray()
                    onSuccess(items)

                } catch (e: Exception) {
                    onError("Catch parseando historial: ${e.message}")
                }
            }
        })
    }

    fun sendMessage(
        operationId: Int,
        token: String,
        contenido: String,
        tipoMensaje: String = "NORMAL",
        destinatarioRol: String? = "GLOBAL",
        destinoTipo: String? = null,
        destinoId: String? = null,
        destinoLabel: String? = null,
        onSuccess: (JSONObject) -> Unit,
        onError: (String) -> Unit
    ) {
        val body = JSONObject().apply {
            put("contenido", contenido)
            put("tipo_mensaje", tipoMensaje)
            put("destinatario_rol", destinatarioRol ?: "GLOBAL")
            destinoTipo?.takeIf { it.isNotBlank() }?.let { put("destino_tipo", it) }
            destinoId?.takeIf { it.isNotBlank() }?.let { put("destino_id", it) }
            destinoLabel?.takeIf { it.isNotBlank() }?.let { put("destino_label", it) }
        }.toString().toRequestBody("application/json".toMediaType())

        val req = Request.Builder()
            .url("${ApiConfig.BASE_URL}/ops/$operationId/chat/messages")
            .post(body)
            .addHeader("Authorization", "Bearer $token")
            .build()

        http.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                onError("Fallo HTTP real al enviar: ${e.message}")
            }

            override fun onResponse(call: Call, response: Response) {
                val bodyStr = response.body?.string() ?: ""

                try {
                    android.util.Log.d("CHAT_HTTP", "POST code=${response.code}")
                    android.util.Log.d("CHAT_HTTP", "POST body=$bodyStr")

                    val json = JSONObject(bodyStr)

                    if (!response.isSuccessful) {
                        onError(json.optString("mensaje", "Error HTTP ${response.code}"))
                        return
                    }

                    if (!json.optBoolean("ok")) {
                        onError(json.optString("mensaje", "Error enviando mensaje"))
                        return
                    }

                    val item = json.optJSONObject("item") ?: json.optJSONObject("mensaje")
                    if (item == null) {
                        onError("Respuesta OK pero sin mensaje")
                        return
                    }

                    onSuccess(item)

                } catch (e: Exception) {
                    onError("Catch parseando envío: ${e.message}")
                }
            }
        })
    }

    fun sendAttachment(
        operationId: Int,
        token: String,
        contentResolver: ContentResolver,
        uri: Uri,
        fileName: String,
        mimeType: String,
        attachmentKind: String,
        tipoMensaje: String = "NORMAL",
        destinatarioRol: String? = "GLOBAL",
        destinoTipo: String? = null,
        destinoId: String? = null,
        destinoLabel: String? = null,
        durationMs: Long? = null,
        onSuccess: (JSONObject) -> Unit,
        onError: (String) -> Unit
    ) {
        val query = JSONObject().apply {
            put("tipo_mensaje", tipoMensaje)
            put("destinatario_rol", destinatarioRol ?: "GLOBAL")
            destinoTipo?.takeIf { it.isNotBlank() }?.let { put("destino_tipo", it) }
            destinoId?.takeIf { it.isNotBlank() }?.let { put("destino_id", it) }
            destinoLabel?.takeIf { it.isNotBlank() }?.let { put("destino_label", it) }
        }

        val url = buildString {
            append("${ApiConfig.BASE_URL}/ops/$operationId/chat/attachments?")
            append("tipo_mensaje=${query.optString("tipo_mensaje").urlEncode()}")
            append("&destinatario_rol=${query.optString("destinatario_rol").urlEncode()}")
            query.optString("destino_tipo", "").takeIf { it.isNotBlank() }?.let {
                append("&destino_tipo=${it.urlEncode()}")
            }
            query.optString("destino_id", "").takeIf { it.isNotBlank() }?.let {
                append("&destino_id=${it.urlEncode()}")
            }
            query.optString("destino_label", "").takeIf { it.isNotBlank() }?.let {
                append("&destino_label=${it.urlEncode()}")
            }
        }

        val req = Request.Builder()
            .url(url)
            .post(UriRequestBody(contentResolver, uri, mimeType))
            .addHeader("Authorization", "Bearer $token")
            .addHeader("X-File-Name", fileName)
            .addHeader("X-Attachment-Kind", attachmentKind)
            .apply {
                durationMs?.takeIf { it >= 0 }?.let { addHeader("X-Duration-Ms", it.toString()) }
            }
            .build()

        http.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                onError("Fallo HTTP real al enviar adjunto: ${e.message}")
            }

            override fun onResponse(call: Call, response: Response) {
                val bodyStr = response.body?.string() ?: ""
                try {
                    val json = JSONObject(bodyStr)
                    if (!response.isSuccessful) {
                        onError(json.optString("mensaje", "Error HTTP ${response.code}"))
                        return
                    }
                    if (!json.optBoolean("ok")) {
                        onError(json.optString("mensaje", "Error enviando adjunto"))
                        return
                    }
                    val item = json.optJSONObject("item")
                    if (item == null) {
                        onError("Respuesta OK pero sin mensaje")
                        return
                    }
                    onSuccess(item)
                } catch (e: Exception) {
                    onError("Catch parseando adjunto: ${e.message}")
                }
            }
        })
    }

    private class UriRequestBody(
        private val contentResolver: ContentResolver,
        private val uri: Uri,
        private val mimeType: String
    ) : RequestBody() {
        override fun contentType() = mimeType.toMediaType()

        override fun contentLength(): Long =
            runCatching {
                contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: -1L
            }.getOrDefault(-1L)

        override fun writeTo(sink: BufferedSink) {
            contentResolver.openInputStream(uri)?.use { input ->
                val buffer = ByteArray(8192)
                while (true) {
                    val read = input.read(buffer)
                    if (read == -1) break
                    sink.write(buffer, 0, read)
                }
            } ?: throw IOException("No se pudo abrir el archivo")
        }
    }

    private fun String.urlEncode(): String = URLEncoder.encode(this, "UTF-8")
}
