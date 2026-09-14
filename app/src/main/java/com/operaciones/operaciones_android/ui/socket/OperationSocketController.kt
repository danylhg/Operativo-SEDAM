package com.operaciones.operaciones_android.ui.socket

import com.operaciones.operaciones_android.network.ChatSocketManager
import org.json.JSONArray
import org.json.JSONObject

class OperationSocketController(
    private val host: Host
) {
    interface Host {
        fun getSocketOperationId(): Int
        fun getSocketUserId(): Int
        fun getSocketDeviceId(): Int?
        fun getSocketDeviceSerial(): String?
        fun getSocketDeviceImei(): String?
        fun getSocketUserRole(): String
        fun getSocketUserName(): String
        fun getSocketLastKnownLat(): Double?
        fun getSocketLastKnownLon(): Double?
        fun isSocketCesiumReady(): Boolean
        fun runSocketOnUi(block: () -> Unit)
        fun onSocketNewMessage(item: JSONObject)
        fun onSocketRemoteRouteCreated(routeJson: String, route: JSONObject)
        fun onSocketRemoteRouteDeleted(idRoute: Int)
        fun onSocketTacticalRouteCreated(route: JSONObject)
        fun onSocketTacticalRouteDeleted(idRoute: Int)
        fun onSocketTrackingPersonal(id: Int, lat: Double, lon: Double, label: String, rumboGrados: Double?, speed: Double?)
        fun onSocketSignosVitalesPersonal(
            idPersonal: Int,
            fc: Int?,
            baro: Double?,
            battery: Double?
        )
        fun onSocketTrackingVehicle(id: Int, lat: Double, lon: Double, label: String, rumboGrados: Double?, speed: Double?)
        fun onSocketTrackingEquipo(id: Int, lat: Double, lon: Double, label: String, rumboGrados: Double?)
        fun onSocketTrackingDispositivo(
            id: Int,
            lat: Double,
            lon: Double,
            label: String,
            numeroSerie: String?,
            imei: String?,
            rumboGrados: Double?
        )
        fun onSocketPoiCreated(
            idPoi: Int,
            lat: Double,
            lon: Double,
            nombre: String,
            tipo: String,
            color: String,
            iconoSrc: String?,
            sidc: String?,
            visibility: String,
            creatorType: String,
            creatorUserId: Int?,
            creatorPersonalId: Int?,
            creatorLabel: String,
            creatorRank: String,
            editorLabel: String = ""
        )
        fun onSocketPoiDeleted(idPoi: Int)
        fun onSocketAreaPolygonCreated(
            idArea: Int,
            nombre: String,
            pointsJson: String,
            color: String,
            opacity: Double,
            outlineWidth: Double
        )
        fun onSocketCoverageCircleCreated(
            idArea: Int,
            centerLat: Double,
            centerLon: Double,
            radiusM: Double,
            nombre: String,
            color: String,
            opacity: Double,
            outlineWidth: Double
        )
        fun onSocketAreaDeleted(idArea: Int)
        fun onSocketStructureCreated(
            idMarca: Int,
            lat: Double,
            lon: Double,
            nombre: String,
            tipoEstructura: String
        )
        fun onSocketStructureDeleted(idMarca: Int)
        fun onSocketDrawingCreated(dibujo: JSONObject)
        fun onSocketDrawingDeleted(idDibujo: Int)
        fun onSocketGridUpdated(grid: JSONObject)
        fun onSocketGridDeleted()
        fun onSocketMgrsToggled(active: Boolean)
        fun onSocketGeoMsgCreated(idGeoMsg: Int, lat: Double, lon: Double, text: String, author: String, isPublic: Boolean, ownerId: Int)
        fun onSocketGeoMsgUpdated(idGeoMsg: Int, lat: Double, lon: Double, text: String, author: String, isPublic: Boolean, ownerId: Int)
        fun onSocketGeoMsgDeleted(idGeoMsg: Int)
        fun onSocketConnected()
        fun onSocketDisconnected()
        fun onSocketVoiceCallEvent(event: String, data: JSONObject)
    }

    fun create(): ChatSocketManager? {
        val operationId = host.getSocketOperationId()
        if (operationId <= 0) return null

        var manager: ChatSocketManager? = null
        manager = ChatSocketManager(
            operationId = operationId,
            idPersonal = host.getSocketUserId(),
            rol = host.getSocketUserRole(),
            onNewMessage = { item ->
                host.runSocketOnUi { host.onSocketNewMessage(item) }
            },
            onSignosVitalesPersonal = { data ->
                host.runSocketOnUi {
                    val id = data.optInt("id_personal")
                    val fc = data.optInt("frecuencia_cardiaca_bpm", -1).takeIf { it > 0 }
                        ?: data.optInt("frecuencia_cardiaca", -1).takeIf { it > 0 }
                        ?: data.optInt("fc", -1).takeIf { it > 0 }
                        ?: data.optInt("heart_rate_bpm", -1).takeIf { it > 0 }
                        ?: data.optInt("heart_rate", -1).takeIf { it > 0 }
                    val baro = data.optDouble("presion_barometrica_hpa", Double.NaN).takeUnless { it.isNaN() || it.isInfinite() }
                        ?: data.optDouble("barometro", Double.NaN).takeUnless { it.isNaN() || it.isInfinite() }
                        ?: data.optDouble("baro", Double.NaN).takeUnless { it.isNaN() || it.isInfinite() }
                    val battery = data.optDouble("bateria_pct", Double.NaN).takeUnless { it.isNaN() || it.isInfinite() }
                        ?: data.optDouble("bateria", Double.NaN).takeUnless { it.isNaN() || it.isInfinite() }
                        ?: data.optDouble("battery", Double.NaN).takeUnless { it.isNaN() || it.isInfinite() }
                    if (id > 0) {
                        host.onSocketSignosVitalesPersonal(id, fc, baro, battery)
                    }
                }
            },
            onNavigationRouteEvt = { event, data ->
                host.runSocketOnUi {
                    when (event) {
                        "creada" -> {
                            val route = data.optJSONObject("ruta") ?: return@runSocketOnUi
                            host.onSocketRemoteRouteCreated(route.toString(), route)
                        }
                        "eliminada" -> host.onSocketRemoteRouteDeleted(data.optInt("id_ruta", -1))
                    }
                }
            },
            onTacticalRouteCreada = { data ->
                host.runSocketOnUi {
                    val route = data.optJSONObject("ruta") ?: return@runSocketOnUi
                    if (route.optInt("id_ruta", -1) > 0) host.onSocketTacticalRouteCreated(route)
                }
            },
            onTacticalRouteEliminada = { data ->
                host.runSocketOnUi { host.onSocketTacticalRouteDeleted(data.optInt("id_ruta", -1)) }
            },
            onTrackingPersonal = { data ->
                host.runSocketOnUi {
                    val id = data.optInt("id_personal")
                    val lat = data.optDouble("latitud")
                    val lon = data.optDouble("longitud")
                    val label = data.optString("apodo", data.optString("nombre", "P-$id"))
                    val rumboGrados = nullableHeadingDegrees(data)
                    val speed = nullableDouble(data, "velocidad_kmh")
                        ?: nullableDouble(data, "velocidad")
                        ?: nullableDouble(data, "speed")
                    if (id > 0 && isValidTrackingLocation(lat, lon)) {
                        host.onSocketTrackingPersonal(id, lat, lon, label, rumboGrados, speed)
                    }
                }
            },
            onTrackingVehiculo = { data ->
                host.runSocketOnUi {
                    val id = data.optInt("id_vehiculo")
                    val lat = data.optDouble("latitud")
                    val lon = data.optDouble("longitud")
                    val label = data.optString("alias", data.optString("nombre", "V-$id"))
                    val rumboGrados = nullableHeadingDegrees(data)
                    val speed = nullableDouble(data, "velocidad_kmh")
                        ?: nullableDouble(data, "velocidad")
                        ?: nullableDouble(data, "speed")
                    if (id > 0 && isValidTrackingLocation(lat, lon)) {
                        host.onSocketTrackingVehicle(id, lat, lon, label, rumboGrados, speed)
                    }
                }
            },
            onTrackingEquipo = { data ->
                host.runSocketOnUi {
                    val id = data.optInt("id_equipo")
                    val lat = data.optDouble("latitud")
                    val lon = data.optDouble("longitud")
                    val label = data.optString("nombre", data.optString("tipo_equipo", "E-$id"))
                    val rumboGrados = nullableHeadingDegrees(data)
                    if (id > 0 && isValidTrackingLocation(lat, lon)) {
                        host.onSocketTrackingEquipo(id, lat, lon, label, rumboGrados)
                    }
                }
            },
            onTrackingDispositivo = { data ->
                host.runSocketOnUi {
                    val id = data.optInt("id_dispositivo")
                    val lat = data.optDouble("latitud")
                    val lon = data.optDouble("longitud")
                    val label = listOf(
                        data.optString("tipo", ""),
                        data.optString("marca", ""),
                        data.optString("modelo", "")
                    ).filter { it.isNotBlank() }.joinToString(" ")
                        .ifBlank { data.optString("nombre", "D-$id") }
                    val numeroSerie = data.optString(
                        "serial_dispositivo",
                        data.optString("numero_serie", data.optString("numeroSerie", ""))
                    ).takeIf { it.isNotBlank() }
                    val imei = data.optString("imei", "").takeIf { it.isNotBlank() }
                    val rumboGrados = nullableHeadingDegrees(data)
                    if (id > 0 && isValidTrackingLocation(lat, lon)) {
                        host.onSocketTrackingDispositivo(id, lat, lon, label, numeroSerie, imei, rumboGrados)
                    }
                }
            },
            onPoiCreado = { data ->
                host.runSocketOnUi {
                    val poi = data.optJSONObject("poi") ?: return@runSocketOnUi
                    if (!poi.optString("visibilidad", "PRIVADO").equals("PUBLICO", ignoreCase = true)) {
                        return@runSocketOnUi
                    }
                    val editor = poi.optString("editor_nombre", poi.optString("editorLabel", poi.optString("modificado_por", "")))
                    host.onSocketPoiCreated(
                        idPoi = poi.optInt("id_poi"),
                        lat = poi.optDouble("latitud"),
                        lon = poi.optDouble("longitud"),
                        nombre = poi.optString("nombre", "PDI"),
                        tipo = poi.optString("tipo_poi", ""),
                        color = poi.optString("color", "#FFD700").ifBlank { "#FFD700" },
                        iconoSrc = optionalString(poi, "icono_src"),
                        sidc = optionalString(poi, "sidc"),
                        visibility = poi.optString("visibilidad", "PUBLICO"),
                        creatorType = poi.optString("tipo_creador", ""),
                        creatorUserId = poi.optInt("id_usuario", -1).takeIf { it > 0 },
                        creatorPersonalId = poi.optInt("id_personal", -1).takeIf { it > 0 },
                        creatorLabel = poi.optString("creador_nombre", poi.optString("creador_label", "")),
                        creatorRank = poi.optString("creador_puesto", ""),
                        editorLabel = editor
                    )
                }
            },
            onPoiEliminado = { data ->
                host.runSocketOnUi { host.onSocketPoiDeleted(data.optInt("id_poi", -1)) }
            },
            onAreaCreada = { data ->
                host.runSocketOnUi {
                    val area = data.optJSONObject("area") ?: return@runSocketOnUi
                    emitAreaCreated(area)
                }
            },
            onAreaEliminada = { data ->
                host.runSocketOnUi { host.onSocketAreaDeleted(data.optInt("id_area", -1)) }
            },
            onStructureCreada = { data ->
                host.runSocketOnUi {
                    val structure = data.optJSONObject("estructura") ?: return@runSocketOnUi
                    val idMarca = structure.optInt("id_marca", -1)
                    val lat = structure.optDouble("latitud", Double.NaN)
                    val lon = structure.optDouble("longitud", Double.NaN)
                    if (idMarca <= 0 || lat.isNaN() || lon.isNaN()) return@runSocketOnUi
                    host.onSocketStructureCreated(
                        idMarca = idMarca,
                        lat = lat,
                        lon = lon,
                        nombre = structure.optString("nombre", "Estructura"),
                        tipoEstructura = structure.optString("tipo_estructura", "EDIFICIO")
                    )
                }
            },
            onStructureEliminada = { data ->
                host.runSocketOnUi { host.onSocketStructureDeleted(data.optInt("id_marca", -1)) }
            },
            onDibujoCreado = { data ->
                host.runSocketOnUi {
                    val dibujo = data.optJSONObject("dibujo") ?: return@runSocketOnUi
                    host.onSocketDrawingCreated(dibujo)
                }
            },
            onDibujoEliminado = { data ->
                host.runSocketOnUi { host.onSocketDrawingDeleted(data.optInt("id_dibujo", -1)) }
            },
            onGridActualizada = { data ->
                host.runSocketOnUi {
                    val grid = data.optJSONObject("grid") ?: data.optJSONObject("cuadricula") ?: return@runSocketOnUi
                    host.onSocketGridUpdated(grid)
                }
            },
            onGridEliminada = {
                host.runSocketOnUi { host.onSocketGridDeleted() }
            },
            onConnected = {
                host.runSocketOnUi { host.onSocketConnected() }
                val lat = host.getSocketLastKnownLat() ?: return@ChatSocketManager
                val lon = host.getSocketLastKnownLon() ?: return@ChatSocketManager
                val deviceId = host.getSocketDeviceId()
                if (deviceId != null) {
                    manager?.emitTrackingDispositivo(
                        idDispositivo = deviceId,
                        lat = lat,
                        lon = lon,
                        numeroSerie = host.getSocketDeviceSerial(),
                        imei = host.getSocketDeviceImei()
                    )
                } else {
                    manager?.emitTracking(
                        idPersonal = host.getSocketUserId(),
                        lat = lat,
                        lon = lon,
                        apodo = host.getSocketUserName(),
                        rol = host.getSocketUserRole()
                    )
                }
            },
            onDisconnected = {
                host.runSocketOnUi { host.onSocketDisconnected() }
            },
            onConnectionError = {
                host.runSocketOnUi { host.onSocketDisconnected() }
            },
            onVoiceCallEvent = { event, data ->
                host.runSocketOnUi { host.onSocketVoiceCallEvent(event, data) }
            }
        )

        manager.onMgrsToggledFromSocket = { active ->
            host.runSocketOnUi { host.onSocketMgrsToggled(active) }
        }
        manager.onGeoMsgCreatedFromSocket = { data ->
            host.runSocketOnUi {
                val id = data.optInt("id_geo_msg", data.optInt("id", -1))
                val lat = data.optDouble("lat", Double.NaN)
                val lon = data.optDouble("lon", Double.NaN)
                if (id > 0 && lat.isFinite() && lon.isFinite()) {
                    host.onSocketGeoMsgCreated(
                        idGeoMsg = id,
                        lat = lat,
                        lon = lon,
                        text = data.optString("text", ""),
                        author = data.optString("author", "Usuario"),
                        isPublic = data.optString("visibilidad", "PRIVADO").equals("PUBLICO", true),
                        ownerId = data.optInt("id_personal_autor", -1)
                    )
                }
            }
        }
        manager.onGeoMsgDeletedFromSocket = { id ->
            host.runSocketOnUi { host.onSocketGeoMsgDeleted(id) }
        }
        manager.onGeoMsgUpdatedFromSocket = { data ->
            host.runSocketOnUi {
                val id = data.optInt("id_geo_msg", data.optInt("id", -1))
                val lat = data.optDouble("lat", Double.NaN)
                val lon = data.optDouble("lon", Double.NaN)
                if (id > 0 && lat.isFinite() && lon.isFinite()) {
                    host.onSocketGeoMsgUpdated(id, lat, lon, data.optString("text", ""), data.optString("author", "Usuario"), data.optString("visibilidad", "PRIVADO").equals("PUBLICO", true), data.optInt("id_personal_autor", -1))
                }
            }
        }

        return manager
    }

    private fun emitAreaCreated(area: JSONObject) {
        val geometria = area.optJSONObject("geometria") ?: return
        val meta = geometria.optJSONObject("meta") ?: JSONObject()
        val shape = meta.optString("shape", "").lowercase()

        if (shape == "polygon") {
            val idArea = area.optInt("id_area", -1)
            val points = parseOuterRingPoints(geometria.optJSONArray("coordinates")?.optJSONArray(0))
            if (idArea <= 0 || points.size < 3) return
            host.onSocketAreaPolygonCreated(
                idArea = idArea,
                nombre = area.optString("nombre", "Poligono / Zona"),
                pointsJson = buildPolygonPointsJson(points),
                color = area.optString("color", "#FFD700").ifBlank { "#FFD700" },
                opacity = meta.optDouble("opacity", 0.35),
                outlineWidth = meta.optDouble("outline_width", 3.0)
            )
            return
        }

        if (!shape.equals("circle", ignoreCase = true)) return
        val center = meta.optJSONArray("center") ?: return
        if (center.length() < 2) return

        val idArea = area.optInt("id_area", -1)
        val centerLon = center.optDouble(0, Double.NaN)
        val centerLat = center.optDouble(1, Double.NaN)
        val radiusM = meta.optDouble("radius_m", Double.NaN)
        if (idArea <= 0 || centerLat.isNaN() || centerLon.isNaN() || radiusM.isNaN()) return

        host.onSocketCoverageCircleCreated(
            idArea = idArea,
            centerLat = centerLat,
            centerLon = centerLon,
            radiusM = radiusM,
            nombre = area.optString("nombre", "Circulo de cobertura"),
            color = area.optString("color", "#FF4500").ifBlank { "#FF4500" },
            opacity = meta.optDouble("opacity", 0.35),
            outlineWidth = meta.optDouble("outline_width", 3.0)
        )
    }

    private fun parseOuterRingPoints(outerRing: JSONArray?): List<Pair<Double, Double>> {
        if (outerRing == null || outerRing.length() < 4) return emptyList()
        val points = mutableListOf<Pair<Double, Double>>()
        for (i in 0 until outerRing.length() - 1) {
            val point = outerRing.optJSONArray(i) ?: continue
            val lon = point.optDouble(0, Double.NaN)
            val lat = point.optDouble(1, Double.NaN)
            if (lat.isNaN() || lon.isNaN()) continue
            points.add(lat to lon)
        }
        return points
    }

    private fun buildPolygonPointsJson(points: List<Pair<Double, Double>>): String =
        buildString {
            append("[")
            points.forEachIndexed { index, point ->
                if (index > 0) append(",")
                append("{")
                append("\"lat\":${point.first},")
                append("\"lon\":${point.second}")
                append("}")
            }
            append("]")
        }

    private fun optionalString(json: JSONObject, key: String): String? {
        if (!json.has(key) || json.isNull(key)) return null
        return json.optString(key, "").trim()
            .takeUnless { it.isBlank() || it.equals("null", ignoreCase = true) }
    }

    private fun nullableDouble(json: JSONObject, key: String): Double? {
        if (!json.has(key) || json.isNull(key)) return null
        val value = json.optDouble(key, Double.NaN)
        return value.takeUnless { it.isNaN() || it.isInfinite() }
    }

    private fun nullableHeadingDegrees(json: JSONObject): Double? =
        listOf("rumbo_grados", "rumboGrados", "headingDegrees", "heading", "bearing", "curso", "rumbo")
            .firstNotNullOfOrNull { key -> nullableDouble(json, key) }
            ?.let { ((it % 360.0) + 360.0) % 360.0 }

    private fun isValidTrackingLocation(lat: Double, lon: Double): Boolean =
        !lat.isNaN() &&
            !lon.isNaN() &&
            !lat.isInfinite() &&
            !lon.isInfinite() &&
            lat in -90.0..90.0 &&
            lon in -180.0..180.0 &&
            !(lat == 0.0 && lon == 0.0)
}
