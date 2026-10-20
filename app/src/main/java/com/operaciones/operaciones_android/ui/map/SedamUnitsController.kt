package com.operaciones.operaciones_android.ui.map

import android.content.Context
import android.util.Log
import com.operaciones.operaciones_android.config.SedamNetworkConfig
import com.operaciones.operaciones_android.network.SedamSocketManager
import com.operaciones.operaciones_android.network.SedamUnitPosition
import com.operaciones.operaciones_android.webview.CesiumWebController
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

/**
 * Muestra en el mapa las unidades de la red SEDAM (las mismas del dashboard web):
 * escucha el socket cifrado y las dibuja con su símbolo MIL-STD-2525 según el catálogo por id.
 */
class SedamUnitsController(
    private val context: Context,
    private val cesiumWebController: CesiumWebController
) {
    private data class CatalogEntry(val sidc: String, val name: String)

    private var manager: SedamSocketManager? = null
    private val catalog: Map<Int, CatalogEntry> by lazy { loadCatalog() }
    private val aliases = ConcurrentHashMap<String, String>()
    private val lastPositions = ConcurrentHashMap<String, SedamUnitPosition>()

    fun start() {
        if (manager != null) return
        val settings = SedamNetworkConfig.load(context)
        if (!settings.isConfigured) {
            Log.i(TAG, "Red SEDAM sin número de serie configurado; no se conecta.")
            return
        }
        manager = SedamSocketManager(
            context = context,
            url = settings.url,
            serial = settings.serial,
            onUnit = ::showUnit,
            onAlias = { id, alias ->
                aliases[id] = alias
                lastPositions[id]?.let(::showUnit)
            },
            onUnitGone = { id -> removeUnit(id) },
            onTrackRemoved = { key -> removeUnit(key) },
            onStatus = { Log.i(TAG, it) }
        ).also { it.connect() }
    }

    fun stop() {
        manager?.disconnect()
        manager = null
        lastPositions.clear()
        cesiumWebController.evaluate("if(typeof clearSedamUnits === 'function') clearSedamUnits()")
    }

    /** Evento que la API de Operaciones reenvía del bridge SEDAM: { type: unit | alias | gone, id, ... }. */
    fun handleBridgeEvent(event: JSONObject) {
        val id = event.optString("id").takeIf { it.isNotBlank() } ?: return
        when (event.optString("type")) {
            "unit" -> {
                if (!event.has("lat") || !event.has("lon")) return
                showUnit(
                    SedamUnitPosition(
                        id = id,
                        lat = event.optDouble("lat"),
                        lon = event.optDouble("lon"),
                        courseDeg = event.takeUnless { it.isNull("course") }?.optDouble("course"),
                        speed = event.takeUnless { it.isNull("speed") }?.optDouble("speed"),
                        sidc = event.optString("sidc").takeIf { it.length >= 10 },
                        name = event.optString("name").takeIf { it.isNotBlank() }
                    )
                )
            }
            "alias" -> {
                aliases[id] = event.optString("alias")
                lastPositions[id]?.let(::showUnit)
            }
            "gone" -> removeUnit(id)
        }
    }

    private fun showUnit(unit: SedamUnitPosition) {
        lastPositions[unit.id] = unit
        val entry = unit.id.toIntOrNull()?.let(catalog::get)
        val label = aliases[unit.id] ?: entry?.name ?: unit.name ?: unit.id
        val meta = JSONObject()
            .put("sidc", unit.sidc ?: entry?.sidc ?: DEFAULT_SIDC)
            .put("velocidad", unit.speed ?: 0.0)
            .apply { unit.courseDeg?.takeIf { unit.speed != null && unit.speed > 0.5 }?.let { put("rumbo_grados", it) } }
        cesiumWebController.evaluate(
            "if(typeof updateSedamUnit === 'function') updateSedamUnit('${js(unit.id)}', ${unit.lat}, ${unit.lon}, '${js(label)}', $meta)"
        )
    }

    private fun removeUnit(id: String) {
        lastPositions.remove(id)
        cesiumWebController.evaluate("if(typeof removeSedamUnit === 'function') removeSedamUnit('${js(id)}')")
    }

    private fun loadCatalog(): Map<Int, CatalogEntry> = try {
        val json = context.assets.open("sedam_units.json").bufferedReader().use { JSONObject(it.readText()) }
        buildMap {
            json.keys().forEach { key ->
                val item = json.getJSONObject(key)
                key.toIntOrNull()?.let { put(it, CatalogEntry(item.getString("sidc"), item.getString("name"))) }
            }
        }
    } catch (e: Exception) {
        Log.e(TAG, "No se pudo leer sedam_units.json", e)
        emptyMap()
    }

    private fun js(value: String) = value.replace("\\", "\\\\").replace("'", "\\'").replace("\n", " ")

    private companion object {
        const val TAG = "SedamUnits"
        // Unidad terrestre amiga genérica.
        const val DEFAULT_SIDC = "SFGPU----------"
    }
}
