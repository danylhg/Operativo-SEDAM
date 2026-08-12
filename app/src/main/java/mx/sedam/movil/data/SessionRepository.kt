package mx.sedam.movil.data

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject
import java.util.Locale
import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin

/** Posición de otra unidad recibida por el canal 'data' (OWNPOS de otros). */
data class UnitPos(
    val id: String,
    val lat: Double,
    val lng: Double,
    val course: Float,
    val speed: Float,
    val ts: Long,
)

/**
 * Waypoint (punto táctico). key = "$ownerId-$id".
 * `sharing` solo es controlable para los MÍOS (owner == myId): indica si está
 * siendo emitido a los demás ahora mismo. Un waypoint ajeno solo existe en el
 * mapa mientras su dueño lo comparte (llega/se quita por WAYPOINTPOS/REMOVE).
 */
data class Waypoint(
    val key: String,
    val id: String,
    val ownerId: String,
    val sidc: String,
    val name: String,
    val lat: Double,
    val lng: Double,
    val alt: Double,
    val sharing: Boolean = false,
)

/**
 * Mensaje de chat (MSGTXT). `toId` = "0" para el chat general (grupal); para
 * privados, es el id del destinatario. `threadId` es la clave de conversación
 * usada en `privateChats`: el id de LA OTRA unidad (si `mine`, es `toId`; si no,
 * es `fromId`) — así el hilo es el mismo se mande o se reciba.
 */
data class ChatMessage(
    val id: String,
    val fromId: String,
    val toId: String,
    val text: String,
    val ts: Long,
    val mine: Boolean,
)

/**
 * Blanco/objetivo (TRACKPOS). key = "$unitId-$serial".
 * `transmitting` solo es controlable para los MÍOS: si es true y speed>0, la
 * posición avanza sola (dead reckoning) y se reemite cada 2s, igual que el
 * web-system.
 */
data class TargetTrack(
    val key: String,
    val unitId: String,
    val serial: String,
    val sidc: String,
    val name: String,
    val lat: Double,
    val lng: Double,
    val heading: Float,
    val speed: Float, // km/h
    val transmitting: Boolean = false,
)

/**
 * Sesión compartida (singleton) entre el login y el mapa. Posee el socket y el
 * cifrado, aprende el id propio (myId) que el server envía tras el login y expone
 * el envío de OWNPOS, pánico, waypoints y blancos, más un flujo de mensajes 'data'.
 */
object SessionRepository {

    val crypto = CryptoManager()
    val socket = SocketManager(crypto)

    private val _myId = MutableStateFlow<String?>(null)
    val myId: StateFlow<String?> = _myId.asStateFlow()

    var workSession: String? = null
        private set

    // Mensajes 'data' ya descifrados (por si se necesitan crudos).
    private val _incoming = MutableSharedFlow<String>(extraBufferCapacity = 128)
    val incoming: SharedFlow<String> = _incoming

    // Otras unidades (por id) con su última posición, para pintarlas en el mapa.
    private val _units = MutableStateFlow<Map<String, UnitPos>>(emptyMap())
    val units: StateFlow<Map<String, UnitPos>> = _units.asStateFlow()

    // Alias por id (llegan por ID_ALIAS). Se muestran con prioridad sobre el nombre.
    private val _aliases = MutableStateFlow<Map<String, String>>(emptyMap())
    val aliases: StateFlow<Map<String, String>> = _aliases.asStateFlow()

    // Ids de OTRAS unidades en pánico (MSGPANIC ON), para resaltarlas en el mapa.
    private val _panics = MutableStateFlow<Set<String>>(emptySet())
    val panics: StateFlow<Set<String>> = _panics.asStateFlow()

    @Volatile
    private var ownPanic = false

    // Waypoints y blancos (propios + de otras unidades) para pintar/listar.
    private val _waypoints = MutableStateFlow<Map<String, Waypoint>>(emptyMap())
    val waypoints: StateFlow<Map<String, Waypoint>> = _waypoints.asStateFlow()

    private val _targets = MutableStateFlow<Map<String, TargetTrack>>(emptyMap())
    val targets: StateFlow<Map<String, TargetTrack>> = _targets.asStateFlow()

    // Chat general (grupal, toId="0"): historial compartido por todas las unidades.
    private val _generalChat = MutableStateFlow<List<ChatMessage>>(emptyList())
    val generalChat: StateFlow<List<ChatMessage>> = _generalChat.asStateFlow()
    private val _unreadGeneral = MutableStateFlow(0)
    val unreadGeneral: StateFlow<Int> = _unreadGeneral.asStateFlow()

    // Chats privados: id de LA OTRA unidad -> historial de esa conversación.
    private val _privateChats = MutableStateFlow<Map<String, List<ChatMessage>>>(emptyMap())
    val privateChats: StateFlow<Map<String, List<ChatMessage>>> = _privateChats.asStateFlow()
    private val _unreadPrivate = MutableStateFlow<Map<String, Int>>(emptyMap())
    val unreadPrivate: StateFlow<Map<String, Int>> = _unreadPrivate.asStateFlow()

    // Pulso de "llegó un mensaje de otra unidad" (general o privado), para que la UI
    // dispare sonido/vibración/banner sin tener que diffear las listas de arriba.
    private val _incomingChat = MutableSharedFlow<ChatMessage>(extraBufferCapacity = 32)
    val incomingChat: SharedFlow<ChatMessage> = _incomingChat

    // Contador local para ids de objetos creados por esta unidad.
    @Volatile
    private var localSeq = 0
    private fun nextLocalId(): String = "${System.currentTimeMillis() % 100000}${localSeq++}"

    private var lastTargetTick = System.currentTimeMillis()

    init {
        socket.onData = { plaintext -> handleData(plaintext) }
    }

    fun isMine(ownerOrUnitId: String): Boolean = ownerOrUnitId == _myId.value

    /**
     * Tras el login, el server manda como 'data' el JSON del dispositivo
     * { id, work_session, ... } — de ahí aprendemos nuestro id para el OWNPOS.
     */
    private fun handleData(plaintext: String) {
        val trimmed = plaintext.trim()
        if (trimmed.startsWith("{")) {
            runCatching {
                val obj = JSONObject(trimmed)
                when {
                    obj.has("id") -> {
                        _myId.value = obj.get("id").toString()
                        val ws = obj.optString("work_session")
                        if (ws.isNotBlank()) workSession = ws
                        // Repuebla el chat (general + privados donde participo) desde la
                        // BD del server — no vive solo en memoria del celular.
                        sendHistoryRequest()
                        // Alias que YA pusieron otras unidades aunque ahora mismo no estén
                        // conectadas (antes solo se aprendían por reenvío en vivo).
                        sendAliasDirectoryRequest()
                    }

                    obj.optString("type") == "MSGTXT_HISTORY" -> parseHistory(obj)
                    obj.optString("type") == "ALIAS_DIRECTORY" -> parseAliasDirectory(obj)
                }
            }
        } else {
            val clean = trimmed.substringAfterLast("[:]")
            when (clean.substringBefore(",")) {
                "OWNPOS" -> parseOwnPos(clean)
                "ID_ALIAS" -> parseAlias(clean)
                "MSGPANIC" -> parsePanic(clean)
                "WAYPOINTPOS" -> parseWaypoint(clean)
                "TRACKPOS" -> parseTrack(clean)
                "MSGTXT" -> parseMsgTxt(clean)
                "SESSION_OUT" -> removeUnit(clean) // unidad desconectada → quitar del mapa
            }
        }
        _incoming.tryEmit(plaintext)
    }

    private fun parseAlias(clean: String) {
        val p = clean.split(",")
        val id = p.getOrNull(1)?.trim().orEmpty()
        val alias = p.getOrNull(2)?.trim().orEmpty()
        if (id.isNotEmpty() && alias.isNotEmpty()) _aliases.value = _aliases.value + (id to alias)
    }

    /**
     * { type: "ALIAS_DIRECTORY", aliases: [{id, alias}, ...] } — respuesta a
     * sendAliasDirectoryRequest(). Trae los alias que YA pusieron otras unidades
     * (guardados en la BD del server) aunque ahora mismo no estén conectadas para
     * reenviar el suyo en vivo. No pisa un alias que haya llegado más reciente
     * por ID_ALIAS en vivo si por alguna carrera llegara después.
     */
    private fun parseAliasDirectory(obj: JSONObject) {
        val arr = obj.optJSONArray("aliases") ?: return
        var map = _aliases.value
        for (i in 0 until arr.length()) {
            val row = arr.optJSONObject(i) ?: continue
            val id = row.optString("id")
            val alias = row.optString("alias")
            if (id.isEmpty() || alias.isEmpty()) continue
            if (!map.containsKey(id)) map = map + (id to alias)
        }
        _aliases.value = map
    }

    /** MSGPANIC,id,ON[,lat,lng] | MSGPANIC,id,OFF — de OTRA unidad. */
    private fun parsePanic(clean: String) {
        val p = clean.split(",")
        val id = p.getOrNull(1)?.trim().orEmpty()
        if (id.isEmpty() || id == _myId.value) return
        val on = p.getOrNull(2)?.trim()?.uppercase() == "ON"
        if (on) {
            _panics.value = _panics.value + id
            // El ON viene enriquecido con la posición → mover la unidad ahí.
            val lat = p.getOrNull(3)?.toDoubleOrNull()
            val lng = p.getOrNull(4)?.toDoubleOrNull()
            if (lat != null && lng != null) {
                val prev = _units.value[id]
                _units.value = _units.value + (id to UnitPos(
                    id,
                    lat,
                    lng,
                    prev?.course ?: 0f,
                    prev?.speed ?: 0f,
                    System.currentTimeMillis()
                ))
            }
        } else {
            _panics.value = _panics.value - id
        }
    }

    // Estos SOLO llegan de OTRAS unidades: el server no hace echo al emisor
    // (broadcastEncrypted excluye el socket de origen), así que los objetos
    // propios nunca pasan por aquí — su estado local lo maneja create/share/edit.

    // WAYPOINTPOS,id,ownerId,sidc,name,lat,lng,alt  |  ...,REMOVE,0,0
    private fun parseWaypoint(clean: String) {
        val p = clean.split(",")
        val id = p.getOrNull(1)?.trim().orEmpty()
        val owner = p.getOrNull(2)?.trim().orEmpty()
        if (id.isEmpty() || owner.isEmpty()) return
        val key = "$owner-$id"
        if (p.getOrNull(3)?.trim()?.uppercase() == "REMOVE") {
            _waypoints.value = _waypoints.value - key
            return
        }
        val lat = p.getOrNull(5)?.toDoubleOrNull() ?: return
        val lng = p.getOrNull(6)?.toDoubleOrNull() ?: return
        _waypoints.value = _waypoints.value + (key to Waypoint(
            key = key, id = id, ownerId = owner,
            sidc = p.getOrNull(3)?.trim().orEmpty(),
            name = p.getOrNull(4)?.trim().orEmpty(),
            lat = lat, lng = lng, alt = p.getOrNull(7)?.toDoubleOrNull() ?: 0.0,
            sharing = true, // existe porque su dueño lo está compartiendo
        ))
    }

    // TRACKPOS,unitId,serial,sidc,name,lat,lng,alt,heading,speed  (lat=0,lng=0 → remover)
    private fun parseTrack(clean: String) {
        val p = clean.split(",")
        val unitId = p.getOrNull(1)?.trim().orEmpty()
        val serial = p.getOrNull(2)?.trim().orEmpty()
        if (unitId.isEmpty() || serial.isEmpty()) return
        val key = "$unitId-$serial"
        val lat = p.getOrNull(5)?.toDoubleOrNull() ?: return
        val lng = p.getOrNull(6)?.toDoubleOrNull() ?: return
        if (lat == 0.0 && lng == 0.0) {
            _targets.value = _targets.value - key; return
        }
        _targets.value = _targets.value + (key to TargetTrack(
            key = key, unitId = unitId, serial = serial,
            sidc = p.getOrNull(3)?.trim().orEmpty(),
            name = p.getOrNull(4)?.trim().orEmpty(),
            lat = lat, lng = lng,
            heading = p.getOrNull(8)?.toFloatOrNull() ?: 0f,
            speed = p.getOrNull(9)?.toFloatOrNull() ?: 0f,
            transmitting = true, // existe porque su dueño lo está transmitiendo
        ))
    }

    private fun removeUnit(clean: String) {
        val id = clean.split(",").getOrNull(1)?.trim().orEmpty()
        if (id.isNotEmpty()) {
            _units.value = _units.value - id
            _panics.value = _panics.value - id
        }
    }

    /**
     * MSGTXT,fromId,toId,text — de OTRA unidad (el server no hace echo al emisor).
     * toId="0" (o "ALL", por si algún día llega de un puente que use esa
     * convención) es el chat general; cualquier otro toId es privado y solo se
     * procesa si YO soy el destinatario — un privado ajeno se descarta, igual
     * que hace el web-system.
     */
    private fun parseMsgTxt(clean: String) {
        val p = clean.split(",", limit = 4)
        val from = p.getOrNull(1)?.trim().orEmpty()
        val to = p.getOrNull(2)?.trim().orEmpty()
        val text = p.getOrNull(3).orEmpty()
        val myId = _myId.value
        if (from.isEmpty() || from == myId) return

        if (to == "0" || to.equals("ALL", ignoreCase = true)) {
            val msg = ChatMessage(
                id = nextLocalId(), fromId = from, toId = to, text = text,
                ts = System.currentTimeMillis(), mine = false,
            )
            _generalChat.value = _generalChat.value + msg
            _unreadGeneral.value += 1
            _incomingChat.tryEmit(msg)
        } else if (to == myId) {
            val msg = ChatMessage(
                id = nextLocalId(), fromId = from, toId = to, text = text,
                ts = System.currentTimeMillis(), mine = false,
            )
            _privateChats.value = _privateChats.value +
                    (from to ((_privateChats.value[from] ?: emptyList()) + msg))
            _unreadPrivate.value =
                _unreadPrivate.value + (from to ((_unreadPrivate.value[from] ?: 0) + 1))
            _incomingChat.tryEmit(msg)
        }
        // Privado dirigido a otra unidad: no me corresponde, se ignora.
    }

    /**
     * { type: "MSGTXT_HISTORY", messages: [{from,to,text,ts}, ...] } — respuesta a
     * sendHistoryRequest(). Repuebla el general y los privados donde participo
     * desde la BD del server (no depende de lo que ya haya en memoria). No cuenta
     * como "no leído" ni dispara sonido/banner: es historial, no un mensaje nuevo.
     */
    private fun parseHistory(obj: JSONObject) {
        val myId = _myId.value ?: return
        val arr = obj.optJSONArray("messages") ?: return
        var general = _generalChat.value
        var privates = _privateChats.value

        for (i in 0 until arr.length()) {
            val row = arr.optJSONObject(i) ?: continue
            val from = row.optString("from")
            val to = row.optString("to")
            val text = row.optString("text")
            val ts = row.optLong("ts")
            if (from.isEmpty() || to.isEmpty()) continue
            val mine = from == myId
            val msg = ChatMessage(
                id = nextLocalId(),
                fromId = from,
                toId = to,
                text = text,
                ts = ts,
                mine = mine
            )

            if (to == "0" || to.equals("ALL", ignoreCase = true)) {
                if (general.none { it.fromId == from && it.ts == ts && it.text == text }) {
                    general = general + msg
                }
            } else {
                val threadId = if (mine) to else from
                if (threadId.isEmpty()) continue
                val existing = privates[threadId] ?: emptyList()
                if (existing.none { it.fromId == from && it.ts == ts && it.text == text }) {
                    privates = privates + (threadId to (existing + msg))
                }
            }
        }

        _generalChat.value = general.sortedBy { it.ts }
        _privateChats.value = privates.mapValues { (_, list) -> list.sortedBy { it.ts } }
    }

    // ── Waypoints propios: crear/compartir/editar/eliminar (privados por defecto) ──

    private fun sanitize(s: String) = s.replace("[:]", "").replace(",", ";")

    private fun waypointMsg(w: Waypoint) =
        "WAYPOINTPOS,${w.id},${w.ownerId},${w.sidc},${sanitize(w.name)}," +
                "${"%.4f".format(Locale.US, w.lat)},${
                    "%.4f".format(
                        Locale.US,
                        w.lng
                    )
                },${w.alt.toInt()}"

    /** Crea un waypoint PRIVADO (solo yo lo veo); no se emite nada todavía. */
    fun createWaypoint(
        sidc: String,
        name: String,
        lat: Double,
        lng: Double,
        alt: Double = 0.0
    ): String? {
        val owner = _myId.value ?: return null
        val id = nextLocalId()
        val key = "$owner-$id"
        _waypoints.value = _waypoints.value + (key to Waypoint(
            key,
            id,
            owner,
            sidc,
            sanitize(name),
            lat,
            lng,
            alt
        ))
        return key
    }

    /** Empieza a compartir: los demás lo ven a partir de ahora. */
    fun shareWaypoint(key: String) {
        val w = _waypoints.value[key] ?: return
        if (!isMine(w.ownerId)) return
        val updated = w.copy(sharing = true)
        _waypoints.value = _waypoints.value + (key to updated)
        socket.emitEncrypted("WAYPOINTPOS", waypointMsg(updated))
    }

    /** Deja de compartir: los demás lo pierden; yo lo conservo localmente. */
    fun stopShareWaypoint(key: String) {
        val w = _waypoints.value[key] ?: return
        if (!isMine(w.ownerId)) return
        _waypoints.value = _waypoints.value + (key to w.copy(sharing = false))
        socket.emitEncrypted("WAYPOINTPOS", "WAYPOINTPOS,${w.id},${w.ownerId},REMOVE,0,0")
    }

    /** Edita un waypoint propio; si está compartiéndose, reemite el cambio. */
    fun updateWaypoint(key: String, sidc: String, name: String) {
        val w = _waypoints.value[key] ?: return
        if (!isMine(w.ownerId)) return
        val updated = w.copy(sidc = sidc, name = sanitize(name))
        _waypoints.value = _waypoints.value + (key to updated)
        if (updated.sharing) socket.emitEncrypted("WAYPOINTPOS", waypointMsg(updated))
    }

    /** Elimina un waypoint propio. SIEMPRE avisa a los demás (aunque no compartiera). */
    fun removeWaypoint(key: String) {
        val w = _waypoints.value[key] ?: return
        if (!isMine(w.ownerId)) return
        socket.emitEncrypted("WAYPOINTPOS", "WAYPOINTPOS,${w.id},${w.ownerId},REMOVE,0,0")
        _waypoints.value = _waypoints.value - key
    }

    // ── Blancos propios: crear/transmitir/editar/eliminar (privados por defecto) ──

    private fun trackMsg(t: TargetTrack): String {
        val spd = if (t.speed < 0.1f) 0.1f else t.speed
        return "TRACKPOS,${t.unitId},${t.serial},${t.sidc},${sanitize(t.name)}," +
                "${"%.4f".format(Locale.US, t.lat)},${"%.4f".format(Locale.US, t.lng)},0," +
                "${"%.1f".format(Locale.US, t.heading)},${"%.1f".format(Locale.US, spd)}"
    }

    /** Crea un blanco PRIVADO (solo yo lo veo); no se emite nada todavía. */
    fun createTarget(
        sidc: String,
        name: String,
        lat: Double,
        lng: Double,
        heading: Float = 0f,
        speed: Float = 0f
    ): String? {
        val unit = _myId.value ?: return null
        val serial = nextLocalId()
        val key = "$unit-$serial"
        _targets.value = _targets.value + (key to TargetTrack(
            key,
            unit,
            serial,
            sidc,
            sanitize(name),
            lat,
            lng,
            heading,
            speed
        ))
        return key
    }

    /** Empieza a transmitir: se emite ya mismo y luego cada 2s (ver tickTargets). */
    fun startTransmitTarget(key: String) {
        val t = _targets.value[key] ?: return
        if (!isMine(t.unitId)) return
        val updated = t.copy(transmitting = true)
        _targets.value = _targets.value + (key to updated)
        socket.emitEncrypted("TRACKPOS", trackMsg(updated))
    }

    /** Deja de transmitir: avisa a los demás (0,0) para que lo quiten; lo conservo local. */
    fun stopTransmitTarget(key: String) {
        val t = _targets.value[key] ?: return
        if (!isMine(t.unitId)) return
        _targets.value = _targets.value + (key to t.copy(transmitting = false))
        socket.emitEncrypted(
            "TRACKPOS",
            "TRACKPOS,${t.unitId},${t.serial},${t.sidc},${sanitize(t.name)},0,0,0,0,0"
        )
    }

    /** Edita un blanco propio (nombre/sidc/rumbo/velocidad). */
    fun updateTarget(key: String, sidc: String, name: String, heading: Float, speed: Float) {
        val t = _targets.value[key] ?: return
        if (!isMine(t.unitId)) return
        val updated = t.copy(sidc = sidc, name = sanitize(name), heading = heading, speed = speed)
        _targets.value = _targets.value + (key to updated)
        if (updated.transmitting) socket.emitEncrypted("TRACKPOS", trackMsg(updated))
    }

    /**
     * Elimina un blanco propio. SIEMPRE manda la señal de remoción (0,0), esté o
     * no transmitiendo — evita el "fantasma" que queda en otros clientes si se
     * borra sin antes desactivar la transmisión.
     */
    fun removeTarget(key: String) {
        val t = _targets.value[key] ?: return
        if (!isMine(t.unitId)) return
        socket.emitEncrypted(
            "TRACKPOS",
            "TRACKPOS,${t.unitId},${t.serial},${t.sidc},${sanitize(t.name)},0,0,0,0,0"
        )
        _targets.value = _targets.value - key
    }

    /**
     * Dead reckoning: para cada blanco propio transmitiendo, si tiene velocidad
     * avanza su posición según rumbo/velocidad, y reemite (cada ~2s), igual que
     * el web-system. Llamar periódicamente desde la UI mientras el mapa esté visible.
     */
    fun tickTargets() {
        val now = System.currentTimeMillis()
        val dt = (now - lastTargetTick) / 1000.0
        lastTargetTick = now
        val mine = _targets.value.values.filter { isMine(it.unitId) && it.transmitting }
        if (mine.isEmpty()) return
        var map = _targets.value
        mine.forEach { t ->
            var lat = t.lat
            var lng = t.lng
            if (t.speed > 0f) {
                val (nlat, nlng) = movePoint(t.lat, t.lng, t.heading, t.speed, dt)
                lat = nlat; lng = nlng
            }
            val updated = t.copy(lat = lat, lng = lng)
            map = map + (t.key to updated)
            socket.emitEncrypted("TRACKPOS", trackMsg(updated))
        }
        _targets.value = map
    }

    /** Fórmula de rumbo/distancia (Haversine), igual a movePoint() del web-system. */
    private fun movePoint(
        lat: Double,
        lng: Double,
        headingDeg: Float,
        speedKmh: Float,
        dtSeconds: Double
    ): Pair<Double, Double> {
        val r = 6378137.0
        val speedMs = speedKmh / 3.6
        val distance = speedMs * dtSeconds
        if (!distance.isFinite() || distance <= 0.0) return lat to lng
        val brng = Math.toRadians(headingDeg.toDouble())
        val lat1 = Math.toRadians(lat)
        val lng1 = Math.toRadians(lng)
        val lat2 = asin(sin(lat1) * cos(distance / r) + cos(lat1) * sin(distance / r) * cos(brng))
        val lng2 = lng1 + atan2(
            sin(brng) * sin(distance / r) * cos(lat1),
            cos(distance / r) - sin(lat1) * sin(lat2)
        )
        return Math.toDegrees(lat2) to Math.toDegrees(lng2)
    }

    /** Nombre a mostrar: alias > nombre del catálogo > "Unidad <id>". */
    fun displayName(id: String): String =
        _aliases.value[id] ?: SedamUnits.name(id) ?: "Unidad $id"

    /** Quita unidades que no reportan hace más de maxAgeMs (por si se pierde el SESSION_OUT). */
    fun pruneStale(maxAgeMs: Long = 30_000L) {
        val now = System.currentTimeMillis()
        val fresh = _units.value.filterValues { now - it.ts < maxAgeMs }
        if (fresh.size != _units.value.size) _units.value = fresh
    }

    /** OWNPOS de OTRA unidad: OWNPOS,id,lat,lng,alt,course,speed (puede venir con
     *  prefijo de sesión "sesion[:]OWNPOS,..."). Se ignora la propia. */
    private fun parseOwnPos(raw: String) {
        val clean = raw.substringAfterLast("[:]")
        val parts = clean.split(",")
        if (parts.getOrNull(0) != "OWNPOS") return
        val id = parts.getOrNull(1)?.trim().orEmpty()
        if (id.isEmpty() || id == _myId.value) return
        val lat = parts.getOrNull(2)?.toDoubleOrNull() ?: return
        val lng = parts.getOrNull(3)?.toDoubleOrNull() ?: return
        val course = parts.getOrNull(5)?.toFloatOrNull() ?: 0f
        val speed = parts.getOrNull(6)?.toFloatOrNull() ?: 0f
        _units.value =
            _units.value + (id to UnitPos(id, lat, lng, course, speed, System.currentTimeMillis()))
    }

    /** Envía la posición propia: OWNPOS,id,lat,lng,alt,course,speed (cifrado). */
    fun sendOwnPos(lat: Double, lng: Double, course: Float, speed: Float, alt: Double = 0.0) {
        val id = _myId.value ?: return // aún no sabemos nuestro id
        val fLat = String.format(Locale.US, "%.4f", lat)
        val fLng = String.format(Locale.US, "%.4f", lng)
        val fAlt = abs(alt).roundToInt()
        val fCourse = String.format(Locale.US, "%.1f", course.toDouble())
        val fSpeed = if (speed < 0.1f) "0" else String.format(Locale.US, "%.1f", speed.toDouble())
        runCatching {
            socket.emitEncrypted("OWNPOS", "OWNPOS,$id,$fLat,$fLng,$fAlt,$fCourse,$fSpeed")
        }
    }

    /**
     * Envía (o reenvía tras reconectar) el alias propio: ID_ALIAS,myId,alias.
     * El server no hace eco a quien lo envía, así que se refleja localmente de
     * inmediato para que el nombre se actualice sin esperar a nadie.
     */
    fun sendAlias(alias: String) {
        val id = _myId.value ?: return
        val clean = sanitize(alias.trim())
        if (clean.isEmpty()) return
        _aliases.value = _aliases.value + (id to clean)
        runCatching { socket.emitEncrypted("ID_ALIAS", "ID_ALIAS,$id,$clean") }
    }

    /**
     * Pide al server el historial de chat (general + privados donde participo),
     * guardado en su BD (tabla `messages`). Se llama sola al aprender `myId` tras
     * cada login/reconexión — la respuesta llega como 'data' JSON y la procesa
     * parseHistory(). No usa la API key de manager: es un evento del socket ya
     * autenticado por dispositivo (serial + token + AES), como todo lo demás.
     */
    private fun sendHistoryRequest() {
        runCatching { socket.emitEncrypted("MSGTXT_HISTORY", "MSGTXT_HISTORY") }
    }

    /** Pide el directorio de alias guardados server-side (ver parseAliasDirectory). */
    private fun sendAliasDirectoryRequest() {
        runCatching { socket.emitEncrypted("ALIAS_DIRECTORY", "ALIAS_DIRECTORY") }
    }

    /**
     * Envía un mensaje al chat general (grupal, toId="0"). El server no hace
     * echo al emisor, así que se refleja localmente de inmediato (igual patrón
     * que alias/waypoints/blancos).
     */
    fun sendChatGeneral(text: String) {
        val id = _myId.value ?: return
        val clean = sanitize(text.trim())
        if (clean.isEmpty()) return
        _generalChat.value = _generalChat.value + ChatMessage(
            id = nextLocalId(), fromId = id, toId = "0", text = clean,
            ts = System.currentTimeMillis(), mine = true,
        )
        runCatching { socket.emitEncrypted("MSGTXT", "MSGTXT,$id,0,$clean") }
    }

    /** Envía un mensaje privado a `toId`; se refleja localmente en el hilo de esa unidad. */
    fun sendChatPrivate(toId: String, text: String) {
        val id = _myId.value ?: return
        val clean = sanitize(text.trim())
        if (clean.isEmpty() || toId.isBlank()) return
        val msg = ChatMessage(
            id = nextLocalId(), fromId = id, toId = toId, text = clean,
            ts = System.currentTimeMillis(), mine = true,
        )
        _privateChats.value = _privateChats.value +
                (toId to ((_privateChats.value[toId] ?: emptyList()) + msg))
        runCatching { socket.emitEncrypted("MSGTXT", "MSGTXT,$id,$toId,$clean") }
    }

    fun markGeneralChatRead() {
        _unreadGeneral.value = 0
    }

    fun markPrivateChatRead(otherId: String) {
        if (_unreadPrivate.value.containsKey(otherId)) _unreadPrivate.value =
            _unreadPrivate.value - otherId
    }

    /** Envía alerta de pánico. El server enriquece el ON con la última posición. */
    fun sendPanic(active: Boolean) {
        val id = _myId.value ?: return
        ownPanic = active
        runCatching {
            socket.emitEncrypted("MSGPANIC", "MSGPANIC,$id,${if (active) "ON" else "OFF"}")
        }
    }

    fun disconnect() {
        // Si el pánico quedó activo, mandar OFF ANTES de cerrar el socket.
        if (ownPanic) {
            _myId.value?.let { id ->
                runCatching { socket.emitEncrypted("MSGPANIC", "MSGPANIC,$id,OFF") }
            }
            ownPanic = false
        }
        socket.disconnect()
        _myId.value = null
        workSession = null
        _units.value = emptyMap()
        _aliases.value = emptyMap()
        _panics.value = emptySet()
        _waypoints.value = emptyMap()
        _targets.value = emptyMap()
        _generalChat.value = emptyList()
        _unreadGeneral.value = 0
        _privateChats.value = emptyMap()
        _unreadPrivate.value = emptyMap()
    }
}
