package com.operaciones.operaciones_android.ui.map

import android.webkit.WebView
import com.operaciones.operaciones_android.config.ApiConfig
import com.operaciones.operaciones_android.model.AreaPolygonItem
import com.operaciones.operaciones_android.model.CoverageCircleItem
import com.operaciones.operaciones_android.model.DispositivoItem
import com.operaciones.operaciones_android.model.EquipoItem
import com.operaciones.operaciones_android.model.OperationGridItem
import com.operaciones.operaciones_android.model.OperationMapData
import com.operaciones.operaciones_android.model.OperationZoneItem
import com.operaciones.operaciones_android.model.PersonalItem
import com.operaciones.operaciones_android.model.PoiItem
import com.operaciones.operaciones_android.model.StructureItem
import com.operaciones.operaciones_android.model.VehiculoItem
import com.operaciones.operaciones_android.network.OperationMapParser
import com.operaciones.operaciones_android.network.OperationMapRepository
import com.operaciones.operaciones_android.webview.CesiumWebController
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

class OperationMapDataController(
    private val webView: WebView,
    private val cesiumWebController: CesiumWebController,
    private val host: Host,
    private val operationMapRepository: OperationMapRepository = OperationMapRepository()
) {
    interface Host {
        fun getMapDataOperationId(): Int
        fun getMapDataToken(): String
        fun getMapDataCurrentUserId(): Int
        fun getMapDataCurrentUserTabla(): String
        fun getMapDataCurrentUserLabel(): String
        fun isMapDataCesiumReady(): Boolean
        fun runMapDataOnUi(block: () -> Unit)
        fun onMapDataOperationZoneChanged(lat: Double, lon: Double, zoom: Int)
        fun onMapDataNavigationRoutesLoaded(routesJson: String)
        fun updateMapDataPersonalPanel(idPersonal: Int, lat: Double, lon: Double)
        fun updateMapDataVehiculoPanel(idVehiculo: Int, lat: Double, lon: Double)
        fun updateMapDataEquipoPanel(idEquipo: Int, lat: Double, lon: Double)
        fun updateMapDataDispositivoPanel(
            idDispositivo: Int,
            lat: Double,
            lon: Double,
            numeroSerie: String,
            imei: String
        )
        fun loadMapDataDrawings(replace: Boolean = true)
        fun onMapDataError(message: String)
    }

    private data class PendingPoiAddition(
        val idPoi: Int,
        val lat: Double,
        val lon: Double,
        val nombre: String,
        val tipoPoi: String,
        val color: String,
        val iconoSrc: String? = null,
        val sidc: String? = null,
        val creatorLabel: String = "",
        val editorLabel: String = "",
        val visibility: String = "PRIVADO",
        val velocidadKmh: Double? = null,
        val rumboGrados: Double? = null
    )

    private data class PendingCoverageCircleAddition(
        val idArea: Int,
        val centerLat: Double,
        val centerLon: Double,
        val radiusM: Double,
        val nombre: String,
        val color: String,
        val opacity: Double,
        val outlineWidth: Double,
        val creatorLabel: String = ""
    )

    private data class PendingAreaPolygonAddition(
        val idArea: Int,
        val nombre: String,
        val pointsJson: String,
        val color: String,
        val opacity: Double,
        val outlineWidth: Double,
        val creatorLabel: String = ""
    )

    private data class PendingStructureAddition(
        val idMarca: Int,
        val lat: Double,
        val lon: Double,
        val nombre: String,
        val tipoEstructura: String,
        val iconoSrc: String? = null,
        val creatorLabel: String = ""
    )

    private var pendingPoisJson: String? = null
    private var pendingRemoteRoutesJson: String? = null
    private var pendingTacticalRoutesJson: String? = null
    private var pendingOperationZoneJson: String? = null
    private var pendingOperationGridJson: String? = null
    private var pendingCoverageCirclesJson: String? = null
    private var pendingAreaPolygonsJson: String? = null
    private var pendingStructuresJson: String? = null
    private var currentPois: List<PoiItem> = emptyList()

    fun getPois(): List<PoiItem> = currentPois

    fun removePoi(idPoi: Int) {
        currentPois = currentPois.filterNot { it.idPoi == idPoi }
    }

    private val pendingPoiAdditions = mutableListOf<PendingPoiAddition>()
    private val pendingCoverageCircleAdditions = mutableListOf<PendingCoverageCircleAddition>()
    private val pendingAreaPolygonAdditions = mutableListOf<PendingAreaPolygonAddition>()
    private val pendingStructureAdditions = mutableListOf<PendingStructureAddition>()

    private var lastMapSyncAt = 0L
    private var operationViewApplied = false

    private val trackingTimestampFormats = listOf(
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSX", Locale.US),
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssX", Locale.US),
        SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSSX", Locale.US),
        SimpleDateFormat("yyyy-MM-dd HH:mm:ssX", Locale.US),
        SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US),
        SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US)
    ).onEach { it.timeZone = TimeZone.getTimeZone("UTC") }

    fun fetchMapaData() {
        val operationId = host.getMapDataOperationId()
        if (operationId <= 0) return

        operationMapRepository.fetchMapaData(
            operationId = operationId,
            token = host.getMapDataToken(),
            onSuccess = { data ->
                host.runMapDataOnUi {
                    applyMapData(data)
                }
            },
            onError = { message ->
                host.runMapDataOnUi {
                    host.onMapDataError(message)
                }
            }
        )
    }

    fun syncFromBackend(force: Boolean = false) {
        val operationId = host.getMapDataOperationId()
        if (operationId <= 0) return

        val now = System.currentTimeMillis()
        if (!force && now - lastMapSyncAt < SYNC_THROTTLE_MS) return
        lastMapSyncAt = now

        fetchMapaData()
        if (host.isMapDataCesiumReady()) {
            host.loadMapDataDrawings(replace = true)
        }
    }

    fun syncNavigationRoutesFromBackend() {
        val operationId = host.getMapDataOperationId()
        if (operationId <= 0) return

        operationMapRepository.fetchNavigationRoutes(
            operationId = operationId,
            token = host.getMapDataToken(),
            onSuccess = { routesJson ->
                host.runMapDataOnUi {
                    host.onMapDataNavigationRoutesLoaded(routesJson)
                    loadOrPendingRemoteRoutes(routesJson, replace = true)
                }
            },
            onError = { message ->
                host.runMapDataOnUi {
                    host.onMapDataError(message)
                }
            }
        )
    }

    fun onRemoteRouteCreated(routeJson: String, route: JSONObject) {
        if (host.isMapDataCesiumReady()) {
            cesiumWebController.loadRemoteRoutes("[$routeJson]")
        } else {
            pendingRemoteRoutesJson = mergePendingRouteJson(pendingRemoteRoutesJson, route)
        }
    }

    fun onTacticalRouteCreated(route: JSONObject) {
        val routeJson = route.toString()
        if (host.isMapDataCesiumReady()) {
            cesiumWebController.loadTacticalRoutes("[$routeJson]")
        } else {
            pendingTacticalRoutesJson = mergePendingRouteJson(pendingTacticalRoutesJson, route)
        }
    }

    fun onPoiCreated(
        idPoi: Int,
        lat: Double,
        lon: Double,
        nombre: String,
        tipo: String,
        color: String,
        iconoSrc: String?,
        sidc: String?,
        visibility: String = "PRIVADO",
        creatorType: String = "",
        creatorUserId: Int? = null,
        creatorPersonalId: Int? = null,
        editorLabel: String = "",
        creatorLabel: String = "",
        creatorRank: String = "",
        velocidadKmh: Double? = null,
        rumboGrados: Double? = null
    ) {
        if (idPoi <= 0) return

        val resolvedIcon = resolvePoiIconUrl(iconoSrc)
        val resolvedCreatorLabel = creatorLabel.ifBlank { currentUserLabel() }
        val newItem = PoiItem(
            idPoi = idPoi,
            nombre = nombre,
            tipoPoi = tipo,
            lat = lat,
            lon = lon,
            velocidadKmh = velocidadKmh,
            rumboGrados = rumboGrados,
            color = color,
            iconoSrc = resolvedIcon,
            sidc = sidc,
            creatorLabel = resolvedCreatorLabel,
            creatorRank = creatorRank,
            visibility = visibility.uppercase(),
            creatorType = creatorType.uppercase(),
            creatorUserId = creatorUserId,
            creatorPersonalId = creatorPersonalId,
            editorLabel = editorLabel
        )
        currentPois = currentPois.filterNot { it.idPoi == idPoi } + newItem

        if (host.isMapDataCesiumReady()) {
            cesiumWebController.loadPois("[${poiJson(newItem)}]", replace = false)
        } else {
            pendingPoiAdditions.add(PendingPoiAddition(idPoi, lat, lon, nombre, tipo, color, resolvedIcon, sidc, resolvedCreatorLabel, editorLabel, visibility, velocidadKmh, rumboGrados))
        }
    }

    fun onAreaPolygonCreated(
        idArea: Int,
        nombre: String,
        pointsJson: String,
        color: String,
        opacity: Double,
        outlineWidth: Double
    ) {
        val creatorLabel = currentUserLabel()
        if (host.isMapDataCesiumReady()) {
            cesiumWebController.addAreaPolygonToMap(idArea, nombre, pointsJson, color, opacity, outlineWidth, creatorLabel)
        } else {
            pendingAreaPolygonAdditions.add(
                PendingAreaPolygonAddition(idArea, nombre, pointsJson, color, opacity, outlineWidth, creatorLabel)
            )
        }
    }

    fun onCoverageCircleCreated(
        idArea: Int,
        centerLat: Double,
        centerLon: Double,
        radiusM: Double,
        nombre: String,
        color: String,
        opacity: Double,
        outlineWidth: Double
    ) {
        val creatorLabel = currentUserLabel()
        if (host.isMapDataCesiumReady()) {
            cesiumWebController.addCoverageCircleToMap(
                idArea,
                centerLat,
                centerLon,
                radiusM,
                nombre,
                color,
                opacity,
                outlineWidth,
                creatorLabel
            )
        } else {
            pendingCoverageCircleAdditions.add(
                PendingCoverageCircleAddition(idArea, centerLat, centerLon, radiusM, nombre, color, opacity, outlineWidth, creatorLabel)
            )
        }
    }

    fun onStructureCreated(
        idMarca: Int,
        lat: Double,
        lon: Double,
        nombre: String,
        tipoEstructura: String
    ) {
        val iconoSrc = resolveStructureIconUrl(tipoEstructura)
        val creatorLabel = currentUserLabel()
        if (host.isMapDataCesiumReady()) {
            cesiumWebController.addStructureToMap(idMarca, lat, lon, nombre, tipoEstructura, iconoSrc, creatorLabel)
        } else {
            pendingStructureAdditions.add(PendingStructureAddition(idMarca, lat, lon, nombre, tipoEstructura, iconoSrc, creatorLabel))
        }
    }

    fun onOperationGridUpdated(grid: JSONObject) {
        val parsed = OperationMapParser().parseGridObject(grid) ?: return
        loadOrPendingOperationGrid(operationGridJson(parsed).toString())
    }

    fun onOperationGridDeleted() {
        pendingOperationGridJson = null
        if (host.isMapDataCesiumReady()) {
            cesiumWebController.clearOperationGrid()
        }
    }

    fun applyOperationView() {
        pendingOperationZoneJson?.let { json ->
            pendingOperationZoneJson = null
            cesiumWebController.loadOperationZone(json)
        }

        pendingOperationGridJson?.let { json ->
            pendingOperationGridJson = null
            cesiumWebController.loadOperationGrid(json)
        }

        pendingRemoteRoutesJson?.let { json ->
            pendingRemoteRoutesJson = null
            cesiumWebController.loadRemoteRoutes(json, replace = true)
        }

        pendingTacticalRoutesJson?.let { json ->
            pendingTacticalRoutesJson = null
            cesiumWebController.loadTacticalRoutes(json, replace = true)
        }

        pendingPoisJson?.let { json ->
            pendingPoisJson = null
            cesiumWebController.loadPois(json, replace = true)
        }

        if (pendingCoverageCirclesJson != null || pendingAreaPolygonsJson != null) {
            val circlesJson = pendingCoverageCirclesJson ?: "[]"
            val polygonsJson = pendingAreaPolygonsJson ?: "[]"
            pendingCoverageCirclesJson = null
            pendingAreaPolygonsJson = null
            cesiumWebController.syncAreas(circlesJson, polygonsJson)
        }

        pendingStructuresJson?.let { json ->
            pendingStructuresJson = null
            cesiumWebController.loadStructures(json, replace = true)
        }

        flushPendingAdditions()

        if (host.getMapDataOperationId() > 0) {
            host.loadMapDataDrawings(replace = true)
            syncFromBackend(force = true)
        }
    }

    private fun applyMapData(data: OperationMapData) {
        currentPois = data.pois
        applyOperationZone(data.operationZone)
        applyOperationGrid(data.operationGrid)

        val navigationRoutesJson = data.rutasNavegacion?.let(::enrichOwnNavigationRoutes)
        navigationRoutesJson?.let { routesJson ->
            host.onMapDataNavigationRoutesLoaded(routesJson)
            webView.postDelayed({
                cesiumWebController.evaluate(
                    "if(typeof loadRemoteRoutes === 'function') loadRemoteRoutes($routesJson, true)"
                )
            }, CESIUM_LOAD_DELAY_MS)
        }

        loadOrPendingRemoteRoutes(navigationRoutesJson ?: "[]", replace = true)
        loadOrPendingTacticalRoutes(data.rutasTacticas ?: "[]", replace = true)

        val trackingDelayMs = if (host.isMapDataCesiumReady()) 0L else CESIUM_LOAD_DELAY_MS
        webView.postDelayed({
            loadInitialTrackingMarkers(data.personal, data.vehiculos, data.equipos, data.dispositivos)
        }, trackingDelayMs)

        syncMapObjectLayers(data)
    }

    private fun enrichOwnNavigationRoutes(routesJson: String): String = runCatching {
        val routes = JSONArray(routesJson)
        val currentId = host.getMapDataCurrentUserId()
        val currentTable = host.getMapDataCurrentUserTabla()
        val currentLabel = host.getMapDataCurrentUserLabel()
        for (index in 0 until routes.length()) {
            val route = routes.optJSONObject(index) ?: continue
            val creatorType = route.optString("created_by_tipo", "").uppercase()
            val creatorId = if (currentTable.equals("personal", ignoreCase = true)) {
                route.optInt("id_personal", -1)
            } else {
                route.optInt("id_usuario", -1)
            }
            val expectedType = if (currentTable.equals("personal", ignoreCase = true)) "PERSONAL" else "USUARIO"
            if (creatorType == expectedType && creatorId == currentId && currentLabel.isNotBlank()) {
                route.put("creador_nombre", currentLabel)
                route.put("creador_puesto", "")
            }
        }
        routes.toString()
    }.getOrDefault(routesJson)

    private fun applyOperationZone(zone: OperationZoneItem?) {
        if (zone == null) {
            cesiumWebController.applyOperationView()
            return
        }

        host.onMapDataOperationZoneChanged(zone.centerLat, zone.centerLon, zone.zoomInicial)
        if (!operationViewApplied) {
            cesiumWebController.setOperationView(zone.centerLat, zone.centerLon, zone.zoomInicial)
            operationViewApplied = true
        }
        loadOrPendingOperationZone(operationZoneJson(zone).toString())
    }

    private fun applyOperationGrid(grid: OperationGridItem?) {
        if (grid == null) {
            pendingOperationGridJson = null
            if (host.isMapDataCesiumReady()) {
                cesiumWebController.clearOperationGrid()
            }
            return
        }

        loadOrPendingOperationGrid(operationGridJson(grid).toString())
    }

    private fun syncMapObjectLayers(data: OperationMapData) {
        val poisJson = JSONArray().apply {
            data.pois.forEach { put(poiJson(it)) }
        }.toString()

        val circlesJson = JSONArray().apply {
            data.coverageCircles.forEach { put(coverageCircleJson(it)) }
        }.toString()

        val polygonsJson = JSONArray().apply {
            data.areaPolygons.forEach { put(areaPolygonJson(it)) }
        }.toString()

        val structuresJson = JSONArray().apply {
            data.structures.forEach { put(structureJson(it)) }
        }.toString()

        if (host.isMapDataCesiumReady()) {
            cesiumWebController.loadPois(poisJson, replace = true)
            cesiumWebController.syncAreas(circlesJson, polygonsJson)
            cesiumWebController.loadStructures(structuresJson, replace = true)
        } else {
            pendingPoisJson = poisJson
            pendingCoverageCirclesJson = circlesJson
            pendingAreaPolygonsJson = polygonsJson
            pendingStructuresJson = structuresJson
        }
    }

    private fun loadOrPendingOperationZone(zoneJson: String) {
        if (host.isMapDataCesiumReady()) {
            cesiumWebController.loadOperationZone(zoneJson)
        } else {
            pendingOperationZoneJson = zoneJson
        }
    }

    private fun loadOrPendingOperationGrid(gridJson: String) {
        if (host.isMapDataCesiumReady()) {
            cesiumWebController.loadOperationGrid(gridJson)
        } else {
            pendingOperationGridJson = gridJson
        }
    }

    private fun loadOrPendingRemoteRoutes(routesJson: String, replace: Boolean) {
        if (host.isMapDataCesiumReady()) {
            cesiumWebController.loadRemoteRoutes(routesJson, replace)
        } else {
            pendingRemoteRoutesJson = routesJson
        }
    }

    private fun loadOrPendingTacticalRoutes(routesJson: String, replace: Boolean) {
        if (host.isMapDataCesiumReady()) {
            cesiumWebController.loadTacticalRoutes(routesJson, replace)
        } else {
            pendingTacticalRoutesJson = routesJson
        }
    }

    private fun flushPendingAdditions() {
        pendingCoverageCircleAdditions.forEach { circle ->
            cesiumWebController.addCoverageCircleToMap(
                circle.idArea,
                circle.centerLat,
                circle.centerLon,
                circle.radiusM,
                circle.nombre,
                circle.color,
                circle.opacity,
                circle.outlineWidth,
                circle.creatorLabel
            )
        }
        pendingCoverageCircleAdditions.clear()

        pendingAreaPolygonAdditions.forEach { polygon ->
            cesiumWebController.addAreaPolygonToMap(
                polygon.idArea,
                polygon.nombre,
                polygon.pointsJson,
                polygon.color,
                polygon.opacity,
                polygon.outlineWidth,
                polygon.creatorLabel
            )
        }
        pendingAreaPolygonAdditions.clear()

        pendingStructureAdditions.forEach { structure ->
            cesiumWebController.addStructureToMap(
                structure.idMarca,
                structure.lat,
                structure.lon,
                structure.nombre,
                structure.tipoEstructura,
                structure.iconoSrc,
                structure.creatorLabel
            )
        }
        pendingStructureAdditions.clear()

        pendingPoiAdditions.forEach { poi ->
            cesiumWebController.addPoiToMap(
                poi.idPoi,
                poi.lat,
                poi.lon,
                poi.nombre,
                poi.tipoPoi,
                poi.color,
                poi.iconoSrc,
                poi.sidc,
                poi.creatorLabel,
                poi.editorLabel,
                false,
                poi.visibility,
                poi.velocidadKmh,
                poi.rumboGrados
            )
        }
        pendingPoiAdditions.clear()
    }

    private fun mergePendingRouteJson(currentJson: String?, route: JSONObject): String {
        val id = route.optInt("id_ruta", -1)
        val merged = runCatching { JSONArray(currentJson ?: "[]") }.getOrDefault(JSONArray())
        if (id <= 0) {
            merged.put(route)
            return merged.toString()
        }

        for (index in 0 until merged.length()) {
            val existing = merged.optJSONObject(index) ?: continue
            if (existing.optInt("id_ruta", -1) == id) {
                merged.put(index, route)
                return merged.toString()
            }
        }

        merged.put(route)
        return merged.toString()
    }

    private fun currentUserLabel(): String =
        host.getMapDataCurrentUserLabel().trim().ifBlank { "Usuario actual" }

    private fun loadInitialTrackingMarkers(
        personal: List<PersonalItem>,
        vehiculos: List<VehiculoItem>,
        equipos: List<EquipoItem>,
        dispositivos: List<DispositivoItem>
    ) {
        val currentUserId = host.getMapDataCurrentUserId()
        val personalById = personal.associateBy { it.idPersonal }

        fun vehicleOccupantsJson(idVehiculo: Int): JSONArray {
            val vehicleRows = vehiculos.filter { it.idVehiculo == idVehiculo }
            val direct = vehicleRows
                .mapNotNull { it.idPersonalAsignado }
                .distinct()
                .mapNotNull { personalById[it] }

            val occupants = if (direct.isNotEmpty()) {
                direct
            } else {
                val groupNames = vehicleRows
                    .flatMap { listOf(it.grupoNombre, it.grupoPadreNombre) }
                    .map { it.trim() }
                    .filter { it.isNotBlank() }
                    .toSet()

                personal.filter { person ->
                    listOf(
                        person.grupoNombre,
                        person.grupoApodo,
                        person.grupoPadreNombre,
                        person.grupoPadreApodo,
                        person.cetNombre,
                        person.cetFlotilla
                    )
                        .map { it.trim() }
                        .any { it.isNotBlank() && groupNames.contains(it) }
                }
            }

            return JSONArray().apply {
                occupants.distinctBy { it.idPersonal }.forEach { person ->
                    val name = "${person.nombre} ${person.apellido}".trim()
                        .ifBlank { person.apodo }
                        .ifBlank { "Personal ${person.idPersonal}" }
                    val detail = listOf(person.rol, person.puesto)
                        .map { it.trim() }
                        .filter { it.isNotBlank() }
                        .distinct()
                        .joinToString(" - ")
                    put(JSONObject().put("name", name).put("detail", detail))
                }
            }
        }

        val js = buildString {
            append("(function(){")
            personal.forEach { person ->
                val lat = person.lat ?: return@forEach
                val lon = person.lon ?: return@forEach
                if (!isValidLocation(lat, lon)) return@forEach
                host.updateMapDataPersonalPanel(person.idPersonal, lat, lon)
                if (person.idPersonal == currentUserId) return@forEach
                val label = person.apodo.ifBlank { "${person.nombre} ${person.apellido}".trim() }
                    .ifBlank { "P-${person.idPersonal}" }
                append("if(typeof updateTrackingPersonal==='function') updateTrackingPersonal(")
                append(person.idPersonal)
                append(",")
                append(lat)
                append(",")
                append(lon)
                append(",'")
                append(jsString(label))
                append("',")
                append(
                    JSONObject()
                        .put("rol", person.rol)
                        .put("nombre", person.nombre)
                        .put("apellido", person.apellido)
                        .put("apodo", person.apodo)
                        .put("grupoNombre", person.grupoNombre)
                        .put("grupoApodo", person.grupoApodo)
                        .put("cetNombre", person.cetNombre)
                        .apply { person.rumboGrados?.let { put("rumbo_grados", it) } }
                        .toString()
                )
                append(");")
            }
            vehiculos.forEach { vehiculo ->
                val lat = vehiculo.lat ?: return@forEach
                val lon = vehiculo.lon ?: return@forEach
                if (!isValidLocation(lat, lon)) return@forEach
                host.updateMapDataVehiculoPanel(vehiculo.idVehiculo, lat, lon)
                val label = vehiculo.alias.ifBlank { vehiculo.codigoInterno }
                    .ifBlank { vehiculo.nombre }
                    .ifBlank { "V-${vehiculo.idVehiculo}" }
                append("if(typeof updateTrackingVehiculo==='function') updateTrackingVehiculo(")
                append(vehiculo.idVehiculo)
                append(",")
                append(lat)
                append(",")
                append(lon)
                append(",'")
                append(jsString(label))
                append("',")
                append(
                    JSONObject()
                        .put("tipo", vehiculo.tipo)
                        .put("nombre", vehiculo.nombre)
                        .put("alias", vehiculo.alias)
                        .put("codigo_interno", vehiculo.codigoInterno)
                        .put("detalle", vehiculo.detalle)
                        .put("occupants", vehicleOccupantsJson(vehiculo.idVehiculo))
                        .apply { vehiculo.rumboGrados?.let { put("rumbo_grados", it) } }
                        .toString()
                )
                append(");")
            }
            equipos.forEach { equipo ->
                val lat = equipo.lat ?: return@forEach
                val lon = equipo.lon ?: return@forEach
                if (!isValidLocation(lat, lon)) return@forEach
                if (!isFreshTrackingTimestamp(equipo.ultimaActualizacion)) return@forEach
                host.updateMapDataEquipoPanel(equipo.idEquipo, lat, lon)
                val label = equipo.nombre.ifBlank { "E-${equipo.idEquipo}" }
                append("if(typeof updateTrackingEquipo==='function') updateTrackingEquipo(")
                append(equipo.idEquipo)
                append(",")
                append(lat)
                append(",")
                append(lon)
                append(",'")
                append(jsString(label))
                append("',")
                append(
                    JSONObject()
                        .put("categoria", equipo.categoria)
                        .put("tipo_equipo", equipo.tipoEquipo)
                        .put("nombre", equipo.nombre)
                        .put("numero_serie", equipo.numeroSerie)
                        .apply { equipo.rumboGrados?.let { put("rumbo_grados", it) } }
                        .toString()
                )
                append(");")
            }
            dispositivos.forEach { dispositivo ->
                val lat = dispositivo.lat ?: return@forEach
                val lon = dispositivo.lon ?: return@forEach
                if (!isValidLocation(lat, lon)) return@forEach
                if (!isFreshTrackingTimestamp(dispositivo.ultimaActualizacion)) return@forEach
                host.updateMapDataDispositivoPanel(
                    dispositivo.idDispositivo,
                    lat,
                    lon,
                    dispositivo.numeroSerie,
                    dispositivo.imei
                )
            }
            append("})();")
        }
        cesiumWebController.evaluate(js)
    }

    private fun isValidLocation(lat: Double, lon: Double): Boolean =
        !lat.isNaN() &&
            !lon.isNaN() &&
            !lat.isInfinite() &&
            !lon.isInfinite() &&
            lat in -90.0..90.0 &&
            lon in -180.0..180.0 &&
            !(lat == 0.0 && lon == 0.0)

    private fun isFreshTrackingTimestamp(value: String): Boolean {
        val timestamp = parseTrackingTimestamp(value) ?: return false
        return System.currentTimeMillis() - timestamp <= TRACKING_ACTIVE_STALE_MS
    }

    private fun parseTrackingTimestamp(value: String): Long? {
        val clean = value.trim()
        if (clean.isBlank()) return null
        clean.toLongOrNull()?.let { return it }
        trackingTimestampFormats.forEach { format ->
            runCatching { format.parse(clean)?.time }.getOrNull()?.let { return it }
        }
        return null
    }

    private fun operationZoneJson(zone: OperationZoneItem): JSONObject =
        JSONObject()
            .put("id_zona", zone.idZona)
            .put("nombre", zone.nombre)
            .put("centroide_lat", zone.centerLat)
            .put("centroide_lon", zone.centerLon)
            .put("zoom_inicial", zone.zoomInicial)
            .put("color", zone.color)
            .put("points", pointsJson(zone.points))

    private fun operationGridJson(grid: OperationGridItem): JSONObject =
        JSONObject()
            .put("id_cuadricula", grid.idCuadricula)
            .put("size", grid.size)
            .put("rows", grid.rows)
            .put("cols", grid.cols)
            .put("names", JSONArray().apply { grid.names.forEach { put(it) } })

    private fun poiJson(poi: PoiItem): JSONObject {
        val currentUserId = host.getMapDataCurrentUserId()
        val currentUserTable = host.getMapDataCurrentUserTabla()
        val currentUserLabel = host.getMapDataCurrentUserLabel().trim()
        val isMine = if (currentUserTable.equals("personal", ignoreCase = true)) {
            poi.creatorType == "PERSONAL" && poi.creatorPersonalId == currentUserId
        } else {
            poi.creatorType == "USUARIO" && poi.creatorUserId == currentUserId
        } || (currentUserLabel.isNotBlank() && poi.creatorLabel.contains(currentUserLabel, ignoreCase = true))
        return JSONObject()
            .put("id_poi", poi.idPoi)
            .put("nombre", poi.nombre)
            .put("tipo_poi", poi.tipoPoi)
            .put("latitud", poi.lat)
            .put("longitud", poi.lon)
            .put("velocidad_kmh", poi.velocidadKmh ?: JSONObject.NULL)
            .put("rumbo_grados", poi.rumboGrados ?: JSONObject.NULL)
            .put("color", poi.color)
            .put("creatorLabel", poi.creatorLabel)
            .put("creador_label", poi.creatorLabel)
            .put("creador", poi.creatorLabel)
            .put("creatorRank", poi.creatorRank)
            .put("creador_puesto", poi.creatorRank)
            .put("visibilidad", poi.visibility)
            .put("tipo_creador", poi.creatorType)
            .put("id_usuario", poi.creatorUserId ?: JSONObject.NULL)
            .put("id_personal", poi.creatorPersonalId ?: JSONObject.NULL)
            .put("isMine", isMine)
            .put("editorLabel", poi.editorLabel)
            .put("editor_nombre", poi.editorLabel)
            .put("modificado_por", poi.editorLabel)
            .apply {
                poi.iconoSrc?.let { put("icono_src", resolvePoiIconUrl(it)) }
                poi.sidc?.let { put("sidc", it) }
            }
    }

    private fun coverageCircleJson(circle: CoverageCircleItem): JSONObject =
        JSONObject()
            .put("id_area", circle.idArea)
            .put("nombre", circle.nombre)
            .put("center_lat", circle.centerLat)
            .put("center_lon", circle.centerLon)
            .put("radius_m", circle.radiusM)
            .put("color", circle.color)
            .put("opacity", circle.opacity)
            .put("outline_width", circle.outlineWidth)
            .put("creatorLabel", circle.creatorLabel)

    private fun areaPolygonJson(polygon: AreaPolygonItem): JSONObject =
        JSONObject()
            .put("id_area", polygon.idArea)
            .put("nombre", polygon.nombre)
            .put("color", polygon.color)
            .put("opacity", polygon.opacity)
            .put("outline_width", polygon.outlineWidth)
            .put("creatorLabel", polygon.creatorLabel)
            .put("points", pointsJson(polygon.points))

    private fun structureJson(structure: StructureItem): JSONObject =
        JSONObject()
            .put("id_marca", structure.idMarca)
            .put("nombre", structure.nombre)
            .put("tipo_estructura", structure.tipoEstructura)
            .put("latitud", structure.lat)
            .put("longitud", structure.lon)
            .put("creatorLabel", structure.creatorLabel)
            .apply {
                structure.iconoSrc?.let { put("icono_src", it) }
            }

    private fun pointsJson(points: List<Pair<Double, Double>>): JSONArray =
        JSONArray().apply {
            points.forEach { point ->
                put(
                    JSONObject()
                        .put("lat", point.first)
                        .put("lon", point.second)
                )
            }
        }

    private fun resolveStructureIconUrl(tipoEstructura: String?): String? {
        val tipo = tipoEstructura?.trim()?.uppercase().orEmpty()
        return if (tipo == "ETIQUETA") null else "${ApiConfig.BASE_URL}/img/estructuras/casa.png"
    }

    private fun resolvePoiIconUrl(iconoSrc: String?): String? {
        val cleaned = iconoSrc?.trim()
        if (cleaned.isNullOrBlank() || cleaned.equals("null", ignoreCase = true)) return null
        if (cleaned.startsWith("S")) return cleaned
        if (cleaned.startsWith("http://") || cleaned.startsWith("https://")) return cleaned
        return "${ApiConfig.BASE_URL}/${cleaned.trimStart('/')}"
    }

    private fun jsString(value: String): String =
        value
            .replace("\\", "\\\\")
            .replace("'", "\\'")
            .replace("\n", " ")
            .replace("\r", " ")

    private companion object {
        private const val SYNC_THROTTLE_MS = 1500L
        private const val CESIUM_LOAD_DELAY_MS = 2600L
        private const val TRACKING_ACTIVE_STALE_MS = 30_000L
    }
}
