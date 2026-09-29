package com.operaciones.operaciones_android.wear

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.Log
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import com.operaciones.operaciones_android.auth.AuthManager
import com.operaciones.operaciones_android.config.ApiConfig
import com.operaciones.operaciones_android.network.ChatSocketManager
import com.operaciones.operaciones_android.ui.LoginActivity
import com.operaciones.operaciones_android.ui.MainActivity
import com.operaciones.operaciones_android.ui.OperationStatusActivity
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException

class PhoneWearListenerService : WearableListenerService() {
    companion object {
        private const val TAG = "PhoneWearListener"
        private const val PATH_OPEN_PHONE = "/sedam/open-phone"
        private const val PATH_EMERGENCY = "/sedam/emergency"
        private const val PATH_SESSION_REQUEST = "/sedam/session/request"
        private const val PATH_SESSION_SYNC = "/sedam/session/sync"
        private const val PATH_SESSION_ERROR = "/sedam/session/error"
        const val ACTION_WEAR_ALERT = "com.operaciones.operaciones_android.WEAR_ALERT"
        const val EXTRA_WEAR_ALERT_SOURCE = "WEAR_ALERT_SOURCE"
        const val EXTRA_WEAR_ALERT_DEVICE = "WEAR_ALERT_DEVICE"
        const val PATH_VOICE_CALL = "/sedam/voice-call"
        const val PATH_VOICE_CALL_ACTION = "/sedam/voice-call/action"

        @Volatile
        var voiceCallActionHandler: ((String, String) -> Unit)? = null

        fun sendVoiceCallToWear(context: Context, event: String, payload: JSONObject) {
            val data = JSONObject(payload.toString()).put("event", event)
            Wearable.getNodeClient(context).connectedNodes
                .addOnSuccessListener { nodes ->
                    nodes.forEach { node ->
                        Wearable.getMessageClient(context).sendMessage(
                            node.id,
                            PATH_VOICE_CALL,
                            data.toString().toByteArray(Charsets.UTF_8)
                        )
                    }
                }
                .addOnFailureListener { Log.e(TAG, "No se pudo localizar el smartwatch", it) }
        }
    }

    private val http by lazy { OkHttpClient() }

    override fun onMessageReceived(messageEvent: MessageEvent) {
        when (messageEvent.path) {
            PATH_OPEN_PHONE -> openPhone(messageEvent)
            PATH_EMERGENCY -> mirrorEmergency(messageEvent)
            PATH_SESSION_REQUEST -> issueWearSession(messageEvent)
            PATH_VOICE_CALL_ACTION -> {
                val payload = parsePayload(messageEvent)
                voiceCallActionHandler?.invoke(
                    payload.optString("call_id"),
                    payload.optString("action")
                )
            }
            else -> super.onMessageReceived(messageEvent)
        }
    }

    private fun openPhone(messageEvent: MessageEvent) {
        val payload = parsePayload(messageEvent)
        val user = AuthManager.getCurrentUser(this)
        val intent = when {
            user == null -> Intent(this, LoginActivity::class.java)
            payload.optString("op_estado", "ACTIVA").uppercase() == "ACTIVA" ->
                Intent(this, MainActivity::class.java).apply {
                    putExtra("USER_ID", user.id)
                    putOperationExtras(payload)
                }
            else ->
                Intent(this, OperationStatusActivity::class.java).apply {
                    putExtra("USER_ID", user.id)
                    putOperationExtras(payload)
                }
        }

        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        runCatching { startActivity(intent) }
            .onFailure { Log.e(TAG, "No se pudo abrir telefono desde Wear", it) }
    }

    private fun mirrorEmergency(messageEvent: MessageEvent) {
        val payload = parsePayload(messageEvent)
        Log.w(TAG, "SOS recibido desde reloj: $payload")
        sendBroadcast(Intent(ACTION_WEAR_ALERT).setPackage(packageName).apply {
            putExtra(EXTRA_WEAR_ALERT_SOURCE, payload.optString("source", "AGITAR_RELOJ"))
            putExtra(EXTRA_WEAR_ALERT_DEVICE, payload.optString("device_label", "SMARTWATCH"))
        })
        // El dashboard ya usa shake_alert_update para mostrar el aviso lateral.
        // Retransmitimos la alerta del reloj por ese canal compatible, con una
        // etiqueta de smartwatch, en vez de depender de un evento exclusivo.
        relayWearAlertToDashboard(payload)
        val vibrator = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 300, 120, 300), -1))
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(longArrayOf(0, 300, 120, 300), -1)
        }
    }

    private fun relayWearAlertToDashboard(payload: JSONObject) {
        ApiConfig.load(this)
        val operationId = payload.optInt("operation_id", -1)
        val user = AuthManager.getCurrentUser(this)
        if (operationId <= 0 || user == null) {
            Log.w(TAG, "No se puede retransmitir alerta Wear: sesión u operación no disponible")
            return
        }
        lateinit var socketManager: ChatSocketManager
        socketManager = ChatSocketManager(
            operationId = operationId,
            onNewMessage = {},
            onConnected = {
                // El servidor ya confirmó join_operacion; emitir la alerta del reloj.
                Handler(Looper.getMainLooper()).postDelayed({
                    socketManager.emitShakeAlert(
                        senderName = "${user.jerarquia} ${user.nombreCompleto}".trim(),
                        deviceLabel = payload.optString("device_label", "SMARTWATCH"),
                        lat = payload.optionalCoordinate("lat", "latitud"),
                        lon = payload.optionalCoordinate("lon", "lng", "longitud"),
                        idPersonal = user.id
                    )
                }, 80L)
                Handler(Looper.getMainLooper()).postDelayed({ socketManager.disconnect() }, 1_600L)
            },
            idPersonal = user.id,
            rol = user.rol.name
        )
        socketManager.connect()
    }

    private fun issueWearSession(messageEvent: MessageEvent) {
        ApiConfig.load(this)
        val token = AuthManager.getToken(this)
        if (AuthManager.getCurrentUser(this) == null || token.isBlank()) {
            sendSessionError(messageEvent.sourceNodeId, "Telefono sin sesion activa")
            return
        }

        val payload = parsePayload(messageEvent)
        val device = payload.optJSONObject("device") ?: payload
        val body = JSONObject().apply {
            put("device", device)
        }.toString().toRequestBody("application/json".toMediaType())

        val request = Request.Builder()
            .url("${ApiConfig.BASE_URL}/auth/wear/session")
            .post(body)
            .addHeader("Authorization", "Bearer $token")
            .build()

        http.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                sendSessionError(messageEvent.sourceNodeId, "No se pudo validar smartwatch: ${e.message}")
            }

            override fun onResponse(call: Call, response: Response) {
                val bodyStr = response.body?.string().orEmpty()
                try {
                    val json = JSONObject(bodyStr)
                    if (!response.isSuccessful || !json.optBoolean("ok")) {
                        val message = json.optString("mensaje", "Smartwatch no autorizado")
                        sendSessionError(messageEvent.sourceNodeId, message)
                        return
                    }

                    val sync = JSONObject().apply {
                        put("api_base_url", ApiConfig.BASE_URL)
                        put("rtmp_publish_base_url", ApiConfig.RTMP_PUBLISH_BASE_URL)
                        put("hls_playback_base_url", ApiConfig.HLS_PLAYBACK_BASE_URL)
                        put("token", json.getString("token"))
                        put("usuario", json.getJSONObject("usuario"))
                        put("operacion", json.optJSONObject("operacion") ?: JSONObject.NULL)
                    }
                    sendMessage(messageEvent.sourceNodeId, PATH_SESSION_SYNC, sync)
                } catch (e: Exception) {
                    sendSessionError(messageEvent.sourceNodeId, "Respuesta de smartwatch invalida")
                }
            }
        })
    }

    private fun sendSessionError(nodeId: String, message: String) {
        sendMessage(
            nodeId,
            PATH_SESSION_ERROR,
            JSONObject().apply { put("mensaje", message) }
        )
    }

    private fun sendMessage(nodeId: String, path: String, payload: JSONObject) {
        if (nodeId.isBlank()) return
        Wearable.getMessageClient(this)
            .sendMessage(nodeId, path, payload.toString().toByteArray(Charsets.UTF_8))
            .addOnFailureListener { Log.e(TAG, "No se pudo enviar $path al reloj", it) }
    }

    private fun Intent.putOperationExtras(payload: JSONObject) {
        putExtra("OPERATION_ID", payload.optInt("operation_id", -1))
        putExtra("OP_ESTADO", payload.optString("op_estado", "ACTIVA"))
        putExtra("OP_CODIGO", payload.optString("op_codigo", ""))
        putExtra("OP_NOMBRE", payload.optString("op_nombre", "Operacion"))
        putExtra("OP_DESCRIPCION", payload.optString("op_descripcion", ""))
        putExtra("OP_PRIORIDAD", payload.optString("op_prioridad", "MEDIA"))
        putExtra("OP_FECHA_INICIO", payload.optString("op_fecha_inicio", ""))
        putExtra("OP_FECHA_FIN", payload.optString("op_fecha_fin", ""))
        putExtra("OP_LAT", payload.optDouble("op_lat", 0.0))
        putExtra("OP_LON", payload.optDouble("op_lon", 0.0))
        putExtra("OP_ZOOM", payload.optInt("op_zoom", 8000))
    }

    private fun parsePayload(messageEvent: MessageEvent): JSONObject =
        runCatching { JSONObject(String(messageEvent.data, Charsets.UTF_8)) }
            .getOrElse { JSONObject() }

    private fun JSONObject.optionalCoordinate(vararg keys: String): Double? {
        for (key in keys) {
            if (!has(key) || isNull(key)) continue
            val value = optDouble(key, Double.NaN)
            if (value.isFinite()) return value
        }
        return null
    }
}
