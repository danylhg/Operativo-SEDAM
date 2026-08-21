package com.operaciones.operaciones_android.ui.panel

import android.graphics.Color
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import com.operaciones.operaciones_android.R
import com.operaciones.operaciones_android.model.PersonalItem
import com.operaciones.operaciones_android.model.User

internal class PersonalPanelRenderer(
    private val host: MainPanelRenderer.Host
) {
    private data class CellNode(
        val item: PersonalItem,
        val flotilla: String,
        val grupo: String
    )

    private val liveLocations = mutableMapOf<Int, Pair<Double, Double>>()
    private val locatedPersonalIds = mutableSetOf<Int>()
    private val activeRows = mutableMapOf<Int, View>()
    private var currentUserId: Int? = null
    private var selectedPersonalId: Int? = null

    fun selectPersonal(idPersonal: Int?) {
        selectedPersonalId = idPersonal
        activeRows.forEach { (id, row) -> applyPersonalRowStyle(row, id) }
    }

    fun updatePersonalLocation(id: Int, lat: Double, lon: Double) {
        liveLocations[id] = lat to lon
        locatedPersonalIds.add(id)
        val row = activeRows[id]
        if (row == null) {
            host.refreshPersonalPanelIfActive()
            return
        }

        row.findViewById<View>(R.id.personalStatus).setBackgroundColor(Color.parseColor("#22c55e"))
        if (row.foreground == null) {
            row.foreground = row.context.obtainStyledAttributes(
                intArrayOf(android.R.attr.selectableItemBackground)
            ).getDrawable(0)
        }

        val label = row.findViewById<TextView>(R.id.personalNombre).text.toString()
        row.setOnClickListener {
            selectPersonal(id)
            host.selectPersonalOnMap(id, lat, lon, label)
        }
        applyPersonalRowStyle(row, id)
    }

    fun inflate(
        panelContent: FrameLayout,
        personalList: List<PersonalItem>,
        currentUser: User
    ) {
        val view = host.getLayoutInflater().inflate(R.layout.panel_personal, panelContent, false)
        panelContent.addView(view)

        val list = view.findViewById<LinearLayout>(R.id.personalList)
        currentUserId = currentUser.id
        activeRows.clear()
        locatedPersonalIds.clear()

        if (personalList.isEmpty()) {
            addEmptyState(list, "Cargando personal...")
            return
        }

        renderCuts(list, personalList)
        renderCetsAndCells(list, personalList)
    }

    private fun renderCuts(list: LinearLayout, personalList: List<PersonalItem>) {
        personalList
            .filter { it.rol.equals("CUT", ignoreCase = true) }
            .sortedBy { displayName(it) }
            .forEach { cut ->
                addSectionHeader(list, "CUT")
                addPersonRow(list, cut)
            }
    }

    private fun renderCetsAndCells(list: LinearLayout, personalList: List<PersonalItem>) {
        val cets = personalList
            .filter { it.rol.equals("CET", ignoreCase = true) }
            .sortedBy { displayName(it) }

        val cellsByCet = personalList
            .filter { it.rol.equals("CELL", ignoreCase = true) }
            .groupBy { normalize(it.cetNombre) }

        cets.forEach { cet ->
            val cetName = displayName(cet)
            val cetFullName = "${cet.nombre} ${cet.apellido}".trim()
            val cetFlotilla = flotillaNombre(cet)
            val cetCells = cellsForCet(cellsByCet, cetFullName, cetName, cetFlotilla)

            addSectionHeader(list, "CET")
            addPersonRow(list, cet)
            addSectionHeader(list, prefixed("Flotilla", cetFlotilla))

            cetCells
                .filter { it.grupo.isBlank() }
                .sortedBy { displayName(it.item) }
                .forEach { addPersonRow(list, it.item) }

            cetCells
                .filter { it.grupo.isNotBlank() }
                .groupBy { it.grupo }
                .toSortedMap(String.CASE_INSENSITIVE_ORDER)
                .forEach { (grupo, integrantes) ->
                    addSectionHeader(list, prefixed("Grupo", grupo))
                    integrantes
                        .sortedBy { displayName(it.item) }
                        .forEach { addPersonRow(list, it.item) }
                }
        }
    }

    private fun cellsForCet(
        cellsByCet: Map<String, List<PersonalItem>>,
        cetFullName: String,
        cetName: String,
        cetFlotilla: String
    ): List<CellNode> =
        (cellsByCet[normalize(cetFullName)] ?: cellsByCet[normalize(cetName)] ?: emptyList())
            .map { cell ->
                val padre = cell.grupoPadreNombre.trim()
                val grupo = cell.grupoNombre.trim()
                val isSubgrupo = padre.isNotBlank() &&
                    !padre.equals("Mando Operativo", ignoreCase = true)

                CellNode(
                    item = cell,
                    flotilla = when {
                        cell.cetFlotilla.isNotBlank() -> cell.cetFlotilla.trim()
                        isSubgrupo -> padre
                        else -> cetFlotilla
                    },
                    grupo = if (isSubgrupo) grupo else ""
                )
            }
            .filter { normalize(it.flotilla) == normalize(cetFlotilla) }

    private fun addPersonRow(list: LinearLayout, person: PersonalItem) {
        val row = host.getLayoutInflater().inflate(R.layout.item_personal, list, false)
        val fullName = "${person.nombre} ${person.apellido}".trim()
        val rowLabel = fullName.ifBlank { person.apodo }

        row.findViewById<TextView>(R.id.personalAvatar).text =
            person.nombre.firstOrNull()?.toString() ?: "?"
        row.findViewById<TextView>(R.id.personalNombre).text = rowLabel
        row.findViewById<TextView>(R.id.personalRol).text = buildString {
            if (person.rol.isNotBlank()) append(person.rol)
            if (person.puesto.isNotBlank()) append(" - ${person.puesto}")
        }

        val live = liveLocations[person.idPersonal]
        val effectiveLat = live?.first ?: person.lat
        val effectiveLon = live?.second ?: person.lon
        val hasLocation = effectiveLat != null && effectiveLon != null
        if (hasLocation) locatedPersonalIds.add(person.idPersonal)

        row.findViewById<View>(R.id.personalStatus).setBackgroundColor(
            Color.parseColor(if (hasLocation) "#22c55e" else "#475569")
        )

        if (effectiveLat != null && effectiveLon != null) {
            row.foreground = row.context.obtainStyledAttributes(
                intArrayOf(android.R.attr.selectableItemBackground)
            ).getDrawable(0)
            row.setOnClickListener {
                selectPersonal(person.idPersonal)
                host.selectPersonalOnMap(person.idPersonal, effectiveLat, effectiveLon, rowLabel)
            }
        }

        activeRows[person.idPersonal] = row
        applyPersonalRowStyle(row, person.idPersonal)
        list.addView(row)
    }

    private fun addSectionHeader(list: LinearLayout, text: String) {
        val header = TextView(list.context).apply {
            this.text = text.uppercase()
            setTextColor(Color.parseColor("#94a3b8"))
            textSize = 11f
            setPadding(0, 20, 0, 10)
            letterSpacing = 0.08f
        }
        list.addView(header)
    }

    private fun addEmptyState(list: LinearLayout, textValue: String) {
        list.addView(TextView(list.context).apply {
            text = textValue
            setTextColor(Color.parseColor("#64748b"))
            textSize = 12f
            setPadding(0, 16, 0, 0)
        })
    }

    private fun applyPersonalRowStyle(row: View, idPersonal: Int) {
        val selected = selectedPersonalId == idPersonal
        val isCurrentUser = currentUserId == idPersonal
        val hasLocation = locatedPersonalIds.contains(idPersonal)
        val highlighted = hasLocation && (selected || isCurrentUser)

        row.setBackgroundColor(Color.parseColor(if (highlighted) "#0d1f3c" else "#0d1526"))
        row.findViewById<TextView>(R.id.personalNombre).setTextColor(
            Color.parseColor(if (highlighted) "#3b82f6" else "#e2e8f0")
        )
        row.findViewById<TextView>(R.id.personalAvatar).setBackgroundColor(
            Color.parseColor(if (selected) "#2563eb" else "#1e3a5f")
        )
    }

    private fun displayName(person: PersonalItem): String {
        val fullName = "${person.nombre} ${person.apellido}".trim()
        return fullName.ifBlank { person.apodo }
    }

    private fun normalize(value: String): String = value.trim().lowercase()

    private fun flotillaNombre(person: PersonalItem): String {
        val padre = person.grupoPadreNombre.trim()
        val grupo = person.grupoNombre.trim()
        return when {
            person.cetFlotilla.isNotBlank() -> person.cetFlotilla.trim()
            padre.isNotBlank() && !padre.equals("Mando Operativo", ignoreCase = true) -> padre
            grupo.isNotBlank() -> grupo
            else -> "Sin flotilla"
        }
    }

    private fun prefixed(prefix: String, name: String): String {
        val clean = name.trim()
        return if (clean.lowercase().startsWith(prefix.lowercase())) clean else "$prefix $clean"
    }
}
