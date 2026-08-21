package com.operaciones.operaciones_android.ui.map

import android.text.InputType
import android.util.Log
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.EditText
import android.widget.Button
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.operaciones.operaciones_android.R
import com.operaciones.operaciones_android.config.ApiConfig
import com.operaciones.operaciones_android.map.MapActionController
import com.operaciones.operaciones_android.model.ChatMessage
import com.operaciones.operaciones_android.model.MessageType
import com.operaciones.operaciones_android.model.User
import com.operaciones.operaciones_android.network.DrawingRepository
import com.operaciones.operaciones_android.webview.CesiumWebController
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import kotlin.math.PI
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin

class MapObjectsController(
    private val activity: AppCompatActivity,
    private val cesiumWebController: CesiumWebController,
    private val httpClient: OkHttpClient,
    private val drawingRepository: DrawingRepository = DrawingRepository(),
    private val host: Host
) : MapActionController.Host {

    interface Host {
        fun getMapOperationId(): Int
        fun getMapToken(): String
        fun getMapCurrentUser(): User
        fun getSelectedMapVehiculoId(): Int?
        fun addMapMessage(msg: ChatMessage)
        fun openMapChatPanel()
        fun isMapChatPanelActive(): Boolean
        fun selectMapPersonal(idPersonal: Int?)
        fun selectMapVehiculo(idVehiculo: Int?)
        fun showMapVehiculoInfo(idVehiculo: Int, screenX: Double?, screenY: Double?, viewportWidth: Double?, viewportHeight: Double?)
        fun showMapPersonalInfo(idPersonal: Int, label: String?, screenX: Double?, screenY: Double?, viewportWidth: Double?, viewportHeight: Double?)
        fun showMapEquipoInfo(idEquipo: Int, screenX: Double?, screenY: Double?, viewportWidth: Double?, viewportHeight: Double?)
        fun selectMapEquipo(idEquipo: Int?)
        fun selectMapDispositivo(idDispositivo: Int?)
    }

    private data class SelectedMapObject(
        val kind: String,
        val id: Int?,
        val localId: String?,
        val label: String,
        val screenX: Double? = null,
        val screenY: Double? = null,
        val viewportWidth: Double? = null,
        val viewportHeight: Double? = null
    )

    private data class CoverageCircleDraft(
        val name: String,
        val radiusMeters: Double,
        val color: String,
        val opacity: Double
    )

    private data class StructureDraft(
        val name: String,
        val type: String,
        val title: String
    )

    private enum class ObjectTool {
        MIL,
        POI,
        POLYGON,
        CIRCLE,
        ROUTE_START,
        ROUTE_END,
        BUILDING,
        LABEL
    }

    private val mapActionController = MapActionController(this, cesiumWebController)
    private val drawingLocalToBackendId = HashMap<String, Int>()
    private val polygonToolPoints = mutableListOf<Pair<Double, Double>>()

    private var drawingMode: String? = null
    private var selectedObjectTool: ObjectTool? = null
    private var objectToolSelectionView: TextView? = null
    private var drawingMiniToolbar: View? = null
    private var colorOptions: View? = null
    private var miniPencilButton: ImageButton? = null
    private var miniEraserButton: ImageButton? = null
    private var selectedPencilColor = "#00ffa6"
    private var pencilColorViews: Map<Int, View> = emptyMap()
    private var pencilColorHexById: Map<Int, String> = emptyMap()
    private var selectedMapObject: SelectedMapObject? = null
    private var deleteButton: Button? = null
    private var lastRouteId: Int = -1
    private var pendingMilitarySymbol: MapActionController.MilitarySymbolChoice? = null
    private var pendingPoi: Pair<String, String>? = null // (nombre, colorHex)
    private var pendingCoverageCircle: CoverageCircleDraft? = null
    private var pendingStructure: StructureDraft? = null
    private var nextLocalPoiId: Int = -1

    fun setupDeleteControls(button: Button) {
        deleteButton = button
        button.visibility = View.GONE
        button.setOnClickListener {
            deleteSelectedMapObject()
        }
    }

    fun onMapObjectSelectedFromBridge(payloadJson: String) {
        val selected = runCatching {
            val payload = JSONObject(payloadJson)
            SelectedMapObject(
                kind = payload.optString("kind").trim().lowercase(),
                id = payload.optInt("id", -1).takeIf { it > 0 },
                localId = payload.optString("localId", "").trim().takeIf { it.isNotBlank() },
                label = payload.optString("label", "Objeto").trim().ifBlank { "Objeto" },
                screenX = payload.optionalDouble("screenX"),
                screenY = payload.optionalDouble("screenY"),
                viewportWidth = payload.optionalDouble("viewportWidth"),
                viewportHeight = payload.optionalDouble("viewportHeight")
            )
        }.getOrNull() ?: return

        if (selected.kind.isBlank() || (selected.id == null && selected.localId == null)) return

        if (selected.kind in setOf("personal", "vehiculo", "equipo", "dispositivo")) {
            val selectedId = selected.id ?: return
            selectedMapObject = null
            deleteButton?.visibility = View.GONE
            activity.findViewById<View>(R.id.objectToolsMenu)?.visibility = View.GONE
            when (selected.kind) {
                "personal" -> {
                    host.selectMapPersonal(selectedId)
                    host.showMapPersonalInfo(
                        selectedId,
                        selected.label,
                        selected.screenX,
                        selected.screenY,
                        selected.viewportWidth,
                        selected.viewportHeight
                    )
                }
                "vehiculo" -> {
                    host.selectMapVehiculo(selectedId)
                    host.showMapVehiculoInfo(
                        selectedId,
                        selected.screenX,
                        selected.screenY,
                        selected.viewportWidth,
                        selected.viewportHeight
                    )
                }
                "equipo" -> {
                    host.selectMapEquipo(selectedId)
                    host.showMapEquipoInfo(
                        selectedId,
                        selected.screenX,
                        selected.screenY,
                        selected.viewportWidth,
                        selected.viewportHeight
                    )
                }
                "dispositivo" -> host.selectMapDispositivo(selectedId)
            }
            return
        }

        selectedMapObject = selected
        deleteButton?.visibility = View.GONE
        activity.findViewById<View>(R.id.objectToolsMenu)?.visibility = View.GONE
    }

    fun onMapObjectMovedFromBridge(payloadJson: String) {
        val payload = runCatching { JSONObject(payloadJson) }.getOrNull() ?: return
        val kind = payload.optString("kind").trim().lowercase()
        val id = payload.optInt("id", -1)
        val lat = payload.optDouble("lat", Double.NaN)
        val lon = payload.optDouble("lon", Double.NaN)
        if (id <= 0 || !lat.isFinite() || !lon.isFinite()) return

        val operationId = host.getMapOperationId()
        val endpoint = when (kind) {
            "poi" -> "pois"
            "structure" -> "edificios"
            "area" -> "areas"
            else -> return
        }
        val token = host.getMapToken()
        if (operationId <= 0 || token.isBlank()) return

        val body = JSONObject()
            .put("latitud", lat)
            .put("longitud", lon)
        val request = Request.Builder()
            .url("${ApiConfig.BASE_URL}/ops/$operationId/$endpoint/$id")
            .addHeader("Authorization", "Bearer $token")
            .addHeader("Content-Type", "application/json")
            .put(body.toString().toRequestBody(JSON_MEDIA_TYPE))
            .build()

        httpClient.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                Log.e("MAP_MOVE", "Error guardando posicion del objeto", e)
                activity.runOnUiThread {
                    host.addMapMessage(
                        ChatMessage(
                            user = "Sistema",
                            text = "No se pudo guardar la nueva posicion.",
                            type = MessageType.SYSTEM
                        )
                    )
                }
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    if (!it.isSuccessful) {
                        Log.e("MAP_MOVE", "Error ${it.code} guardando posicion: ${it.body?.string().orEmpty()}")
                        activity.runOnUiThread {
                            Toast.makeText(activity, "No se pudo mover el objeto.", Toast.LENGTH_SHORT).show()
                        }
                        return
                    }
                }
                activity.runOnUiThread {
                    Toast.makeText(activity, "Posicion actualizada.", Toast.LENGTH_SHORT).show()
                }
            }
        })
    }

    fun clearSelectedMapObject() {
        selectedMapObject = null
        host.selectMapPersonal(null)
        host.selectMapVehiculo(null)
        host.selectMapEquipo(null)
        host.selectMapDispositivo(null)
        cesiumWebController.clearTrackingSelection()
        deleteButton?.visibility = View.GONE
    }

    fun showMapActionDialogFromBridge(lat: Double, lon: Double): Boolean {
        mapActionController.showMapActionDialog(host.getMapCurrentUser(), lat, lon)
        return true
    }

    fun handleMapTapFromBridge(lat: Double, lon: Double): Boolean =
        handleSelectedObjectToolTap(lat, lon)

    fun deleteMapObjectFromBridge(payloadJson: String) {
        val selected = runCatching {
            val payload = JSONObject(payloadJson)
            SelectedMapObject(
                kind = payload.optString("kind").trim().lowercase(),
                id = payload.optInt("id", -1).takeIf { it > 0 },
                localId = payload.optString("localId", "").trim().takeIf { it.isNotBlank() },
                label = payload.optString("label", "Objeto").trim().ifBlank { "Objeto" },
                screenX = payload.optionalDouble("screenX"),
                screenY = payload.optionalDouble("screenY"),
                viewportWidth = payload.optionalDouble("viewportWidth"),
                viewportHeight = payload.optionalDouble("viewportHeight")
            )
        }.getOrNull() ?: return

        selectedMapObject = selected
        deleteSelectedMapObject()
    }

    fun onRouteCreatedFromBridge(payloadJson: String) {
        Log.d("RUTA_ANDROID", "Ruta recibida desde bridge: $payloadJson")
        sendRouteToBackend(payloadJson)
    }

    fun setupObjectToolsMenu() {
        val btnObjectTools = activity.findViewById<View>(R.id.btnObjectTools)
        val objectToolsMenu = activity.findViewById<View>(R.id.objectToolsMenu)
        objectToolSelectionView = activity.findViewById(R.id.objectToolSelection)
        drawingMiniToolbar = activity.findViewById(R.id.drawingMiniToolbar)
        colorOptions = activity.findViewById(R.id.layoutColorOptions)
        miniPencilButton = activity.findViewById(R.id.btnMiniPencil)
        miniEraserButton = activity.findViewById(R.id.btnMiniEraser)

        fun setMenuVisible(visible: Boolean) {
            objectToolsMenu.visibility = if (visible) View.VISIBLE else View.GONE
            btnObjectTools.contentDescription = if (visible) {
                "Cerrar herramientas de mapa"
            } else {
                "Abrir herramientas de mapa"
            }
        }

        btnObjectTools.setOnClickListener {
            if (drawingMiniToolbar?.visibility == View.VISIBLE || drawingMode != null) {
                stopFreeDrawingMode()
                updateObjectToolSelection(null)
                setMenuVisible(true)
                return@setOnClickListener
            }
            setMenuVisible(objectToolsMenu.visibility != View.VISIBLE)
        }

        fun bindItem(id: Int, action: () -> Unit) {
            activity.findViewById<TextView>(id).setOnClickListener {
                setMenuVisible(false)
                action()
            }
        }

        bindItem(R.id.itemToolPencil) { showFreeDrawingToolbar() }
        bindItem(R.id.itemToolEraser) { showFreeDrawingToolbar() }
        miniPencilButton?.setOnClickListener {
            toggleFreeDrawingMode("pencil", "Lapiz")
        }
        miniEraserButton?.setOnClickListener {
            toggleFreeDrawingMode("eraser", "Goma de borrar")
        }

        val pencilColors = mapOf(
            R.id.colorCyan to "#00ffa6",
            R.id.colorRed to "#FF3B30",
            R.id.colorBlue to "#007AFF",
            R.id.colorYellow to "#FFCC00",
            R.id.colorPurple to "#AF52DE",
            R.id.colorWhite to "#FFFFFF"
        )
        pencilColorHexById = pencilColors
        pencilColorViews = pencilColors.keys.mapNotNull { id ->
            activity.findViewById<View>(id)?.let { id to it }
        }.toMap()
        pencilColors.forEach { (id, color) ->
            activity.findViewById<View>(id)?.setOnClickListener {
                selectedPencilColor = color
                cesiumWebController.setPencilColor(color)
                if (drawingMode == "pencil") {
                    cesiumWebController.startPencilMode(color)
                }
                updatePencilColorSelection()
                Toast.makeText(activity, "Color de lapiz actualizado.", Toast.LENGTH_SHORT).show()
            }
        }
        updatePencilColorSelection()
        bindItem(R.id.itemToolMil) {
            pendingMilitarySymbol = null
            pendingPoi = null
            mapActionController.showMilitarySymbolPicker { choice ->
                pendingMilitarySymbol = choice
                selectMapObjectTool(ObjectTool.MIL, choice.unitLabel)
            }
        }
        bindItem(R.id.itemToolPoi) {
            pendingMilitarySymbol = null
            pendingPoi = null
            mapActionController.showPoiConfigurationDialog { nombre, color ->
                pendingPoi = nombre to color
                selectMapObjectTool(ObjectTool.POI, "PDI: $nombre")
            }
        }
        // bindItem(R.id.itemToolPolygon) {
        //     polygonToolPoints.clear()
        //     selectMapObjectTool(ObjectTool.POLYGON, "Poligono Tactico")
        //     Toast.makeText(activity, "Toca 3 puntos en el mapa para cerrar el poligono.", Toast.LENGTH_LONG).show()
        // }
        bindItem(R.id.itemToolCircle) {
            showCoverageCircleConfigurationDialog { draft ->
                pendingCoverageCircle = draft
                selectMapObjectTool(ObjectTool.CIRCLE, "Circulo: ${draft.name}")
            }
        }
        bindItem(R.id.itemToolRoute) {
            selectMapObjectTool(ObjectTool.ROUTE_START, "Ruta: origen")
            Toast.makeText(activity, "Toca el origen de la ruta.", Toast.LENGTH_SHORT).show()
        }
        bindItem(R.id.itemToolBuilding) {
            showStructureConfigurationDialog("EDIFICIO", "Edificio") { draft ->
                pendingStructure = draft
                selectMapObjectTool(ObjectTool.BUILDING, draft.title)
            }
        }
        bindItem(R.id.itemToolLabel) {
            showStructureConfigurationDialog("ETIQUETA", "Etiqueta") { draft ->
                pendingStructure = draft
                selectMapObjectTool(ObjectTool.LABEL, draft.title)
            }
        }
    }

    override fun getContext(): android.content.Context = activity

    override fun addMessage(msg: ChatMessage) {
        host.addMapMessage(msg)
    }

    override fun openChatPanel() {
        host.openMapChatPanel()
    }

    override fun isChatPanelActive(): Boolean =
        host.isMapChatPanelActive()

    override fun clearRouteOnBackend() {
        sendClearRouteToBackend()
    }

    override fun savePoi(
        lat: Double,
        lon: Double,
        nombre: String,
        tipoPoi: String,
        color: String,
        iconoSrc: String?
    ) {
        savePoiInternal(lat, lon, nombre, tipoPoi, color, iconoSrc, null)
    }

    private fun savePoiInternal(
        lat: Double,
        lon: Double,
        nombre: String,
        tipoPoi: String,
        color: String,
        iconoSrc: String?,
        localTempId: Int?
    ) {
        val operationId = host.getMapOperationId()
        if (operationId <= 0) return
        val token = host.getMapToken()
        if (token.isBlank()) return

        val currentUser = host.getMapCurrentUser()
        val tipoCreador = if (currentUser.tabla == "personal") "PERSONAL" else "USUARIO"
        val idKey = if (currentUser.tabla == "personal") "id_personal" else "id_usuario"
        val body = JSONObject()
            .put("nombre", nombre)
            .put("tipo_poi", tipoPoi)
            .put("latitud", lat)
            .put("longitud", lon)
            .put("color", color)
            .put("icono_src", iconoSrc ?: JSONObject.NULL)
            .put("sidc", iconoSrc?.takeIf { it.startsWith("S") || it.startsWith("G") } ?: JSONObject.NULL)
            .put("tipo_creador", tipoCreador)
            .put(idKey, currentUser.id)

        val request = Request.Builder()
            .url("${ApiConfig.BASE_URL}/ops/$operationId/pois")
            .addHeader("Authorization", "Bearer $token")
            .addHeader("Content-Type", "application/json")
            .post(body.toString().toRequestBody(JSON_MEDIA_TYPE))
            .build()

        httpClient.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                Log.e("POI", "Error guardando POI en backend", e)
                activity.runOnUiThread {
                    localTempId?.let { cesiumWebController.removePoiFromMap(it) }
                    host.addMapMessage(ChatMessage(user = "Sistema", text = "Error de conexion al guardar el POI.", type = MessageType.SYSTEM))
                    Toast.makeText(activity, "Error de conexion al guardar el POI.", Toast.LENGTH_LONG).show()
                }
            }

            override fun onResponse(call: Call, response: Response) {
                val responseBody = response.body?.string().orEmpty()
                Log.d("POI", "POI guardado: ${response.code} - $responseBody")

                if (response.isSuccessful && renderSavedPoi(responseBody, lat, lon, nombre, tipoPoi, color, iconoSrc, localTempId)) {
                    return
                }

                if (!response.isSuccessful) {
                    val mensaje = runCatching {
                        JSONObject(responseBody).optString("mensaje", "No se pudo guardar el POI.")
                    }.getOrDefault("No se pudo guardar el POI.")

                    activity.runOnUiThread {
                        localTempId?.let { cesiumWebController.removePoiFromMap(it) }
                        host.addMapMessage(ChatMessage(user = "Sistema", text = mensaje, type = MessageType.SYSTEM))
                        Toast.makeText(activity, mensaje, Toast.LENGTH_LONG).show()
                    }
                }
            }
        })
    }

    fun sendClearRouteToBackend() {
        if (lastRouteId <= 0) return
        val operationId = host.getMapOperationId()
        if (operationId <= 0) return
        val token = host.getMapToken()
        if (token.isBlank()) return

        val request = Request.Builder()
            .url("${ApiConfig.BASE_URL}/ops/$operationId/rutas/navegacion/$lastRouteId")
            .addHeader("Authorization", "Bearer $token")
            .delete()
            .build()

        httpClient.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                Log.e("RUTA_ANDROID", "Error limpiando ruta en backend", e)
            }

            override fun onResponse(call: Call, response: Response) {
                Log.d("RUTA_ANDROID", "Ruta limpiada: ${response.code}")
                lastRouteId = -1
            }
        })
    }

    fun loadDrawingsFromBackend(replace: Boolean = true) {
        val operationId = host.getMapOperationId()
        if (operationId <= 0) return
        val token = host.getMapToken()
        if (token.isBlank()) return

        drawingRepository.fetchDrawings(
            operationId = operationId,
            token = token,
            onSuccess = { items ->
                val arr = JSONArray()
                items.forEach { item ->
                    val localId = "draw_loaded_${item.optInt("id_dibujo")}"
                    drawingLocalToBackendId[localId] = item.optInt("id_dibujo")
                    val d = JSONObject()
                    d.put("id_dibujo", item.optInt("id_dibujo"))
                    d.put("color", item.optString("color", "#00ffa6"))
                    d.put("grosor", item.optDouble("grosor", 4.0))
                    val puntos = item.optJSONArray("puntos") ?: JSONArray()
                    val coords = JSONArray()
                    for (i in 0 until puntos.length()) {
                        val p = puntos.optJSONObject(i) ?: continue
                        coords.put(JSONObject().put("lat", p.optDouble("lat")).put("lng", p.optDouble("lng")))
                    }
                    d.put("coords", coords)
                    arr.put(d)
                }
                activity.runOnUiThread {
                    cesiumWebController.loadDrawings(arr.toString(), replace = replace)
                }
            },
            onError = { msg -> Log.w("DRAWING", "Error cargando dibujos: $msg") }
        )
    }

    fun onDrawingSavedFromBridge(strokeJson: String) {
        val operationId = host.getMapOperationId()
        if (operationId <= 0) return
        val token = host.getMapToken()
        if (token.isBlank()) return

        try {
            val stroke = JSONObject(strokeJson)
            val localId = stroke.optString("localId")
            val coords = stroke.optJSONArray("coords") ?: return
            val color = stroke.optString("color", "#00ffa6")
            val grosor = stroke.optDouble("grosor", 4.0)
            val currentUser = host.getMapCurrentUser()

            val userData = JSONObject().apply {
                put("tabla", if (currentUser.tabla == "personal") "personal" else "usuario")
                put("id_personal", currentUser.id)
                put("id_usuario", currentUser.id)
            }

            drawingRepository.saveDrawing(
                operationId = operationId,
                token = token,
                userData = userData,
                coords = coords,
                color = color,
                grosor = grosor,
                onSuccess = { idDibujo ->
                    if (localId.isNotBlank()) drawingLocalToBackendId[localId] = idDibujo
                    Log.d("DRAWING", "Trazo guardado id_dibujo=$idDibujo localId=$localId")
                },
                onError = { msg -> Log.w("DRAWING", "Error guardando trazo: $msg") }
            )
        } catch (e: Exception) {
            Log.e("DRAWING", "Error parseando strokeJson: ${e.message}")
        }
    }

    fun onDrawingDeletedFromBridge(localId: String) {
        val idDibujo = drawingLocalToBackendId[localId] ?: run {
            Log.w("DRAWING", "onDrawingDeleted: sin id_dibujo para localId=$localId")
            return
        }
        drawingLocalToBackendId.remove(localId)

        val operationId = host.getMapOperationId()
        if (operationId <= 0) return
        val token = host.getMapToken()
        if (token.isBlank()) return

        drawingRepository.deleteDrawing(
            operationId = operationId,
            idDibujo = idDibujo,
            token = token,
            onError = { msg -> Log.w("DRAWING", "Error borrando dibujo: $msg") }
        )
        Log.d("DRAWING", "Trazo eliminado id_dibujo=$idDibujo")
    }

    fun hasDrawingBackendId(idDibujo: Int): Boolean =
        drawingLocalToBackendId.containsValue(idDibujo)

    private fun showDeleteButtonNearSelection(selected: SelectedMapObject) {
        val button = deleteButton ?: return
        button.visibility = View.VISIBLE

        button.post {
            val parent = button.parent as? View ?: return@post
            val webView = activity.findViewById<View>(R.id.cesiumWebView)
            val viewportWidth = selected.viewportWidth?.takeIf { it > 0.0 } ?: webView.width.toDouble().takeIf { it > 0.0 } ?: return@post
            val viewportHeight = selected.viewportHeight?.takeIf { it > 0.0 } ?: webView.height.toDouble().takeIf { it > 0.0 } ?: return@post
            val rawX = selected.screenX ?: (viewportWidth * 0.5)
            val rawY = selected.screenY ?: (viewportHeight * 0.5)
            val anchorX = (webView.left + (rawX / viewportWidth * webView.width)).toFloat()
            val anchorY = (webView.top + (rawY / viewportHeight * webView.height)).toFloat()
            val gap = dp(10).toFloat()
            val edge = dp(8).toFloat()

            val rightX = anchorX + gap
            val leftX = anchorX - button.width - gap
            val targetX = if (rightX + button.width <= parent.width - edge) rightX else leftX
            val targetY = anchorY - (button.height / 2f)

            button.x = targetX.coerceIn(edge, (parent.width - button.width - edge).coerceAtLeast(edge))
            button.y = targetY.coerceIn(edge, (parent.height - button.height - edge).coerceAtLeast(edge))
        }
    }

    private fun JSONObject.optionalDouble(key: String): Double? =
        if (has(key) && !isNull(key)) optDouble(key).takeIf { it.isFinite() } else null

    private fun dp(value: Int): Int =
        (value * activity.resources.displayMetrics.density).toInt()

    fun deletePoiById(idPoi: Int, label: String = "Punto") {
        val operationId = host.getMapOperationId()
        if (operationId <= 0 || idPoi <= 0) return

        deleteMapObjectFromBackend(
            url = "${ApiConfig.BASE_URL}/ops/$operationId/pois/$idPoi",
            successMessage = "$label eliminado.",
            onSuccess = { cesiumWebController.removePoiFromMap(idPoi) }
        )
    }

    private fun deleteSelectedMapObject() {
        val selected = selectedMapObject ?: return
        val operationId = host.getMapOperationId()
        if (operationId <= 0) return

        when (selected.kind) {
            "poi" -> selected.id?.let { id ->
                deleteMapObjectFromBackend(
                    url = "${ApiConfig.BASE_URL}/ops/$operationId/pois/$id",
                    successMessage = "Punto eliminado.",
                    onSuccess = { cesiumWebController.removePoiFromMap(id) }
                )
            }
            "area" -> selected.id?.let { id ->
                deleteMapObjectFromBackend(
                    url = "${ApiConfig.BASE_URL}/ops/$operationId/areas/$id",
                    successMessage = "Area eliminada.",
                    onSuccess = { cesiumWebController.removeAreaFromMap(id) }
                )
            }
            "structure" -> selected.id?.let { id ->
                deleteMapObjectFromBackend(
                    url = "${ApiConfig.BASE_URL}/ops/$operationId/edificios/$id",
                    successMessage = "Estructura eliminada.",
                    onSuccess = { cesiumWebController.removeStructureFromMap(id) }
                )
            }
            "route" -> selected.id?.let { id ->
                deleteMapObjectFromBackend(
                    url = "${ApiConfig.BASE_URL}/ops/$operationId/rutas/navegacion/$id",
                    successMessage = "Ruta eliminada.",
                    onSuccess = {
                        cesiumWebController.evaluate("if(typeof removeRemoteRoute === 'function') removeRemoteRoute($id);")
                        if (lastRouteId == id) {
                            lastRouteId = -1
                            cesiumWebController.clearRoute()
                        }
                    }
                )
            }
            "tactical_route" -> selected.id?.let { id ->
                deleteMapObjectFromBackend(
                    url = "${ApiConfig.BASE_URL}/ops/$operationId/rutas/$id",
                    successMessage = "Linea tactica eliminada.",
                    onSuccess = { cesiumWebController.removeTacticalRouteFromMap(id) }
                )
            }
            "drawing" -> deleteSelectedDrawing(selected, operationId)
        }
    }

    private fun deleteSelectedDrawing(selected: SelectedMapObject, operationId: Int) {
        selected.localId?.let { localId ->
            cesiumWebController.evaluate("if(typeof removeDrawingByLocalId === 'function') removeDrawingByLocalId('${jsString(localId)}');")
            onDrawingDeletedFromBridge(localId)
            clearSelectedMapObject()
            Toast.makeText(activity, "Dibujo eliminado.", Toast.LENGTH_SHORT).show()
            return
        }

        val idDibujo = selected.id ?: return
        val token = host.getMapToken()
        if (token.isBlank()) return
        drawingRepository.deleteDrawing(
            operationId = operationId,
            idDibujo = idDibujo,
            token = token,
            onError = { msg ->
                activity.runOnUiThread {
                    host.addMapMessage(ChatMessage(user = "Sistema", text = msg, type = MessageType.SYSTEM))
                }
            }
        )
        cesiumWebController.removeDrawingFromMap(idDibujo)
        clearSelectedMapObject()
        Toast.makeText(activity, "Dibujo eliminado.", Toast.LENGTH_SHORT).show()
    }

    private fun deleteMapObjectFromBackend(
        url: String,
        successMessage: String,
        onSuccess: () -> Unit
    ) {
        val token = host.getMapToken()
        if (token.isBlank()) return

        val request = Request.Builder()
            .url(url)
            .addHeader("Authorization", "Bearer $token")
            .delete()
            .build()

        httpClient.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                Log.e("MAP_DELETE", "Error eliminando objeto", e)
                activity.runOnUiThread {
                    host.addMapMessage(ChatMessage(user = "Sistema", text = "Error de conexion al eliminar el objeto.", type = MessageType.SYSTEM))
                }
            }

            override fun onResponse(call: Call, response: Response) {
                if (!response.isSuccessful) {
                    activity.runOnUiThread {
                        host.addMapMessage(ChatMessage(user = "Sistema", text = "No se pudo eliminar el objeto.", type = MessageType.SYSTEM))
                    }
                    return
                }

                activity.runOnUiThread {
                    onSuccess()
                    clearSelectedMapObject()
                    Toast.makeText(activity, successMessage, Toast.LENGTH_SHORT).show()
                }
            }
        })
    }

    private fun sendRouteToBackend(payloadJson: String) {
        val operationId = host.getMapOperationId()
        Log.d("RUTA_ANDROID", "operationId actual: $operationId")
        if (operationId <= 0) {
            Log.e("RUTA_ANDROID", "No hay operacion activa valida para enviar ruta")
            return
        }

        val token = host.getMapToken()
        if (token.isBlank()) {
            Log.e("RUTA_ANDROID", "No hay token para enviar ruta")
            return
        }

        val requestPayload = runCatching {
            val payload = JSONObject(payloadJson)
            host.getSelectedMapVehiculoId()?.let { idVehiculo ->
                if (idVehiculo > 0) payload.put("id_vehiculo", idVehiculo)
            }
            payload.toString()
        }.getOrElse { e ->
            Log.e("RUTA_ANDROID", "Payload de ruta invalido", e)
            payloadJson
        }

        val createRequest = Request.Builder()
            .url("${ApiConfig.BASE_URL}/ops/$operationId/rutas/navegacion")
            .addHeader("Authorization", "Bearer $token")
            .addHeader("Content-Type", "application/json")
            .post(requestPayload.toRequestBody(JSON_MEDIA_TYPE))
            .build()

        fun createNewRoute() {
            httpClient.newCall(createRequest).enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) {
                    Log.e("RUTA_ANDROID", "Error enviando ruta al backend", e)
                }

                override fun onResponse(call: Call, response: Response) {
                    val body = response.body?.string().orEmpty()
                    Log.d("RUTA_ANDROID", "Respuesta backend ruta: ${response.code} - $body")

                    if (response.isSuccessful) {
                        runCatching {
                            val json = JSONObject(body)
                            if (json.optBoolean("ok")) {
                                lastRouteId = json.optJSONObject("ruta")?.optInt("id_ruta", -1) ?: lastRouteId
                            }
                        }.onFailure { e ->
                            Log.e("RUTA_ANDROID", "Error parseando respuesta json de ruta", e)
                        }
                    } else {
                        Log.e("RUTA_ANDROID", "Backend rechazo la ruta: $body")
                    }
                }
            })
        }

        val previousRouteId = lastRouteId
        if (previousRouteId <= 0) {
            createNewRoute()
            return
        }

        val deleteRequest = Request.Builder()
            .url("${ApiConfig.BASE_URL}/ops/$operationId/rutas/navegacion/$previousRouteId")
            .addHeader("Authorization", "Bearer $token")
            .delete()
            .build()

        httpClient.newCall(deleteRequest).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                Log.e("RUTA_ANDROID", "No se pudo reemplazar la ruta anterior", e)
                activity.runOnUiThread {
                    Toast.makeText(activity, "No se pudo reemplazar la ruta anterior.", Toast.LENGTH_LONG).show()
                }
            }

            override fun onResponse(call: Call, response: Response) {
                val canReplace = response.isSuccessful || response.code == 404
                response.close()
                if (!canReplace) {
                    Log.e("RUTA_ANDROID", "Backend rechazo eliminar ruta anterior: ${response.code}")
                    activity.runOnUiThread {
                        Toast.makeText(activity, "No se pudo reemplazar la ruta anterior.", Toast.LENGTH_LONG).show()
                    }
                    return
                }

                if (lastRouteId == previousRouteId) lastRouteId = -1
                createNewRoute()
            }
        })
    }

    private fun renderSavedPoi(
        responseBody: String,
        lat: Double,
        lon: Double,
        nombre: String,
        tipoPoi: String,
        color: String,
        iconoSrc: String?,
        localTempId: Int? = null
    ): Boolean = runCatching {
        val currentUser = host.getMapCurrentUser()
        val json = JSONObject(responseBody)
        val poi = json.optJSONObject("poi")
        if (!json.optBoolean("ok") || poi == null) return false

        val idPoi = poi.optInt("id_poi")
        val poiLat = poi.optDouble("latitud", lat)
        val poiLon = poi.optDouble("longitud", lon)
        val poiNombre = poi.optString("nombre", nombre)
        val poiTipo = poi.optString("tipo_poi", tipoPoi)
        val poiColor = poi.optString("color", color).ifBlank { color }
        val poiIconoRaw = if (poi.has("icono_src") && !poi.isNull("icono_src")) {
            poi.optString("icono_src")
        } else {
            iconoSrc.orEmpty()
        }
        val poiIconoSrc = resolvePoiIconUrl(poiIconoRaw)
        val poiSidc = if (poi.has("sidc") && !poi.isNull("sidc")) {
            poi.optString("sidc")
                .takeUnless { it.isBlank() || it.equals("null", ignoreCase = true) }
        } else {
            iconoSrc?.takeIf { it.startsWith("S") || it.startsWith("G") }
        }

        activity.runOnUiThread {
            localTempId?.let { cesiumWebController.removePoiFromMap(it) }
            if (idPoi > 0) {
                cesiumWebController.addPoiToMap(
                    idPoi = idPoi,
                    lat = poiLat,
                    lon = poiLon,
                    nombre = poiNombre,
                    tipoPoi = poiTipo,
                    color = poiColor,
                    iconoSrc = poiIconoSrc,
                    sidc = poiSidc
                )
            }

            val coord = "%.5f, %.5f".format(poiLat, poiLon)
            host.addMapMessage(
                ChatMessage(
                    user = currentUser.nombreCompleto,
                    text = "$poiNombre [$poiTipo] -> $coord",
                    type = MessageType.NORMAL
                )
            )
        }
        true
    }.getOrDefault(false)

    private fun toggleFreeDrawingMode(mode: String, label: String) {
        clearSelectedMapObject()
        selectedObjectTool = null
        polygonToolPoints.clear()

        if (drawingMode == mode) {
            stopFreeDrawingMode()
            updateObjectToolSelection(null)
            return
        }

        drawingMode = mode
        drawingMiniToolbar?.visibility = View.VISIBLE
        colorOptions?.visibility = if (mode == "pencil") View.VISIBLE else View.GONE
        updateDrawingToolSelection()
        if (mode == "pencil") {
            cesiumWebController.stopEraserMode()
            cesiumWebController.startPencilMode(selectedPencilColor)
        } else {
            cesiumWebController.stopPencilMode()
            cesiumWebController.startEraserMode()
        }
        updateObjectToolSelection(label)
        Toast.makeText(activity, "$label activo.", Toast.LENGTH_SHORT).show()
    }

    private fun showFreeDrawingToolbar() {
        clearSelectedMapObject()
        selectedObjectTool = null
        polygonToolPoints.clear()
        drawingMode = null
        cesiumWebController.stopPencilMode()
        cesiumWebController.stopEraserMode()
        cesiumWebController.unlockMapNavigation()
        drawingMiniToolbar?.visibility = View.VISIBLE
        colorOptions?.visibility = View.GONE
        updateDrawingToolSelection()
        updateObjectToolSelection(null)
    }

    private fun stopFreeDrawingMode() {
        drawingMode = null
        cesiumWebController.stopPencilMode()
        cesiumWebController.stopEraserMode()
        cesiumWebController.unlockMapNavigation()
        drawingMiniToolbar?.visibility = View.GONE
        colorOptions?.visibility = View.GONE
        updateDrawingToolSelection()
    }

    private fun selectMapObjectTool(tool: ObjectTool, label: String) {
        clearSelectedMapObject()
        stopFreeDrawingMode()
        if (tool != ObjectTool.MIL) pendingMilitarySymbol = null
        if (tool != ObjectTool.POI) pendingPoi = null
        if (tool != ObjectTool.CIRCLE) pendingCoverageCircle = null
        if (tool != ObjectTool.BUILDING && tool != ObjectTool.LABEL) pendingStructure = null
        selectedObjectTool = tool
        updateObjectToolSelection(label)
        Toast.makeText(activity, "$label: toca el mapa para colocar.", Toast.LENGTH_SHORT).show()
    }

    private fun clearSelectedObjectTool() {
        selectedObjectTool = null
        polygonToolPoints.clear()
        updateObjectToolSelection(null)
    }

    private fun updateObjectToolSelection(label: String?) {
        objectToolSelectionView?.text = label.orEmpty()
    }

    private fun updatePencilColorSelection() {
        pencilColorViews.forEach { (id, view) ->
            val colorHex = pencilColorHexById[id] ?: "#FFFFFF"
            val isSelected = colorHex.equals(selectedPencilColor, ignoreCase = true)
            view.background = buildColorCircle(colorHex, isSelected)
            view.alpha = 1f
            view.scaleX = if (isSelected) 1.16f else 1f
            view.scaleY = if (isSelected) 1.16f else 1f
        }
    }

    private fun updateDrawingToolSelection() {
        val pencilActive = drawingMode == "pencil"
        val eraserActive = drawingMode == "eraser"
        miniPencilButton?.background = buildToolCircle(pencilActive)
        miniEraserButton?.background = buildToolCircle(eraserActive)
        miniPencilButton?.setColorFilter(Color.parseColor(if (pencilActive) "#FFFFFF" else "#BFE1FF"))
        miniEraserButton?.setColorFilter(Color.parseColor(if (eraserActive) "#FFFFFF" else "#BFE1FF"))
        miniPencilButton?.alpha = if (eraserActive) 0.74f else 1f
        miniEraserButton?.alpha = if (pencilActive) 0.74f else 1f
    }

    private fun buildToolCircle(active: Boolean): GradientDrawable =
        GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            val density = activity.resources.displayMetrics.density
            setColor(Color.parseColor(if (active) "#D82F7DD3" else "#EE101827"))
            setStroke(
                ((if (active) 2 else 1) * density).toInt().coerceAtLeast(1),
                Color.parseColor(if (active) "#FFFFFFFF" else "#668FA3BD")
            )
        }

    private fun buildColorCircle(colorHex: String, selected: Boolean): GradientDrawable =
        GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(Color.parseColor(colorHex))
            val density = activity.resources.displayMetrics.density
            val strokeWidth = ((if (selected) 3 else 1) * density).toInt().coerceAtLeast(1)
            val strokeColor = if (selected) Color.WHITE else Color.parseColor("#668FA3BD")
            setStroke(strokeWidth, strokeColor)
        }

    private fun buildMilUniqueName(baseName: String): String {
        val normalizedBase = baseName.trim().ifBlank { "Simbolo MIL" }
        val sdf = java.text.SimpleDateFormat("yyyyMMddHHmmssSSS", java.util.Locale.US)
        val stamp = sdf.format(java.util.Date())
        return "$normalizedBase $stamp"
    }

    private fun handleSelectedObjectToolTap(lat: Double, lon: Double): Boolean =
        when (selectedObjectTool) {
            ObjectTool.MIL -> {
                val choice = pendingMilitarySymbol
                if (choice == null) {
                    Log.w("MIL_PLACE", "Tap MIL sin simbolo pendiente lat=$lat lon=$lon")
                    mapActionController.showMilitarySymbolPicker { selected ->
                        pendingMilitarySymbol = selected
                        selectMapObjectTool(ObjectTool.MIL, selected.unitLabel)
                    }
                } else {
                    Log.d("MIL_PLACE", "Colocando ${choice.unitLabel} sidc=${choice.sidc} lat=$lat lon=$lon")
                    pendingMilitarySymbol = null
                    clearSelectedObjectTool()
                    val localId = nextLocalPoiId--
                    val uniqueName = buildMilUniqueName(choice.unitLabel)
                    cesiumWebController.addPoiToMap(
                        idPoi = localId,
                        lat = lat,
                        lon = lon,
                        nombre = uniqueName,
                        tipoPoi = "MIL",
                        color = "#FF4500",
                        iconoSrc = choice.sidc,
                        sidc = choice.sidc,
                        creatorLabel = host.getMapCurrentUser().nombreCompleto
                    )
                    savePoiInternal(lat, lon, uniqueName, "MIL", "#FF4500", choice.sidc, localId)
                    Toast.makeText(activity, "${choice.unitLabel} colocado.", Toast.LENGTH_SHORT).show()
                }
                true
            }
            ObjectTool.POI -> {
                val choice = pendingPoi
                if (choice == null) {
                    mapActionController.showPoiConfigurationDialog { nombre, color ->
                        pendingPoi = nombre to color
                        selectMapObjectTool(ObjectTool.POI, "PDI: $nombre")
                    }
                } else {
                    pendingPoi = null
                    clearSelectedObjectTool()
                    val localId = nextLocalPoiId--
                    cesiumWebController.addPoiToMap(
                        idPoi = localId,
                        lat = lat,
                        lon = lon,
                        nombre = choice.first,
                        tipoPoi = "PDI",
                        color = choice.second,
                        iconoSrc = null,
                        sidc = null,
                        creatorLabel = host.getMapCurrentUser().nombreCompleto
                    )
                    savePoiInternal(lat, lon, choice.first, "PDI", choice.second, null, localId)
                    Toast.makeText(activity, "${choice.first} colocado.", Toast.LENGTH_SHORT).show()
                }
                true
            }
            ObjectTool.CIRCLE -> {
                val draft = pendingCoverageCircle
                if (draft == null) {
                    showCoverageCircleConfigurationDialog { configuredDraft ->
                        pendingCoverageCircle = configuredDraft
                        selectMapObjectTool(ObjectTool.CIRCLE, "Circulo: ${configuredDraft.name}")
                    }
                    true
                } else {
                    pendingCoverageCircle = null
                    clearSelectedObjectTool()
                    saveCoverageCircle(lat, lon, draft)
                    true
                }
            }
            ObjectTool.ROUTE_START -> {
                cesiumWebController.setRouteStart(lat, lon)
                selectedObjectTool = ObjectTool.ROUTE_END
                updateObjectToolSelection("Ruta: destino")
                Toast.makeText(activity, "Origen listo. Ahora toca el destino.", Toast.LENGTH_SHORT).show()
                true
            }
            ObjectTool.ROUTE_END -> {
                cesiumWebController.setRouteEnd(lat, lon)
                clearSelectedObjectTool()
                Toast.makeText(activity, "Ruta marcada.", Toast.LENGTH_SHORT).show()
                true
            }
            ObjectTool.BUILDING -> {
                placePendingStructure(lat, lon, "EDIFICIO", "Edificio", ObjectTool.BUILDING)
            }
            ObjectTool.LABEL -> {
                placePendingStructure(lat, lon, "ETIQUETA", "Etiqueta", ObjectTool.LABEL)
            }
            ObjectTool.POLYGON -> {
                polygonToolPoints.add(lat to lon)
                if (polygonToolPoints.size < 3) {
                    updateObjectToolSelection("Poligono: punto ${polygonToolPoints.size}/3")
                    Toast.makeText(activity, "Punto ${polygonToolPoints.size}/3 agregado.", Toast.LENGTH_SHORT).show()
                } else {
                    val points = polygonToolPoints.toList()
                    clearSelectedObjectTool()
                    savePolygonArea(points)
                }
                true
            }
            null -> false
        }

    private fun showCoverageCircleConfigurationDialog(onConfigured: (CoverageCircleDraft) -> Unit) {
        val density = activity.resources.displayMetrics.density
        fun dp(value: Int): Int = (value * density).toInt()
        fun roundedBg(color: String, stroke: String, radius: Int, width: Int = 1) = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dp(radius).toFloat()
            setColor(Color.parseColor(color))
            setStroke(dp(width), Color.parseColor(stroke))
        }
        fun label(text: String) = TextView(activity).apply {
            this.text = text
            setTextColor(Color.parseColor("#DDEEFF"))
            textSize = 10f
            typeface = Typeface.DEFAULT_BOLD
            setPadding(0, dp(9), 0, dp(4))
        }
        fun styledSpinner(items: List<String>) = Spinner(activity).apply {
            adapter = object : ArrayAdapter<String>(activity, android.R.layout.simple_spinner_item, items) {
                override fun getView(position: Int, convertView: View?, parent: ViewGroup): View =
                    (super.getView(position, convertView, parent) as TextView).apply {
                        setTextColor(Color.WHITE)
                        textSize = 13f
                        typeface = Typeface.DEFAULT_BOLD
                        setPadding(dp(12), 0, dp(8), 0)
                    }
                override fun getDropDownView(position: Int, convertView: View?, parent: ViewGroup): View =
                    (super.getDropDownView(position, convertView, parent) as TextView).apply {
                        setTextColor(Color.WHITE)
                        setBackgroundColor(Color.parseColor("#0B1220"))
                        setPadding(dp(12), dp(10), dp(12), dp(10))
                    }
            }
            background = roundedBg("#2630445E", "#4F8BFF", 10)
        }

        val layout = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(16), dp(18), dp(14))
            background = roundedBg("#F20B1220", "#4F8BFF", 18)
        }
        layout.addView(TextView(activity).apply {
            text = "Circulo de cobertura"
            setTextColor(Color.WHITE)
            textSize = 22f
            typeface = Typeface.DEFAULT_BOLD
        })
        layout.addView(label("NOMBRE"))
        val inputName = EditText(activity).apply {
            setText("Circulo de cobertura")
            setTextColor(Color.WHITE)
            textSize = 14f
            typeface = Typeface.DEFAULT_BOLD
            setSingleLine(true)
            background = roundedBg("#2630445E", "#4F8BFF", 10)
            setPadding(dp(12), 0, dp(12), 0)
        }
        layout.addView(inputName, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(44)))

        val colorNames = listOf("Rojo", "Azul", "Amarillo", "Verde", "Morado")
        val colorValues = listOf("#EF4444", "#3B82F6", "#FACC15", "#22C55E", "#A855F7")
        val colorColumn = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        colorColumn.addView(label("COLOR"))
        val colorSpinner = styledSpinner(colorNames)
        colorColumn.addView(colorSpinner, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(44)))
        layout.addView(colorColumn, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        val opacityColumn = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(2), 0, dp(2))
        }
        val opacityLabel = label("OPACIDAD")
        val opacityValue = TextView(activity).apply {
            text = "25%"
            setTextColor(Color.WHITE)
            textSize = 11f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            background = roundedBg("#D80B1B34", "#4F8BFF", 12)
            setPadding(dp(8), dp(3), dp(8), dp(3))
        }
        val opacityHeader = LinearLayout(activity).apply { gravity = Gravity.CENTER_VERTICAL; addView(opacityLabel, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)); addView(opacityValue) }
        opacityColumn.addView(opacityHeader)
        val opacitySeek = SeekBar(activity).apply {
            max = 70
            progress = 25
            setPadding(0, 0, 0, 0)
        }
        opacitySeek.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: SeekBar?, progress: Int, fromUser: Boolean) { opacityValue.text = "${progress.coerceAtLeast(10)}%" }
            override fun onStartTrackingTouch(seekBar: SeekBar?) = Unit
            override fun onStopTrackingTouch(seekBar: SeekBar?) = Unit
        })
        opacityColumn.addView(opacitySeek, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(38)))
        layout.addView(opacityColumn, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        val sizeRow = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL }
        val radiusColumn = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        radiusColumn.addView(label("RADIO (M)"))
        val inputRadius = EditText(activity).apply {
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
            setText("5000")
            setTextColor(Color.WHITE)
            textSize = 14f
            typeface = Typeface.DEFAULT_BOLD
            setSingleLine(true)
            background = roundedBg("#2630445E", "#4F8BFF", 10)
            setPadding(dp(12), 0, dp(12), 0)
        }
        radiusColumn.addView(inputRadius, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(44)))
        sizeRow.addView(radiusColumn, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        layout.addView(sizeRow)

        val actions = LinearLayout(activity).apply { gravity = Gravity.END; setPadding(0, dp(12), 0, 0) }
        val cancel = TextView(activity).apply { text = "CANCELAR"; setTextColor(Color.parseColor("#BFE1FF")); textSize = 12f; typeface = Typeface.DEFAULT_BOLD; setPadding(dp(12), dp(8), dp(12), dp(8)) }
        val next = TextView(activity).apply { text = "SIGUIENTE"; setTextColor(Color.WHITE); textSize = 12f; typeface = Typeface.DEFAULT_BOLD; background = roundedBg("#D81E3A5F", "#4F8BFF", 9); setPadding(dp(12), dp(8), dp(12), dp(8)) }
        actions.addView(cancel)
        actions.addView(next)
        layout.addView(actions)

        val dialog = AlertDialog.Builder(activity).setView(layout).create()
        cancel.setOnClickListener { dialog.dismiss() }
        next.setOnClickListener {
                val name = inputName.text.toString().trim().ifBlank { "Circulo de cobertura" }
                val radius = inputRadius.text.toString().toDoubleOrNull()?.coerceAtLeast(25.0) ?: 5000.0
                val opacity = opacitySeek.progress.coerceAtLeast(10) / 100.0
                val color = colorValues[colorSpinner.selectedItemPosition.coerceIn(colorValues.indices)]
                onConfigured(CoverageCircleDraft(name, radius, color, opacity))
                dialog.dismiss()
            }
        dialog.setOnShowListener {
            dialog.window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            dialog.window?.setDimAmount(0.35f)
            dialog.window?.setLayout(dp(390), ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        dialog.show()
    }

    private fun placePendingStructure(
        lat: Double,
        lon: Double,
        type: String,
        title: String,
        tool: ObjectTool
    ): Boolean {
        val draft = pendingStructure
        if (draft == null || draft.type != type) {
            showStructureConfigurationDialog(type, title) { configuredDraft ->
                pendingStructure = configuredDraft
                selectMapObjectTool(tool, configuredDraft.title)
            }
            return true
        }

        pendingStructure = null
        clearSelectedObjectTool()
        saveStructure(lat, lon, draft.name, draft.type)
        return true
    }

    private fun showStructureConfigurationDialog(
        type: String,
        title: String,
        onConfigured: (StructureDraft) -> Unit
    ) {
        val density = activity.resources.displayMetrics.density
        fun dp(value: Int): Int = (value * density).toInt()
        fun roundedBg(color: String, stroke: String, radius: Int) = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dp(radius).toFloat()
            setColor(Color.parseColor(color))
            setStroke(dp(1), Color.parseColor(stroke))
        }

        val layout = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(16), dp(18), dp(14))
            background = roundedBg("#F20B1220", "#4F8BFF", 18)
        }
        layout.addView(TextView(activity).apply {
            text = title
            setTextColor(Color.WHITE)
            textSize = 21f
            typeface = Typeface.DEFAULT_BOLD
        })
        layout.addView(TextView(activity).apply {
            text = "NOMBRE"
            setTextColor(Color.parseColor("#DDEEFF"))
            textSize = 10f
            typeface = Typeface.DEFAULT_BOLD
            setPadding(0, dp(10), 0, dp(4))
        })
        val inputName = EditText(activity).apply {
            setText(title)
            setTextColor(Color.WHITE)
            textSize = 14f
            typeface = Typeface.DEFAULT_BOLD
            setSingleLine(true)
            background = roundedBg("#2630445E", "#4F8BFF", 10)
            setPadding(dp(12), 0, dp(12), 0)
        }
        layout.addView(inputName, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(44)))
        val actions = LinearLayout(activity).apply { gravity = Gravity.END; setPadding(0, dp(14), 0, 0) }
        val cancel = TextView(activity).apply {
            text = "CANCELAR"
            setTextColor(Color.parseColor("#BFE1FF"))
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            setPadding(dp(12), dp(8), dp(12), dp(8))
        }
        val next = TextView(activity).apply {
            text = "SIGUIENTE"
            setTextColor(Color.WHITE)
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            background = roundedBg("#D81E3A5F", "#4F8BFF", 9)
            setPadding(dp(12), dp(8), dp(12), dp(8))
        }
        actions.addView(cancel)
        actions.addView(next)
        layout.addView(actions)

        val dialog = AlertDialog.Builder(activity).setView(layout).create()
        cancel.setOnClickListener { dialog.dismiss() }
        next.setOnClickListener {
            val name = inputName.text.toString().trim().ifBlank { title }
            onConfigured(StructureDraft(name, type, title))
            dialog.dismiss()
        }
        dialog.setOnShowListener {
            dialog.window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            dialog.window?.setDimAmount(0.35f)
            dialog.window?.setLayout(dp(360), ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        dialog.show()
    }

    private fun saveCoverageCircle(lat: Double, lon: Double, draft: CoverageCircleDraft) {
        saveArea(
            nombre = draft.name,
            descripcion = "Circulo de cobertura",
            color = draft.color,
            geometry = JSONObject()
                .put("type", "Polygon")
                .put("coordinates", circleCoordinates(lat, lon, draft.radiusMeters))
                .put(
                    "meta",
                    JSONObject()
                        .put("shape", "circle")
                        .put("center", JSONArray().put(lon).put(lat))
                        .put("radius_m", draft.radiusMeters)
                        .put("opacity", draft.opacity)
                        .put("outline_width", 3)
                ),
            onSaved = { idArea ->
                cesiumWebController.addCoverageCircleToMap(idArea, lat, lon, draft.radiusMeters, draft.name, draft.color, draft.opacity, 3.0)
            }
        )
    }

    private fun savePolygonArea(points: List<Pair<Double, Double>>) {
        saveArea(
            nombre = "Poligono Tactico",
            descripcion = "Poligono tactico",
            color = "#FFD700",
            geometry = JSONObject()
                .put("type", "Polygon")
                .put("coordinates", polygonCoordinates(points))
                .put(
                    "meta",
                    JSONObject()
                        .put("shape", "polygon")
                        .put("opacity", 0.35)
                        .put("outline_width", 3)
                ),
            onSaved = { idArea ->
                cesiumWebController.addAreaPolygonToMap(idArea, "Poligono Tactico", buildPolygonPointsJson(points), "#FFD700", 0.35, 3.0)
            }
        )
    }

    private fun saveArea(
        nombre: String,
        descripcion: String,
        color: String,
        geometry: JSONObject,
        onSaved: (Int) -> Unit
    ) {
        val operationId = host.getMapOperationId()
        if (operationId <= 0) return
        val token = host.getMapToken()
        if (token.isBlank()) return

        val body = JSONObject()
            .put("nombre", nombre)
            .put("descripcion", descripcion)
            .put("color", color)
            .put("geometria", geometry)
        putCreatorPayload(body)

        val request = Request.Builder()
            .url("${ApiConfig.BASE_URL}/ops/$operationId/areas")
            .addHeader("Authorization", "Bearer $token")
            .addHeader("Content-Type", "application/json")
            .post(body.toString().toRequestBody(JSON_MEDIA_TYPE))
            .build()

        httpClient.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                Log.e("AREA_ANDROID", "Error guardando area", e)
                activity.runOnUiThread {
                    host.addMapMessage(ChatMessage(user = "Sistema", text = "Error de conexion al guardar el area.", type = MessageType.SYSTEM))
                }
            }

            override fun onResponse(call: Call, response: Response) {
                val responseBody = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    activity.runOnUiThread {
                        host.addMapMessage(ChatMessage(user = "Sistema", text = "No se pudo guardar el area.", type = MessageType.SYSTEM))
                    }
                    return
                }

                val idArea = runCatching {
                    JSONObject(responseBody).optJSONObject("area")?.optInt("id_area", -1) ?: -1
                }.getOrDefault(-1)

                activity.runOnUiThread {
                    if (idArea > 0) {
                        onSaved(idArea)
                        Toast.makeText(activity, "$nombre colocado.", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        })
    }

    private fun saveStructure(lat: Double, lon: Double, nombre: String, tipoEstructura: String) {
        val operationId = host.getMapOperationId()
        if (operationId <= 0) return
        val token = host.getMapToken()
        if (token.isBlank()) return

        val body = JSONObject()
            .put("nombre", nombre)
            .put("tipo_estructura", tipoEstructura)
            .put("latitud", lat)
            .put("longitud", lon)
        putCreatorPayload(body)

        val request = Request.Builder()
            .url("${ApiConfig.BASE_URL}/ops/$operationId/edificios")
            .addHeader("Authorization", "Bearer $token")
            .addHeader("Content-Type", "application/json")
            .post(body.toString().toRequestBody(JSON_MEDIA_TYPE))
            .build()

        httpClient.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                Log.e("ESTRUCTURA_ANDROID", "Error guardando estructura", e)
                activity.runOnUiThread {
                    host.addMapMessage(ChatMessage(user = "Sistema", text = "Error de conexion al guardar la estructura.", type = MessageType.SYSTEM))
                }
            }

            override fun onResponse(call: Call, response: Response) {
                val responseBody = response.body?.string().orEmpty()
                if (!response.isSuccessful) {
                    val mensaje = runCatching {
                        JSONObject(responseBody).optString("mensaje", "No se pudo guardar la estructura.")
                    }.getOrDefault("No se pudo guardar la estructura.")
                    activity.runOnUiThread {
                        host.addMapMessage(ChatMessage(user = "Sistema", text = mensaje, type = MessageType.SYSTEM))
                    }
                    return
                }

                val structure = runCatching {
                    JSONObject(responseBody).optJSONObject("edificio")
                        ?: JSONObject(responseBody).optJSONObject("estructura")
                }.getOrNull()

                val idMarca = structure?.optInt("id_marca", -1) ?: -1
                val savedName = structure?.optString("nombre", nombre) ?: nombre
                val savedType = structure?.optString("tipo_estructura", tipoEstructura) ?: tipoEstructura
                val iconoSrc = resolveStructureIconUrl(savedType)

                activity.runOnUiThread {
                    if (idMarca > 0) {
                        cesiumWebController.addStructureToMap(idMarca, lat, lon, savedName, savedType, iconoSrc)
                        Toast.makeText(activity, "$savedName colocado.", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        })
    }

    private fun putCreatorPayload(body: JSONObject) {
        val currentUser = host.getMapCurrentUser()
        val tipoCreador = if (currentUser.tabla == "personal") "PERSONAL" else "USUARIO"
        val idKey = if (currentUser.tabla == "personal") "id_personal" else "id_usuario"
        body.put("tipo_creador", tipoCreador)
        body.put(idKey, currentUser.id)
    }

    private fun circleCoordinates(lat: Double, lon: Double, radiusMeters: Double): JSONArray {
        val earthRadius = 6378137.0
        val distance = radiusMeters / earthRadius
        val latRad = Math.toRadians(lat)
        val lonRad = Math.toRadians(lon)
        val ring = JSONArray()

        for (i in 0..64) {
            val bearing = 2.0 * PI * i / 64.0
            val pointLat = asin(
                sin(latRad) * cos(distance) +
                    cos(latRad) * sin(distance) * cos(bearing)
            )
            val pointLon = lonRad + atan2(
                sin(bearing) * sin(distance) * cos(latRad),
                cos(distance) - sin(latRad) * sin(pointLat)
            )
            ring.put(JSONArray().put(Math.toDegrees(pointLon)).put(Math.toDegrees(pointLat)))
        }

        return JSONArray().put(ring)
    }

    private fun polygonCoordinates(points: List<Pair<Double, Double>>): JSONArray {
        val ring = JSONArray()
        points.forEach { (lat, lon) ->
            ring.put(JSONArray().put(lon).put(lat))
        }
        points.firstOrNull()?.let { (lat, lon) ->
            ring.put(JSONArray().put(lon).put(lat))
        }
        return JSONArray().put(ring)
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

    private fun resolvePoiIconUrl(iconoSrc: String?): String? {
        val cleaned = iconoSrc?.trim()
        if (cleaned.isNullOrBlank() || cleaned.equals("null", ignoreCase = true)) return null
        if (cleaned.startsWith("S") || cleaned.startsWith("G")) return cleaned
        if (cleaned.startsWith("http://") || cleaned.startsWith("https://")) return cleaned
        return "${ApiConfig.BASE_URL}/${cleaned.trimStart('/')}"
    }

    private fun resolveStructureIconUrl(tipoEstructura: String?): String? {
        val tipo = tipoEstructura?.trim()?.uppercase().orEmpty()
        return if (tipo == "ETIQUETA") null else "${ApiConfig.BASE_URL}/img/estructuras/casa.png"
    }

    private fun jsString(value: String): String =
        value
            .replace("\\", "\\\\")
            .replace("'", "\\'")
            .replace("\n", " ")
            .replace("\r", " ")

    private companion object {
        val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()
    }
}
