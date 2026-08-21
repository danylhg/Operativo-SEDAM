package com.operaciones.operaciones_android.ui.panel

import android.graphics.Color
import android.view.View
import java.util.Locale
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import com.operaciones.operaciones_android.R
import com.operaciones.operaciones_android.model.DispositivoItem
import com.operaciones.operaciones_android.model.EquipoItem
import com.operaciones.operaciones_android.model.PersonalItem
import com.operaciones.operaciones_android.model.PoiItem
import com.operaciones.operaciones_android.model.User
import com.operaciones.operaciones_android.model.VehiculoItem

internal class ResourcesPanelRenderer(
    private val host: MainPanelRenderer.Host
) {
    private enum class ResourceTab(val label: String) {
        PERSONAL("Personal"),
        VEHICULOS("Vehiculos"),
        EQUIPO_TACTICO("Equipo tactico"),
        EQUIPO_COMUNICACION("Comunicacion"),
        DISPOSITIVOS("Dispositivos"),
        WAYPOINTS("Waypoints"),
        BLANCOS("Blancos")
    }

    private val livePersonalLocations = mutableMapOf<Int, Pair<Double, Double>>()
    private val liveVehiculoLocations = mutableMapOf<Int, Pair<Double, Double>>()
    private val liveEquipoLocations = mutableMapOf<Int, Pair<Double, Double>>()
    private val liveDispositivoLocations = mutableMapOf<Int, Pair<Double, Double>>()
    private val personalRows = mutableMapOf<Int, View>()
    private val vehiculoRows = mutableMapOf<Int, View>()
    private val equipoRows = mutableMapOf<Int, View>()
    private val dispositivoRows = mutableMapOf<Int, View>()
    private var activeTab = ResourceTab.PERSONAL
    private var selectedPersonalId: Int? = null
    private var selectedVehiculoId: Int? = null
    private var selectedEquipoId: Int? = null
    private var selectedDispositivoId: Int? = null
    private var currentUserId: Int? = null

    fun selectPersonal(idPersonal: Int?) {
        selectedPersonalId = idPersonal
        personalRows.forEach { (id, row) -> applyPersonalStyle(row, id) }
    }

    fun selectVehiculo(idVehiculo: Int?) {
        selectedVehiculoId = idVehiculo
        vehiculoRows.forEach { (id, row) -> applyResourceStyle(row, id == selectedVehiculoId, hasVehiculoLocation(id)) }
    }

    fun selectEquipo(idEquipo: Int?) {
        selectedEquipoId = idEquipo
        equipoRows.forEach { (id, row) -> applyResourceStyle(row, id == selectedEquipoId, hasEquipoLocation(id)) }
    }

    fun selectDispositivo(idDispositivo: Int?) {
        selectedDispositivoId = idDispositivo
        dispositivoRows.forEach { (id, row) -> applyResourceStyle(row, id == selectedDispositivoId, hasDispositivoLocation(id)) }
    }

    fun updatePersonalLocation(id: Int, lat: Double, lon: Double) {
        livePersonalLocations[id] = lat to lon
        personalRows[id]?.let { row ->
            row.findViewById<View>(R.id.personalStatus).setBackgroundColor(Color.parseColor("#22c55e"))
            setSelectableForeground(row)
            val label = row.findViewById<TextView>(R.id.personalNombre).text.toString()
            row.setOnClickListener {
                selectPersonal(id)
                host.selectPersonalOnMap(id, lat, lon, label)
            }
            applyPersonalStyle(row, id)
        }
    }

    fun updateVehiculoLocation(id: Int, lat: Double, lon: Double) {
        if (!isValidLocation(lat, lon)) return
        liveVehiculoLocations[id] = lat to lon
        vehiculoRows[id]?.let { row ->
            val label = row.tag as? String ?: row.findViewById<TextView>(R.id.equipoNombre).text.toString()
            setSelectableForeground(row)
            row.setOnClickListener {
                selectVehiculo(id)
                host.selectVehiculoOnMap(id, lat, lon, label)
            }
            applyResourceStyle(row, id == selectedVehiculoId, true)
        }
    }

    fun updateEquipoLocation(id: Int, lat: Double, lon: Double) {
        if (!isValidLocation(lat, lon)) return
        liveEquipoLocations[id] = lat to lon
        equipoRows[id]?.let { row ->
            val label = row.tag as? String ?: row.findViewById<TextView>(R.id.equipoNombre).text.toString()
            setSelectableForeground(row)
            row.setOnClickListener {
                selectEquipo(id)
                host.selectEquipoOnMap(id, lat, lon, label)
            }
            applyResourceStyle(row, id == selectedEquipoId, true)
        }
    }

    fun updateDispositivoLocation(id: Int, lat: Double, lon: Double) {
        if (!isValidLocation(lat, lon)) return
        liveDispositivoLocations[id] = lat to lon
        dispositivoRows[id]?.let { row ->
            val label = row.tag as? String ?: row.findViewById<TextView>(R.id.equipoNombre).text.toString()
            setSelectableForeground(row)
            row.setOnClickListener {
                selectDispositivo(id)
                host.selectDispositivoOnMap(id, lat, lon, label)
            }
            applyResourceStyle(row, id == selectedDispositivoId, true)
        }
    }

    fun inflate(
        panelContent: FrameLayout,
        personalList: List<PersonalItem>,
        vehiculosList: List<VehiculoItem>,
        equiposList: List<EquipoItem>,
        dispositivosList: List<DispositivoItem>,
        currentUser: User,
        poisList: List<PoiItem> = emptyList()
    ) {
        val view = host.getLayoutInflater().inflate(R.layout.panel_resources, panelContent, false)
        panelContent.addView(view)

        currentUserId = currentUser.id
        val tabs = view.findViewById<LinearLayout>(R.id.resourcesTabs)
        val list = view.findViewById<LinearLayout>(R.id.resourcesList)

        fun render(tab: ResourceTab) {
            activeTab = tab
            renderTabs(tabs, ::render)
            renderList(list, tab, personalList, vehiculosList, equiposList, dispositivosList, poisList)
        }

        render(activeTab)
    }

    private fun renderTabs(tabs: LinearLayout, onTabSelected: (ResourceTab) -> Unit) {
        tabs.removeAllViews()
        ResourceTab.entries.forEach { tab ->
            val active = tab == activeTab
            tabs.addView(TextView(tabs.context).apply {
                text = tab.label
                setTextColor(Color.parseColor(if (active) "#F8FBFF" else "#7F93AE"))
                textSize = 11f
                setTypeface(typeface, if (active) android.graphics.Typeface.BOLD else android.graphics.Typeface.NORMAL)
                setPadding(dp(this, 12f), 0, dp(this, 12f), 0)
                minHeight = dp(this, 32f)
                gravity = android.view.Gravity.CENTER
                setBackgroundColor(Color.parseColor(if (active) "#223A5C" else "#00000000"))
                setOnClickListener { onTabSelected(tab) }
            })
        }
    }

    private fun renderList(
        list: LinearLayout,
        tab: ResourceTab,
        personalList: List<PersonalItem>,
        vehiculosList: List<VehiculoItem>,
        equiposList: List<EquipoItem>,
        dispositivosList: List<DispositivoItem>,
        poisList: List<PoiItem>
    ) {
        list.removeAllViews()
        personalRows.clear()
        vehiculoRows.clear()
        equipoRows.clear()
        dispositivoRows.clear()

        when (tab) {
            ResourceTab.PERSONAL -> {
                addSectionHeader(list, "Personal asignado")
                if (personalList.isEmpty()) addEmptyState(list, "Cargando personal...")
                else personalList.sortedBy(::personalHierarchyKey).forEach { addPersonalRow(list, it) }
            }
            ResourceTab.VEHICULOS -> {
                addSectionHeader(list, "Vehiculos asignados")
                val vehicles = vehiculosList.groupBy { it.idVehiculo }.map { it.value.first() }.sortedBy { vehicleLabel(it) }
                if (vehicles.isEmpty()) addEmptyState(list, "Cargando vehiculos...")
                else vehicles.forEach { addVehicleRow(list, it) }
            }
            ResourceTab.WAYPOINTS -> {
                val waypoints = poisList.filter { !isBlancoPoi(it) }
                addSectionHeader(list, "Waypoints (${waypoints.size})")
                if (waypoints.isEmpty()) addEmptyState(list, "Sin waypoints activos")
                else waypoints.forEach { addPoiRow(list, it) }
            }
            ResourceTab.BLANCOS -> {
                val blancos = poisList.filter { isBlancoPoi(it) }
                addSectionHeader(list, "Blancos (${blancos.size})")
                if (blancos.isEmpty()) addEmptyState(list, "Sin blancos activos")
                else blancos.forEach { addPoiRow(list, it) }
            }
            ResourceTab.EQUIPO_TACTICO -> renderEquipmentGroup(
                list,
                "Equipo tactico",
                equiposList.filter { it.categoria.equals("TACTICO", ignoreCase = true) }
            )
            ResourceTab.EQUIPO_COMUNICACION -> renderEquipmentGroup(
                list,
                "Equipo de comunicacion",
                equiposList.filter { it.categoria.equals("COMUNICACION", ignoreCase = true) }
            )
            ResourceTab.DISPOSITIVOS -> {
                addSectionHeader(list, "Dispositivos asignados")
                if (dispositivosList.isEmpty()) addEmptyState(list, "Cargando dispositivos...")
                else dispositivosList.sortedWith(compareBy({ it.tipo }, { it.marca }, { it.modelo })).forEach { addDeviceRow(list, it) }
            }
        }
    }

    private fun renderEquipmentGroup(list: LinearLayout, title: String, items: List<EquipoItem>) {
        addSectionHeader(list, title)
        if (items.isEmpty()) addEmptyState(list, "Sin elementos en esta seccion")
        else items.sortedBy { it.nombre.ifBlank { it.numeroSerie } }.forEach { addEquipmentRow(list, it) }
    }

    private fun addPersonalRow(list: LinearLayout, person: PersonalItem) {
        val row = host.getLayoutInflater().inflate(R.layout.item_personal, list, false)
        val rowLabel = displayName(person)

        row.findViewById<TextView>(R.id.personalAvatar).text = person.nombre.firstOrNull()?.toString() ?: "?"
        row.findViewById<TextView>(R.id.personalNombre).text = rowLabel
        row.findViewById<TextView>(R.id.personalRol).text = buildString {
            append(person.rol.ifBlank { "Personal" })
            if (person.puesto.isNotBlank()) append(" - ${person.puesto}")
        }

        val live = livePersonalLocations[person.idPersonal]
        val lat = live?.first ?: person.lat
        val lon = live?.second ?: person.lon
        val hasLocation = lat != null && lon != null
        row.findViewById<View>(R.id.personalStatus).setBackgroundColor(
            Color.parseColor(if (hasLocation) "#22c55e" else "#475569")
        )

        if (lat != null && lon != null) {
            setSelectableForeground(row)
            row.setOnClickListener {
                selectPersonal(person.idPersonal)
                host.selectPersonalOnMap(person.idPersonal, lat, lon, rowLabel)
            }
        }

        personalRows[person.idPersonal] = row
        applyPersonalStyle(row, person.idPersonal)
        list.addView(row)
    }

    private fun addVehicleRow(list: LinearLayout, vehicle: VehiculoItem) {
        val row = host.getLayoutInflater().inflate(R.layout.item_equipo, list, false)
        val rowLabel = vehicleLabel(vehicle)
        row.tag = rowLabel

        row.findViewById<TextView>(R.id.equipoIcon).text = when {
            vehicle.tipo.equals("INTERCEPTOR", ignoreCase = true) -> "INT"
            vehicle.tipo.equals("BLINDADO", ignoreCase = true) -> "BLD"
            vehicle.tipo.equals("PICKUP", ignoreCase = true) -> "PK"
            else -> "VEH"
        }
        row.findViewById<TextView>(R.id.equipoNombre).text = rowLabel
        row.findViewById<TextView>(R.id.equipoDetalle).text = vehicleDetail(vehicle)
        row.findViewById<TextView>(R.id.equipoTipo).text = vehicle.tipo.ifBlank { "VEHICULO" }.uppercase()

        val live = liveVehiculoLocations[vehicle.idVehiculo]
        val lat = live?.first ?: vehicle.lat
        val lon = live?.second ?: vehicle.lon
        val hasLocation = lat != null && lon != null && isValidLocation(lat, lon)
        if (hasLocation) {
            setSelectableForeground(row)
            row.setOnClickListener {
                selectVehiculo(vehicle.idVehiculo)
                host.selectVehiculoOnMap(vehicle.idVehiculo, lat!!, lon!!, rowLabel)
            }
        }

        vehiculoRows[vehicle.idVehiculo] = row
        applyResourceStyle(row, vehicle.idVehiculo == selectedVehiculoId, hasLocation)
        list.addView(row)
    }

    private fun addEquipmentRow(list: LinearLayout, item: EquipoItem) {
        val row = host.getLayoutInflater().inflate(R.layout.item_equipo, list, false)
        val rowLabel = item.nombre.ifBlank { "E-${item.idEquipo}" }
        row.tag = rowLabel

        row.findViewById<TextView>(R.id.equipoIcon).text = when {
            item.categoria.equals("COMUNICACION", ignoreCase = true) -> "COM"
            item.categoria.equals("TACTICO", ignoreCase = true) -> "TAC"
            else -> "EQP"
        }
        row.findViewById<TextView>(R.id.equipoNombre).text = rowLabel
        row.findViewById<TextView>(R.id.equipoDetalle).text = equipmentDetail(item)
        row.findViewById<TextView>(R.id.equipoTipo).text = item.categoria.ifBlank { "EQUIPO" }.uppercase()

        val live = liveEquipoLocations[item.idEquipo]
        val lat = live?.first ?: item.lat
        val lon = live?.second ?: item.lon
        val hasLocation = lat != null && lon != null && isValidLocation(lat, lon)
        if (hasLocation) {
            setSelectableForeground(row)
            row.setOnClickListener {
                selectEquipo(item.idEquipo)
                host.selectEquipoOnMap(item.idEquipo, lat, lon, rowLabel)
            }
        }

        equipoRows[item.idEquipo] = row
        applyResourceStyle(row, item.idEquipo == selectedEquipoId, hasLocation)
        list.addView(row)
    }

    private fun addDeviceRow(list: LinearLayout, item: DispositivoItem) {
        val row = host.getLayoutInflater().inflate(R.layout.item_equipo, list, false)
        val rowLabel = deviceLabel(item)
        row.tag = rowLabel

        row.findViewById<TextView>(R.id.equipoIcon).text = deviceIconText(item)
        row.findViewById<TextView>(R.id.equipoNombre).text = rowLabel
        row.findViewById<TextView>(R.id.equipoDetalle).text = deviceDetail(item)
        row.findViewById<TextView>(R.id.equipoTipo).text = item.estado.ifBlank { "DISP" }.uppercase()

        val live = liveDispositivoLocations[item.idDispositivo]
        val lat = live?.first ?: item.lat
        val lon = live?.second ?: item.lon
        val hasLocation = lat != null && lon != null && isValidLocation(lat, lon)
        if (hasLocation) {
            setSelectableForeground(row)
            row.setOnClickListener {
                selectDispositivo(item.idDispositivo)
                host.selectDispositivoOnMap(item.idDispositivo, lat, lon, rowLabel)
            }
        }

        dispositivoRows[item.idDispositivo] = row
        applyResourceStyle(row, item.idDispositivo == selectedDispositivoId, hasLocation)
        list.addView(row)
    }

    private fun isBlancoPoi(poi: PoiItem): Boolean {
        val normTipo = poi.tipoPoi.uppercase().trim()
        val sidc = poi.sidc.orEmpty().uppercase().trim()
        return normTipo == "MIL" ||
               normTipo.contains("BLANCO") ||
               normTipo == "TARGET" ||
               normTipo == "OBJETIVO" ||
               (sidc.isNotBlank() && (sidc.startsWith("S") || sidc.startsWith("A") || sidc.startsWith("U")))
    }

    private fun addPoiRow(list: LinearLayout, poi: PoiItem) {
        val row = host.getLayoutInflater().inflate(R.layout.item_equipo, list, false)
        val isBlanco = isBlancoPoi(poi)
        val rowLabel = poi.nombre.ifBlank { if (isBlanco) "Blanco ${poi.idPoi}" else "Waypoint ${poi.idPoi}" }
        row.tag = rowLabel

        row.findViewById<TextView>(R.id.equipoIcon).text = if (isBlanco) "BLC" else "WPT"
        row.findViewById<TextView>(R.id.equipoNombre).text = rowLabel
        val detail = buildString {
            append("Lat: %.5f, Lng: %.5f".format(Locale.US, poi.lat, poi.lon))
            if (poi.creatorLabel.isNotBlank()) append(" · ${poi.creatorLabel}")
        }
        row.findViewById<TextView>(R.id.equipoDetalle).text = detail
        row.findViewById<TextView>(R.id.equipoTipo).text = poi.tipoPoi.ifBlank { if (isBlanco) "BLANCO" else "WAYPOINT" }.uppercase()

        val hasLocation = isValidLocation(poi.lat, poi.lon)
        if (hasLocation) {
            setSelectableForeground(row)
            row.setOnClickListener {
                host.selectPoiOnMap(poi.idPoi, poi.lat, poi.lon, rowLabel)
            }
        }

        applyResourceStyle(row, false, hasLocation)

        val deleteBtn = TextView(list.context).apply {
            text = " ✕ "
            setTextColor(Color.parseColor("#ef4444"))
            textSize = 16f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setPadding(dp(this, 10f), dp(this, 6f), dp(this, 6f), dp(this, 6f))
            setSelectableForeground(this)
            setOnClickListener {
                host.deletePoi(poi.idPoi, rowLabel)
            }
        }
        (row as? LinearLayout)?.addView(deleteBtn)

        list.addView(row)
    }

    private fun addSectionHeader(list: LinearLayout, textValue: String) {
        list.addView(TextView(list.context).apply {
            text = textValue.uppercase()
            setTextColor(Color.parseColor("#a0c4ff"))
            textSize = 12f
            setPadding(0, dp(list, 10f), 0, dp(list, 8f))
        })
    }

    private fun addEmptyState(list: LinearLayout, textValue: String) {
        list.addView(TextView(list.context).apply {
            text = textValue
            setTextColor(Color.parseColor("#64748b"))
            textSize = 12f
            setPadding(0, dp(list, 6f), 0, dp(list, 10f))
        })
    }

    private fun applyPersonalStyle(row: View, idPersonal: Int) {
        val selected = selectedPersonalId == idPersonal
        val highlighted = selected || currentUserId == idPersonal
        row.setBackgroundColor(Color.parseColor(if (highlighted) "#0d1f3c" else "#0d1526"))
        row.findViewById<TextView>(R.id.personalNombre).setTextColor(
            Color.parseColor(if (highlighted) "#3b82f6" else "#e2e8f0")
        )
        row.findViewById<TextView>(R.id.personalAvatar).setBackgroundColor(
            Color.parseColor(if (selected) "#2563eb" else "#1e3a5f")
        )
    }

    private fun applyResourceStyle(row: View, selected: Boolean, hasLocation: Boolean) {
        row.setBackgroundColor(Color.parseColor(if (selected) "#0d1f3c" else "#0d1526"))
        row.findViewById<TextView>(R.id.equipoNombre).setTextColor(
            Color.parseColor(if (selected) "#3b82f6" else "#e2e8f0")
        )
        row.findViewById<TextView>(R.id.equipoIcon).setBackgroundColor(
            Color.parseColor(if (selected) "#2563eb" else "#0f172a")
        )
        row.findViewById<TextView>(R.id.equipoTipo).setTextColor(
            Color.parseColor(if (hasLocation) "#22c55e" else "#64748b")
        )
    }

    private fun displayName(person: PersonalItem): String {
        val fullName = "${person.nombre} ${person.apellido}".trim()
        return fullName.ifBlank { person.apodo }.ifBlank { "Personal" }
    }

    private fun personalHierarchyKey(person: PersonalItem): String {
        val role = person.rol.trim().uppercase()
        val name = displayName(person).lowercase()
        if (role == "CUT") return "0|$name"

        val cetName = when {
            role == "CET" -> displayName(person)
            person.cetNombre.isNotBlank() -> person.cetNombre
            else -> "ZZZ Sin CET"
        }.trim().lowercase()
        val memberOrder = if (role == "CET") "0" else "1"
        val flotilla = person.cetFlotilla
            .ifBlank { person.grupoPadreNombre }
            .trim()
            .lowercase()
        val group = person.grupoNombre.trim().lowercase()

        return "1|$cetName|$memberOrder|$flotilla|$group|$name"
    }

    private fun vehicleLabel(vehicle: VehiculoItem): String = when {
        vehicle.codigoInterno.isNotBlank() && vehicle.alias.isNotBlank() -> "${vehicle.codigoInterno} - ${vehicle.alias}"
        vehicle.codigoInterno.isNotBlank() -> vehicle.codigoInterno
        vehicle.alias.isNotBlank() -> vehicle.alias
        vehicle.nombre.isNotBlank() -> vehicle.nombre
        else -> "Vehiculo"
    }

    private fun vehicleDetail(vehicle: VehiculoItem): String = when {
        vehicle.asignadoAApodo.isNotBlank() -> "Asignado a ${vehicle.asignadoAApodo}"
        vehicle.grupoNombre.isNotBlank() -> "Grupo ${vehicle.grupoNombre}"
        vehicle.grupoPadreNombre.isNotBlank() -> "Flotilla ${vehicle.grupoPadreNombre}"
        vehicle.detalle.isNotBlank() -> vehicle.detalle
        else -> "Sin asignacion visible"
    }

    private fun equipmentDetail(item: EquipoItem): String = buildString {
        append(item.numeroSerie.ifBlank { "Sin numero" })
        val destino = when {
            item.vehiculoAsignado.isNotBlank() -> item.vehiculoAsignado
            item.personalAsignado.isNotBlank() -> item.personalAsignado
            item.grupoAsignado.isNotBlank() -> item.grupoAsignado
            item.flotillaAsignada.isNotBlank() -> item.flotillaAsignada
            item.asignadoA.isNotBlank() -> item.asignadoA
            else -> ""
        }
        if (destino.isNotBlank()) append(" - $destino")
    }

    private fun deviceLabel(item: DispositivoItem): String =
        listOf(item.tipo, item.marca, item.modelo)
            .filter { it.isNotBlank() }
            .joinToString(" ")
            .ifBlank { "Dispositivo ${item.idDispositivo}" }

    private fun deviceIconText(item: DispositivoItem): String {
        val tipo = item.tipo.uppercase()
        return when {
            tipo.contains("TABLET") -> "TAB"
            tipo.contains("WATCH") || tipo.contains("RELOJ") -> "WCH"
            tipo.contains("LORA") -> "LOR"
            tipo.contains("RADIO") -> "RAD"
            tipo.contains("CAM") -> "CAM"
            else -> "DEV"
        }
    }

    private fun deviceDetail(item: DispositivoItem): String = buildString {
        val serial = item.numeroSerie.ifBlank { item.imei }
        if (serial.isNotBlank()) append("Serie: $serial")
        val fullName = listOf(item.personalNombre, item.personalApellido).filter { it.isNotBlank() }.joinToString(" ")
        val responsible = fullName.ifBlank { item.personalApodo }
        if (responsible.isNotBlank()) {
            if (isNotEmpty()) append(" - ")
            append("Custodio: $responsible")
        }
        if (item.bateriaPct != null) {
            if (isNotEmpty()) append(" - ")
            append("Bateria: ${item.bateriaPct.toInt()}%")
        }
        if (isEmpty()) append("Sin detalle")
    }

    private fun hasVehiculoLocation(id: Int): Boolean = liveVehiculoLocations[id] != null
    private fun hasEquipoLocation(id: Int): Boolean = liveEquipoLocations[id] != null
    private fun hasDispositivoLocation(id: Int): Boolean = liveDispositivoLocations[id] != null

    private fun setSelectableForeground(row: View) {
        if (row.foreground == null) {
            row.foreground = row.context.obtainStyledAttributes(
                intArrayOf(android.R.attr.selectableItemBackground)
            ).getDrawable(0)
        }
    }

    private fun isValidLocation(lat: Double, lon: Double): Boolean =
        !lat.isNaN() &&
            !lon.isNaN() &&
            !lat.isInfinite() &&
            !lon.isInfinite() &&
            lat in -90.0..90.0 &&
            lon in -180.0..180.0 &&
            !(lat == 0.0 && lon == 0.0)

    private fun dp(view: View, value: Float): Int =
        (value * view.context.resources.displayMetrics.density + 0.5f).toInt()
}
