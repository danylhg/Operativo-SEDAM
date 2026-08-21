package com.operaciones.operaciones_android.ui.panel

import android.graphics.Color
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import com.operaciones.operaciones_android.R
import com.operaciones.operaciones_android.model.EquipoItem

internal class EquipmentPanelRenderer(
    private val host: MainPanelRenderer.Host
) {
    private val liveLocations = mutableMapOf<Int, Pair<Double, Double>>()
    private val locatedEquipoIds = mutableSetOf<Int>()
    private val activeRows = mutableMapOf<Int, View>()
    private var selectedEquipoId: Int? = null

    fun selectEquipo(idEquipo: Int?) {
        selectedEquipoId = idEquipo
        activeRows.forEach { (id, row) -> applyEquipmentRowStyle(row, id) }
    }

    fun updateEquipoLocation(id: Int, lat: Double, lon: Double) {
        if (!isValidLocation(lat, lon)) return
        liveLocations[id] = lat to lon
        locatedEquipoIds.add(id)
        val row = activeRows[id] ?: return
        val label = row.tag as? String
            ?: row.findViewById<TextView>(R.id.equipoNombre).text.toString()
        setSelectableForeground(row)
        row.isClickable = true
        row.setOnClickListener {
            selectEquipo(id)
            host.selectEquipoOnMap(id, lat, lon, label)
        }
        applyEquipmentRowStyle(row, id)
    }

    fun inflate(panelContent: FrameLayout, equiposList: List<EquipoItem>) {
        val view = host.getLayoutInflater().inflate(R.layout.panel_equipo, panelContent, false)
        panelContent.addView(view)

        val list = view.findViewById<LinearLayout>(R.id.equipoList)
        activeRows.clear()
        locatedEquipoIds.clear()
        if (equiposList.isEmpty()) {
            addEmptyState(list, "Cargando equipo...")
            return
        }

        equipmentGroups(equiposList).forEach { (title, items) ->
            addSectionHeader(list, title)
            items.forEach { item -> addEquipmentRow(list, item) }
        }
    }

    private fun equipmentGroups(equiposList: List<EquipoItem>): List<Pair<String, List<EquipoItem>>> =
        listOf(
            "Equipos de Comunicacion" to equiposList.filter {
                it.categoria.equals("COMUNICACION", ignoreCase = true)
            },
            "Equipos Tacticos" to equiposList.filter {
                it.categoria.equals("TACTICO", ignoreCase = true)
            },
            "Otros equipos" to equiposList.filter {
                !it.categoria.equals("COMUNICACION", ignoreCase = true) &&
                    !it.categoria.equals("TACTICO", ignoreCase = true)
            }
        ).filter { it.second.isNotEmpty() }

    private fun addEquipmentRow(list: LinearLayout, item: EquipoItem) {
        val row = host.getLayoutInflater().inflate(R.layout.item_equipo, list, false)
        val rowLabel = item.nombre.ifBlank { "E-${item.idEquipo}" }
        row.tag = rowLabel

        row.findViewById<TextView>(R.id.equipoIcon).text = when (item.categoria.uppercase()) {
            "COMUNICACION" -> "COM"
            "TACTICO" -> "TAC"
            else -> "EQP"
        }

        row.findViewById<TextView>(R.id.equipoNombre).text =
            "Nombre de equipo: ${rowLabel.ifBlank { "Equipo" }}"
        row.findViewById<TextView>(R.id.equipoDetalle).text = equipmentDetail(item)
        row.findViewById<TextView>(R.id.equipoTipo).text = ""

        val live = liveLocations[item.idEquipo]
        if (live != null && isValidLocation(live.first, live.second)) {
            locatedEquipoIds.add(item.idEquipo)
            setSelectableForeground(row)
            row.isClickable = true
            row.setOnClickListener {
                selectEquipo(item.idEquipo)
                host.selectEquipoOnMap(item.idEquipo, live.first, live.second, rowLabel)
            }
        }

        activeRows[item.idEquipo] = row
        applyEquipmentRowStyle(row, item.idEquipo)
        list.addView(row)
    }

    private fun equipmentDetail(item: EquipoItem): String {
        val flotillas = uniqueNonBlank(item.flotillasVinculadas)
        val grupos = uniqueNonBlank(item.gruposVinculados)
        val contextValues = (flotillas + grupos).map { it.trim().lowercase() }.toSet()
        val destino = destinationText(item)
        val showDestino = destino.isNotBlank() &&
            !destino.equals("Sin destino", ignoreCase = true) &&
            !contextValues.contains(destino.trim().lowercase())

        return buildString {
            append("Numero: ")
            append(item.numeroSerie.ifBlank { "Sin numero" })
            if (flotillas.isNotEmpty()) {
                append("\n\n")
                append(flotillas.joinToString(", "))
            }
            if (grupos.isNotEmpty()) {
                append("\n\n")
                append(grupos.joinToString(", "))
            }
            if (showDestino) {
                append("\n\n-- ")
                append(destino)
            }
        }
    }

    private fun addSectionHeader(list: LinearLayout, textValue: String) {
        list.addView(TextView(list.context).apply {
            text = textValue
            setTextColor(Color.parseColor("#a0c4ff"))
            textSize = 13f
            setPadding(0, dp(list, 8f), 0, dp(list, 8f))
        })
    }

    private fun addEmptyState(list: LinearLayout, textValue: String) {
        list.addView(TextView(list.context).apply {
            text = textValue
            setTextColor(Color.parseColor("#64748b"))
            textSize = 12f
            setPadding(0, 16, 0, 0)
        })
    }

    private fun uniqueNonBlank(values: List<String>): List<String> =
        values.map { it.trim() }.filter { it.isNotBlank() }.distinct()

    private fun destinationText(item: EquipoItem): String = when {
        item.vehiculoAsignado.isNotBlank() -> item.vehiculoAsignado
        item.personalAsignado.isNotBlank() -> item.personalAsignado
        item.asignadoA.isNotBlank() -> item.asignadoA
        else -> "Sin destino"
    }

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

    private fun applyEquipmentRowStyle(row: View, idEquipo: Int) {
        val selected = selectedEquipoId == idEquipo
        val hasLocation = locatedEquipoIds.contains(idEquipo)
        val highlighted = selected

        row.setBackgroundColor(Color.parseColor(if (highlighted) "#0d1f3c" else "#0d1526"))
        row.findViewById<TextView>(R.id.equipoNombre).setTextColor(
            Color.parseColor(if (highlighted) "#3b82f6" else "#e2e8f0")
        )
        row.findViewById<TextView>(R.id.equipoDetalle).setTextColor(
            Color.parseColor(if (hasLocation) "#94a3b8" else "#64748b")
        )
        row.findViewById<TextView>(R.id.equipoIcon).setBackgroundColor(
            Color.parseColor(if (selected) "#2563eb" else "#0f172a")
        )
    }

    private fun dp(list: LinearLayout, value: Float): Int =
        (value * list.context.resources.displayMetrics.density + 0.5f).toInt()
}
