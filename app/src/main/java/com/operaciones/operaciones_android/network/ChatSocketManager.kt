package com.operaciones.operaciones_android.network

import com.operaciones.operaciones_android.config.ApiConfig
import android.util.Log
import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONObject

class ChatSocketManager(
    private val operationId: Int,
    private val onNewMessage: (JSONObject) -> Unit,
    private val onNavigationRouteEvt: ((event: String, data: JSONObject) -> Unit)? = null,
    private val onTrackingPersonal: ((JSONObject) -> Unit)? = null,
    private val onTrackingVehiculo: ((JSONObject) -> Unit)? = null,
    private val onTrackingEquipo: ((JSONObject) -> Unit)? = null,
    private val onTrackingDispositivo: ((JSONObject) -> Unit)? = null,
    private val onSignosVitalesPersonal: ((JSONObject) -> Unit)? = null,
    private val onPoiCreado: ((JSONObject) -> Unit)? = null,
    private val onPoiEliminado: ((JSONObject) -> Unit)? = null,
    private val onAreaCreada: ((JSONObject) -> Unit)? = null,
    private val onAreaEliminada: ((JSONObject) -> Unit)? = null,
    private val onStructureCreada: ((JSONObject) -> Unit)? = null,
    private val onStructureEliminada: ((JSONObject) -> Unit)? = null,
    private val onDibujoCreado: ((JSONObject) -> Unit)? = null,
    private val onDibujoEliminado: ((JSONObject) -> Unit)? = null,
    private val onTacticalRouteCreada: ((JSONObject) -> Unit)? = null,
    private val onTacticalRouteEliminada: ((JSONObject) -> Unit)? = null,
    private val onGridActualizada: ((JSONObject) -> Unit)? = null,
    private val onGridEliminada: ((JSONObject) -> Unit)? = null,
    private val onConnected: (() -> Unit)? = null,
    private val onDisconnected: ((String) -> Unit)? = null,
    private val onConnectionError: ((String) -> Unit)? = null,
    private val onVoiceCallEvent: ((String, JSONObject) -> Unit)? = null,
    private val idPersonal: Int = -1,
    private val rol: String = ""
) {

    private var socket: Socket? = null

    fun isConnected(): Boolean = socket?.connected() == true

    fun connect() {
        if (isConnected()) return

        socket?.off()
        socket?.disconnect()

        val options = IO.Options().apply {
            reconnection = true
            reconnectionAttempts = Int.MAX_VALUE
            reconnectionDelay = 1_000L
            reconnectionDelayMax = 10_000L
            timeout = 20_000L
        }
        socket = IO.socket(ApiConfig.BASE_URL, options)

        socket?.on(Socket.EVENT_CONNECT) {
            Log.d("TrackingPersonal", "Socket conectado. Uniendo a operacion=$operationId idPersonal=$idPersonal rol=$rol")
            val payload = JSONObject().apply {
                put("id_operacion", operationId)
                if (idPersonal > 0) put("id_personal", idPersonal)
                if (rol.isNotEmpty()) put("rol", rol)
            }
            socket?.emit("join_operacion", payload)
            // Notifica que ya está conectado y unido para que se emita la posición inicial
            onConnected?.invoke()
        }

        socket?.on(Socket.EVENT_DISCONNECT) { args ->
            val reason = args.firstOrNull()?.toString().orEmpty()
            onDisconnected?.invoke(reason.ifBlank { "socket disconnect" })
        }

        socket?.on(Socket.EVENT_CONNECT_ERROR) { args ->
            val reason = args.firstOrNull()?.toString().orEmpty()
            Log.e("ChatSocket", "Error de conexion: ${reason.ifBlank { "connect error" }}")
            onConnectionError?.invoke(reason.ifBlank { "connect error" })
        }

        socket?.on("chat_message") { args ->
            val item = args.firstOrNull() as? JSONObject ?: return@on
            Log.d("ChatSocket", "Mensaje recibido id=${item.optInt("id_mensaje", -1)}")
            onNewMessage(item)
        }

        listOf(
            "voice_call_invite", "voice_call_accept", "voice_call_reject",
            "voice_call_end", "voice_call_offer", "voice_call_answer", "voice_call_ice"
        ).forEach { event ->
            socket?.on(event) { args ->
                val data = args.firstOrNull() as? JSONObject ?: return@on
                onVoiceCallEvent?.invoke(event, data)
            }
        }

        socket?.on("ruta_navegacion_creada") { args ->
            val data = args.firstOrNull() as? JSONObject ?: return@on
            onNavigationRouteEvt?.invoke("creada", data)
        }

        socket?.on("ruta_navegacion_eliminada") { args ->
            val data = args.firstOrNull() as? JSONObject ?: return@on
            onNavigationRouteEvt?.invoke("eliminada", data)
        }

        socket?.on("ruta_operacion_creada") { args ->
            val data = args.firstOrNull() as? JSONObject ?: return@on
            onTacticalRouteCreada?.invoke(data)
        }

        socket?.on("ruta_operacion_eliminada") { args ->
            val data = args.firstOrNull() as? JSONObject ?: return@on
            onTacticalRouteEliminada?.invoke(data)
        }

        socket?.on("tracking_personal") { args ->
            val data = args.firstOrNull() as? JSONObject ?: return@on
            onTrackingPersonal?.invoke(data)
        }

        socket?.on("signos_vitales_personal") { args ->
            val data = args.firstOrNull() as? JSONObject ?: return@on
            onSignosVitalesPersonal?.invoke(data)
        }

        socket?.on("tracking_vehiculo") { args ->
            val data = args.firstOrNull() as? JSONObject ?: return@on
            onTrackingVehiculo?.invoke(data)
        }

        socket?.on("tracking_equipo") { args ->
            val data = args.firstOrNull() as? JSONObject ?: return@on
            onTrackingEquipo?.invoke(data)
        }

        socket?.on("tracking_dispositivo") { args ->
            val data = args.firstOrNull() as? JSONObject ?: return@on
            onTrackingDispositivo?.invoke(data)
        }

        socket?.on("poi_creado") { args ->
            val data = args.firstOrNull() as? JSONObject ?: return@on
            onPoiCreado?.invoke(data)
        }

        socket?.on("poi_actualizado") { args ->
            val data = args.firstOrNull() as? JSONObject ?: return@on
            onPoiCreado?.invoke(data)
        }

        socket?.on("poi_eliminado") { args ->
            val data = args.firstOrNull() as? JSONObject ?: return@on
            onPoiEliminado?.invoke(data)
        }

        socket?.on("area_creada") { args ->
            val data = args.firstOrNull() as? JSONObject ?: return@on
            onAreaCreada?.invoke(data)
        }

        socket?.on("area_actualizada") { args ->
            val data = args.firstOrNull() as? JSONObject ?: return@on
            onAreaCreada?.invoke(data)
        }

        socket?.on("area_eliminada") { args ->
            val data = args.firstOrNull() as? JSONObject ?: return@on
            onAreaEliminada?.invoke(data)
        }

        socket?.on("estructura_creada") { args ->
            val data = args.firstOrNull() as? JSONObject ?: return@on
            onStructureCreada?.invoke(data)
        }

        socket?.on("estructura_actualizada") { args ->
            val data = args.firstOrNull() as? JSONObject ?: return@on
            onStructureCreada?.invoke(data)
        }

        socket?.on("estructura_eliminada") { args ->
            val data = args.firstOrNull() as? JSONObject ?: return@on
            onStructureEliminada?.invoke(data)
        }

        socket?.on("dibujo_creado") { args ->
            val data = args.firstOrNull() as? JSONObject ?: return@on
            onDibujoCreado?.invoke(data)
        }

        socket?.on("dibujo_eliminado") { args ->
            val data = args.firstOrNull() as? JSONObject ?: return@on
            onDibujoEliminado?.invoke(data)
        }

        socket?.on("cuadricula_actualizada") { args ->
            val data = args.firstOrNull() as? JSONObject ?: return@on
            onGridActualizada?.invoke(data)
        }

        socket?.on("cuadricula_eliminada") { args ->
            val data = args.firstOrNull() as? JSONObject ?: JSONObject()
            onGridEliminada?.invoke(data)
        }

        socket?.on("mgrs_grid_toggled") { args ->
            val data = args.firstOrNull() as? JSONObject
            val active = data?.optBoolean("active", false) ?: data?.optBoolean("enabled", false) ?: false
            onMgrsToggledFromSocket?.invoke(active)
        }

        socket?.on("geo_msg_created") { args ->
            val data = args.firstOrNull() as? JSONObject ?: return@on
            onGeoMsgCreatedFromSocket?.invoke(data)
        }

        socket?.on("geo_msg_deleted") { args ->
            val data = args.firstOrNull() as? JSONObject ?: return@on
            val id = data.optInt("id_geo_msg", data.optInt("id", -1))
            if (id > 0) onGeoMsgDeletedFromSocket?.invoke(id)
        }

        socket?.on("geo_msg_updated") { args ->
            val data = args.firstOrNull() as? JSONObject ?: return@on
            onGeoMsgUpdatedFromSocket?.invoke(data)
        }

        socket?.on("ptt_alert_update") { args ->
            val data = args.firstOrNull() as? JSONObject ?: JSONObject()
            onPttAlertUpdate?.invoke(data)
        }

        socket?.connect()
    }

    fun emitTracking(
        idPersonal: Int,
        lat: Double,
        lon: Double,
        apodo: String,
        rol: String = "",
        speedKmh: Double? = null,
        headingDegrees: Double? = null,
        accuracyMeters: Float? = null
    ) {
        val connected = socket?.connected() == true
        Log.d(
            "TrackingPersonal",
            "emitTracking connected=$connected op=$operationId personal=$idPersonal lat=$lat lon=$lon rol=$rol"
        )

        if (!connected) {
            Log.w("TrackingPersonal", "No se emitio tracking_personal: socket desconectado")
            return
        }

        val payload = JSONObject().apply {
            put("id_personal", idPersonal)
            put("latitud", lat)
            put("longitud", lon)
            put("apodo", apodo)
            put("nombre", apodo)
            put("rol", rol)
            speedKmh?.let { put("velocidad_kmh", it) }
            headingDegrees?.let { put("rumbo_grados", it) }
            accuracyMeters?.let { put("precision_m", it) }
        }
        socket?.emit("tracking_personal", payload)
    }

    fun emitTrackingVehiculo(idVehiculo: Int, lat: Double, lon: Double, alias: String) {
        val connected = socket?.connected() == true
        Log.d(
            "TrackingVehiculo",
            "emitTrackingVehiculo connected=$connected op=$operationId vehiculo=$idVehiculo lat=$lat lon=$lon"
        )

        if (!connected) {
            Log.w("TrackingVehiculo", "No se emitio tracking_vehiculo: socket desconectado")
            return
        }

        val payload = JSONObject().apply {
            put("id_vehiculo", idVehiculo)
            put("latitud", lat)
            put("longitud", lon)
            put("alias", alias)
            put("nombre", alias)
        }
        socket?.emit("tracking_vehiculo", payload)
    }

    fun emitTrackingEquipo(
        idEquipo: Int,
        lat: Double,
        lon: Double,
        nombre: String,
        categoria: String = "",
        tipoEquipo: String = "",
        numeroSerie: String = "",
        altitud: Double? = null,
        speedKmh: Double? = null,
        headingDegrees: Double? = null,
        accuracyMeters: Float? = null
    ) {
        val connected = socket?.connected() == true
        Log.d(
            "TrackingEquipo",
            "emitTrackingEquipo connected=$connected op=$operationId equipo=$idEquipo lat=$lat lon=$lon"
        )

        if (!connected) {
            Log.w("TrackingEquipo", "No se emitio tracking_equipo: socket desconectado")
            return
        }

        val payload = JSONObject().apply {
            put("id_equipo", idEquipo)
            put("latitud", lat)
            put("longitud", lon)
            put("nombre", nombre)
            if (categoria.isNotBlank()) put("categoria", categoria)
            if (tipoEquipo.isNotBlank()) put("tipo_equipo", tipoEquipo)
            if (numeroSerie.isNotBlank()) put("numero_serie", numeroSerie)
            altitud?.let { put("altitud", it) }
            speedKmh?.let { put("velocidad_kmh", it) }
            headingDegrees?.let { put("rumbo_grados", it) }
            accuracyMeters?.let { put("precision_m", it) }
        }
        socket?.emit("tracking_equipo", payload)
    }

    fun emitTrackingDispositivo(
        idDispositivo: Int,
        lat: Double,
        lon: Double,
        speedKmh: Double? = null,
        headingDegrees: Double? = null,
        accuracyMeters: Float? = null,
        numeroSerie: String? = null,
        imei: String? = null
    ) {
        val connected = socket?.connected() == true
        Log.d(
            "TrackingDispositivo",
            "emitTrackingDispositivo connected=$connected op=$operationId dispositivo=$idDispositivo lat=$lat lon=$lon"
        )

        if (!connected) {
            Log.w("TrackingDispositivo", "No se emitio tracking_dispositivo: socket desconectado")
            return
        }

        val payload = JSONObject().apply {
            put("id_dispositivo", idDispositivo)
            put("latitud", lat)
            put("longitud", lon)
            speedKmh?.let { put("velocidad_kmh", it) }
            headingDegrees?.let { put("rumbo_grados", it) }
            accuracyMeters?.let { put("precision_m", it) }
            numeroSerie?.takeIf { it.isNotBlank() }?.let {
                put("serial_dispositivo", it)
                put("numero_serie", it)
            }
            imei?.takeIf { it.isNotBlank() }?.let { put("imei", it) }
        }
        socket?.emit("tracking_dispositivo", payload)
    }

    fun disconnect() {
        socket?.disconnect()
        socket?.off()
        socket = null
    }

    fun emitVoiceCall(event: String, payload: JSONObject) {
        if (socket?.connected() != true) return
        socket?.emit(event, payload)
    }

    var onMgrsToggledFromSocket: ((Boolean) -> Unit)? = null
    var onGeoMsgCreatedFromSocket: ((JSONObject) -> Unit)? = null
    var onGeoMsgDeletedFromSocket: ((Int) -> Unit)? = null
    var onGeoMsgUpdatedFromSocket: ((JSONObject) -> Unit)? = null

    fun emitMgrsToggled(active: Boolean) {
        if (socket?.connected() != true) return
        val payload = JSONObject().apply {
            put("id_operacion", operationId)
            put("active", active)
            put("enabled", active)
        }
        socket?.emit("mgrs_grid_toggled", payload)
    }

    fun emitGeoMsgCreated(idGeoMsg: Int, lat: Double, lon: Double, text: String, author: String, isPublic: Boolean = false) {
        if (socket?.connected() != true || idGeoMsg <= 0) return
        val payload = JSONObject().apply {
            put("id_operacion", operationId)
            put("id_geo_msg", idGeoMsg)
            put("lat", lat)
            put("lon", lon)
            put("text", text)
            put("author", author)
            put("visibilidad", if (isPublic) "PUBLICO" else "PRIVADO")
        }
        socket?.emit("geo_msg_created", payload)
    }

    fun emitGeoMsgDeleted(idGeoMsg: Int) {
        if (socket?.connected() != true || idGeoMsg <= 0) return
        socket?.emit("geo_msg_deleted", JSONObject().apply {
            put("id_operacion", operationId)
            put("id_geo_msg", idGeoMsg)
        })
    }

    fun emitGeoMsgUpdated(idGeoMsg: Int, lat: Double, lon: Double, text: String, author: String, isPublic: Boolean) {
        if (socket?.connected() != true || idGeoMsg <= 0) return
        socket?.emit("geo_msg_updated", JSONObject().apply {
            put("id_operacion", operationId); put("id_geo_msg", idGeoMsg); put("lat", lat); put("lon", lon)
            put("text", text); put("author", author); put("visibilidad", if (isPublic) "PUBLICO" else "PRIVADO")
        })
    }

    fun emitGeoMsgVisibilityChanged(idGeoMsg: Int, isPublic: Boolean) {
        if (socket?.connected() != true || idGeoMsg <= 0) return
        socket?.emit("geo_msg_visibility_changed", JSONObject().apply {
            put("id_operacion", operationId); put("id_geo_msg", idGeoMsg); put("visibilidad", if (isPublic) "PUBLICO" else "PRIVADO")
        })
    }

    fun emitGridUpdated(rows: Int, cols: Int, size: String, names: List<String>) {
        if (socket?.connected() != true) return
        val gridObj = JSONObject().apply {
            put("rows", rows)
            put("cols", cols)
            put("size", size)
            put("names", org.json.JSONArray(names))
            put("nombres", org.json.JSONArray(names))
        }
        val payload = JSONObject().apply {
            put("id_operacion", operationId)
            put("grid", gridObj)
            put("cuadricula", gridObj)
        }
        socket?.emit("cuadricula_actualizada", payload)
        socket?.emit("grid_actualizada", payload)
    }

    var onPttAlertUpdate: ((JSONObject) -> Unit)? = null

    fun emitPttAlertToggle(active: Boolean, senderName: String, lat: Double? = null, lon: Double? = null, idPersonal: Int? = null) {
        val payload = JSONObject().apply {
            put("id_operacion", operationId)
            put("active", active)
            put("sender_name", senderName)
            if (idPersonal != null) put("id_personal", idPersonal)
            if (lat != null) put("lat", lat)
            if (lon != null) put("lon", lon)
        }
        socket?.emit("ptt_alert_toggle", payload)
    }

    fun emitGridDeleted() {
        if (socket?.connected() != true) return
        val payload = JSONObject().apply {
            put("id_operacion", operationId)
        }
        socket?.emit("cuadricula_eliminada", payload)
        socket?.emit("grid_eliminada", payload)
    }
}
