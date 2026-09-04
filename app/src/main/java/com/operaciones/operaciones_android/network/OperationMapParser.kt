package com.operaciones.operaciones_android.network

import com.operaciones.operaciones_android.config.ApiConfig
import com.operaciones.operaciones_android.model.AreaPolygonItem
import com.operaciones.operaciones_android.model.CoverageCircleItem
import com.operaciones.operaciones_android.model.DispositivoItem
import com.operaciones.operaciones_android.model.EquipoItem
import com.operaciones.operaciones_android.model.OperationMapData
import com.operaciones.operaciones_android.model.OperationGridItem
import com.operaciones.operaciones_android.model.OperationZoneItem
import com.operaciones.operaciones_android.model.PersonalItem
import com.operaciones.operaciones_android.model.PoiItem
import com.operaciones.operaciones_android.model.StructureItem
import com.operaciones.operaciones_android.model.VehiculoItem
import org.json.JSONArray
import org.json.JSONObject

class OperationMapParser {
    private data class TrackingPosition(
        val lat: Double,
        val lon: Double,
        val rumboGrados: Double?
    )

    private data class ParsedAreas(
        val coverageCircles: List<CoverageCircleItem>,
        val areaPolygons: List<AreaPolygonItem>
    )

    fun parseMapData(json: JSONObject): OperationMapData {
        val capas = json.optJSONArray("capas")
        val personalPositions = parsePersonalPositions(json.optJSONArray("personal"))
        val parsedAreas = parseAreas(capas)

        return OperationMapData(
            personal = parsePersonalFromLayers(capas, personalPositions),
            vehiculos = parseVehiculos(json.optJSONArray("vehiculos")),
            equipos = parseEquipos(json.optJSONArray("equipos") ?: capas),
            dispositivos = parseDispositivos(json.optJSONArray("dispositivos")),
            rutasNavegacion = json.optJSONArray("rutas_navegacion")?.toString(),
            rutasTacticas = parseTacticalRoutes(capas).toString(),
            operationZone = parseOperationZone(json.optJSONObject("zona_operacion")),
            pois = parsePois(json.optJSONArray("pois") ?: capas),
            coverageCircles = parsedAreas.coverageCircles,
            areaPolygons = parsedAreas.areaPolygons,
            structures = parseStructures(capas),
            operationGrid = parseOperationGrid(
                json.optJSONObject("grid") ?: json.optJSONObject("cuadricula_operacion")
            )
        )
    }

    fun parsePersonalList(items: JSONArray): List<PersonalItem> {
        val result = mutableListOf<PersonalItem>()

        for (i in 0 until items.length()) {
            val p = items.optJSONObject(i) ?: continue
            result.add(
                PersonalItem(
                    idPersonal = p.optInt("id_personal"),
                    apodo = p.optString("apodo", ""),
                    nombre = p.optString("nombre", ""),
                    apellido = p.optString("apellido", ""),
                    rol = p.optString("rol", ""),
                    puesto = p.optString("puesto", ""),
                    lat = nullableDouble(p, "latitud"),
                    lon = nullableDouble(p, "longitud"),
                    rumboGrados = nullableHeadingDegrees(p)
                )
            )
        }

        return result
    }

    fun parseGridObject(grid: JSONObject?): OperationGridItem? =
        parseOperationGrid(grid)

    private fun parsePersonalPositions(posPersonal: JSONArray?): Map<Int, TrackingPosition> {
        val posMap = mutableMapOf<Int, TrackingPosition>()
        if (posPersonal == null) return posMap

        for (i in 0 until posPersonal.length()) {
            val p = posPersonal.optJSONObject(i) ?: continue
            val lat = nullableDouble(p, "latitud")
            val lon = nullableDouble(p, "longitud")
            val idPersonal = p.optInt("id_personal")
            if (idPersonal > 0 && lat != null && lon != null) {
                posMap[idPersonal] = TrackingPosition(
                    lat = lat,
                    lon = lon,
                    rumboGrados = nullableHeadingDegrees(p)
                )
            }
        }

        return posMap
    }

    private fun parsePersonalFromLayers(
        capas: JSONArray?,
        posMap: Map<Int, TrackingPosition>
    ): List<PersonalItem> {
        val personal = mutableListOf<PersonalItem>()
        if (capas == null) return personal

        for (i in 0 until capas.length()) {
            val c = capas.optJSONObject(i) ?: continue
            if (c.optString("tipo_capa") != "PERSONAL") continue

            val idP = c.optInt("id_referencia")
            val pos = posMap[idP]

            personal.add(
                PersonalItem(
                    idPersonal = idP,
                    apodo = c.optString("apodo", ""),
                    nombre = c.optString("nombre", ""),
                    apellido = c.optString("apellido", ""),
                    rol = c.optString("rol", ""),
                    puesto = c.optString("puesto", ""),
                    lat = pos?.lat,
                    lon = pos?.lon,
                    rumboGrados = pos?.rumboGrados ?: nullableHeadingDegrees(c),
                    idGrupoOperacion = positiveInt(c, "id_grupo_operacion"),
                    idGrupoPadre = positiveInt(c, "grupo_padre_id"),
                    grupoNombre = c.optString("grupo_nombre", ""),
                    grupoApodo = c.optString("grupo_apodo", ""),
                    grupoPadreNombre = c.optString("grupo_padre_nombre", ""),
                    grupoPadreApodo = c.optString("grupo_padre_apodo", ""),
                    idCetRef = positiveInt(c, "id_cet_ref"),
                    cetNombre = c.optString("cet_nombre", ""),
                    cetFlotilla = c.optString("cet_flotilla", "")
                )
            )
        }

        return personal
    }

    private fun parseVehiculos(posVehiculos: JSONArray?): List<VehiculoItem> {
        val vehiculos = mutableListOf<VehiculoItem>()
        if (posVehiculos == null) return vehiculos

        for (i in 0 until posVehiculos.length()) {
            val v = posVehiculos.optJSONObject(i) ?: continue
            val codigoInterno = v.optString("codigo_interno", "")
            val nombreVehiculo = v.optString("nombre", "").ifBlank {
                if (codigoInterno.isNotBlank()) codigoInterno else "Vehiculo"
            }

            vehiculos.add(
                VehiculoItem(
                    idVehiculo = v.optInt("id_vehiculo"),
                    codigoInterno = codigoInterno,
                    nombre = nombreVehiculo,
                    tipo = v.optString("tipo", ""),
                    detalle = "",
                    idPersonalAsignado = positiveInt(v, "id_personal"),
                    tipoDestino = v.optString("tipo_destino", "").uppercase(),
                    asignadoAApodo = v.optString("asignado_a_apodo", ""),
                    personalNombre = v.optString("asignado_a_nombre", v.optString("personal_nombre", "")),
                    personalApellido = v.optString("asignado_a_apellido", v.optString("personal_apellido", "")),
                    personalPuesto = v.optString("personal_puesto", ""),
                    cetNombre = v.optString("cet_nombre", ""),
                    grupoNombre = v.optString("grupo_nombre", ""),
                    grupoPadreNombre = v.optString("grupo_padre_nombre", ""),
                    lat = nullableDouble(v, "latitud"),
                    lon = nullableDouble(v, "longitud"),
                    rumboGrados = nullableHeadingDegrees(v)
                )
            )
        }

        return vehiculos
    }

    private fun parseEquipos(capas: JSONArray?): List<EquipoItem> {
        val equipos = mutableListOf<EquipoItem>()
        if (capas == null) return equipos

        for (i in 0 until capas.length()) {
            val c = capas.optJSONObject(i) ?: continue
            val tipoCapa = c.optString("tipo_capa", "")
            if (tipoCapa.isNotBlank() && tipoCapa != "EQUIPO") continue

            val numeroSerie = c.optString("numero_serie", "")
            val tipoDestino = c.optString("tipo_destino", "").uppercase()
            val vehiculoCodigo = c.optString("asignado_a_vehiculo", "")
            val vehiculoAlias = c.optString("vehiculo_alias", "")
            val vehiculoNombre = listOf(vehiculoCodigo, vehiculoAlias)
                .filter { it.isNotBlank() }
                .joinToString(" - ")
            val personalNombre = c.optString("asignado_a_personal", "")
            val grupoNombre = c.optString("grupo_asignado", "")
            val flotillaNombre = c.optString("flotilla_asignada", "")
            val gruposVinculados = splitCsv(c.optString("grupos_vinculados", ""))
                .ifEmpty { listOf(grupoNombre).filter { it.isNotBlank() } }
            val flotillasVinculadas = splitCsv(c.optString("flotillas_vinculadas", ""))
                .ifEmpty { listOf(flotillaNombre).filter { it.isNotBlank() } }

            equipos.add(
                EquipoItem(
                    idEquipo = positiveInt(c, "id_equipo") ?: positiveInt(c, "id_referencia") ?: 0,
                    numeroSerie = numeroSerie,
                    nombre = c.optString("nombre", "Equipo"),
                    categoria = c.optString("categoria", ""),
                    tipoEquipo = c.optString("tipo_equipo", ""),
                    detalle = if (numeroSerie.isNotBlank()) "S/N: $numeroSerie" else "",
                    asignadoA = vehiculoNombre.ifBlank {
                        personalNombre.ifBlank {
                            grupoNombre.ifBlank { flotillaNombre }
                        }
                    },
                    tipoDestino = tipoDestino,
                    idPersonalAsignado = positiveInt(c, "ueo_id_personal")
                        ?: positiveInt(c, "id_personal_asignado")
                        ?: positiveInt(c, "id_personal"),
                    idVehiculoAsignado = positiveInt(c, "id_vehiculo_contexto")
                        ?: positiveInt(c, "id_vehiculo_asignado")
                        ?: positiveInt(c, "id_vehiculo"),
                    personalAsignado = personalNombre,
                    vehiculoAsignado = vehiculoNombre,
                    grupoAsignado = grupoNombre,
                    flotillaAsignada = flotillaNombre,
                    gruposVinculados = gruposVinculados,
                    flotillasVinculadas = flotillasVinculadas,
                    lat = nullableDouble(c, "latitud"),
                    lon = nullableDouble(c, "longitud"),
                    rumboGrados = nullableHeadingDegrees(c),
                    ultimaActualizacion = c.optString("ultima_actualizacion", "")
                )
            )
        }

        return equipos
    }

    private fun parseDispositivos(source: JSONArray?): List<DispositivoItem> {
        val dispositivos = mutableListOf<DispositivoItem>()
        if (source == null) return dispositivos

        for (i in 0 until source.length()) {
            val d = source.optJSONObject(i) ?: continue
            dispositivos.add(
                DispositivoItem(
                    idDispositivo = d.optInt("id_dispositivo"),
                    tipo = d.optString("tipo", ""),
                    marca = d.optString("marca", ""),
                    modelo = d.optString("modelo", ""),
                    numeroTelefono = d.optString("numero_telefono", ""),
                    imei = d.optString("imei", ""),
                    numeroSerie = d.optString("numero_serie", ""),
                    sistemaOperativo = d.optString("sistema_operativo", ""),
                    identificadorApp = d.optString("identificador_app", ""),
                    estado = d.optString("dispositivo_estado", d.optString("estado", "")),
                    idPersonal = positiveInt(d, "id_personal"),
                    personalApodo = d.optString("personal_apodo", ""),
                    personalNombre = d.optString("personal_nombre", ""),
                    personalApellido = d.optString("personal_apellido", ""),
                    personalPuesto = d.optString("personal_puesto", ""),
                    estadoAsignacion = d.optString("estado_asignacion", ""),
                    lat = nullableDouble(d, "latitud"),
                    lon = nullableDouble(d, "longitud"),
                    velocidadKmh = nullableDouble(d, "velocidad_kmh"),
                    rumboGrados = nullableHeadingDegrees(d),
                    precisionM = nullableDouble(d, "precision_m"),
                    bateriaPct = nullableDouble(d, "bateria_pct"),
                    ultimaActualizacion = d.optString("ultima_actualizacion", "")
                )
            )
        }

        return dispositivos
    }

    private fun parsePois(poisSource: JSONArray?): List<PoiItem> {
        val pois = mutableListOf<PoiItem>()
        if (poisSource == null) return pois

        for (i in 0 until poisSource.length()) {
            val c = poisSource.optJSONObject(i) ?: continue
            val isPoi = c.optString("tipo_capa").isBlank() || c.optString("tipo_capa") == "POI"
            if (!isPoi) continue

            val idPoi = if (c.has("id_poi")) c.optInt("id_poi") else c.optInt("id_elemento")
            if (idPoi <= 0) continue

            val iconoSrc = optionalString(c, "icono_src")
            val sidc = optionalString(c, "sidc") ?: iconoSrc?.takeIf { it.startsWith("S") || it.startsWith("G") }

            pois.add(
                PoiItem(
                    idPoi = idPoi,
                    nombre = c.optString("nombre", "PDI"),
                    tipoPoi = if (c.has("tipo_poi")) c.optString("tipo_poi", "") else c.optString("subtipo", ""),
                    lat = c.optDouble("latitud"),
                    lon = c.optDouble("longitud"),
                    color = c.optString("color", "#FFD700").ifBlank { "#FFD700" },
                    iconoSrc = iconoSrc,
                    sidc = sidc,
                    creatorLabel = creatorLabel(c),
                    creatorRank = c.optString("creador_puesto", c.optString("creatorRank", "")),
                    visibility = c.optString("visibilidad", "PRIVADO").uppercase(),
                    creatorType = c.optString("tipo_creador", "").uppercase(),
                    creatorUserId = c.optInt("id_usuario", -1).takeIf { it > 0 },
                    creatorPersonalId = c.optInt("id_personal", -1).takeIf { it > 0 },
                    editorLabel = editorLabel(c)
                )
            )
        }

        return pois
    }

    private fun parseTacticalRoutes(capas: JSONArray?): JSONArray {
        val rutasTacticas = JSONArray()
        if (capas == null) return rutasTacticas

        for (i in 0 until capas.length()) {
            val c = capas.optJSONObject(i) ?: continue
            if (c.optString("tipo_capa") != "RUTA") continue

            val idRuta = if (c.has("id_ruta")) c.optInt("id_ruta") else c.optInt("id_elemento")
            if (idRuta <= 0) continue

            val geometria = geometryObject(c.opt("geometria")) ?: continue

            rutasTacticas.put(
                JSONObject()
                    .put("id_ruta", idRuta)
                    .put("nombre", c.optString("nombre", "Linea tactica"))
                    .put("geometria", geometria)
                    .put("color", c.optString("color", "#1E90FF").ifBlank { "#1E90FF" })
                    .put("estado", c.optString("estado", "ACTIVA"))
                    .put("creatorLabel", creatorLabel(c))
            )
        }

        return rutasTacticas
    }

    private fun parseStructures(capas: JSONArray?): List<StructureItem> {
        val structures = mutableListOf<StructureItem>()
        if (capas == null) return structures

        for (i in 0 until capas.length()) {
            val c = capas.optJSONObject(i) ?: continue
            val tipoCapa = c.optString("tipo_capa")
            val tipoEstructuraRaw = c.optString("tipo_estructura", "").ifBlank {
                if (tipoCapa == "EDIFICIO") c.optString("subtipo", "") else ""
            }
            val tipoEstructura = tipoEstructuraRaw.trim().uppercase()
            val isStructure =
                tipoCapa == "EDIFICIO" ||
                    tipoEstructura == "EDIFICIO" ||
                    tipoEstructura == "ETIQUETA"
            if (!isStructure) continue

            val idMarca = if (c.has("id_marca")) c.optInt("id_marca") else c.optInt("id_elemento")
            if (idMarca <= 0) continue

            structures.add(
                StructureItem(
                    idMarca = idMarca,
                    nombre = c.optString("nombre", "Estructura"),
                    tipoEstructura = if (tipoEstructura.isNotBlank()) tipoEstructura else "EDIFICIO",
                    lat = c.optDouble("latitud"),
                    lon = c.optDouble("longitud"),
                    iconoSrc = if (tipoEstructura == "ETIQUETA") null else "${ApiConfig.BASE_URL}/img/estructuras/casa.png",
                    creatorLabel = creatorLabel(c)
                )
            )
        }

        return structures
    }

    private fun parseAreas(capas: JSONArray?): ParsedAreas {
        val coverageCircles = mutableListOf<CoverageCircleItem>()
        val areaPolygons = mutableListOf<AreaPolygonItem>()
        if (capas == null) return ParsedAreas(coverageCircles, areaPolygons)

        for (i in 0 until capas.length()) {
            val c = capas.optJSONObject(i) ?: continue
            if (c.optString("tipo_capa") != "AREA") continue

            val geometria = c.optJSONObject("geometria") ?: continue
            val meta = geometria.optJSONObject("meta") ?: JSONObject()
            val shape = meta.optString("shape", "").lowercase()

            if (shape == "polygon") {
                parseAreaPolygon(c, geometria, meta)?.let { areaPolygons.add(it) }
                continue
            }

            if (shape.equals("circle", ignoreCase = true)) {
                parseCoverageCircle(c, meta)?.let { coverageCircles.add(it) }
            }
        }

        return ParsedAreas(coverageCircles, areaPolygons)
    }

    private fun parseAreaPolygon(
        layer: JSONObject,
        geometria: JSONObject,
        meta: JSONObject
    ): AreaPolygonItem? {
        val rings = geometria.optJSONArray("coordinates") ?: return null
        val points = parseOuterRingPoints(rings.optJSONArray(0))
        if (points.size < 3) return null

        return AreaPolygonItem(
            idArea = layer.optInt("id_elemento"),
            nombre = layer.optString("nombre", "Poligono / Zona"),
            points = points,
            color = layer.optString("color", "#FFD700").ifBlank { "#FFD700" },
            opacity = meta.optDouble("opacity", 0.35),
            outlineWidth = meta.optDouble("outline_width", 3.0),
            creatorLabel = creatorLabel(layer)
        )
    }

    private fun parseCoverageCircle(layer: JSONObject, meta: JSONObject): CoverageCircleItem? {
        val center = meta.optJSONArray("center") ?: return null
        if (center.length() < 2) return null

        val centerLon = center.optDouble(0, Double.NaN)
        val centerLat = center.optDouble(1, Double.NaN)
        val radiusM = meta.optDouble("radius_m", Double.NaN)
        if (centerLat.isNaN() || centerLon.isNaN() || radiusM.isNaN() || radiusM <= 0.0) return null

        return CoverageCircleItem(
            idArea = layer.optInt("id_elemento"),
            nombre = layer.optString("nombre", "Circulo de cobertura"),
            centerLat = centerLat,
            centerLon = centerLon,
            radiusM = radiusM,
            color = layer.optString("color", "#FF4500").ifBlank { "#FF4500" },
            opacity = meta.optDouble("opacity", 0.35),
            outlineWidth = meta.optDouble("outline_width", 3.0),
            creatorLabel = creatorLabel(layer)
        )
    }

    private fun parseOperationZone(zona: JSONObject?): OperationZoneItem? {
        if (zona == null) return null

        val centerLat = zona.optDouble("centroide_lat", Double.NaN)
        val centerLon = zona.optDouble("centroide_lon", Double.NaN)
        val zoomInicial = zona.optInt("zoom_inicial", 1000)
        val geometria = zona.optJSONObject("geometria")
        val outerRing = geometria?.optJSONArray("coordinates")?.optJSONArray(0)
        if (centerLat.isNaN() || centerLon.isNaN() || outerRing == null) return null

        val points = parseOuterRingPoints(outerRing)
        if (points.size < 3) return null

        return OperationZoneItem(
            idZona = zona.optInt("id_zona"),
            nombre = zona.optString("nombre", "Zona de operacion"),
            centerLat = centerLat,
            centerLon = centerLon,
            zoomInicial = if (zoomInicial > 0) zoomInicial else 1000,
            color = zona.optString("color", "#3b82f6").ifBlank { "#3b82f6" },
            points = points
        )
    }

    private fun parseOperationGrid(grid: JSONObject?): OperationGridItem? {
        if (grid == null) return null

        val size = grid.optString("size", "").trim().lowercase()
        val sizeMatch = Regex("""^(\d+)x(\d+)$""").matchEntire(size)
        val rows = positiveInt(grid, "rows") ?: sizeMatch?.groupValues?.getOrNull(1)?.toIntOrNull()
        val cols = positiveInt(grid, "cols") ?: sizeMatch?.groupValues?.getOrNull(2)?.toIntOrNull()
        if (size.isBlank() || rows == null || cols == null || rows <= 0 || cols <= 0) return null

        val rawNames = grid.optJSONArray("names") ?: grid.optJSONArray("nombres") ?: JSONArray()
        val total = rows * cols
        val names = List(total) { index ->
            rawNames.optString(index, "").trim()
        }

        return OperationGridItem(
            idCuadricula = grid.optInt("id_cuadricula", -1),
            size = size,
            rows = rows,
            cols = cols,
            names = names
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

    private fun geometryObject(raw: Any?): JSONObject? =
        when (raw) {
            is JSONObject -> raw
            is String -> runCatching { JSONObject(raw) }.getOrNull()
            else -> null
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

    private fun positiveInt(json: JSONObject, key: String): Int? =
        json.optInt(key, -1).takeIf { it > 0 }

    private fun abbreviateRank(rank: String): String {
        val r = rank.trim().lowercase()
        return when {
            r.contains("capitán de navío") || r.contains("capitan de navio") -> "Cap. Nav."
            r.contains("capitán de fragata") || r.contains("capitan de fragata") -> "Cap. Frag."
            r.contains("capitán de corbeta") || r.contains("capitan de corbeta") -> "Cap. Corb."
            r.contains("capitán 1/o") || r.contains("capitan 1/o") || r.contains("capitán primero") -> "Cap. 1/o"
            r.contains("capitán 2/o") || r.contains("capitan 2/o") || r.contains("capitán segundo") -> "Cap. 2/o"
            r.contains("capitán") || r.contains("capitan") || r == "cap" || r == "cap." -> "Cap."
            r.contains("teniente de navío") || r.contains("teniente de navio") -> "Tte. Nav."
            r.contains("teniente de fragata") || r.contains("teniente de fragata") -> "Tte. Frag."
            r.contains("teniente de corbeta") || r.contains("teniente de corbeta") -> "Tte. Corb."
            r.contains("primer teniente") || r.contains("1er teniente") -> "1er. Tte."
            r.contains("segundo teniente") || r.contains("2do teniente") -> "2do. Tte."
            r.contains("subteniente") || r == "subtte" || r == "subtte." -> "Subtte."
            r.contains("teniente") || r == "tte" || r == "tte." -> "Tte."
            r.contains("sargento 1/o") || r.contains("sargento primero") -> "Sgto. 1/o"
            r.contains("sargento 2/o") || r.contains("sargento segundo") -> "Sgto. 2/o"
            r.contains("sargento") || r == "sgto" || r == "sgto." -> "Sgto."
            r.contains("cabo") || r == "cbo" || r == "cbo." -> "Cbo."
            r.contains("marinero") || r == "mro" || r == "mro." -> "Mro."
            r.contains("soldado") || r == "sld" || r == "sld." -> "Sld."
            r.contains("general de división") || r.contains("general de division") -> "Gral. Div."
            r.contains("general de brigada") -> "Gral. Brig."
            r.contains("general brigadier") -> "Gral. Bgda."
            r.contains("general") || r == "gral" || r == "gral." -> "Gral."
            r.contains("almirante") || r == "alm" || r == "alm." -> "Alm."
            r.contains("vicealmirante") || r == "valm" || r == "valm." -> "Valm."
            r.contains("contralmirante") || r == "calm" || r == "calm." -> "Calm."
            r.contains("coronel") || r == "cnel" || r == "cnel." -> "Cnel."
            r.contains("mayor") || r == "my" || r == "my." -> "My."
            else -> ""
        }
    }

    private fun creatorLabel(json: JSONObject): String {
        val rawRank = listOf("jerarquia", "creador_jerarquia", "puesto", "creador_puesto", "rango", "grado")
            .map { key -> json.optString(key, "").trim() }
            .firstOrNull { it.isNotBlank() && !it.equals("null", ignoreCase = true) }
            .orEmpty()
        val rank = if (rawRank.isNotBlank()) abbreviateRank(rawRank) else ""

        val direct = listOf(
            "creatorLabel",
            "creador_label",
            "creador_nombre",
            "nombre_creador",
            "autor_nombre",
            "created_by_nombre",
            "creador",
            "apodo",
            "username",
            "usuario"
        )
            .map { key -> json.optString(key, "").trim() }
            .firstOrNull { it.isNotBlank() && !it.equals("null", ignoreCase = true) }

        if (!direct.isNullOrBlank()) {
            val cleanDirect = direct.replace(Regex("""\s*\([^)]*\)"""), "").trim()
            return if (rank.isNotBlank() && !cleanDirect.contains(rank, ignoreCase = true)) {
                "$rank $cleanDirect"
            } else {
                cleanDirect
            }
        }

        val fullName = listOf(
            json.optString("nombre_creador_persona", "").trim(),
            json.optString("apellido_creador_persona", "").trim()
        )
            .filter { it.isNotBlank() && !it.equals("null", ignoreCase = true) }
            .joinToString(" ")
            .replace(Regex("""\s*\([^)]*\)"""), "")
            .trim()
        if (fullName.isNotBlank()) {
            return if (rank.isNotBlank() && !fullName.contains(rank, ignoreCase = true)) {
                "$rank $fullName"
            } else {
                fullName
            }
        }

        return ""
    }

    private fun editorLabel(json: JSONObject): String {
        val direct = listOf(
            "editorLabel",
            "editor_nombre",
            "modificado_por",
            "editor"
        )
            .map { key -> json.optString(key, "").trim() }
            .firstOrNull { it.isNotBlank() && !it.equals("null", ignoreCase = true) }
        return direct?.replace(Regex("""\s*\([^)]*\)"""), "")?.trim() ?: ""
    }

    private fun splitCsv(value: String): List<String> =
        value.split(",")
            .map { it.trim() }
            .filter { it.isNotBlank() }

    private fun optionalString(json: JSONObject, key: String): String? {
        if (!json.has(key) || json.isNull(key)) return null
        val cleaned = json.optString(key, "").trim()
        return if (cleaned.isBlank() || cleaned.equals("null", ignoreCase = true)) null else cleaned
    }
}
