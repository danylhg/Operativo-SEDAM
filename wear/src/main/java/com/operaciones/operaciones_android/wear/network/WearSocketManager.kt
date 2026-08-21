package com.operaciones.operaciones_android.wear.network

import android.util.Log
import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONObject

class WearSocketManager(
    private val baseUrl: String,
    private val operationId: Int,
    private val idPersonal: Int,
    private val rol: String,
    private val onConnected: (() -> Unit)? = null,
    private val onDisconnected: ((String) -> Unit)? = null,
    private val onConnectionError: ((String) -> Unit)? = null,
    private val onChatMessage: ((JSONObject) -> Unit)? = null,
    private val onMapEvent: ((String, JSONObject) -> Unit)? = null,
    private val onVoiceCallEvent: ((String, JSONObject) -> Unit)? = null
) {
    private var socket: Socket? = null

    fun connect() {
        if (socket?.connected() == true) return
        if (operationId <= 0 || idPersonal <= 0 || baseUrl.isBlank()) return

        socket = IO.socket(baseUrl).apply {
            on(Socket.EVENT_CONNECT) {
                emit("join_operacion", JSONObject().apply {
                    put("id_operacion", operationId)
                    put("id_personal", idPersonal)
                    put("rol", rol)
                    put("source", "SMARTWATCH")
                })
                onConnected?.invoke()
            }
            on(Socket.EVENT_DISCONNECT) { args ->
                onDisconnected?.invoke(args.firstOrNull()?.toString().orEmpty())
            }
            on(Socket.EVENT_CONNECT_ERROR) { args ->
                onConnectionError?.invoke(args.firstOrNull()?.toString().orEmpty())
            }
            on("chat_message") { args ->
                onChatMessage?.invoke(args.firstOrNull() as? JSONObject ?: return@on)
            }
            listOf(
                "voice_call_invite", "voice_call_accept", "voice_call_reject",
                "voice_call_end", "voice_call_offer", "voice_call_answer", "voice_call_ice"
            ).forEach { eventName ->
                on(eventName) { args ->
                    onVoiceCallEvent?.invoke(
                        eventName,
                        args.firstOrNull() as? JSONObject ?: return@on
                    )
                }
            }
            val mapEvents = listOf(
                "tracking_personal", "tracking_vehiculo", "tracking_equipo", "tracking_dispositivo",
                "ruta_navegacion_creada", "ruta_navegacion_eliminada", "ruta_operacion_creada", "ruta_operacion_eliminada",
                "poi_creado", "poi_actualizado", "poi_eliminado", "area_creada", "area_actualizada", "area_eliminada",
                "estructura_creada", "estructura_actualizada", "estructura_eliminada", "dibujo_creado", "dibujo_eliminado",
                "cuadricula_actualizada", "cuadricula_eliminada"
            )
            mapEvents.forEach { eventName ->
                on(eventName) { args ->
                    onMapEvent?.invoke(eventName, args.firstOrNull() as? JSONObject ?: JSONObject())
                }
            }
            connect()
        }
    }

    fun matches(baseUrl: String, operationId: Int, idPersonal: Int): Boolean =
        this.baseUrl == baseUrl && this.operationId == operationId && this.idPersonal == idPersonal

    fun emitTracking(
        lat: Double,
        lon: Double,
        apodo: String,
        speedKmh: Double?,
        headingDegrees: Double?,
        accuracyMeters: Float?
    ): Boolean {
        val active = socket?.connected() == true
        if (!active) {
            Log.w(TAG, "tracking_personal no emitido: socket desconectado")
            return false
        }

        socket?.emit("tracking_personal", JSONObject().apply {
            put("id_personal", idPersonal)
            put("latitud", lat)
            put("longitud", lon)
            put("apodo", apodo)
            put("nombre", apodo)
            put("rol", rol)
            put("origen", "SMARTWATCH")
            speedKmh?.let { put("velocidad_kmh", it) }
            headingDegrees?.let { put("rumbo_grados", it) }
            accuracyMeters?.let { put("precision_m", it) }
        })
        return true
    }

    fun emitVitalSigns(
        heartRateBpm: Double?,
        steps: Long?,
        pressureHpa: Float?,
        batteryPct: Double?,
        lat: Double?,
        lon: Double?
    ): Boolean {
        val active = socket?.connected() == true
        if (!active) {
            Log.w(TAG, "signos_vitales_personal no emitido: socket desconectado")
            return false
        }

        socket?.emit("signos_vitales_personal", JSONObject().apply {
            put("id_personal", idPersonal)
            heartRateBpm?.let { put("frecuencia_cardiaca_bpm", it) }
            steps?.let { put("pasos", it) }
            pressureHpa?.let { put("presion_barometrica_hpa", it.toDouble()) }
            batteryPct?.let { put("bateria_pct", it) }
            lat?.let { put("latitud", it) }
            lon?.let { put("longitud", it) }
            put("origen", "SMARTWATCH")
        })
        return true
    }

    fun emitVoiceCall(event: String, payload: JSONObject): Boolean {
        if (socket?.connected() != true) return false
        socket?.emit(event, payload)
        return true
    }

    fun disconnect() {
        socket?.disconnect()
        socket?.off()
        socket = null
    }

    private companion object {
        private const val TAG = "WearSocket"
    }
}
