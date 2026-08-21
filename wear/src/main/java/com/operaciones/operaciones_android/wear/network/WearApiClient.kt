package com.operaciones.operaciones_android.wear.network

import android.content.Context
import com.operaciones.operaciones_android.wear.config.WearApiConfig
import com.operaciones.operaciones_android.wear.data.WearChatMessage
import com.operaciones.operaciones_android.wear.data.WearOperation
import com.operaciones.operaciones_android.wear.data.WearUser
import com.operaciones.operaciones_android.wear.data.WearUserRole
import com.operaciones.operaciones_android.wear.device.WearDeviceInfo
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okio.BufferedSink
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.URLEncoder

class WearApiClient(
    private val http: OkHttpClient = OkHttpClient()
) {
    data class LoginResult(val user: WearUser, val token: String)
    data class ResourceSummary(
        val personal: List<String>,
        val vehiculos: List<String>,
        val equipos: List<String>
    )
    data class AssignedCet(val id: String, val label: String)

    fun getAssignedCet(
        operationId: Int,
        personalId: Int,
        token: String,
        onSuccess: (AssignedCet?) -> Unit,
        onError: (String) -> Unit
    ) {
        val req = Request.Builder()
            .url("${WearApiConfig.baseUrl}/ops/$operationId/personal")
            .get()
            .addHeader("Authorization", "Bearer $token")
            .build()

        http.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                onError("No se pudo obtener el CET asignado.")
            }

            override fun onResponse(call: Call, response: Response) {
                val bodyStr = response.body?.string().orEmpty()
                try {
                    val json = JSONObject(bodyStr)
                    if (!response.isSuccessful || !json.optBoolean("ok")) {
                        onError(json.optString("mensaje", "No se pudo obtener el CET asignado."))
                        return
                    }
                    val items = json.optJSONArray("items") ?: JSONArray()
                    val person = (0 until items.length())
                        .mapNotNull { items.optJSONObject(it) }
                        .firstOrNull { it.optInt("id_personal") == personalId }
                    val cetId = person?.optInt("id_cet_ref", -1)?.takeIf { it > 0 }
                    if (cetId == null) {
                        onSuccess(null)
                        return
                    }
                    val label = sequenceOf(
                        person.optString("cet_apodo"),
                        person.optString("cet_nombre")
                    ).firstOrNull { it.isNotBlank() } ?: "CET asignado"
                    onSuccess(AssignedCet(cetId.toString(), label))
                } catch (e: Exception) {
                    onError("Respuesta invalida del CET asignado.")
                }
            }
        })
    }

    fun login(
        context: Context,
        username: String,
        password: String,
        onSuccess: (LoginResult) -> Unit,
        onError: (String) -> Unit
    ) {
        WearApiConfig.load(context)
        val body = JSONObject().apply {
            put("username", username)
            put("password", password)
            put("device", WearDeviceInfo.toJson(context))
        }.toString().toRequestBody("application/json".toMediaType())

        val req = Request.Builder()
            .url("${WearApiConfig.baseUrl}/auth/login")
            .post(body)
            .build()

        http.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                onError("No se pudo conectar: ${e.message}")
            }

            override fun onResponse(call: Call, response: Response) {
                val bodyStr = response.body?.string().orEmpty()
                try {
                    if (response.code == 401) {
                        onError("Usuario o contraseña incorrectos")
                        return
                    }
                    val json = JSONObject(bodyStr)
                    if (!response.isSuccessful || !json.optBoolean("ok")) {
                        val message = json.optString("mensaje", "Login invalido")
                        onError(message)
                        return
                    }
                    val u = json.getJSONObject("usuario")
                    val tabla = u.optString("tabla", "personal")
                    val id = if (tabla == "personal") {
                        u.optInt("id_personal", 0).takeIf { it > 0 } ?: u.optInt("id_usuario", 0)
                    } else {
                        u.optInt("id_usuario", 0)
                    }
                    val user = WearUser(
                        id = id,
                        nombre = u.optString("nombre", ""),
                        apellido = u.optString("apellido", ""),
                        username = u.optString("username", username),
                        rol = WearUserRole.from(u.optString("rol", "CELL")),
                        jerarquia = u.optString("puesto", ""),
                        tabla = tabla
                    )
                    if (user.rol == WearUserRole.ADMIN || user.rol == WearUserRole.CUT) {
                        onError("Este rol solo tiene acceso a la plataforma web.")
                        return
                    }
                    onSuccess(LoginResult(user, json.getString("token")))
                } catch (e: Exception) {
                    onError("Respuesta de login invalida: ${e.message}")
                }
            }
        })
    }

    fun fetchAssignedOperation(
        userId: Int,
        token: String,
        onSuccess: (WearOperation?) -> Unit,
        onError: (String) -> Unit
    ) {
        val req = Request.Builder()
            .url("${WearApiConfig.baseUrl}/ops/personal/$userId")
            .get()
            .addHeader("Authorization", "Bearer $token")
            .build()

        http.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                onError("No se pudo obtener la operacion: ${e.message}")
            }

            override fun onResponse(call: Call, response: Response) {
                val bodyStr = response.body?.string().orEmpty()
                try {
                    if (response.code == 404) {
                        onSuccess(null)
                        return
                    }
                    if (!response.isSuccessful) {
                        onError("Error del servidor (${response.code}).")
                        return
                    }
                    val opJson = JSONObject(bodyStr).optJSONObject("operacion")
                    onSuccess(opJson?.let { WearOperation.fromJson(it) })
                } catch (e: Exception) {
                    onError("Operacion invalida: ${e.message}")
                }
            }
        })
    }

    fun getMessages(
        operationId: Int,
        token: String,
        onSuccess: (List<WearChatMessage>) -> Unit,
        onError: (String) -> Unit
    ) {
        val req = Request.Builder()
            .url("${WearApiConfig.baseUrl}/ops/$operationId/chat/messages")
            .get()
            .addHeader("Authorization", "Bearer $token")
            .build()

        http.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                onError("No se pudo cargar chat: ${e.message}")
            }

            override fun onResponse(call: Call, response: Response) {
                val bodyStr = response.body?.string().orEmpty()
                try {
                    val json = JSONObject(bodyStr)
                    if (!response.isSuccessful || !json.optBoolean("ok")) {
                        onError(json.optString("mensaje", "Error cargando chat"))
                        return
                    }
                    val items = json.optJSONArray("items") ?: JSONArray()
                    val messages = buildList {
                        for (i in 0 until items.length()) {
                            val item = items.optJSONObject(i) ?: continue
                            add(WearChatMessage.fromJson(item))
                        }
                    }
                    onSuccess(messages)
                } catch (e: Exception) {
                    onError("Chat invalido: ${e.message}")
                }
            }
        })
    }

    fun getResourceSummary(
        operationId: Int,
        token: String,
        onSuccess: (ResourceSummary) -> Unit,
        onError: (String) -> Unit
    ) {
        val lock = Any()
        var remaining = 3
        val errors = mutableListOf<String>()
        var personalResult = emptyList<String>()
        var vehiculosResult = emptyList<String>()
        var equiposResult = emptyList<String>()

        fun finish(kind: String, items: List<String>, error: String? = null) {
            var summary: ResourceSummary? = null
            var failure: String? = null
            synchronized(lock) {
                when (kind) {
                    "personal" -> personalResult = items
                    "vehiculos" -> vehiculosResult = items
                    "equipos" -> equiposResult = items
                }
                error?.let { errors.add(it) }
                remaining--
                if (remaining == 0) {
                    val loadedAny = personalResult.isNotEmpty() || vehiculosResult.isNotEmpty() || equiposResult.isNotEmpty()
                    if (loadedAny || errors.size < 3) {
                        summary = ResourceSummary(personalResult, vehiculosResult, equiposResult)
                    } else {
                        failure = errors.firstOrNull() ?: "Error cargando recursos"
                    }
                }
            }
            summary?.let(onSuccess)
            failure?.let(onError)
        }

        fetchItems(
            path = "/ops/$operationId/personal",
            token = token,
            mapper = { item ->
                item.safeString("apodo").ifBlank {
                    "${item.safeString("nombre")} ${item.safeString("apellido")}".trim()
                }.ifBlank { item.safeString("rol").ifBlank { "Personal" } }
            },
            onSuccess = { finish("personal", it) },
            onError = { finish("personal", emptyList(), it) }
        )

        fetchItems(
            path = "/ops/$operationId/vehiculos-asignados",
            token = token,
            mapper = { item ->
                item.safeString("alias").ifBlank {
                    item.safeString("codigo_interno").ifBlank { item.safeString("tipo") }
                }.ifBlank { "Vehiculo" }
            },
            onSuccess = { finish("vehiculos", it) },
            onError = { finish("vehiculos", emptyList(), it) }
        )

        fetchItems(
            path = "/ops/$operationId/equipos-asignados",
            token = token,
            mapper = { item ->
                item.safeString("nombre").ifBlank {
                    item.safeString("numero_serie")
                }.ifBlank { "Equipo" }
            },
            onSuccess = { finish("equipos", it) },
            onError = { finish("equipos", emptyList(), it) }
        )
    }

    fun getOperationMap(
        operationId: Int,
        token: String,
        onSuccess: (JSONObject) -> Unit,
        onError: (String) -> Unit
    ) {
        val req = Request.Builder()
            .url("${WearApiConfig.baseUrl}/ops/$operationId/mapa")
            .get()
            .addHeader("Authorization", "Bearer $token")
            .build()

        http.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                onError("No se pudo cargar el mapa: ${e.message}")
            }

            override fun onResponse(call: Call, response: Response) {
                val body = response.body?.string().orEmpty()
                runCatching { JSONObject(body) }
                    .onSuccess { json ->
                        if (response.isSuccessful && json.optBoolean("ok")) onSuccess(json)
                        else if (response.code == 401) onError("Sesion vencida; sincronizando telefono")
                        else onError(json.optString("mensaje", "Error cargando mapa"))
                    }
                    .onFailure { onError("Respuesta de mapa invalida") }
            }
        })
    }

    fun getOperationTracking(
        operationId: Int,
        resource: String,
        token: String,
        onSuccess: (JSONArray) -> Unit,
        onError: (String) -> Unit
    ) {
        val safeResource = resource.takeIf {
            it in setOf("personal", "vehiculos", "equipos", "dispositivos")
        } ?: run {
            onError("Tipo de seguimiento invalido")
            return
        }
        val req = Request.Builder()
            .url("${WearApiConfig.baseUrl}/ops/$operationId/tracking/$safeResource")
            .get()
            .addHeader("Authorization", "Bearer $token")
            .build()

        http.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                onError("No se pudo cargar el seguimiento de $safeResource")
            }

            override fun onResponse(call: Call, response: Response) {
                val body = response.body?.string().orEmpty()
                runCatching { JSONObject(body) }
                    .onSuccess { json ->
                        if (response.isSuccessful && json.optBoolean("ok")) {
                            onSuccess(json.optJSONArray("items") ?: JSONArray())
                        } else if (response.code == 401) {
                            onError("Sesion vencida; sincronizando telefono")
                        } else {
                            onError(json.optString("mensaje", "Error cargando seguimiento"))
                        }
                    }
                    .onFailure { onError("Respuesta de seguimiento invalida") }
            }
        })
    }

    fun getOperationDrawings(
        operationId: Int,
        token: String,
        onSuccess: (JSONArray) -> Unit,
        onError: (String) -> Unit
    ) {
        val req = Request.Builder()
            .url("${WearApiConfig.baseUrl}/ops/$operationId/dibujos")
            .get()
            .addHeader("Authorization", "Bearer $token")
            .build()

        http.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                onError("No se pudieron cargar los dibujos: ${e.message}")
            }

            override fun onResponse(call: Call, response: Response) {
                val body = response.body?.string().orEmpty()
                runCatching { JSONObject(body) }
                    .onSuccess { json ->
                        if (response.isSuccessful && json.optBoolean("ok")) {
                            onSuccess(json.optJSONArray("items") ?: JSONArray())
                        } else if (response.code == 401) {
                            onError("Sesion vencida; sincronizando telefono")
                        } else {
                            onError(json.optString("mensaje", "Error cargando dibujos"))
                        }
                    }
                    .onFailure { onError("Respuesta de dibujos invalida") }
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
        onSuccess: () -> Unit,
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
            .url("${WearApiConfig.baseUrl}/ops/$operationId/chat/messages")
            .post(body)
            .addHeader("Authorization", "Bearer $token")
            .build()

        http.newCall(req).enqueue(simpleOkCallback(onSuccess, onError, "Error enviando mensaje"))
    }

    private fun fetchItems(
        path: String,
        token: String,
        mapper: (JSONObject) -> String,
        onSuccess: (List<String>) -> Unit,
        onError: (String) -> Unit
    ) {
        val req = Request.Builder()
            .url("${WearApiConfig.baseUrl}$path")
            .get()
            .addHeader("Authorization", "Bearer $token")
            .build()

        http.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                onError("No se pudieron cargar recursos: ${e.message}")
            }

            override fun onResponse(call: Call, response: Response) {
                val bodyStr = response.body?.string().orEmpty()
                try {
                    val json = JSONObject(bodyStr)
                    if (!response.isSuccessful || !json.optBoolean("ok")) {
                        onError(json.optString("mensaje", "Error cargando recursos"))
                        return
                    }
                    val items = json.optJSONArray("items") ?: JSONArray()
                    val result = buildList {
                        for (i in 0 until items.length()) {
                            val item = items.optJSONObject(i) ?: continue
                            add(mapper(item))
                        }
                    }
                    onSuccess(result)
                } catch (e: Exception) {
                    onError("Recursos invalidos: ${e.message}")
                }
            }
        })
    }

    fun sendAttachment(
        operationId: Int,
        token: String,
        file: File,
        fileName: String,
        mimeType: String,
        attachmentKind: String,
        durationMs: Long?,
        destinatarioRol: String? = "GLOBAL",
        destinoTipo: String? = null,
        destinoId: String? = null,
        destinoLabel: String? = null,
        onSuccess: () -> Unit,
        onError: (String) -> Unit
    ) {
        val url = buildString {
            append("${WearApiConfig.baseUrl}/ops/$operationId/chat/attachments?")
            append("tipo_mensaje=${"NORMAL".urlEncode()}")
            append("&destinatario_rol=${(destinatarioRol ?: "GLOBAL").urlEncode()}")
            destinoTipo?.takeIf { it.isNotBlank() }?.let {
                append("&destino_tipo=${it.urlEncode()}")
            }
            destinoId?.takeIf { it.isNotBlank() }?.let {
                append("&destino_id=${it.urlEncode()}")
            }
            destinoLabel?.takeIf { it.isNotBlank() }?.let {
                append("&destino_label=${it.urlEncode()}")
            }
        }

        val req = Request.Builder()
            .url(url)
            .post(FileRequestBody(file, mimeType))
            .addHeader("Authorization", "Bearer $token")
            .addHeader("X-File-Name", fileName)
            .addHeader("X-Attachment-Kind", attachmentKind)
            .apply {
                durationMs?.takeIf { it >= 0 }?.let { addHeader("X-Duration-Ms", it.toString()) }
            }
            .build()

        http.newCall(req).enqueue(simpleOkCallback(onSuccess, onError, "Error enviando adjunto"))
    }

    fun sendTracking(
        operationId: Int,
        token: String,
        idPersonal: Int,
        latitude: Double,
        longitude: Double,
        accuracyMeters: Float?,
        speedKmh: Double? = null,
        headingDegrees: Double? = null,
        onDone: () -> Unit = {},
        onSuccess: () -> Unit = {},
        onError: (String) -> Unit = {}
    ) {
        val body = JSONObject().apply {
            put("id_personal", idPersonal)
            put("latitud", latitude)
            put("longitud", longitude)
            accuracyMeters?.let { put("precision_m", it) }
            speedKmh?.let { put("velocidad_kmh", it) }
            headingDegrees?.let { put("rumbo_grados", it) }
        }.toString().toRequestBody("application/json".toMediaType())

        val req = Request.Builder()
            .url("${WearApiConfig.baseUrl}/ops/$operationId/tracking/personal")
            .post(body)
            .addHeader("Authorization", "Bearer $token")
            .build()

        http.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                onError("Error enviando tracking: ${e.message ?: "red no disponible"}")
                onDone()
            }

            override fun onResponse(call: Call, response: Response) {
                if (response.isSuccessful) {
                    onSuccess()
                } else {
                    onError("Error enviando tracking: HTTP ${response.code}")
                }
                response.close()
                onDone()
            }
        })
    }

    fun sendVitalSigns(
        operationId: Int,
        token: String,
        idPersonal: Int,
        heartRateBpm: Double?,
        steps: Long?,
        pressureHpa: Float?,
        batteryPct: Double?,
        latitude: Double?,
        longitude: Double?,
        onDone: () -> Unit = {}
    ) {
        val body = JSONObject().apply {
            put("id_personal", idPersonal)
            heartRateBpm?.let { put("frecuencia_cardiaca_bpm", it) }
            steps?.let { put("pasos", it) }
            pressureHpa?.let { put("presion_barometrica_hpa", it.toDouble()) }
            batteryPct?.let { put("bateria_pct", it) }
            latitude?.let { put("latitud", it) }
            longitude?.let { put("longitud", it) }
            put("origen", "SMARTWATCH")
        }.toString().toRequestBody("application/json".toMediaType())

        val req = Request.Builder()
            .url("${WearApiConfig.baseUrl}/ops/$operationId/signos-vitales")
            .post(body)
            .addHeader("Authorization", "Bearer $token")
            .build()

        http.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) = onDone()
            override fun onResponse(call: Call, response: Response) {
                response.close()
                onDone()
            }
        })
    }

    private fun simpleOkCallback(
        onSuccess: () -> Unit,
        onError: (String) -> Unit,
        fallback: String
    ) = object : Callback {
        override fun onFailure(call: Call, e: IOException) {
            onError("$fallback: ${e.message}")
        }

        override fun onResponse(call: Call, response: Response) {
            val bodyStr = response.body?.string().orEmpty()
            try {
                val json = JSONObject(bodyStr)
                if (!response.isSuccessful || !json.optBoolean("ok")) {
                    onError(json.optString("mensaje", fallback))
                    return
                }
                onSuccess()
            } catch (e: Exception) {
                onError("$fallback: ${e.message}")
            }
        }
    }

    private fun JSONObject.safeString(key: String): String {
        if (!has(key) || isNull(key)) return ""
        return optString(key, "").takeUnless { it.equals("null", ignoreCase = true) } ?: ""
    }

    private fun String.urlEncode(): String =
        URLEncoder.encode(this, Charsets.UTF_8.name())

    private class FileRequestBody(
        private val file: File,
        private val mimeType: String
    ) : RequestBody() {
        override fun contentType() = mimeType.toMediaType()

        override fun contentLength(): Long = file.length()

        override fun writeTo(sink: BufferedSink) {
            file.inputStream().use { input ->
                val buffer = ByteArray(8192)
                while (true) {
                    val read = input.read(buffer)
                    if (read == -1) break
                    sink.write(buffer, 0, read)
                }
            }
        }
    }
}
