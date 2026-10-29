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

    private data class LivePersonalLocation(val lat: Double, val lon: Double, val receivedAt: Long)

    private val livePersonalLocations = mutableMapOf<Int, LivePersonalLocation>()
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
        val receivedAt = System.currentTimeMillis()
        livePersonalLocations[id] = LivePersonalLocation(lat, lon, receivedAt)
        personalRows[id]?.let { row ->
            row.findViewById<View>(R.id.personalStatus).setBackgroundColor(Color.parseColor("#22c55e"))
            setSelectableForeground(row)
            val label = row.findViewById<TextView>(R.id.personalNombre).text.toString()
            row.setOnClickListener {
                selectPersonal(id)
                host.selectPersonalOnMap(id, lat, lon, label)
            }
            applyPersonalStyle(row, id)
            row.postDelayed({
                val stillCurrent = livePersonalLocations[id]?.receivedAt == receivedAt
                if (stillCurrent && personalRows[id] === row) {
                    row.findViewById<View>(R.id.personalStatus)
                        .setBackgroundColor(Color.parseColor("#475569"))
                }
            }, ONLINE_STALE_MS)
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

        // Jalar hacia abajo para actualizar. Si el servidor no trae cambios la lista
        // no se vuelve a dibujar, así que el indicador se oculta solo.
        view.findViewById<androidx.swiperefreshlayout.widget.SwipeRefreshLayout>(R.id.resourcesRefresh)?.apply {
            setColorSchemeColors(Color.parseColor("#60A5FA"))
            setProgressBackgroundColorSchemeColor(Color.parseColor("#0d1526"))
            setOnRefreshListener {
                host.refreshResourcesData()
                postDelayed({ isRefreshing = false }, 1200)
            }
        }
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
                background = roundedBackground(this, if (active) "#223A5C" else "#00000000", 16f)
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
                addPersonalSectionHeader(list)
                if (personalList.isEmpty()) addEmptyState(list, "Cargando personal...")
                else personalList.sortedBy(::personalHierarchyKey).forEach { addPersonalRow(list, it) }
            }
            ResourceTab.VEHICULOS -> {
                addSectionHeader(list, "Vehiculos asignados")
                val vehicles = vehiculosList.groupBy { it.idVehiculo }.map { it.value.first() }.sortedBy { vehicleLabel(it) }
                if (vehicles.isEmpty()) addEmptyState(list, "Cargando vehiculos...")
                else vehicles.forEach { addVehicleRow(list, it, vehiculosList, personalList) }
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
                equiposList.filter { it.categoria.equals("TACTICO", ignoreCase = true) },
                personalList
            )
            ResourceTab.EQUIPO_COMUNICACION -> renderEquipmentGroup(
                list,
                "Equipo de comunicacion",
                equiposList.filter { it.categoria.equals("COMUNICACION", ignoreCase = true) },
                personalList
            )
            ResourceTab.DISPOSITIVOS -> {
                addSectionHeader(list, "Dispositivos asignados")
                if (dispositivosList.isEmpty()) addEmptyState(list, "Cargando dispositivos...")
                else dispositivosList.sortedWith(compareBy({ it.tipo }, { it.marca }, { it.modelo })).forEach { addDeviceRow(list, it, personalList) }
            }
        }
    }

    private fun renderEquipmentGroup(list: LinearLayout, title: String, items: List<EquipoItem>, personalList: List<PersonalItem>) {
        addSectionHeader(list, title)
        if (items.isEmpty()) addEmptyState(list, "Sin elementos en esta seccion")
        else items.sortedBy { it.nombre.ifBlank { it.numeroSerie } }.forEach { addEquipmentRow(list, it, personalList) }
    }

    private fun addPersonalRow(list: LinearLayout, person: PersonalItem) {
        val row = host.getLayoutInflater().inflate(R.layout.item_personal, list, false)
        val rowLabel = displayNameWithRank(person)

        row.findViewById<TextView>(R.id.personalAvatar).text = person.nombre.firstOrNull()?.toString() ?: "?"
        row.findViewById<TextView>(R.id.personalNombre).text = rowLabel
        row.findViewById<TextView>(R.id.personalRol).text = person.rol.ifBlank { "Personal" }

        val live = livePersonalLocations[person.idPersonal]
        val lat = live?.lat ?: person.lat
        val lon = live?.lon ?: person.lon
        val hasLocation = lat != null && lon != null
        val isOnline = live?.let { System.currentTimeMillis() - it.receivedAt <= ONLINE_STALE_MS } == true
        row.findViewById<View>(R.id.personalStatus).setBackgroundColor(
            Color.parseColor(if (isOnline) "#22c55e" else "#475569")
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

    /** Personas asignadas al vehículo como "Tte. Nombre Apellido" (todas las filas del vehículo). */
    private fun vehicleAssignedPeople(
        vehicle: VehiculoItem,
        vehiculosList: List<VehiculoItem>,
        personalList: List<PersonalItem>
    ): List<String> =
        vehiculosList.filter { it.idVehiculo == vehicle.idVehiculo }.mapNotNull { row ->
            val person = row.idPersonalAsignado?.let { id -> personalList.firstOrNull { it.idPersonal == id } }
            when {
                person != null -> displayNameWithRank(person)
                row.personalNombre.isNotBlank() || row.personalApellido.isNotBlank() -> {
                    val rank = abbreviateRank(row.personalPuesto)
                    listOf(rank, "${row.personalNombre} ${row.personalApellido}".trim())
                        .filter { it.isNotBlank() }.joinToString(" ")
                }
                row.asignadoAApodo.isNotBlank() -> row.asignadoAApodo
                else -> null
            }
        }.distinct()

    private fun addVehicleRow(
        list: LinearLayout,
        vehicle: VehiculoItem,
        vehiculosList: List<VehiculoItem>,
        personalList: List<PersonalItem>
    ) {
        val row = host.getLayoutInflater().inflate(R.layout.item_equipo, list, false)
        val rowLabel = vehicleLabel(vehicle)
        row.tag = rowLabel

        setCenteredIcon(row, R.drawable.ic_resource_vehicle)
        row.findViewById<TextView>(R.id.equipoNombre).text = rowLabel
        val detail = row.findViewById<TextView>(R.id.equipoDetalle)
        val people = vehicleAssignedPeople(vehicle, vehiculosList, personalList)
        if (people.isEmpty()) {
            detail.text = vehicleDetail(vehicle)
        } else {
            detail.text = "Asignado"
            detail.compoundDrawablePadding = dp(row, 4f)
            detail.setCompoundDrawablesRelativeWithIntrinsicBounds(0, 0, R.drawable.ic_chevron_down, 0)
            detail.setPadding(0, dp(row, 4f), dp(row, 12f), dp(row, 2f))

            // Lista desplegable con todas las personas del vehículo.
            val column = detail.parent as LinearLayout
            val peopleBox = LinearLayout(row.context).apply {
                orientation = LinearLayout.VERTICAL
                visibility = View.GONE
                setPadding(0, dp(row, 4f), 0, 0)
                people.forEach { name ->
                    addView(TextView(row.context).apply {
                        text = name
                        setTextColor(Color.parseColor("#C5D3E6"))
                        textSize = 12f
                        setPadding(0, dp(row, 3f), 0, dp(row, 3f))
                    })
                }
            }
            column.addView(peopleBox)
            detail.setOnClickListener {
                val expand = peopleBox.visibility != View.VISIBLE
                peopleBox.visibility = if (expand) View.VISIBLE else View.GONE
                detail.setCompoundDrawablesRelativeWithIntrinsicBounds(
                    0, 0, if (expand) R.drawable.ic_chevron_up else R.drawable.ic_chevron_down, 0
                )
            }
        }
        row.findViewById<TextView>(R.id.equipoTipo).text = vehicle.tipo.ifBlank { "VEHICULO" }.uppercase()

        val live = liveVehiculoLocations[vehicle.idVehiculo]
        val lat = live?.first ?: vehicle.lat
        val lon = live?.second ?: vehicle.lon
        val hasLocation = lat != null && lon != null && isValidLocation(lat, lon)
        // Tocar la tarjeta ya no abre el cuadro de información; el mapa se abre con el botón.
        addMapButton(row) {
            selectVehiculo(vehicle.idVehiculo)
            host.focusVehiculoOnMap(vehicle.idVehiculo, lat, lon, rowLabel)
        }

        vehiculoRows[vehicle.idVehiculo] = row
        applyResourceStyle(row, vehicle.idVehiculo == selectedVehiculoId, hasLocation)
        list.addView(row)
    }

    /** Icono centrado en el recuadro de la tarjeta (un drawable del TextView quedaba pegado arriba). */
    private fun setCenteredIcon(row: View, iconRes: Int) {
        row.findViewById<TextView>(R.id.equipoIcon).apply {
            text = ""
            androidx.core.content.ContextCompat.getDrawable(context, iconRes)?.let { icon ->
                foreground = android.graphics.drawable.LayerDrawable(arrayOf(icon)).apply {
                    setLayerSize(0, dp(row, 22f), dp(row, 22f))
                    setLayerGravity(0, android.view.Gravity.CENTER)
                }
            }
        }
    }

    /** Pone bajo el tipo/estado de la tarjeta un botón "Ver en mapa" con icono de ubicación. */
    private fun addMapButton(row: View, onClick: () -> Unit) {
        val typeLabel = row.findViewById<TextView>(R.id.equipoTipo)
        val rightColumn = LinearLayout(row.context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = android.view.Gravity.END
        }
        (typeLabel.parent as LinearLayout).let { parent ->
            parent.removeView(typeLabel)
            parent.addView(rightColumn)
        }
        rightColumn.addView(typeLabel)
        rightColumn.addView(TextView(row.context).apply {
            text = "Ver en mapa"
            setTextColor(Color.parseColor("#69B4FF"))
            textSize = 11f
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            gravity = android.view.Gravity.CENTER
            compoundDrawablePadding = dp(row, 4f)
            androidx.core.content.ContextCompat.getDrawable(row.context, R.drawable.ic_attach_location)?.mutate()?.let {
                it.setTint(Color.parseColor("#69B4FF"))
                it.setBounds(0, 0, dp(row, 13f), dp(row, 13f))
                setCompoundDrawablesRelative(it, null, null, null)
            }
            setPadding(dp(row, 10f), dp(row, 5f), dp(row, 10f), dp(row, 5f))
            background = android.graphics.drawable.GradientDrawable().apply {
                cornerRadius = dp(row, 14f).toFloat()
                setColor(Color.parseColor("#152A43"))
                setStroke(dp(row, 1f), Color.parseColor("#2F5D8C"))
            }
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(row, 6f) }
            setOnClickListener { onClick() }
        })
    }

    /** "Tte. Nombre Apellido" a partir del id (si está en la lista) o de los textos disponibles. */
    private fun assignedPersonLabel(
        idPersonal: Int?,
        fallbackName: String,
        fallbackRank: String,
        personalList: List<PersonalItem>
    ): String {
        val person = idPersonal?.let { id -> personalList.firstOrNull { it.idPersonal == id } }
        if (person != null) return displayNameWithRank(person)
        val rank = abbreviateRank(fallbackRank)
        return listOf(rank, fallbackName.trim()).filter { it.isNotBlank() }.joinToString(" ")
    }

    private fun addEquipmentRow(list: LinearLayout, item: EquipoItem, personalList: List<PersonalItem>) {
        val row = host.getLayoutInflater().inflate(R.layout.item_equipo, list, false)
        val rowLabel = item.nombre.ifBlank { "E-${item.idEquipo}" }
        row.tag = rowLabel

        val isComm = item.categoria.equals("COMUNICACION", ignoreCase = true)
        setCenteredIcon(row, if (isComm) R.drawable.ic_resource_comm else R.drawable.ic_resource_tactical)
        row.findViewById<TextView>(R.id.equipoNombre).text = rowLabel
        row.findViewById<TextView>(R.id.equipoDetalle).text = equipmentDetail(item, personalList)
        row.findViewById<TextView>(R.id.equipoTipo).text = item.categoria.ifBlank { "EQUIPO" }.uppercase()

        val live = liveEquipoLocations[item.idEquipo]
        val lat = live?.first ?: item.lat
        val lon = live?.second ?: item.lon
        val hasLocation = lat != null && lon != null && isValidLocation(lat, lon)
        addMapButton(row) {
            selectEquipo(item.idEquipo)
            host.focusEquipoOnMap(item.idEquipo, lat, lon, rowLabel)
        }

        equipoRows[item.idEquipo] = row
        applyResourceStyle(row, item.idEquipo == selectedEquipoId, hasLocation)
        list.addView(row)
    }

    private fun addDeviceRow(list: LinearLayout, item: DispositivoItem, personalList: List<PersonalItem>) {
        val row = host.getLayoutInflater().inflate(R.layout.item_equipo, list, false)
        val rowLabel = deviceLabel(item)
        row.tag = rowLabel

        setCenteredIcon(row, deviceIconRes(item))
        row.findViewById<TextView>(R.id.equipoNombre).text = rowLabel
        val detail = row.findViewById<TextView>(R.id.equipoDetalle)
        val responsible = assignedPersonLabel(
            item.idPersonal,
            listOf(item.personalNombre, item.personalApellido).filter { it.isNotBlank() }
                .joinToString(" ").ifBlank { item.personalApodo },
            item.personalPuesto,
            personalList
        )
        detail.text = if (responsible.isNotBlank()) "Asignado: $responsible" else "Sin asignar"
        // Segunda línea con la batería.
        item.bateriaPct?.let { battery ->
            val pct = battery.toInt()
            (detail.parent as LinearLayout).addView(TextView(row.context).apply {
                text = "Batería: $pct%"
                textSize = 11f
                setTextColor(
                    Color.parseColor(
                        when {
                            pct >= 50 -> "#22c55e"
                            pct >= 20 -> "#f59e0b"
                            else -> "#ef4444"
                        }
                    )
                )
                setPadding(0, dp(row, 2f), 0, 0)
            })
        }
        row.findViewById<TextView>(R.id.equipoTipo).text = item.estado.ifBlank { "DISP" }.uppercase()

        val live = liveDispositivoLocations[item.idDispositivo]
        val lat = live?.first ?: item.lat
        val lon = live?.second ?: item.lon
        val hasLocation = lat != null && lon != null && isValidLocation(lat, lon)
        addMapButton(row) {
            selectDispositivo(item.idDispositivo)
            host.focusDispositivoOnMap(item.idDispositivo, lat, lon, rowLabel)
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

        val iconView = row.findViewById<TextView>(R.id.equipoIcon).apply {
            text = if (isBlanco) "BLC" else "WPT"
            textSize = 11f
            maxLines = 1
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        }
        addPoiSymbol(row, iconView, poi.sidc)
        val nameView = row.findViewById<TextView>(R.id.equipoNombre).apply {
            text = rowLabel
            textSize = 15f
            setTextColor(Color.parseColor("#60A5FA"))
        }
        row.findViewById<TextView>(R.id.equipoTipo).visibility = View.GONE

        val textColumn = nameView.parent as LinearLayout
        val ctx = textColumn.context

        // Quien creó el punto, debajo del nombre; se quita el número final (p. ej. "Campos 2").
        val creator = poi.creatorLabel.replace(Regex("""\s+\d+$"""), "").trim()
        if (creator.isNotBlank()) {
            textColumn.addView(TextView(ctx).apply {
                text = creator
                setTextColor(Color.parseColor("#94a3b8"))
                textSize = 11f
                maxLines = 1
                ellipsize = android.text.TextUtils.TruncateAt.END
            }, 1)
        }

        // Coordenadas con pin a la izquierda y un botón pequeño de copiar junto a ellas.
        val coords = "%.5f, %.5f".format(Locale.US, poi.lat, poi.lon)
        val detailView = row.findViewById<TextView>(R.id.equipoDetalle)
        textColumn.removeView(detailView)
        detailView.text = coords
        detailView.setPadding(dp(detailView, 4f), 0, 0, 0)
        textColumn.addView(LinearLayout(ctx).apply {
            gravity = android.view.Gravity.CENTER_VERTICAL
            setPadding(0, dp(this, 2f), 0, 0)
            addView(android.widget.ImageView(ctx).apply {
                setImageResource(R.drawable.ic_location_pin_alert)
                setColorFilter(Color.parseColor("#64748b"))
            }, LinearLayout.LayoutParams(dp(this, 14f), dp(this, 14f)))
            addView(detailView, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ))
            addView(android.widget.ImageView(ctx).apply {
                setImageResource(R.drawable.ic_copy_coordinates)
                setPadding(dp(this, 8f), dp(this, 6f), dp(this, 8f), dp(this, 6f))
                setOnClickListener {
                    val clipboard = ctx.getSystemService(android.content.Context.CLIPBOARD_SERVICE)
                        as android.content.ClipboardManager
                    clipboard.setPrimaryClip(android.content.ClipData.newPlainText("Coordenadas", coords))
                    android.widget.Toast.makeText(ctx, "Coordenadas copiadas", android.widget.Toast.LENGTH_SHORT).show()
                }
            }, LinearLayout.LayoutParams(dp(this, 30f), dp(this, 28f)))
        })

        val hasLocation = isValidLocation(poi.lat, poi.lon)
        if (hasLocation) {
            setSelectableForeground(row)
            row.setOnClickListener {
                host.selectPoiOnMap(poi.idPoi, poi.lat, poi.lon, rowLabel)
            }
        }

        applyResourceStyle(row, false, hasLocation)
        nameView.setTextColor(Color.parseColor("#60A5FA"))

        // Capa roja "Eliminando" que queda detrás de la fila y se revela al deslizar.
        val deleteLabel = TextView(ctx).apply {
            text = "Eliminando"
            setTextColor(Color.WHITE)
            textSize = 13f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            gravity = android.view.Gravity.CENTER_VERTICAL or android.view.Gravity.END
            setPadding(0, 0, dp(this, 22f), 0)
            background = roundedBackground(this, "#DC2626", 14f)
            alpha = 0f
        }
        val wrapper = FrameLayout(ctx)
        wrapper.layoutParams = row.layoutParams
        row.layoutParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT
        )
        wrapper.addView(deleteLabel, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT
        ))
        wrapper.addView(row)

        enableSwipeToDelete(row, onProgress = { deleteLabel.alpha = it }) {
            host.deletePoi(poi.idPoi, rowLabel)
        }

        list.addView(wrapper)
    }

    /**
     * Dibuja la figura MIL-STD-2525C del punto (milsymbol) sobre el recuadro del icono.
     * Si no hay SIDC se conserva el texto WPT/BLC. El WebView no recibe toques para no
     * interferir con el clic ni con el deslizamiento de la fila.
     */
    @android.annotation.SuppressLint("SetJavaScriptEnabled")
    private fun addPoiSymbol(row: View, iconView: TextView, sidc: String?) {
        val safeSidc = sidc.orEmpty().trim().filter { it.isLetterOrDigit() || it == '*' || it == '-' }
        val parent = iconView.parent as? LinearLayout ?: return
        if (safeSidc.length < 10) return

        val ctx = iconView.context
        val web = object : android.webkit.WebView(ctx) {
            override fun dispatchTouchEvent(event: android.view.MotionEvent) = false
        }.apply {
            setBackgroundColor(Color.TRANSPARENT)
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER
            isClickable = false
            isFocusable = false
            settings.javaScriptEnabled = true
            loadDataWithBaseURL(
                "file:///android_asset/",
                """
                <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
                <script src="milsymbol.min.js"></script><style>html,body,#s{width:100%;height:100%;margin:0;background:transparent;overflow:hidden}#s{display:flex;align-items:center;justify-content:center}svg{max-width:34px;max-height:34px}</style>
                </head><body><div id="s"></div><script>
                try{var sidc='$safeSidc';var colors={F:'#F7FAFF',H:'#FF3347',N:'#00F53D',U:'#FFF000'};var wp=sidc.charAt(0)==='G';var o=wp?{size:46,monoColor:colors[sidc.charAt(1)]||'#FFF000',fill:false}:{size:46,colorMode:'Light',fill:true};document.getElementById('s').innerHTML=new ms.Symbol(sidc,o).asSVG()||'';}catch(x){}
                </script></body></html>
                """.trimIndent(),
                "text/html",
                "UTF-8",
                null
            )
        }

        val index = parent.indexOfChild(iconView)
        parent.removeView(iconView)
        iconView.text = ""
        parent.addView(FrameLayout(ctx).apply {
            addView(iconView, FrameLayout.LayoutParams(dp(this, 40f), dp(this, 40f)))
            addView(web, FrameLayout.LayoutParams(dp(this, 40f), dp(this, 40f)))
        }, index, LinearLayout.LayoutParams(dp(parent, 40f), dp(parent, 40f)))
    }

    /** Deslizar la fila a la izquierda dispara [onDelete]; la fila siempre vuelve a su lugar. */
    @android.annotation.SuppressLint("ClickableViewAccessibility")
    private fun enableSwipeToDelete(row: View, onProgress: (Float) -> Unit = {}, onDelete: () -> Unit) {
        val touchSlop = android.view.ViewConfiguration.get(row.context).scaledTouchSlop
        var downX = 0f
        var downY = 0f
        var swiping = false

        row.setOnTouchListener { v, event ->
            when (event.actionMasked) {
                android.view.MotionEvent.ACTION_DOWN -> {
                    downX = event.rawX
                    downY = event.rawY
                    swiping = false
                    // Evita que el ScrollView / jalar-para-actualizar se queden el gesto
                    // por un pequeño movimiento vertical antes de decidir la dirección.
                    v.parent?.requestDisallowInterceptTouchEvent(true)
                    false
                }
                android.view.MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - downX
                    val dy = event.rawY - downY
                    if (!swiping) {
                        if (Math.abs(dy) > touchSlop && Math.abs(dy) > Math.abs(dx)) {
                            // Movimiento vertical: devuelve el gesto para desplazar la lista.
                            v.parent?.requestDisallowInterceptTouchEvent(false)
                        } else if (dx < -touchSlop && Math.abs(dx) > Math.abs(dy)) {
                            swiping = true
                            v.cancelPendingInputEvents()
                        }
                    }
                    if (swiping) {
                        v.translationX = dx.coerceAtMost(0f)
                        onProgress((-v.translationX / (v.width * 0.35f)).coerceIn(0f, 1f))
                    }
                    swiping
                }
                android.view.MotionEvent.ACTION_UP, android.view.MotionEvent.ACTION_CANCEL -> {
                    if (!swiping) return@setOnTouchListener false
                    val shouldDelete = event.actionMasked == android.view.MotionEvent.ACTION_UP &&
                        v.translationX < -v.width * 0.35f
                    swiping = false
                    v.animate().translationX(0f).setDuration(180)
                        .setUpdateListener { onProgress((-v.translationX / (v.width * 0.35f)).coerceIn(0f, 1f)) }
                        .start()
                    if (shouldDelete) onDelete()
                    true
                }
                else -> false
            }
        }
    }

    private fun addSectionHeader(list: LinearLayout, textValue: String) {
        list.addView(TextView(list.context).apply {
            text = textValue.uppercase()
            setTextColor(Color.parseColor("#a0c4ff"))
            textSize = 12f
            setPadding(0, dp(list, 10f), 0, dp(list, 8f))
        })
    }

    private fun addPersonalSectionHeader(list: LinearLayout) {
        list.addView(LinearLayout(list.context).apply {
            gravity = android.view.Gravity.CENTER_VERTICAL
            setPadding(0, dp(list, 10f), 0, dp(list, 8f))

            addView(TextView(context).apply {
                text = "PERSONAL ASIGNADO"
                setTextColor(Color.parseColor("#a0c4ff"))
                textSize = 12f
            }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            addView(TextView(context).apply {
                text = "●"
                setTextColor(Color.parseColor("#22c55e"))
                textSize = 13f
            })
            addView(TextView(context).apply {
                text = " EN LÍNEA"
                setTextColor(Color.parseColor("#94a3b8"))
                textSize = 10f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
            })
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
        row.background = roundedBackground(row, if (highlighted) "#0d1f3c" else "#0d1526", 14f)
        row.findViewById<TextView>(R.id.personalNombre).setTextColor(
            Color.parseColor(if (highlighted) "#3b82f6" else "#e2e8f0")
        )
        row.findViewById<TextView>(R.id.personalAvatar).background = roundedBackground(
            row, if (selected) "#2563eb" else "#1e3a5f", 10f
        )
    }

    private fun applyResourceStyle(row: View, selected: Boolean, hasLocation: Boolean) {
        row.background = roundedBackground(row, if (selected) "#0d1f3c" else "#0d1526", 14f)
        row.findViewById<TextView>(R.id.equipoNombre).setTextColor(
            Color.parseColor(if (selected) "#3b82f6" else "#e2e8f0")
        )
        row.findViewById<TextView>(R.id.equipoIcon).background = roundedBackground(
            row, if (selected) "#2563eb" else "#0f172a", 10f
        )
        row.findViewById<TextView>(R.id.equipoTipo).setTextColor(
            Color.parseColor(if (hasLocation) "#22c55e" else "#64748b")
        )
    }

    private fun displayName(person: PersonalItem): String {
        val fullName = "${person.nombre} ${person.apellido}".trim()
        return fullName.ifBlank { person.apodo }.ifBlank { "Personal" }
    }

    private fun displayNameWithRank(person: PersonalItem): String {
        val rank = abbreviateRank(person.puesto).ifBlank {
            person.puesto.trim().ifBlank { person.rol.trim() }
        }
        return listOf(rank, displayName(person)).filter { it.isNotBlank() }.joinToString(" ")
    }

    private fun abbreviateRank(value: String): String {
        val rank = value.trim().lowercase()
        return when {
            rank.contains("capitán de navío") || rank.contains("capitan de navio") -> "Cap. Nav."
            rank.contains("capitán de fragata") || rank.contains("capitan de fragata") -> "Cap. Frag."
            rank.contains("capitán de corbeta") || rank.contains("capitan de corbeta") -> "Cap. Corb."
            rank.contains("capitán 1/o") || rank.contains("capitan 1/o") || rank.contains("capitán primero") -> "Cap. 1/o"
            rank.contains("capitán 2/o") || rank.contains("capitan 2/o") || rank.contains("capitán segundo") -> "Cap. 2/o"
            rank.contains("capitán") || rank.contains("capitan") || rank == "cap" || rank == "cap." -> "Cap."
            rank.contains("teniente de navío") || rank.contains("teniente de navio") -> "Tte. Nav."
            rank.contains("teniente de fragata") -> "Tte. Frag."
            rank.contains("teniente de corbeta") -> "Tte. Corb."
            rank.contains("teniente coronel") -> "Tte. Cnel."
            rank.contains("primer teniente") || rank.contains("1er teniente") -> "1er. Tte."
            rank.contains("segundo teniente") || rank.contains("2do teniente") -> "2do. Tte."
            rank.contains("subteniente") || rank == "subtte" || rank == "subtte." -> "Subtte."
            rank.contains("teniente") || rank == "tte" || rank == "tte." -> "Tte."
            rank.contains("sargento 1/o") || rank.contains("sargento primero") -> "Sgto. 1/o"
            rank.contains("sargento 2/o") || rank.contains("sargento segundo") -> "Sgto. 2/o"
            rank.contains("sargento") || rank == "sgto" || rank == "sgto." -> "Sgto."
            rank.contains("cabo") || rank == "cbo" || rank == "cbo." -> "Cbo."
            rank.contains("marinero") || rank == "mro" || rank == "mro." -> "Mro."
            rank.contains("soldado") || rank == "sld" || rank == "sld." -> "Sld."
            rank.contains("general de división") || rank.contains("general de division") -> "Gral. Div."
            rank.contains("general de brigada") -> "Gral. Brig."
            rank.contains("general brigadier") -> "Gral. Bgda."
            rank.contains("general") || rank == "gral" || rank == "gral." -> "Gral."
            rank.contains("vicealmirante") || rank == "valm" || rank == "valm." -> "Valm."
            rank.contains("contralmirante") || rank == "calm" || rank == "calm." -> "Calm."
            rank.contains("almirante") || rank == "alm" || rank == "alm." -> "Alm."
            rank.contains("coronel") || rank == "cnel" || rank == "cnel." -> "Cnel."
            rank.contains("mayor") || rank == "my" || rank == "my." -> "My."
            else -> ""
        }
    }

    private fun roundedBackground(view: View, color: String, radiusDp: Float) =
        android.graphics.drawable.GradientDrawable().apply {
            cornerRadius = dp(view, radiusDp).toFloat()
            setColor(Color.parseColor(color))
        }

    private companion object {
        const val ONLINE_STALE_MS = 30_000L
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

    /** "Asignado: …" con el cargo y nombre si es una persona; sin número de serie. */
    private fun equipmentDetail(item: EquipoItem, personalList: List<PersonalItem>): String {
        val destino = when {
            item.vehiculoAsignado.isNotBlank() -> item.vehiculoAsignado
            item.personalAsignado.isNotBlank() || item.idPersonalAsignado != null ->
                assignedPersonLabel(item.idPersonalAsignado, item.personalAsignado, "", personalList)
            item.grupoAsignado.isNotBlank() -> item.grupoAsignado
            item.flotillaAsignada.isNotBlank() -> item.flotillaAsignada
            item.asignadoA.isNotBlank() -> item.asignadoA
            else -> ""
        }
        return if (destino.isNotBlank()) "Asignado: $destino" else "Sin asignar"
    }

    private fun deviceLabel(item: DispositivoItem): String =
        listOf(item.tipo, item.marca, item.modelo)
            .filter { it.isNotBlank() }
            .joinToString(" ")
            .ifBlank { "Dispositivo ${item.idDispositivo}" }

    private fun deviceIconRes(item: DispositivoItem): Int {
        val tipo = item.tipo.uppercase()
        return when {
            tipo.contains("TABLET") -> R.drawable.ic_resource_tablet
            tipo.contains("WATCH") || tipo.contains("RELOJ") -> R.drawable.ic_resource_watch
            tipo.contains("LORA") || tipo.contains("RADIO") -> R.drawable.ic_resource_antenna
            tipo.contains("CAM") -> R.drawable.ic_resource_camera
            else -> R.drawable.ic_resource_phone
        }
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
