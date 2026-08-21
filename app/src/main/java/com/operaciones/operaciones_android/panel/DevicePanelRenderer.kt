package com.operaciones.operaciones_android.ui.panel

import android.graphics.Color
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import com.operaciones.operaciones_android.R
import com.operaciones.operaciones_android.model.DispositivoItem
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

internal class DevicePanelRenderer(
    private val host: MainPanelRenderer.Host
) {
    private val liveLocations = mutableMapOf<Int, Pair<Double, Double>>()
    private val liveIdentities = mutableMapOf<Int, Set<String>>()
    private val locatedDispositivoIds = mutableSetOf<Int>()
    private val activeRows = mutableMapOf<Int, View>()
    private val activeItems = mutableMapOf<Int, DispositivoItem>()
    private var selectedDispositivoId: Int? = null
    private val trackingTimestampFormats = listOf(
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSX", Locale.US),
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssX", Locale.US),
        SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSSX", Locale.US),
        SimpleDateFormat("yyyy-MM-dd HH:mm:ssX", Locale.US),
        SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US),
        SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US)
    ).onEach { it.timeZone = TimeZone.getTimeZone("UTC") }

    fun selectDispositivo(idDispositivo: Int?) {
        selectedDispositivoId = idDispositivo
        activeRows.forEach { (id, row) -> applyDeviceRowStyle(row, id) }
    }

    fun updateDispositivoLocation(
        id: Int,
        lat: Double,
        lon: Double,
        numeroSerie: String? = null,
        imei: String? = null
    ) {
        if (!isValidLocation(lat, lon)) return
        val item = activeItems[id]
        val incomingIdentity = identityValues(numeroSerie, imei)
        if (item != null && !matchesDeviceIdentity(item, incomingIdentity)) return

        liveLocations[id] = lat to lon
        liveIdentities[id] = incomingIdentity
        locatedDispositivoIds.add(id)
        val row = activeRows[id] ?: return
        val label = row.tag as? String
            ?: row.findViewById<TextView>(R.id.equipoNombre).text.toString()

        setSelectableForeground(row)
        row.isClickable = true
        row.setOnClickListener {
            selectDispositivo(id)
            host.selectDispositivoOnMap(id, lat, lon, label)
        }
        applyDeviceRowStyle(row, id)
    }

    fun inflate(panelContent: FrameLayout, dispositivosList: List<DispositivoItem>) {
        val view = host.getLayoutInflater().inflate(R.layout.panel_dispositivo, panelContent, false)
        panelContent.addView(view)

        val list = view.findViewById<LinearLayout>(R.id.dispositivoList)
        activeRows.clear()
        activeItems.clear()
        locatedDispositivoIds.clear()
        liveLocations.clear()
        liveIdentities.clear()

        if (dispositivosList.isEmpty()) {
            addEmptyState(list, "Cargando dispositivos...")
            return
        }

        deviceGroups(dispositivosList).forEach { (title, items) ->
            addSectionHeader(list, title)
            items.forEach { item -> addDeviceRow(list, item) }
        }
    }

    private fun deviceGroups(
        dispositivosList: List<DispositivoItem>
    ): List<Pair<String, List<DispositivoItem>>> =
        dispositivosList
            .groupBy { it.tipo.ifBlank { "Dispositivos" }.uppercase() }
            .toSortedMap(String.CASE_INSENSITIVE_ORDER)
            .map { (tipo, items) ->
                tipo to items.sortedWith(compareBy(
                    { it.marca },
                    { it.modelo },
                    { it.numeroSerie.ifBlank { it.imei } }
                ))
            }

    private fun addDeviceRow(list: LinearLayout, item: DispositivoItem) {
        val row = host.getLayoutInflater().inflate(R.layout.item_equipo, list, false)
        val rowLabel = deviceLabel(item)
        row.tag = rowLabel

        row.findViewById<TextView>(R.id.equipoIcon).text = deviceIconText(item)
        row.findViewById<TextView>(R.id.equipoNombre).text = rowLabel
        row.findViewById<TextView>(R.id.equipoDetalle).text = deviceDetail(item)
        row.findViewById<TextView>(R.id.equipoTipo).text = item.estado.ifBlank { "DISP" }.uppercase()

        val live = liveLocations[item.idDispositivo]
        val freshItemLocation = isFreshTrackingTimestamp(item.ultimaActualizacion)
        val effectiveLat = live?.first ?: item.lat?.takeIf { freshItemLocation }
        val effectiveLon = live?.second ?: item.lon?.takeIf { freshItemLocation }
        val liveIdentity = liveIdentities[item.idDispositivo]
        val identityConfirmed = if (live != null) {
            liveIdentity != null && matchesDeviceIdentity(item, liveIdentity)
        } else {
            hasDeviceIdentity(item)
        }

        if (effectiveLat != null && effectiveLon != null && isValidLocation(effectiveLat, effectiveLon) && identityConfirmed) {
            locatedDispositivoIds.add(item.idDispositivo)
            setSelectableForeground(row)
            row.isClickable = true
            row.setOnClickListener {
                selectDispositivo(item.idDispositivo)
                host.selectDispositivoOnMap(item.idDispositivo, effectiveLat, effectiveLon, rowLabel)
            }
        }

        activeRows[item.idDispositivo] = row
        activeItems[item.idDispositivo] = item
        applyDeviceRowStyle(row, item.idDispositivo)
        list.addView(row)
    }

    private fun normalizeIdentity(value: String?): String =
        value?.trim()?.lowercase().orEmpty()

    private fun deviceIdentityValues(item: DispositivoItem): Set<String> =
        listOf(item.numeroSerie, item.imei, item.identificadorApp)
            .map(::normalizeIdentity)
            .filter { it.isNotBlank() }
            .toSet()

    private fun identityValues(
        numeroSerie: String?,
        imei: String?
    ): Set<String> =
        listOf(numeroSerie, imei)
            .map(::normalizeIdentity)
            .filter { it.isNotBlank() }
            .toSet()

    private fun hasDeviceIdentity(item: DispositivoItem): Boolean =
        deviceIdentityValues(item).isNotEmpty()

    private fun matchesDeviceIdentity(
        item: DispositivoItem,
        incoming: Set<String>
    ): Boolean {
        if (incoming.isEmpty()) return false
        return deviceIdentityValues(item).any { it in incoming }
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

    private fun deviceDetail(item: DispositivoItem): String {
        val responsible = responsibleText(item)
        return buildString {
            val serial = item.numeroSerie.ifBlank { item.imei }
            if (serial.isNotBlank()) append("Serie: $serial")
            if (item.numeroTelefono.isNotBlank()) {
                if (isNotEmpty()) append("\n")
                append("Telefono: ${item.numeroTelefono}")
            }
            if (responsible.isNotBlank()) {
                if (isNotEmpty()) append("\n")
                append("Custodio: $responsible")
            }
            if (item.bateriaPct != null) {
                if (isNotEmpty()) append("\n")
                append("Bateria: ${item.bateriaPct.toInt()}%")
            }
            if (item.ultimaActualizacion.isNotBlank()) {
                if (isNotEmpty()) append("\n")
                append("Ultima posicion: ${item.ultimaActualizacion}")
            }
            if (isEmpty()) append("Sin detalle")
        }
    }

    private fun responsibleText(item: DispositivoItem): String {
        val fullName = listOf(item.personalNombre, item.personalApellido)
            .filter { it.isNotBlank() }
            .joinToString(" ")
        return fullName.ifBlank { item.personalApodo }
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

    private fun applyDeviceRowStyle(row: View, idDispositivo: Int) {
        val selected = selectedDispositivoId == idDispositivo
        val hasLocation = locatedDispositivoIds.contains(idDispositivo)

        row.setBackgroundColor(Color.parseColor(if (selected) "#0d1f3c" else "#0d1526"))
        row.findViewById<TextView>(R.id.equipoNombre).setTextColor(
            Color.parseColor(if (selected) "#3b82f6" else "#e2e8f0")
        )
        row.findViewById<TextView>(R.id.equipoDetalle).setTextColor(
            Color.parseColor(if (hasLocation) "#94a3b8" else "#64748b")
        )
        row.findViewById<TextView>(R.id.equipoIcon).setBackgroundColor(
            Color.parseColor(if (selected) "#2563eb" else "#0f172a")
        )
        row.findViewById<TextView>(R.id.equipoTipo).setTextColor(
            Color.parseColor(if (hasLocation) "#22c55e" else "#64748b")
        )
    }

    private fun dp(view: View, value: Float): Int =
        (value * view.context.resources.displayMetrics.density + 0.5f).toInt()

    private companion object {
        private const val TRACKING_ACTIVE_STALE_MS = 30_000L
    }
}
