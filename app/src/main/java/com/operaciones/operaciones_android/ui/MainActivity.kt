package com.operaciones.operaciones_android.ui

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.res.Configuration
import android.content.pm.PackageManager
import android.graphics.Rect
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.webkit.WebView
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import android.widget.PopupWindow
import android.widget.ScrollView
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import androidx.activity.result.ActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.operaciones.operaciones_android.R
import com.operaciones.operaciones_android.auth.AuthManager
import com.operaciones.operaciones_android.location.LocationHelper
import com.operaciones.operaciones_android.model.ChatMessage
import com.operaciones.operaciones_android.model.DispositivoItem
import com.operaciones.operaciones_android.model.EquipoItem
import com.operaciones.operaciones_android.model.MessageType
import com.operaciones.operaciones_android.model.Operation
import com.operaciones.operaciones_android.model.OperationStatus
import com.operaciones.operaciones_android.model.PersonalItem
import com.operaciones.operaciones_android.model.User
import com.operaciones.operaciones_android.model.VehiculoItem
import com.operaciones.operaciones_android.network.ChatSocketManager
import com.operaciones.operaciones_android.ui.chat.ChatNotificationController
import com.operaciones.operaciones_android.ui.chat.ChatVibrationController
import com.operaciones.operaciones_android.ui.chat.EmergencyVisualAlertController
import com.operaciones.operaciones_android.ui.chat.OperationChatController
import com.operaciones.operaciones_android.ui.call.VoiceCallManager
import com.operaciones.operaciones_android.ui.lifecycle.EmergencyServiceController
import com.operaciones.operaciones_android.ui.lifecycle.OperationLifecycleMonitor
import com.operaciones.operaciones_android.ui.map.MapObjectsController
import com.operaciones.operaciones_android.ui.map.OperationMapDataController
import com.operaciones.operaciones_android.ui.media.MediaStreamController
import com.operaciones.operaciones_android.ui.navigation.PanelNavigationController
import com.operaciones.operaciones_android.ui.navigation.PanelNavigationController.Panel
import com.operaciones.operaciones_android.ui.panel.MainPanelRenderer
import com.operaciones.operaciones_android.ui.panel.ChatChannelSelection
import com.operaciones.operaciones_android.ui.panel.ChatGroupMember
import com.operaciones.operaciones_android.ui.panel.PanelDataController
import com.operaciones.operaciones_android.ui.simulation.OperationSimulationController
import com.operaciones.operaciones_android.ui.socket.OperationSocketController
import com.operaciones.operaciones_android.webview.CesiumWebController
import com.operaciones.operaciones_android.webview.MainJsBridge
import com.operaciones.operaciones_android.wear.PhoneWearListenerService
import okhttp3.OkHttpClient
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.UUID

class MainActivity : AppCompatActivity(),
    MainPanelRenderer.Host,
    PanelNavigationController.Host,
    OperationSimulationController.Host,
    OperationChatController.Host,
    MediaStreamController.Host,
    EmergencyServiceController.Host,
    OperationLifecycleMonitor.Host,
    MapObjectsController.Host,
    OperationMapDataController.Host,
    PanelDataController.Host,
    OperationSocketController.Host {

    // Map: JS localId → id_dibujo del backend

    private lateinit var webView: WebView
    private lateinit var panelContent: FrameLayout
    private lateinit var connectionBanner: TextView
    private lateinit var pttAlertBanner: TextView
    private lateinit var directedAlertBanner: View
    private lateinit var directedAlertMessage: TextView
    private lateinit var btnNavOperation: LinearLayout
    private lateinit var btnNavChat: LinearLayout
    private lateinit var chatUnreadBadge: TextView
    private lateinit var btnNavPersonal: LinearLayout
    private lateinit var btnNavVehiculos: LinearLayout
    private lateinit var btnNavEquipos: LinearLayout
    private lateinit var btnNavDispositivos: LinearLayout
    private lateinit var btnMyLocation: ImageButton
    private lateinit var btnStreamMedia: ImageButton
    private lateinit var btnBluetoothMedia: ImageButton
    private lateinit var btnDeleteSelectedObject: Button
    private var bluetoothController: BluetoothController? = null

    private var chatSocketManager: ChatSocketManager? = null
    private var isMgrsActive: Boolean = false
    private var voiceCallManager: VoiceCallManager? = null
    private var voiceCallDialog: AlertDialog? = null
    private var activeCallId: String? = null
    private var activeCallPeerId: Int? = null
    private var activeCallPeerName: String = ""
    private var activeCallSelection: ChatChannelSelection? = null
    private var activeCallOutgoing = false
    private var activeCallConnectedAt = 0L
    private var pendingVoiceCallSelection: ChatChannelSelection? = null
    private var voiceCallMuted = false

    private val httpClient = OkHttpClient()

    private lateinit var panelRenderer: MainPanelRenderer
    private lateinit var cesiumWebController: CesiumWebController
    private lateinit var locationHelper: LocationHelper
    private lateinit var simulationController: OperationSimulationController
    private lateinit var chatController: OperationChatController
    private lateinit var chatNotificationController: ChatNotificationController
    private lateinit var emergencyVisualAlertController: EmergencyVisualAlertController
    private lateinit var mediaStreamController: MediaStreamController
    private lateinit var emergencyServiceController: EmergencyServiceController
    private lateinit var lifecycleMonitor: OperationLifecycleMonitor
    private lateinit var mapObjectsController: MapObjectsController
    private lateinit var mapDataController: OperationMapDataController
    private lateinit var panelDataController: PanelDataController

    private lateinit var panelNavigationController: PanelNavigationController

    private lateinit var currentUser: User
    private lateinit var currentOperation: Operation

    private val personalList = mutableListOf<PersonalItem>()
    private val vehiculosList = mutableListOf<VehiculoItem>()
    private val equiposList = mutableListOf<EquipoItem>()
    private val dispositivosList = mutableListOf<DispositivoItem>()
    private val livePersonalLocations = mutableMapOf<Int, Pair<Double, Double>>()
    private val liveVehiculoLocations = mutableMapOf<Int, Pair<Double, Double>>()
    private val liveEquipoLocations = mutableMapOf<Int, Pair<Double, Double>>()
    private val liveDispositivoLocations = mutableMapOf<Int, Pair<Double, Double>>()

    private var opLat = 0.0
    private var opLon = 0.0
    private var opZoom = 8000
    private var lastRouteId: Int = -1
    private var centerOnNextLocation = false
    private var followedPersonalId: Int? = null
    private var selectedVehiculoId: Int? = null
    private var pendingChatAttachmentDestination: ChatAttachmentDestination? = null
    private var pendingCameraOutputUri: Uri? = null
    private var pendingCameraKind: String = "IMAGE"
    private var voiceRecorder: MediaRecorder? = null
    private var voiceOutputFile: File? = null
    private var voiceStartedAt: Long = 0L
    private val voiceTimerHandler = Handler(Looper.getMainLooper())
    private val voiceTimerRunnable = object : Runnable {
        override fun run() {
            if (voiceRecorder == null || voiceStartedAt <= 0L) return
            updateVoiceRecordingIndicator()
            voiceTimerHandler.postDelayed(this, 500L)
        }
    }
    private var chatContactsVisible = false
    private var vehicleInfoPopup: PopupWindow? = null
    private var personalInfoPopup: PopupWindow? = null
    private var equipmentInfoPopup: PopupWindow? = null
    private var selectedPersonalInfoId: Int? = null
    private var lastPersonalCoordinates: Pair<Double?, Double?> = null to null
    private var lastPersonalViewport: Pair<Double?, Double?> = null to null
    private val trackingTimestampFormats = listOf(
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSX", Locale.US),
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssX", Locale.US),
        SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSSX", Locale.US),
        SimpleDateFormat("yyyy-MM-dd HH:mm:ssX", Locale.US),
        SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US),
        SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US)
    ).onEach { it.timeZone = TimeZone.getTimeZone("UTC") }

    // Última posición conocida del usuario — se emite al socket cuando se conecta
    private var lastKnownLat: Double? = null
    private var lastKnownLon: Double? = null

    private var isCesiumReady = false

    private data class ChatAttachmentDestination(
        val destinatarioRol: String?,
        val destinoTipo: String?,
        val destinoId: String?,
        val destinoLabel: String?
    )

    private val pickChatMediaLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == RESULT_OK) {
            result.data?.data?.let { uri ->
                sendChatAttachmentUri(uri = uri, forcedKind = null, fallbackName = null)
            }
        }
    }

    private val captureChatMediaLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result: ActivityResult ->
        if (result.resultCode == RESULT_OK) {
            val isVideo = pendingCameraKind == "VIDEO"
            val uri = if (isVideo && result.data?.data != null) result.data!!.data else pendingCameraOutputUri ?: result.data?.data
            uri?.let {
                sendChatAttachmentUri(
                    uri = it,
                    forcedKind = pendingCameraKind,
                    fallbackName = if (pendingCameraKind == "VIDEO") "camara_video.mp4" else "camara_foto.jpg",
                    forcedMimeType = if (pendingCameraKind == "VIDEO") "video/mp4" else "image/jpeg"
                )
            }
        }
        pendingCameraOutputUri = null
    }

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        if (event.action == MotionEvent.ACTION_DOWN) {
            hideKeyboardIfTouchOutsideFocusedInput(event)
        }
        return super.dispatchTouchEvent(event)
    }

    private fun hideKeyboardIfTouchOutsideFocusedInput(event: MotionEvent) {
        val focusedInput = currentFocus as? EditText ?: return
        val inputBounds = Rect()
        focusedInput.getGlobalVisibleRect(inputBounds)

        if (inputBounds.contains(event.rawX.toInt(), event.rawY.toInt())) return

        focusedInput.clearFocus()

        val imm = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
        imm.hideSoftInputFromWindow(focusedInput.windowToken, 0)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        currentUser = AuthManager.getCurrentUser(this) ?: run {
            goToLogin()
            return
        }
        PhoneWearListenerService.voiceCallActionHandler = { callId, action ->
            runOnUiThread {
                if (callId != activeCallId) return@runOnUiThread
                when (action) {
                    "accept" -> acceptIncomingVoiceCall()
                    "end" -> finishVoiceCall(true)
                    "reject" -> {
                        emitVoiceCall("voice_call_reject")
                        finishVoiceCall(false)
                    }
                }
            }
        }

        opLat = intent.getDoubleExtra("OP_LAT", 0.0)
        opLon = intent.getDoubleExtra("OP_LON", 0.0)
        opZoom = intent.getIntExtra("OP_ZOOM", 8000)

        val opId = intent.getIntExtra("OPERATION_ID", -1)
        currentOperation = Operation(
            id = opId,
            codigo = intent.getStringExtra("OP_CODIGO") ?: "",
            nombre = intent.getStringExtra("OP_NOMBRE") ?: "Operación",
            descripcion = intent.getStringExtra("OP_DESCRIPCION") ?: "",
            prioridad = intent.getStringExtra("OP_PRIORIDAD") ?: "MEDIA",
            status = OperationStatus.ACTIVA,
            fechaInicio = intent.getStringExtra("OP_FECHA_INICIO") ?: "",
            fechaFin = intent.getStringExtra("OP_FECHA_FIN") ?: "",
            zonaLat = opLat,
            zonaLon = opLon,
            zonaZoom = opZoom
        )
        simulationController = OperationSimulationController(
            context = this,
            httpClient = httpClient,
            host = this
        )
        chatController = OperationChatController(
            host = this,
            vibrationController = ChatVibrationController(this)
        )
        lifecycleMonitor = OperationLifecycleMonitor(
            httpClient = httpClient,
            host = this
        )
        chatNotificationController = ChatNotificationController(this)
        emergencyVisualAlertController = EmergencyVisualAlertController(this)
        emergencyServiceController = EmergencyServiceController(this, this)

        chatSocketManager = OperationSocketController(this).create()
        setContentView(R.layout.activity_main)
        requestChatNotificationPermissionIfNeeded()

        panelContent = findViewById(R.id.panelContent)
        connectionBanner = findViewById(R.id.connectionBanner)
        pttAlertBanner = findViewById(R.id.pttAlertBanner)
        directedAlertBanner = findViewById(R.id.directedAlertBanner)
        directedAlertMessage = findViewById(R.id.tvDirectedAlertMessage)
        findViewById<View>(R.id.btnDismissDirectedAlert).setOnClickListener {
            directedAlertBanner.visibility = View.GONE
        }
        btnNavOperation = findViewById(R.id.btnNavOperation)
        btnNavChat = findViewById(R.id.btnNavChat)
        chatUnreadBadge = findViewById(R.id.chatUnreadBadge)
        btnNavPersonal = findViewById(R.id.btnNavPersonal)
        btnNavVehiculos = findViewById(R.id.btnNavVehiculos)
        btnNavEquipos = findViewById(R.id.btnNavEquipos)
        btnNavDispositivos = findViewById(R.id.btnNavDispositivos)
        btnMyLocation = findViewById(R.id.btnMyLocation)
        btnStreamMedia = findViewById(R.id.btnStreamMedia)
        btnBluetoothMedia = findViewById(R.id.btnBluetoothMedia)
        btnDeleteSelectedObject = findViewById(R.id.btnDeleteSelectedObject)
        webView = findViewById(R.id.cesiumWebView)

        bluetoothController = BluetoothController(this, btnBluetoothMedia).apply {
            onPttAlertTriggered = { active ->
                val senderName = if (::currentUser.isInitialized) currentUser.nombreCompleto else "Elemento PTT"
                chatSocketManager?.emitPttAlertToggle(
                    active = active,
                    senderName = senderName,
                    lat = lastKnownLat,
                    lon = lastKnownLon,
                    idPersonal = if (::currentUser.isInitialized) currentUser.id else null
                )
                showPttAlertBanner(
                    active = active,
                    senderName = senderName,
                    lat = lastKnownLat,
                    lon = lastKnownLon,
                    idPersonal = if (::currentUser.isInitialized) currentUser.id else null,
                    isOwnAlert = true
                )

                // Evaluar localmente en el WebView del celular
                val js = "if (typeof handlePttEmergencyAlert === 'function') handlePttEmergencyAlert({ active: $active, sender_name: '${senderName.replace("'", "\\'")}' });"
                if (::cesiumWebController.isInitialized) {
                    cesiumWebController.evaluate(js)
                }
            }
        }
        mediaStreamController = MediaStreamController(this, btnStreamMedia, this)
        panelRenderer = MainPanelRenderer(this)
        panelDataController = PanelDataController(this)

        cesiumWebController = CesiumWebController(
            webView = webView,
            jsBridge = MainJsBridge(this),
            opLat = opLat,
            opLon = opLon,
            opZoom = opZoom
        )

        mapDataController = OperationMapDataController(
            webView = webView,
            cesiumWebController = cesiumWebController,
            host = this
        )

        mapObjectsController = MapObjectsController(
            activity = this,
            cesiumWebController = cesiumWebController,
            httpClient = httpClient,
            host = this
        )

        configurePanelContentSize()

        locationHelper = LocationHelper(
            activity = this,
            onLocationUpdate = { latitude, longitude ->
                lastKnownLat = latitude
                lastKnownLon = longitude
                cesiumWebController.updateMyPosition(latitude, longitude, shouldShowSelfLocationMarker())
                if (::currentUser.isInitialized) {
                    if (recordPersonalLocation(currentUser.id, latitude, longitude)) {
                        panelRenderer.updatePersonalLocation(currentUser.id, latitude, longitude)
                    }
                    currentUser.idDispositivo?.let { idDispositivo ->
                        val dispositivo = dispositivosList.firstOrNull { it.idDispositivo == idDispositivo }
                        if (recordDispositivoLocation(idDispositivo, latitude, longitude)) {
                            panelRenderer.updateDispositivoLocation(
                                idDispositivo,
                                latitude,
                                longitude,
                                dispositivo?.numeroSerie,
                                dispositivo?.imei
                            )
                        }
                    }
                    if (followedPersonalId == currentUser.id) {
                        cesiumWebController.centerOnLocation(latitude, longitude, zoom = 500, follow = true)
                    }
                    refreshEquipmentLocationsFromAssignments()
                }
                if (centerOnNextLocation) {
                    centerOnNextLocation = false
                    cesiumWebController.centerOnLocation(latitude, longitude, follow = false)
                }
            },
            onEmitLocation = { lat, lon, speedKmh, headingDegrees, accuracyMeters ->
                lastKnownLat = lat
                lastKnownLon = lon
                if (::currentUser.isInitialized) {
                    val deviceId = currentUser.idDispositivo
                    if (deviceId != null) {
                        val dispositivo = dispositivosList.firstOrNull { it.idDispositivo == deviceId }
                        chatSocketManager?.emitTrackingDispositivo(
                            idDispositivo = deviceId,
                            lat = lat,
                            lon = lon,
                            speedKmh = speedKmh,
                            headingDegrees = headingDegrees,
                            accuracyMeters = accuracyMeters,
                            numeroSerie = dispositivo?.numeroSerie,
                            imei = dispositivo?.imei
                        )
                    } else {
                        chatSocketManager?.emitTracking(
                            idPersonal = currentUser.id,
                            lat = lat,
                            lon = lon,
                            apodo = currentUser.nombreCompleto,
                            rol = currentUser.rol.name,
                            speedKmh = speedKmh,
                            headingDegrees = headingDegrees,
                            accuracyMeters = accuracyMeters
                        )
                    }
                }
            }
        )

        panelNavigationController = PanelNavigationController(
            panelContent = panelContent,
            btnNavOperation = btnNavOperation,
            btnNavChat = btnNavChat,
            btnNavPersonal = btnNavPersonal,
            btnNavVehiculos = btnNavVehiculos,
            btnNavEquipos = btnNavEquipos,
            btnNavDispositivos = btnNavDispositivos,
            userLabel = currentUser.nombreCompleto.ifBlank { currentUser.username }.ifBlank { "Usuario" },
            host = this
        )

        setupWebView()
        setupMyLocationButton()
        setupMediaStreamButton()
        setupSelectedObjectDeleteButton()
        setupObjectToolsMenu()
        setupMapToolsDrawer()
        panelNavigationController.setupNavigation()
        setupBackPress()
        restoreActivePanel(savedInstanceState)
        // Conectar socket primero para que esté listo cuando llegue la primera ubicación
        chatSocketManager?.onPttAlertUpdate = { data ->
            val active = data.optBoolean("active", false)
            val senderName = data.optString("sender_name", "Elemento PTT")
            val lat = data.optNullableDouble("lat")
            val lon = data.optNullableDouble("lon")
            val idPersonal = if (data.has("id_personal") && !data.isNull("id_personal")) {
                data.optInt("id_personal").takeIf { it > 0 }
            } else {
                null
            }
            val isOwnAlert = idPersonal != null &&
                ::currentUser.isInitialized &&
                idPersonal == currentUser.id
            val js = "if (typeof handlePttEmergencyAlert === 'function') handlePttEmergencyAlert({ active: $active, sender_name: '${senderName.replace("'", "\\'")}' });"
            runOnUiThread {
                showPttAlertBanner(active, senderName, lat, lon, idPersonal, isOwnAlert)
                if (::cesiumWebController.isInitialized) {
                    cesiumWebController.evaluate(js)
                }
            }
        }
        chatSocketManager?.connect()
        startServerConnectionMonitor()
        locationHelper.requestLocationPermissionOrStart()

        if (currentOperation.id > 0) {
            fetchMapaData()
            fetchPersonalPanelData()
            fetchVehiculosPanelData()
            fetchEquiposPanelData()
            fetchDispositivosPanelData()
            startEmergencyService()
        }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        configurePanelContentSize()
        if (newConfig.orientation == Configuration.ORIENTATION_LANDSCAPE && ::panelNavigationController.isInitialized) {
            panelNavigationController.showPanel(Panel.NONE)
        }
        if (::cesiumWebController.isInitialized) {
            cesiumWebController.resize()
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun setupMyLocationButton() {
        btnMyLocation.setOnTouchListener { view, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    view.animate().cancel()
                    view.animate()
                        .scaleX(0.9f)
                        .scaleY(0.9f)
                        .alpha(0.78f)
                        .setDuration(70L)
                        .start()
                }

                MotionEvent.ACTION_UP,
                MotionEvent.ACTION_CANCEL -> {
                    view.animate().cancel()
                    view.animate()
                        .scaleX(1f)
                        .scaleY(1f)
                        .alpha(1f)
                        .setDuration(110L)
                        .start()
                }
            }
            false
        }

        btnMyLocation.setOnClickListener {
            val lat = lastKnownLat
            val lon = lastKnownLon

            if (lat == null || lon == null) {
                centerOnNextLocation = true
                Toast.makeText(this, "Buscando tu ubicacion...", Toast.LENGTH_SHORT).show()
                locationHelper.requestLocationPermissionOrStart()
                return@setOnClickListener
            }

            cesiumWebController.updateMyPosition(lat, lon, shouldShowSelfLocationMarker())
            cesiumWebController.centerOnLocation(lat, lon, follow = false)
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun setupMediaStreamButton() {
        mediaStreamController.setupButton()
    }

    private fun setupSelectedObjectDeleteButton() {
        mapObjectsController.setupDeleteControls(btnDeleteSelectedObject)
    }

    private fun configurePanelContentSize() {
        val chatExpanded = ::panelNavigationController.isInitialized &&
            panelNavigationController.activePanel == Panel.CHAT
        applyPanelContentSize(expanded = chatExpanded)
    }

    private fun applyPanelContentSize(expanded: Boolean) {
        panelContent.post {
            val params = panelContent.layoutParams
            val parentView = panelContent.parent as? View
            val parentParams = parentView?.layoutParams

            val activePanel = if (::panelNavigationController.isInitialized) {
                panelNavigationController.activePanel
            } else {
                Panel.NONE
            }

            val isLandscape = resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE

            val streamBtn = findViewById<View>(R.id.btnStreamMedia)
            val bluetoothBtn = findViewById<View>(R.id.btnBluetoothMedia)
            val menuDrawerBtn = findViewById<View>(R.id.btnMapToolsDrawer)
            val toolsContainer = findViewById<View>(R.id.objectToolsContainer)
            val myLocationBtn = findViewById<View>(R.id.btnMyLocation)
            val navBar = findViewById<View>(R.id.navBar)

            val isMapOnly = activePanel == Panel.NONE
            menuDrawerBtn?.visibility = if (isMapOnly && !expanded) View.VISIBLE else View.GONE
            bluetoothBtn?.visibility = if (isMapOnly && !expanded) View.VISIBLE else View.GONE

            if (expanded) {
                params.height = 0
                (params as? LinearLayout.LayoutParams)?.weight = 1f
                parentParams?.height = ViewGroup.LayoutParams.MATCH_PARENT
                parentView?.layoutParams = parentParams
                streamBtn?.visibility = View.GONE
                bluetoothBtn?.visibility = View.GONE
                menuDrawerBtn?.visibility = View.GONE
                toolsContainer?.visibility = View.GONE
                myLocationBtn?.visibility = View.GONE
                navBar?.visibility = View.GONE
            } else if (activePanel == Panel.NONE) {
                params.height = 0
                (params as? LinearLayout.LayoutParams)?.weight = 0f
                parentParams?.height = ViewGroup.LayoutParams.WRAP_CONTENT
                parentView?.layoutParams = parentParams
                streamBtn?.visibility = View.VISIBLE
                bluetoothBtn?.visibility = View.VISIBLE
                menuDrawerBtn?.visibility = View.VISIBLE
                toolsContainer?.visibility = View.VISIBLE
                myLocationBtn?.visibility = View.VISIBLE
                navBar?.visibility = View.VISIBLE
            } else {
                if (isLandscape) {
                    params.height = 0
                    (params as? LinearLayout.LayoutParams)?.weight = 1f
                    parentParams?.height = ViewGroup.LayoutParams.MATCH_PARENT
                    parentView?.layoutParams = parentParams
                    streamBtn?.visibility = View.VISIBLE
                    bluetoothBtn?.visibility = View.GONE
                    menuDrawerBtn?.visibility = View.GONE
                    toolsContainer?.visibility = View.VISIBLE
                    myLocationBtn?.visibility = View.VISIBLE
                    navBar?.visibility = View.VISIBLE
                } else {
                    params.height = (resources.displayMetrics.heightPixels * 0.40).toInt()
                    (params as? LinearLayout.LayoutParams)?.weight = 0f
                    parentParams?.height = ViewGroup.LayoutParams.WRAP_CONTENT
                    parentView?.layoutParams = parentParams
                    streamBtn?.visibility = View.VISIBLE
                    bluetoothBtn?.visibility = View.GONE
                    menuDrawerBtn?.visibility = View.GONE
                    toolsContainer?.visibility = View.VISIBLE
                    myLocationBtn?.visibility = View.VISIBLE
                    navBar?.visibility = View.VISIBLE
                }
            }
            panelContent.layoutParams = params
            panelContent.requestLayout()
            parentView?.let { p ->
                p.requestLayout()
                p.invalidate()
            }
        }
    }

    private fun restoreActivePanel(savedInstanceState: Bundle?) {
        val restoredPanel = savedInstanceState
            ?.getString(KEY_ACTIVE_PANEL)
            ?.let { value -> runCatching { Panel.valueOf(value) }.getOrNull() }
            ?: Panel.NONE
        panelNavigationController.showPanel(restoredPanel)
    }

    fun onMapObjectSelectedFromBridge(payloadJson: String) {
        mapObjectsController.onMapObjectSelectedFromBridge(payloadJson)
    }

    fun onMapObjectMovedFromBridge(payloadJson: String) {
        mapObjectsController.onMapObjectMovedFromBridge(payloadJson)
    }

    fun clearSelectedMapObject() {
        if (::mapObjectsController.isInitialized) {
            mapObjectsController.clearSelectedMapObject()
        }
    }

    override fun onDestroy() {
        PhoneWearListenerService.voiceCallActionHandler = null
        bluetoothController?.destroy()
        finishVoiceCall(notifyPeer = true)
        super.onDestroy()
        stopSimulation()
        stopServerConnectionMonitor()
        chatSocketManager?.disconnect()
        if (!isChangingConfigurations) {
            stopEmergencyService()
            stopMediaStream(showToast = false)
        }
        stopVoiceMessageRecording(send = false)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (::panelNavigationController.isInitialized) {
            outState.putString(KEY_ACTIVE_PANEL, panelNavigationController.activePanel.name)
        }
    }

    // ── EmergencyMonitorService ──────────────────────────────────────────────

    private fun startServerConnectionMonitor() {
        lifecycleMonitor.start()
    }

    private fun stopServerConnectionMonitor() {
        if (::lifecycleMonitor.isInitialized) {
            lifecycleMonitor.stop()
        }
    }

    private fun setServerConnectionBanner(show: Boolean) {
        if (!::connectionBanner.isInitialized) return
        connectionBanner.visibility = if (show) View.VISIBLE else View.GONE
    }

    private fun showPttAlertBanner(
        active: Boolean,
        senderName: String,
        lat: Double? = null,
        lon: Double? = null,
        idPersonal: Int? = null,
        isOwnAlert: Boolean = false
    ) {
        if (!::pttAlertBanner.isInitialized) return
        runOnUiThread {
            pttAlertBanner.animate().cancel()
            if (active) {
                val name = senderName.trim().ifBlank { "ELEMENTO PTT" }.uppercase(Locale.getDefault())
                if (isOwnAlert) {
                    pttAlertBanner.setBackgroundResource(R.drawable.bg_ptt_alert_banner_own)
                    pttAlertBanner.text = "ALERTA PTT ENVIADA\nACTIVADA POR TI\nVER MI UBICACIÓN"
                } else {
                    pttAlertBanner.setBackgroundResource(R.drawable.bg_ptt_alert_banner)
                    pttAlertBanner.text = "ALERTA DE EMERGENCIA PTT\nACTIVADA POR $name\nVER UBICACIÓN"
                }
                pttAlertBanner.isClickable = true
                pttAlertBanner.isFocusable = true
                pttAlertBanner.setOnClickListener {
                    focusPttAlertLocation(lat, lon, idPersonal, if (isOwnAlert) "TI" else name)
                }
                showPttAlertZones(lat, lon, idPersonal)
                pttAlertBanner.alpha = 0f
                pttAlertBanner.translationY = -80f
                pttAlertBanner.visibility = View.VISIBLE
                pttAlertBanner.animate()
                    .alpha(1f)
                    .translationY(0f)
                    .setDuration(220L)
                    .start()
            } else if (pttAlertBanner.visibility == View.VISIBLE) {
                pttAlertBanner.isClickable = false
                pttAlertBanner.setOnClickListener(null)
                if (::cesiumWebController.isInitialized) {
                    cesiumWebController.evaluate("if(typeof clearPttEmergencyZones === 'function') clearPttEmergencyZones()")
                }
                pttAlertBanner.animate()
                    .alpha(0f)
                    .translationY(-80f)
                    .setDuration(180L)
                    .withEndAction {
                        pttAlertBanner.visibility = View.GONE
                        pttAlertBanner.alpha = 1f
                        pttAlertBanner.translationY = 0f
                    }
                    .start()
            }
        }
    }

    private fun showPttAlertZones(lat: Double?, lon: Double?, idPersonal: Int?) {
        if (!::cesiumWebController.isInitialized) return
        val location = validPair(lat, lon) ?: idPersonal?.let { livePersonalLocations[it] } ?: return
        cesiumWebController.evaluate(
            "if(typeof showPttEmergencyZones === 'function') showPttEmergencyZones(${location.first}, ${location.second}, ${idPersonal ?: "null"})"
        )
    }

    private fun focusPttAlertLocation(
        alertLat: Double?,
        alertLon: Double?,
        idPersonal: Int?,
        senderName: String
    ) {
        val alertLocation = validPair(alertLat, alertLon)
        val location = alertLocation ?: idPersonal?.let { livePersonalLocations[it] }
        if (location == null) {
            Toast.makeText(
                this,
                "La ubicación de $senderName todavía no está disponible.",
                Toast.LENGTH_SHORT
            ).show()
            return
        }

        panelNavigationController.showPanel(Panel.NONE)
        val (latitude, longitude) = location
        if (idPersonal != null) {
            followedPersonalId = idPersonal
            cesiumWebController.followTrackingPersonal(idPersonal, latitude, longitude, zoom = 500)
        } else {
            followedPersonalId = null
            cesiumWebController.centerOnLocation(latitude, longitude, zoom = 500, follow = false)
        }
        cesiumWebController.evaluate(
            "if(typeof showPttEmergencyZones === 'function') showPttEmergencyZones($latitude, $longitude, ${idPersonal ?: "null"})"
        )
        Toast.makeText(this, "Ubicación de $senderName", Toast.LENGTH_SHORT).show()
    }

    private fun org.json.JSONObject.optNullableDouble(key: String): Double? {
        if (!has(key) || isNull(key)) return null
        return optDouble(key, Double.NaN).takeIf { !it.isNaN() && !it.isInfinite() }
    }

    override fun getLifecycleUserId(): Int? =
        if (::currentUser.isInitialized) currentUser.id else null

    override fun getLifecycleOperationId(): Int =
        if (::currentOperation.isInitialized) currentOperation.id else -1

    override fun getLifecycleToken(): String = AuthManager.getToken(this)

    override fun onServerConnectionChanged(isDisconnected: Boolean) {
        setServerConnectionBanner(isDisconnected)
        if (!isDisconnected && chatSocketManager?.isConnected() != true) {
            chatSocketManager?.connect()
        }
        if (!isDisconnected && ::chatController.isInitialized) {
            chatController.syncMissedMessages()
        }
    }

    override fun onAssignedOperationClosed(operation: Operation?) {
        leaveClosedOperation(operation)
    }

    private fun leaveClosedOperation(operation: Operation?) {
        stopSimulation()
        stopServerConnectionMonitor()
        chatSocketManager?.disconnect()
        stopEmergencyService()
        stopMediaStream(showToast = false)

        val intent = Intent(this, OperationStatusActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            putExtra("USER_ID", currentUser.id)
            putExtra("OPERATION_ID", operation?.id ?: currentOperation.id)
            putExtra("OP_ESTADO", operation?.status?.name ?: "CERRADA")
        }

        startActivity(intent)
        finish()
    }

    override fun getEmergencyOperation(): Operation = currentOperation

    override fun getEmergencyUser(): User = currentUser

    override fun getEmergencyToken(): String = AuthManager.getToken(this)

    private fun hasLocationPermission(): Boolean =
        ::emergencyServiceController.isInitialized && emergencyServiceController.hasLocationPermission()

    private fun startEmergencyService() {
        if (::emergencyServiceController.isInitialized) {
            emergencyServiceController.start()
        }
    }

    private fun stopEmergencyService() {
        if (::emergencyServiceController.isInitialized) {
            emergencyServiceController.stop()
        }
    }

    private fun requestMediaStreamForOperation() {
        mediaStreamController.requestForOperation()
    }

    private fun stopMediaStream(showToast: Boolean = true) {
        if (::mediaStreamController.isInitialized) {
            mediaStreamController.stop(showToast)
        }
    }

    override fun getMediaOperationId(): Int = currentOperation.id

    override fun getMediaToken(): String = AuthManager.getToken(this)

    override fun getMediaUser(): User = currentUser

    override fun onInvalidMediaSession() {
        goToLogin()
    }

    override fun shouldHideMediaControls(): Boolean {
        return ::panelNavigationController.isInitialized &&
            panelNavigationController.activePanel == Panel.CHAT
    }

    override fun getMapOperationId(): Int = currentOperation.id

    override fun getMapToken(): String = AuthManager.getToken(this)

    override fun getMapCurrentUser(): User = currentUser

    override fun addMapMessage(msg: ChatMessage) {
        addMessage(msg)
    }

    override fun openMapChatPanel() {
        openChatPanel()
    }

    override fun isMapChatPanelActive(): Boolean =
        isChatPanelActive()

    override fun selectMapPersonal(idPersonal: Int?) {
        selectedVehiculoId = null
        if (::cesiumWebController.isInitialized) cesiumWebController.setRouteVehicleId(null)
        if (::panelRenderer.isInitialized) {
            panelRenderer.selectPersonal(idPersonal)
            if (idPersonal != null) {
                panelRenderer.selectVehiculo(null)
                panelRenderer.selectEquipo(null)
                panelRenderer.selectDispositivo(null)
            }
        }
    }

    override fun selectMapVehiculo(idVehiculo: Int?) {
        selectedVehiculoId = idVehiculo
        if (::cesiumWebController.isInitialized) cesiumWebController.setRouteVehicleId(idVehiculo)
        if (::panelRenderer.isInitialized) {
            panelRenderer.selectVehiculo(idVehiculo)
            if (idVehiculo != null) {
                panelRenderer.selectPersonal(null)
                panelRenderer.selectEquipo(null)
                panelRenderer.selectDispositivo(null)
            }
        }
    }

    override fun selectMapEquipo(idEquipo: Int?) {
        selectedVehiculoId = null
        if (::cesiumWebController.isInitialized) cesiumWebController.setRouteVehicleId(null)
        if (::panelRenderer.isInitialized) {
            panelRenderer.selectEquipo(idEquipo)
            if (idEquipo != null) {
                panelRenderer.selectPersonal(null)
                panelRenderer.selectVehiculo(null)
                panelRenderer.selectDispositivo(null)
            }
        }
    }

    override fun selectMapDispositivo(idDispositivo: Int?) {
        selectedVehiculoId = null
        if (::cesiumWebController.isInitialized) cesiumWebController.setRouteVehicleId(null)
        if (::panelRenderer.isInitialized) {
            panelRenderer.selectDispositivo(idDispositivo)
            if (idDispositivo != null) {
                panelRenderer.selectPersonal(null)
                panelRenderer.selectVehiculo(null)
                panelRenderer.selectEquipo(null)
            }
        }
    }

    override fun getMapDataOperationId(): Int = currentOperation.id

    override fun getMapDataToken(): String = AuthManager.getToken(this)

    override fun getMapDataCurrentUserId(): Int = currentUser.id

    override fun isMapDataCesiumReady(): Boolean = isCesiumReady

    override fun runMapDataOnUi(block: () -> Unit) {
        runOnUiThread(block)
    }

    override fun onMapDataOperationZoneChanged(lat: Double, lon: Double, zoom: Int) {
        opLat = lat
        opLon = lon
        opZoom = zoom
    }

    override fun onMapDataNavigationRoutesLoaded(routesJson: String) {
        updateSimulationRouteFromRoutesJson(routesJson)
    }

    override fun updateMapDataPersonalPanel(idPersonal: Int, lat: Double, lon: Double) {
        if (recordPersonalLocation(idPersonal, lat, lon)) {
            panelRenderer.updatePersonalLocation(idPersonal, lat, lon)
            refreshEquipmentLocationsFromAssignments()
        }
    }

    override fun updateMapDataVehiculoPanel(idVehiculo: Int, lat: Double, lon: Double) {
        if (recordVehiculoLocation(idVehiculo, lat, lon)) {
            panelRenderer.updateVehiculoLocation(idVehiculo, lat, lon)
            refreshEquipmentLocationsFromAssignments()
        }
    }

    override fun updateMapDataEquipoPanel(idEquipo: Int, lat: Double, lon: Double) {
        if (recordEquipoLocation(idEquipo, lat, lon)) {
            panelRenderer.updateEquipoLocation(idEquipo, lat, lon)
        }
    }

    override fun updateMapDataDispositivoPanel(
        idDispositivo: Int,
        lat: Double,
        lon: Double,
        numeroSerie: String,
        imei: String
    ) {
        val dispositivo = dispositivosList.firstOrNull { it.idDispositivo == idDispositivo }
        if (dispositivo != null && !matchesDispositivoIdentity(dispositivo, numeroSerie, imei)) return
        if (recordDispositivoLocation(idDispositivo, lat, lon)) {
            panelRenderer.updateDispositivoLocation(idDispositivo, lat, lon, numeroSerie, imei)
            refreshEquipmentLocationsFromAssignments()
        }
    }

    override fun loadMapDataDrawings(replace: Boolean) {
        loadDrawingsFromBackend(replace)
    }

    override fun onMapDataError(message: String) {
        addMessage(ChatMessage(user = "Sistema", text = message, type = MessageType.SYSTEM))
    }

    override fun getSocketOperationId(): Int = currentOperation.id

    override fun getSocketUserId(): Int = currentUser.id

    override fun getSocketDeviceId(): Int? = currentUser.idDispositivo

    override fun getSocketDeviceSerial(): String? =
        currentUser.idDispositivo
            ?.let { id -> dispositivosList.firstOrNull { it.idDispositivo == id } }
            ?.numeroSerie
            ?.takeIf { it.isNotBlank() }

    override fun getSocketDeviceImei(): String? =
        currentUser.idDispositivo
            ?.let { id -> dispositivosList.firstOrNull { it.idDispositivo == id } }
            ?.imei
            ?.takeIf { it.isNotBlank() }

    override fun getSocketUserRole(): String = currentUser.rol.name

    override fun getSocketUserName(): String = currentUser.nombreCompleto

    override fun getSocketLastKnownLat(): Double? = lastKnownLat

    override fun getSocketLastKnownLon(): Double? = lastKnownLon

    override fun isSocketCesiumReady(): Boolean = isCesiumReady

    override fun runSocketOnUi(block: () -> Unit) {
        runOnUiThread(block)
    }

    override fun onSocketNewMessage(item: JSONObject) {
        chatController.addMessageFromJson(item)
    }

    override fun onSocketRemoteRouteCreated(routeJson: String, route: JSONObject) {
        updateSimulationRouteFromRouteJson(routeJson)
        mapDataController.onRemoteRouteCreated(routeJson, route)
    }

    override fun onSocketRemoteRouteDeleted(idRoute: Int) {
        if (idRoute == -1) return
        handleSimulationRouteDeleted(idRoute)
        cesiumWebController.evaluate("if(typeof removeRemoteRoute === 'function') removeRemoteRoute($idRoute)")
    }

    override fun onSocketTacticalRouteCreated(route: JSONObject) {
        mapDataController.onTacticalRouteCreated(route)
    }

    override fun onSocketTacticalRouteDeleted(idRoute: Int) {
        if (idRoute > 0 && isCesiumReady) {
            cesiumWebController.removeTacticalRouteFromMap(idRoute)
        }
    }

    override fun onSocketTrackingPersonal(id: Int, lat: Double, lon: Double, label: String, rumboGrados: Double?, speed: Double?) {
        val index = personalList.indexOfFirst { it.idPersonal == id }
        if (index != -1) {
            val person = personalList[index]
            personalList[index] = person.copy(
                lat = lat,
                lon = lon,
                rumboGrados = rumboGrados ?: person.rumboGrados,
                velocidadKmh = speed ?: person.velocidadKmh,
                ultimaActualizacion = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(java.util.Date())
            )
            if (personalInfoPopup?.isShowing == true && selectedPersonalInfoId == id) {
                showMapPersonalInfo(
                    id,
                    null,
                    lastPersonalCoordinates.first,
                    lastPersonalCoordinates.second,
                    lastPersonalViewport.first,
                    lastPersonalViewport.second
                )
            }
        }

        val person = personalList.firstOrNull { it.idPersonal == id }
        val meta = JSONObject()
            .put("rol", person?.rol ?: "")
            .put("nombre", person?.nombre ?: label)
            .put("apellido", person?.apellido ?: "")
            .put("apodo", person?.apodo ?: label)
            .put("grupoNombre", person?.grupoNombre ?: "")
            .put("grupoApodo", person?.grupoApodo ?: "")
            .put("cetNombre", person?.cetNombre ?: "")
            .apply { (rumboGrados ?: person?.rumboGrados)?.takeIf { !it.isNaN() && !it.isInfinite() }?.let { put("rumbo_grados", it) } }
            .apply { speed?.takeIf { !it.isNaN() && !it.isInfinite() }?.let { put("velocidad", it) } }
        cesiumWebController.evaluate(
            "if(typeof updateTrackingPersonal === 'function') updateTrackingPersonal($id, $lat, $lon, '${jsString(label)}', ${meta})"
        )
        if (recordPersonalLocation(id, lat, lon)) {
            panelRenderer.updatePersonalLocation(id, lat, lon)
            refreshEquipmentLocationsFromAssignments()
        }
    }

    override fun onSocketSignosVitalesPersonal(
        idPersonal: Int,
        fc: Int?,
        baro: Double?,
        battery: Double?
    ) {
        val index = personalList.indexOfFirst { it.idPersonal == idPersonal }
        if (index != -1) {
            val person = personalList[index]
            personalList[index] = person.copy(
                frecuenciaCardiacaBpm = fc ?: person.frecuenciaCardiacaBpm,
                presionBarometricaHpa = baro ?: person.presionBarometricaHpa,
                bateriaPct = battery ?: person.bateriaPct,
                ultimaActualizacion = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(java.util.Date())
            )
            if (personalInfoPopup?.isShowing == true && selectedPersonalInfoId == idPersonal) {
                showMapPersonalInfo(
                    idPersonal,
                    null,
                    lastPersonalCoordinates.first,
                    lastPersonalCoordinates.second,
                    lastPersonalViewport.first,
                    lastPersonalViewport.second
                )
            }
        }
    }

    override fun onSocketTrackingVehicle(id: Int, lat: Double, lon: Double, label: String, rumboGrados: Double?, speed: Double?) {
        val vehiculo = vehiculosList.firstOrNull { it.idVehiculo == id }
        val meta = JSONObject()
            .put("tipo", vehiculo?.tipo ?: "")
            .put("nombre", vehiculo?.nombre ?: label)
            .put("alias", vehiculo?.alias ?: label)
            .put("codigo_interno", vehiculo?.codigoInterno ?: "")
            .put("detalle", vehiculo?.detalle ?: "")
            .apply { (rumboGrados ?: vehiculo?.rumboGrados)?.takeIf { !it.isNaN() && !it.isInfinite() }?.let { put("rumbo_grados", it) } }
            .apply { speed?.takeIf { !it.isNaN() && !it.isInfinite() }?.let { put("velocidad", it) } }
        cesiumWebController.evaluate(
            "if(typeof updateTrackingVehiculo === 'function') updateTrackingVehiculo($id, $lat, $lon, '${jsString(label)}', ${meta})"
        )
        if (recordVehiculoLocation(id, lat, lon)) {
            panelRenderer.updateVehiculoLocation(id, lat, lon)
            refreshEquipmentLocationsFromAssignments()
        }
    }

    override fun onSocketTrackingEquipo(id: Int, lat: Double, lon: Double, label: String, rumboGrados: Double?) {
        val equipo = equiposList.firstOrNull { it.idEquipo == id }
        val meta = JSONObject()
            .put("categoria", equipo?.categoria ?: "")
            .put("tipo_equipo", equipo?.tipoEquipo ?: "")
            .put("nombre", equipo?.nombre ?: label)
            .put("numero_serie", equipo?.numeroSerie ?: "")
            .apply { (rumboGrados ?: equipo?.rumboGrados)?.let { put("rumbo_grados", it) } }
        cesiumWebController.evaluate(
            "if(typeof updateTrackingEquipo === 'function') updateTrackingEquipo($id, $lat, $lon, '${jsString(label)}', ${meta})"
        )
        if (recordEquipoLocation(id, lat, lon)) {
            panelRenderer.updateEquipoLocation(id, lat, lon)
        }
    }

    override fun onSocketTrackingDispositivo(
        id: Int,
        lat: Double,
        lon: Double,
        label: String,
        numeroSerie: String?,
        imei: String?,
        rumboGrados: Double?
    ) {
        val dispositivo = dispositivosList.firstOrNull { it.idDispositivo == id }
        if (dispositivo != null && !matchesDispositivoIdentity(dispositivo, numeroSerie, imei)) return
        val meta = JSONObject()
            .put("tipo", dispositivo?.tipo ?: "")
            .put("marca", dispositivo?.marca ?: "")
            .put("modelo", dispositivo?.modelo ?: "")
            .put("numero_serie", numeroSerie ?: dispositivo?.numeroSerie ?: "")
            .put("imei", imei ?: dispositivo?.imei ?: "")
            .apply { (rumboGrados ?: dispositivo?.rumboGrados)?.let { put("rumbo_grados", it) } }
        cesiumWebController.evaluate(
            "if(typeof updateTrackingDispositivo === 'function') updateTrackingDispositivo($id, $lat, $lon, '${jsString(label)}', ${meta})"
        )
        if (recordDispositivoLocation(id, lat, lon)) {
            panelRenderer.updateDispositivoLocation(id, lat, lon, numeroSerie, imei)
            refreshEquipmentLocationsFromAssignments()
        }
    }

    override fun onSocketPoiCreated(
        idPoi: Int,
        lat: Double,
        lon: Double,
        nombre: String,
        tipo: String,
        color: String,
        iconoSrc: String?,
        sidc: String?
    ) {
        mapDataController.onPoiCreated(idPoi, lat, lon, nombre, tipo, color, iconoSrc, sidc)
    }

    override fun onSocketPoiDeleted(idPoi: Int) {
        if (idPoi > 0 && isCesiumReady) {
            cesiumWebController.removePoiFromMap(idPoi)
        }
    }

    override fun onSocketAreaPolygonCreated(
        idArea: Int,
        nombre: String,
        pointsJson: String,
        color: String,
        opacity: Double,
        outlineWidth: Double
    ) {
        mapDataController.onAreaPolygonCreated(idArea, nombre, pointsJson, color, opacity, outlineWidth)
    }

    override fun onSocketCoverageCircleCreated(
        idArea: Int,
        centerLat: Double,
        centerLon: Double,
        radiusM: Double,
        nombre: String,
        color: String,
        opacity: Double,
        outlineWidth: Double
    ) {
        mapDataController.onCoverageCircleCreated(idArea, centerLat, centerLon, radiusM, nombre, color, opacity, outlineWidth)
    }

    override fun onSocketAreaDeleted(idArea: Int) {
        if (idArea > 0 && isCesiumReady) {
            cesiumWebController.removeAreaFromMap(idArea)
        }
    }

    override fun onSocketStructureCreated(
        idMarca: Int,
        lat: Double,
        lon: Double,
        nombre: String,
        tipoEstructura: String
    ) {
        mapDataController.onStructureCreated(idMarca, lat, lon, nombre, tipoEstructura)
    }

    override fun onSocketStructureDeleted(idMarca: Int) {
        if (idMarca > 0 && isCesiumReady) {
            cesiumWebController.removeStructureFromMap(idMarca)
        }
    }

    override fun onSocketDrawingCreated(dibujo: JSONObject) {
        val idDibujo = dibujo.optInt("id_dibujo", -1)
        if (idDibujo <= 0 || mapObjectsController.hasDrawingBackendId(idDibujo)) return

        val puntos = dibujo.optJSONArray("puntos") ?: JSONArray()
        val coords = JSONArray()
        for (i in 0 until puntos.length()) {
            val p = puntos.optJSONObject(i) ?: continue
            coords.put(JSONObject().put("lat", p.optDouble("lat")).put("lng", p.optDouble("lng")))
        }
        if (coords.length() < 2) return

        val draw = JSONObject()
            .put("id_dibujo", idDibujo)
            .put("color", dibujo.optString("color", "#00ffa6"))
            .put("grosor", dibujo.optDouble("grosor", 4.0))
            .put("coords", coords)
        if (isCesiumReady) cesiumWebController.loadDrawings(JSONArray().put(draw).toString())
    }

    override fun onSocketDrawingDeleted(idDibujo: Int) {
        if (idDibujo > 0 && isCesiumReady) {
            cesiumWebController.removeDrawingFromMap(idDibujo)
        }
    }

    override fun onSocketGridUpdated(grid: JSONObject) {
        mapDataController.onOperationGridUpdated(grid)
    }

    override fun onSocketGridDeleted() {
        mapDataController.onOperationGridDeleted()
    }

    override fun onSocketMgrsToggled(active: Boolean) {
        isMgrsActive = active
        if (::cesiumWebController.isInitialized) {
            cesiumWebController.evaluate("(function(){ if(typeof toggleMgrsGrid==='function') toggleMgrsGrid($active); })();")
        }
    }

    override fun onSocketConnected() {
        setServerConnectionBanner(false)
        syncMapStateFromBackend()
    }

    override fun onSocketDisconnected() {
        setServerConnectionBanner(true)
    }

    override fun addMessage(msg: ChatMessage) {
        chatController.addMessage(msg)
    }

    override fun openChatPanel() {
        panelNavigationController.showPanel(Panel.CHAT)
    }

    override fun selectPersonalOnMap(idPersonal: Int, lat: Double, lon: Double, label: String) {
        if (!isValidTrackingLocation(lat, lon)) {
            Toast.makeText(this, "$label sin ubicacion activa.", Toast.LENGTH_SHORT).show()
            return
        }
        followedPersonalId = idPersonal
        panelRenderer.selectPersonal(idPersonal)
        panelRenderer.selectVehiculo(null)
        panelRenderer.selectEquipo(null)
        panelRenderer.selectDispositivo(null)
        if (::currentUser.isInitialized && idPersonal == currentUser.id) {
            cesiumWebController.selectTrackingPersonal(idPersonal)
            cesiumWebController.centerOnLocation(lat, lon, zoom = 500, follow = true)
        } else {
            cesiumWebController.followTrackingPersonal(idPersonal, lat, lon, zoom = 500)
        }
        showMapPersonalInfo(idPersonal, label, null, null, null, null)
    }

    override fun selectVehiculoOnMap(idVehiculo: Int, lat: Double?, lon: Double?, label: String) {
        if (lat == null || lon == null || !isValidTrackingLocation(lat, lon)) {
            Toast.makeText(this, "$label sin ubicacion activa.", Toast.LENGTH_SHORT).show()
            return
        }
        followedPersonalId = null
        panelRenderer.selectPersonal(null)
        panelRenderer.selectVehiculo(idVehiculo)
        panelRenderer.selectEquipo(null)
        panelRenderer.selectDispositivo(null)
        cesiumWebController.followTrackingVehiculo(idVehiculo, lat, lon, zoom = 500)
        showMapVehiculoInfo(idVehiculo, null, null, null, null)
    }

    override fun selectEquipoOnMap(idEquipo: Int, lat: Double?, lon: Double?, label: String) {
        if (lat == null || lon == null || !isValidTrackingLocation(lat, lon)) {
            Toast.makeText(this, "$label sin ubicacion activa.", Toast.LENGTH_SHORT).show()
            return
        }
        followedPersonalId = null
        panelRenderer.selectPersonal(null)
        panelRenderer.selectVehiculo(null)
        panelRenderer.selectEquipo(idEquipo)
        panelRenderer.selectDispositivo(null)
        cesiumWebController.followTrackingEquipo(idEquipo, lat, lon, zoom = 500)
        showMapEquipoInfo(idEquipo, null, null, null, null)
    }

    override fun selectDispositivoOnMap(idDispositivo: Int, lat: Double?, lon: Double?, label: String) {
        if (lat == null || lon == null || !isValidTrackingLocation(lat, lon)) {
            Toast.makeText(this, "$label sin ubicacion activa.", Toast.LENGTH_SHORT).show()
            return
        }
        followedPersonalId = null
        panelRenderer.selectPersonal(null)
        panelRenderer.selectVehiculo(null)
        panelRenderer.selectEquipo(null)
        panelRenderer.selectDispositivo(idDispositivo)
        cesiumWebController.followTrackingDispositivo(idDispositivo, lat, lon, zoom = 500, label = label)
    }

    override fun selectPoiOnMap(idPoi: Int, lat: Double, lon: Double, label: String) {
        if (!isValidTrackingLocation(lat, lon)) {
            Toast.makeText(this, "$label sin ubicacion valida.", Toast.LENGTH_SHORT).show()
            return
        }
        cesiumWebController.centerOnLocation(lat, lon, zoom = 500, follow = false)
        Toast.makeText(this, "Centrando en $label", Toast.LENGTH_SHORT).show()
    }

    override fun deletePoi(idPoi: Int, label: String) {
        val operationId = currentOperation.id
        if (operationId <= 0 || idPoi <= 0) return

        androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("Eliminar $label")
            .setMessage("¿Estás seguro de que deseas eliminar este elemento del mapa?")
            .setPositiveButton("Eliminar") { dialog, _ ->
                dialog.dismiss()
                mapObjectsController.deletePoiById(idPoi, label)
                mapDataController.removePoi(idPoi)
                inflateResourcesPanel()
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    override fun refreshPersonalPanelIfActive() {
        if (panelNavigationController.activePanel == Panel.PERSONAL && personalList.isNotEmpty()) {
            panelNavigationController.showPanel(Panel.PERSONAL)
        }
    }

    private fun isChatPanelActive(): Boolean =
        panelNavigationController.activePanel == Panel.CHAT

    private fun markVisibleChatMessagesRead() {
        if (!isChatPanelActive() || !::chatNotificationController.isInitialized) return
        chatNotificationController.cancelMessages(chatController.visibleMessages)
    }

    fun requestLocationPermissionFromBridge() {
        locationHelper.requestLocationPermissionOrStart()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (::locationHelper.isInitialized) {
            locationHelper.handlePermissionsResult(requestCode, grantResults)
        }
        if (hasLocationPermission()) {
            startEmergencyService()
        }

        if (::mediaStreamController.isInitialized) {
            mediaStreamController.handlePermissionsResult(requestCode)
        }

        if (requestCode == BluetoothController.REQUEST_BLUETOOTH_PERMISSIONS) {
            bluetoothController?.onPermissionsResult(
                grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }
            )
        }

        if (requestCode == REQUEST_CHAT_CAMERA_PERMISSION && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            chooseChatCameraMode()
        }

        if (requestCode == REQUEST_CHAT_AUDIO_PERMISSION && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            startVoiceMessageRecording()
        }

        if (requestCode == REQUEST_VOICE_CALL_AUDIO_PERMISSION) {
            val selection = pendingVoiceCallSelection
            pendingVoiceCallSelection = null
            if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED && selection != null) {
                startVoiceCall(selection)
            } else {
                Toast.makeText(this, "Se necesita acceso al micrófono para llamar", Toast.LENGTH_SHORT).show()
            }
        }

        if (requestCode == REQUEST_INCOMING_CALL_AUDIO_PERMISSION) {
            if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
                acceptIncomingVoiceCall()
            } else {
                emitVoiceCall("voice_call_reject")
                finishVoiceCall(false)
                Toast.makeText(this, "Llamada rechazada: micrófono sin permiso", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun fetchMapaData() {
        mapDataController.fetchMapaData()
    }
                    
    private fun syncMapStateFromBackend(force: Boolean = false) {
        if (::mapDataController.isInitialized) {
            mapDataController.syncFromBackend(force)
        }
    }

    override fun getPanelDataOperationId(): Int = currentOperation.id

    override fun getPanelDataToken(): String = AuthManager.getToken(this)

    override fun runPanelDataOnUi(block: () -> Unit) {
        runOnUiThread(block)
    }

    override fun onPanelPersonalLoaded(items: List<PersonalItem>) {
        personalList.clear()
        personalList.addAll(items)

        if (panelNavigationController.activePanel == Panel.PERSONAL) {
            inflatePersonalPanel()
        } else if (panelNavigationController.activePanel == Panel.CHAT) {
            refreshChatPanelIfActive()
        }
        refreshEquipmentLocationsFromAssignments()
    }

    override fun onPanelVehiculosLoaded(items: List<VehiculoItem>) {
        vehiculosList.clear()
        vehiculosList.addAll(items)

        if (panelNavigationController.activePanel == Panel.VEHICULOS) {
            inflateVehiculoPanel()
        } else if (panelNavigationController.activePanel == Panel.CHAT) {
            refreshChatPanelIfActive()
        }
        refreshEquipmentLocationsFromAssignments()
    }

    private fun refreshChatPanelIfActive() {
        if (panelNavigationController.activePanel == Panel.CHAT) {
            panelNavigationController.showPanel(Panel.CHAT)
        }
    }

    override fun onPanelEquiposLoaded(items: List<EquipoItem>) {
        equiposList.clear()
        equiposList.addAll(items)
        equiposList.forEach { equipo ->
            validPair(equipo.lat, equipo.lon)?.let { location ->
                if (equipo.idEquipo !in liveEquipoLocations) {
                    liveEquipoLocations[equipo.idEquipo] = location
                }
            }
        }

        if (panelNavigationController.activePanel == Panel.EQUIPOS) {
            inflateEquipoPanel()
        }
        refreshEquipmentLocationsFromAssignments()
    }

    override fun onPanelDispositivosLoaded(items: List<DispositivoItem>) {
        items.forEach { liveDispositivoLocations.remove(it.idDispositivo) }
        dispositivosList.clear()
        dispositivosList.addAll(items.map(::deviceWithFreshTrackingOnly))
        dispositivosList.forEach { dispositivo ->
            validPair(dispositivo.lat, dispositivo.lon)?.let { liveDispositivoLocations[dispositivo.idDispositivo] = it }
            val location = liveDispositivoLocations[dispositivo.idDispositivo] ?: return@forEach
            dispositivo.idPersonal?.let { idPersonal ->
                livePersonalLocations[idPersonal] = location
            }
        }

        if (panelNavigationController.activePanel == Panel.DISPOSITIVOS) {
            inflateDispositivoPanel()
        }
        refreshEquipmentLocationsFromAssignments()
    }

    override fun onPanelDataError(message: String) {
        addMessage(ChatMessage(user = "Sistema", text = message, type = MessageType.SYSTEM))
    }

    private fun recordPersonalLocation(idPersonal: Int, lat: Double, lon: Double): Boolean {
        if (!isValidTrackingLocation(lat, lon)) return false
        livePersonalLocations[idPersonal] = lat to lon
        return true
    }

    private fun recordVehiculoLocation(idVehiculo: Int, lat: Double, lon: Double): Boolean {
        if (!isValidTrackingLocation(lat, lon)) return false
        liveVehiculoLocations[idVehiculo] = lat to lon
        return true
    }

    private fun recordEquipoLocation(idEquipo: Int, lat: Double, lon: Double): Boolean {
        if (!isValidTrackingLocation(lat, lon)) return false
        liveEquipoLocations[idEquipo] = lat to lon
        return true
    }

    private fun recordDispositivoLocation(idDispositivo: Int, lat: Double, lon: Double): Boolean {
        if (!isValidTrackingLocation(lat, lon)) return false
        liveDispositivoLocations[idDispositivo] = lat to lon
        dispositivosList.firstOrNull { it.idDispositivo == idDispositivo }?.idPersonal?.let { idPersonal ->
            livePersonalLocations[idPersonal] = lat to lon
        }
        return true
    }

    private fun refreshEquipmentLocationsFromAssignments() {
        if (equiposList.isEmpty()) return
        equiposList.forEach { equipo ->
            val location = resolveEquipoLocation(equipo) ?: return@forEach
            panelRenderer.updateEquipoLocation(equipo.idEquipo, location.first, location.second)
        }
    }

    private fun resolveEquipoLocation(equipo: EquipoItem): Pair<Double, Double>? {
        liveEquipoLocations[equipo.idEquipo]?.let { return it }
        equipo.idPersonalAsignado?.let { livePersonalLocations[it]?.let { location -> return location } }
        equipo.idVehiculoAsignado?.let { liveVehiculoLocations[it]?.let { location -> return location } }
        return validPair(equipo.lat, equipo.lon)
    }

    private fun validPair(lat: Double?, lon: Double?): Pair<Double, Double>? {
        if (lat == null || lon == null) return null
        return if (isValidTrackingLocation(lat, lon)) lat to lon else null
    }

    private fun isValidTrackingLocation(lat: Double, lon: Double): Boolean =
        !lat.isNaN() &&
            !lon.isNaN() &&
            !lat.isInfinite() &&
            !lon.isInfinite() &&
            lat in -90.0..90.0 &&
            lon in -180.0..180.0 &&
            !(lat == 0.0 && lon == 0.0)

    private fun matchesDispositivoIdentity(
        dispositivo: DispositivoItem,
        numeroSerie: String?,
        imei: String?
    ): Boolean {
        val incoming = setOf(numeroSerie, imei)
            .map { normalizeDeviceIdentity(it) }
            .filter { it.isNotBlank() }
            .toSet()
        if (incoming.isEmpty()) return false

        return setOf(dispositivo.numeroSerie, dispositivo.imei, dispositivo.identificadorApp)
            .map { normalizeDeviceIdentity(it) }
            .any { it.isNotBlank() && it in incoming }
    }

    private fun normalizeDeviceIdentity(value: String?): String =
        value?.trim()?.lowercase().orEmpty()

    private fun deviceWithFreshTrackingOnly(dispositivo: DispositivoItem): DispositivoItem {
        if (isFreshTrackingTimestamp(dispositivo.ultimaActualizacion)) return dispositivo
        return dispositivo.copy(
            lat = null,
            lon = null,
            velocidadKmh = null,
            rumboGrados = null,
            precisionM = null,
            bateriaPct = null
        )
    }

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

    private fun fetchPersonalPanelData() {
        panelDataController.fetchPersonal()
    }

    private fun fetchVehiculosPanelData() {
        panelDataController.fetchVehiculos()
    }

    private fun fetchEquiposPanelData() {
        panelDataController.fetchEquipos()
    }

    private fun fetchDispositivosPanelData() {
        panelDataController.fetchDispositivos()
    }

    private fun setupWebView() {
        cesiumWebController.setup()
    }

    override fun sendChatMessage(
        text: String,
        alert: Boolean,
        destinatarioRol: String?,
        destinoTipo: String?,
        destinoId: String?,
        destinoLabel: String?
    ) {
        chatController.sendMessage(
            text = text,
            alert = alert,
            destinatarioRol = destinatarioRol,
            destinoTipo = destinoTipo,
            destinoId = destinoId,
            destinoLabel = destinoLabel
        )
    }

    override fun requestChatAttachment(
        source: String,
        destinatarioRol: String?,
        destinoTipo: String?,
        destinoId: String?,
        destinoLabel: String?
    ) {
        pendingChatAttachmentDestination = ChatAttachmentDestination(
            destinatarioRol = destinatarioRol,
            destinoTipo = destinoTipo,
            destinoId = destinoId,
            destinoLabel = destinoLabel
        )

        when (source.lowercase()) {
            "voice" -> toggleVoiceMessageRecording()
            "gallery" -> openChatGalleryPicker()
            "file" -> openChatFilePicker()
            "camera" -> chooseChatCameraMode()
        }
    }

    private fun openChatGalleryPicker() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/*", "video/*"))
        }
        pickChatMediaLauncher.launch(intent)
    }

    private fun openChatFilePicker() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
        }
        pickChatMediaLauncher.launch(intent)
    }

    private fun chooseChatCameraMode() {
        if (!hasPermission(Manifest.permission.CAMERA)) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.CAMERA), REQUEST_CHAT_CAMERA_PERMISSION)
            return
        }

        AlertDialog.Builder(this)
            .setTitle("Enviar desde camara")
            .setItems(arrayOf("Foto", "Video")) { _, which ->
                if (which == 0) startChatCameraCapture("IMAGE") else startChatCameraCapture("VIDEO")
            }
            .show()
    }

    private fun startChatCameraCapture(kind: String) {
        pendingCameraKind = kind
        val isVideo = kind == "VIDEO"
        val file = createChatMediaFile(
            prefix = if (isVideo) "chat_video_" else "chat_image_",
            suffix = if (isVideo) ".mp4" else ".jpg"
        )
        val uri = FileProvider.getUriForFile(this, "${packageName}.fileprovider", file)
        pendingCameraOutputUri = uri

        val intent = Intent(if (isVideo) MediaStore.ACTION_VIDEO_CAPTURE else MediaStore.ACTION_IMAGE_CAPTURE).apply {
            putExtra(MediaStore.EXTRA_OUTPUT, uri)
            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        captureChatMediaLauncher.launch(intent)
    }

    private fun toggleVoiceMessageRecording() {
        if (voiceRecorder != null) {
            stopVoiceMessageRecording(send = true)
            return
        }

        if (!hasPermission(Manifest.permission.RECORD_AUDIO)) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.RECORD_AUDIO), REQUEST_CHAT_AUDIO_PERMISSION)
            return
        }

        startVoiceMessageRecording()
    }

    @Suppress("DEPRECATION")
    private fun startVoiceMessageRecording() {
        val file = createChatMediaFile(prefix = "chat_voice_", suffix = ".m4a")
        voiceOutputFile = file
        voiceStartedAt = System.currentTimeMillis()

        try {
            voiceRecorder = MediaRecorder().apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setOutputFile(file.absolutePath)
                prepare()
                start()
            }
        } catch (e: Exception) {
            voiceRecorder?.release()
            voiceRecorder = null
            voiceOutputFile = null
            voiceStartedAt = 0L
            Toast.makeText(this, "No se pudo iniciar la grabacion: ${e.message}", Toast.LENGTH_SHORT).show()
            return
        }

        updateVoiceRecordingUi(recording = true)
    }

    private fun stopVoiceMessageRecording(send: Boolean) {
        val recorder = voiceRecorder ?: return
        val file = voiceOutputFile
        val duration = (System.currentTimeMillis() - voiceStartedAt).coerceAtLeast(0L)

        try {
            recorder.stop()
        } catch (_: Exception) {
        } finally {
            recorder.release()
            voiceRecorder = null
            voiceOutputFile = null
            voiceStartedAt = 0L
            updateVoiceRecordingUi(recording = false)
        }

        if (send && file != null && file.exists() && file.length() > 0) {
            sendChatAttachmentUri(
                uri = Uri.fromFile(file),
                forcedKind = "AUDIO",
                fallbackName = file.name,
                forcedMimeType = "audio/mp4",
                durationMs = duration
            )
            Toast.makeText(this, "Mensaje de voz enviado.", Toast.LENGTH_SHORT).show()
        }
    }

    override fun startVoiceCall(selection: ChatChannelSelection) {
        val peerId = (selection.destinoSendId ?: selection.destinoId)?.toIntOrNull()
        if (peerId == null || peerId <= 0) {
            Toast.makeText(this, "No se pudo identificar al contacto", Toast.LENGTH_SHORT).show()
            return
        }
        if (activeCallId != null) {
            Toast.makeText(this, "Ya hay una llamada en curso", Toast.LENGTH_SHORT).show()
            return
        }
        if (!hasPermission(Manifest.permission.RECORD_AUDIO)) {
            pendingVoiceCallSelection = selection
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.RECORD_AUDIO),
                REQUEST_VOICE_CALL_AUDIO_PERMISSION
            )
            return
        }
        beginOutgoingVoiceCall(selection, peerId, selection.destinoLabel ?: "Contacto")
    }

    private fun beginOutgoingVoiceCall(
        selection: ChatChannelSelection,
        peerId: Int,
        peerName: String
    ) {
        activeCallId = UUID.randomUUID().toString()
        activeCallPeerId = peerId
        activeCallPeerName = peerName
        activeCallSelection = selection
        activeCallOutgoing = true
        activeCallConnectedAt = 0L
        emitVoiceCall("voice_call_invite", JSONObject().put("caller_name", currentUser.nombreCompleto))
        showVoiceCallDialog("Llamando a $peerName", "Esperando respuesta", incoming = false)
    }

    override fun onSocketVoiceCallEvent(event: String, data: JSONObject) {
        val callId = data.optString("call_id")
        val fromId = data.optInt("from_personal_id", -1)
        if (callId.isBlank() || fromId <= 0) return

        if (event == "voice_call_invite") {
            if (activeCallId != null) {
                chatSocketManager?.emitVoiceCall("voice_call_reject", JSONObject().apply {
                    put("call_id", callId)
                    put("to_personal_id", fromId)
                    put("reason", "busy")
                })
                return
            }
            activeCallId = callId
            activeCallPeerId = fromId
            activeCallPeerName = data.optString("caller_name", "Contacto")
            activeCallSelection = null
            activeCallOutgoing = false
            activeCallConnectedAt = 0L
            PhoneWearListenerService.sendVoiceCallToWear(this, event, data)
            showVoiceCallDialog(
                "Llamada de $activeCallPeerName",
                "Llamada de voz entrante",
                incoming = true
            )
            return
        }
        if (callId != activeCallId || fromId != activeCallPeerId) return
        when (event) {
            "voice_call_accept" -> {
                ensureVoiceCallManager()
                showVoiceCallDialog(activeCallPeerName, "Conectando llamada", incoming = false)
                voiceCallManager?.createOffer()
            }
            "voice_call_reject" -> {
                Toast.makeText(this, "La llamada fue rechazada", Toast.LENGTH_SHORT).show()
                finishVoiceCall(false)
            }
            "voice_call_end" -> {
                PhoneWearListenerService.sendVoiceCallToWear(this, event, data)
                finishVoiceCall(false)
            }
            "voice_call_offer" -> {
                ensureVoiceCallManager()
                voiceCallManager?.acceptOffer(data.optString("sdp"))
            }
            "voice_call_answer" -> voiceCallManager?.acceptAnswer(data.optString("sdp"))
            "voice_call_ice" -> voiceCallManager?.addIce(data)
        }
    }

    private fun acceptIncomingVoiceCall() {
        if (!hasPermission(Manifest.permission.RECORD_AUDIO)) {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.RECORD_AUDIO),
                REQUEST_INCOMING_CALL_AUDIO_PERMISSION
            )
            return
        }
        emitVoiceCall("voice_call_accept")
        showVoiceCallDialog(activeCallPeerName, "Conectando llamada", incoming = false)
        PhoneWearListenerService.sendVoiceCallToWear(
            this,
            "voice_call_accept",
            JSONObject().put("call_id", activeCallId)
        )
    }

    private fun ensureVoiceCallManager() {
        if (voiceCallManager != null) return
        voiceCallManager = VoiceCallManager(
            context = this,
            onSignal = { event, payload -> runOnUiThread { emitVoiceCall(event, payload) } },
            onConnected = {
                runOnUiThread {
                    if (activeCallConnectedAt == 0L) activeCallConnectedAt = System.currentTimeMillis()
                    showVoiceCallDialog(activeCallPeerName, "Llamada en curso", incoming = false)
                }
            },
            onFailed = {
                runOnUiThread {
                    Toast.makeText(this, "No se pudo establecer la llamada", Toast.LENGTH_SHORT).show()
                    finishVoiceCall(true)
                }
            }
        )
    }

    private fun emitVoiceCall(event: String, extras: JSONObject = JSONObject()) {
        val callId = activeCallId ?: return
        val peerId = activeCallPeerId ?: return
        extras.put("call_id", callId)
        extras.put("to_personal_id", peerId)
        chatSocketManager?.emitVoiceCall(event, extras)
    }

    private fun showVoiceCallDialog(title: String, status: String, incoming: Boolean) {
        voiceCallDialog?.dismiss()
        val content = layoutInflater.inflate(R.layout.dialog_voice_call, null)
        val titleView = content.findViewById<TextView>(R.id.voiceCallTitle)
        val statusView = content.findViewById<TextView>(R.id.voiceCallStatus)
        val avatarView = content.findViewById<TextView>(R.id.voiceCallAvatar)
        val secondary = content.findViewById<ImageButton>(R.id.voiceCallSecondary)
        val primary = content.findViewById<ImageButton>(R.id.voiceCallPrimary)
        val secondaryLabel = content.findViewById<TextView>(R.id.voiceCallSecondaryLabel)
        val primaryLabel = content.findViewById<TextView>(R.id.voiceCallPrimaryLabel)

        titleView.text = title
        statusView.text = status
        avatarView.text = activeCallPeerName
            .trim()
            .split(Regex("\\s+"))
            .filter { it.isNotBlank() }
            .take(2)
            .joinToString("") { it.take(1).uppercase() }
            .ifBlank { "SE" }

        val dialog = AlertDialog.Builder(this)
            .setView(content)
            .setCancelable(false)
            .create()
        if (incoming) {
            secondaryLabel.text = "Rechazar"
            primaryLabel.text = "Aceptar"
            secondary.setImageResource(R.drawable.ic_call_end)
            secondary.setBackgroundResource(R.drawable.bg_voice_call_control_end)
            primary.setImageResource(R.drawable.ic_call)
            primary.setBackgroundResource(R.drawable.bg_voice_call_control_accept)
            secondary.setOnClickListener {
                emitVoiceCall("voice_call_reject")
                finishVoiceCall(false)
            }
            primary.setOnClickListener { acceptIncomingVoiceCall() }
        } else {
            secondaryLabel.text = if (voiceCallMuted) "Activar micrófono" else "Silenciar"
            primaryLabel.text = "Finalizar"
            secondary.setImageResource(
                if (voiceCallMuted) R.drawable.ic_mic_off else R.drawable.ic_mic
            )
            secondary.contentDescription =
                if (voiceCallMuted) "Activar micrófono" else "Silenciar"
            secondary.setOnClickListener {
                voiceCallMuted = !voiceCallMuted
                voiceCallManager?.setMuted(voiceCallMuted)
                secondary.setImageResource(
                    if (voiceCallMuted) R.drawable.ic_mic_off else R.drawable.ic_mic
                )
                secondary.contentDescription =
                    if (voiceCallMuted) "Activar micrófono" else "Silenciar"
                secondaryLabel.text =
                    if (voiceCallMuted) "Activar micrófono" else "Silenciar"
            }
            primary.setOnClickListener { finishVoiceCall(true) }
        }
        voiceCallDialog = dialog
        dialog.setOnShowListener {
            dialog.window?.apply {
                setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
                setDimAmount(0.72f)
                addFlags(android.view.WindowManager.LayoutParams.FLAG_DIM_BEHIND)
                setLayout((resources.displayMetrics.widthPixels * 0.82f).toInt(), ViewGroup.LayoutParams.WRAP_CONTENT)
            }
        }
        dialog.show()
        dialog.window?.setLayout(
            (resources.displayMetrics.widthPixels * 0.82f).toInt(),
            ViewGroup.LayoutParams.WRAP_CONTENT
        )
    }

    private fun finishVoiceCall(notifyPeer: Boolean) {
        if (notifyPeer && activeCallId != null) emitVoiceCall("voice_call_end")
        saveOutgoingCallInChat()
        activeCallId?.let { callId ->
            PhoneWearListenerService.sendVoiceCallToWear(
                this,
                "voice_call_end",
                JSONObject().put("call_id", callId)
            )
        }
        voiceCallDialog?.dismiss()
        voiceCallDialog = null
        voiceCallManager?.close()
        voiceCallManager = null
        activeCallId = null
        activeCallPeerId = null
        activeCallPeerName = ""
        activeCallSelection = null
        activeCallOutgoing = false
        activeCallConnectedAt = 0L
        voiceCallMuted = false
    }

    private fun saveOutgoingCallInChat() {
        if (!activeCallOutgoing) return
        val selection = activeCallSelection ?: return
        val connectedAt = activeCallConnectedAt
        val callText = if (connectedAt > 0L) {
            val elapsedSeconds = ((System.currentTimeMillis() - connectedAt) / 1000L).coerceAtLeast(1L)
            val minutes = elapsedSeconds / 60L
            val seconds = elapsedSeconds % 60L
            "Llamada de voz · %02d:%02d".format(minutes, seconds)
        } else {
            "Llamada no contestada"
        }
        sendChatMessage(
            text = callText,
            alert = false,
            destinatarioRol = selection.destinatarioRol,
            destinoTipo = selection.destinoTipo,
            destinoId = selection.destinoSendId ?: selection.destinoId,
            destinoLabel = selection.destinoLabel
        )
    }

    private fun updateVoiceRecordingUi(recording: Boolean) {
        val input = findViewById<EditText?>(R.id.msgInput)
        val indicator = findViewById<TextView?>(R.id.voiceRecordingIndicator)
        val attachment = findViewById<ImageButton?>(R.id.attachmentBtn)
        val send = findViewById<ImageButton?>(R.id.sendBtn)
        val microphone = findViewById<ImageButton?>(R.id.voiceBtn)

        input?.visibility = if (recording) View.GONE else View.VISIBLE
        indicator?.visibility = if (recording) View.VISIBLE else View.GONE
        attachment?.visibility = if (recording) View.GONE else View.VISIBLE
        send?.visibility = if (recording) View.GONE else View.VISIBLE
        microphone?.apply {
            setColorFilter(Color.parseColor(if (recording) "#69B4FF" else "#8FB6E8"))
            contentDescription = if (recording) "Detener y enviar audio" else "Mensaje de voz"
        }

        voiceTimerHandler.removeCallbacks(voiceTimerRunnable)
        if (recording) {
            updateVoiceRecordingIndicator()
            voiceTimerHandler.postDelayed(voiceTimerRunnable, 500L)
        }
    }

    private fun updateVoiceRecordingIndicator() {
        val elapsedSeconds = ((System.currentTimeMillis() - voiceStartedAt).coerceAtLeast(0L) / 1000L)
        val minutes = elapsedSeconds / 60L
        val seconds = elapsedSeconds % 60L
        findViewById<TextView?>(R.id.voiceRecordingIndicator)?.text =
            String.format(Locale.getDefault(), "●  Grabando audio  %d:%02d", minutes, seconds)
    }

    private fun sendChatAttachmentUri(
        uri: Uri,
        forcedKind: String?,
        fallbackName: String?,
        forcedMimeType: String? = null,
        durationMs: Long? = null
    ) {
        val mimeType = forcedMimeType ?: contentResolver.getType(uri) ?: "application/octet-stream"
        val kind = forcedKind ?: when {
            mimeType.startsWith("image/") -> "IMAGE"
            mimeType.startsWith("video/") -> "VIDEO"
            mimeType.startsWith("audio/") -> "AUDIO"
            else -> "FILE"
        }

        val destination = pendingChatAttachmentDestination
        val fileName = queryDisplayName(uri) ?: fallbackName ?: defaultAttachmentName(kind, mimeType)
        chatController.sendAttachment(
            uri = uri,
            fileName = fileName,
            mimeType = mimeType,
            attachmentKind = kind,
            destinatarioRol = destination?.destinatarioRol,
            destinoTipo = destination?.destinoTipo,
            destinoId = destination?.destinoId,
            destinoLabel = destination?.destinoLabel,
            durationMs = durationMs
        )
    }

    private fun queryDisplayName(uri: Uri): String? {
        if (uri.scheme == "file") return File(uri.path.orEmpty()).name
        return runCatching {
            contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) cursor.getString(0) else null
            }
        }.getOrNull()
    }

    private fun defaultAttachmentName(kind: String, mimeType: String): String {
        val suffix = when {
            mimeType == "image/png" -> ".png"
            mimeType.startsWith("image/") -> ".jpg"
            mimeType.startsWith("video/") -> ".mp4"
            mimeType.startsWith("audio/") -> ".m4a"
            else -> ".bin"
        }
        return "${kind.lowercase()}_${System.currentTimeMillis()}$suffix"
    }

    private fun createChatMediaFile(prefix: String, suffix: String): File {
        val dir = File(cacheDir, "chat_media").apply { mkdirs() }
        return File.createTempFile(prefix, suffix, dir)
    }

    private fun hasPermission(permission: String): Boolean =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    private fun requestChatNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (hasPermission(Manifest.permission.POST_NOTIFICATIONS)) return

        ActivityCompat.requestPermissions(
            this,
            arrayOf(Manifest.permission.POST_NOTIFICATIONS),
            REQUEST_CHAT_NOTIFICATION_PERMISSION
        )
    }

    private fun loadChatHistoryIfNeeded() {
        chatController.loadHistoryIfNeeded()
    }

    override fun getChatOperationId(): Int = currentOperation.id

    override fun getChatToken(): String = AuthManager.getToken(this)

    override fun getChatCurrentUser(): User = currentUser

    override fun getChatPersonal(): List<PersonalItem> = personalList

    override fun getChatContentResolver(): android.content.ContentResolver = contentResolver

    override fun getChatReadMessageIds(): Set<Int> {
        val key = "${currentOperation.id}_${currentUser.tabla}_${currentUser.id}"
        return getSharedPreferences("chat_read_state", MODE_PRIVATE)
            .getStringSet(key, emptySet())
            .orEmpty()
            .mapNotNull(String::toIntOrNull)
            .toSet()
    }

    override fun saveChatReadMessageIds(ids: Set<Int>) {
        val key = "${currentOperation.id}_${currentUser.tabla}_${currentUser.id}"
        getSharedPreferences("chat_read_state", MODE_PRIVATE)
            .edit()
            .putStringSet(key, ids.map(Int::toString).toSet())
            .apply()
    }

    override fun onChatMessageAdded(message: ChatMessage, visibleInActiveChat: Boolean) {
        if (isChatPanelActive() && chatContactsVisible) {
            runOnUiThread { inflateChatPanelForSelection(null) }
        }
        if (message.isMine && message.type != MessageType.ALERT) return
        if (message.type == MessageType.SYSTEM) return

        if (!message.isMine && ::chatNotificationController.isInitialized && ::currentOperation.isInitialized) {
            if (isChatPanelActive() && visibleInActiveChat) {
                chatNotificationController.cancelMessage(message)
            } else {
                chatNotificationController.showNewMessage(message, currentOperation.nombre)
            }
        }

        if (message.type == MessageType.ALERT) {
            if (!message.isMine) {
                showDirectedAlertBanner(message)
            }
            if (::emergencyVisualAlertController.isInitialized) {
                emergencyVisualAlertController.flashScreen()
            }
            if (::cesiumWebController.isInitialized) {
                val directedTargetId = if (message.isMine) {
                    message.destinoId
                        ?.split(',')
                        ?.firstNotNullOfOrNull { it.trim().toIntOrNull() }
                } else {
                    null
                }
                val emergencyLocation = emergencyLocationFromText(message.text)
                if (directedTargetId != null) {
                    cesiumWebController.pulseEmergencyPersonal(directedTargetId)
                } else if (emergencyLocation != null) {
                    cesiumWebController.pulseEmergencyAtLocation(
                        message.idPersonal ?: -1,
                        emergencyLocation.first,
                        emergencyLocation.second
                    )
                } else {
                    message.idPersonal?.let { idPersonal ->
                        cesiumWebController.pulseEmergencyPersonal(idPersonal)
                    }
                }
            }
        }
    }

    override fun onChatVisibleMessagesRead(messages: List<ChatMessage>) {
        if (!isChatPanelActive() || !::chatNotificationController.isInitialized) return
        chatNotificationController.cancelMessages(messages)
    }

    private fun emergencyLocationFromText(text: String): Pair<Double, Double>? {
        val match = Regex(
            """UBICACI(?:ON|.N):\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)""",
            RegexOption.IGNORE_CASE
        ).find(text) ?: return null

        val lat = match.groupValues.getOrNull(1)?.toDoubleOrNull() ?: return null
        val lon = match.groupValues.getOrNull(2)?.toDoubleOrNull() ?: return null
        if (lat !in -90.0..90.0 || lon !in -180.0..180.0) return null
        return lat to lon
    }

    private fun jsString(value: String): String =
        value
            .replace("\\", "\\\\")
            .replace("'", "\\'")
            .replace("\n", " ")
            .replace("\r", " ")

    private fun shouldShowSelfLocationMarker(): Boolean =
        !::currentUser.isInitialized || currentUser.idDispositivo == null

    private fun dispositivoLabel(dispositivo: DispositivoItem?, fallback: String): String =
        dispositivo?.let {
            listOf(it.tipo, it.marca, it.modelo)
                .filter { value -> value.isNotBlank() }
                .joinToString(" ")
                .ifBlank { fallback }
        } ?: fallback

    override fun inflateOperationPanel() {
        applyPanelContentSize(expanded = false)
        panelRenderer.inflateOperationPanel(
            panelContent = panelContent,
            operation = currentOperation
        )
    }

    private fun updateSimulationRouteFromRoutesJson(routesJson: String) {
        simulationController.updateRoutesFromJson(routesJson)
    }

    private fun updateSimulationRouteFromRouteJson(routeJson: String) {
        simulationController.updateRouteFromJson(routeJson)
    }

    private fun handleSimulationRouteDeleted(idRoute: Int = -1) {
        simulationController.handleRouteDeleted(idRoute)
    }

    private fun stopSimulation() {
        if (::simulationController.isInitialized) {
            simulationController.stop()
        }
    }

    override fun shouldShowSimulationButton(): Boolean =
        ::simulationController.isInitialized && simulationController.canRun()

    override fun isSimulationActive(): Boolean =
        ::simulationController.isInitialized && simulationController.isActive

    override fun toggleSimulation() {
        simulationController.toggle()
    }

    override fun getSimulationOperation(): Operation = currentOperation

    override fun getSimulationUser(): User = currentUser

    override fun getSimulationPersonal(): List<PersonalItem> = personalList

    override fun getSimulationVehiculos(): List<VehiculoItem> = vehiculosList

    override fun getSimulationEquipos(): List<EquipoItem> = equiposList

    override fun getSimulationOperationLat(): Double = opLat

    override fun getSimulationOperationLon(): Double = opLon

    override fun getSimulationLastKnownLat(): Double? = lastKnownLat

    override fun getSimulationLastKnownLon(): Double? = lastKnownLon

    override fun hasSimulationSocket(): Boolean = chatSocketManager != null

    override fun fetchSimulationPersonal() {
        fetchPersonalPanelData()
    }

    override fun fetchSimulationVehiculos() {
        fetchVehiculosPanelData()
    }

    override fun fetchSimulationEquipos() {
        fetchEquiposPanelData()
    }

    override fun emitSimulationPersonalTracking(
        idPersonal: Int,
        lat: Double,
        lon: Double,
        apodo: String,
        rol: String
    ) {
        chatSocketManager?.emitTracking(
            idPersonal = idPersonal,
            lat = lat,
            lon = lon,
            apodo = apodo,
            rol = rol
        )
    }

    override fun emitSimulationVehiculoTracking(
        idVehiculo: Int,
        lat: Double,
        lon: Double,
        alias: String
    ) {
        chatSocketManager?.emitTrackingVehiculo(
            idVehiculo = idVehiculo,
            lat = lat,
            lon = lon,
            alias = alias
        )
    }

    override fun emitSimulationEquipoTracking(
        idEquipo: Int,
        lat: Double,
        lon: Double,
        label: String,
        categoria: String,
        tipoEquipo: String,
        numeroSerie: String,
        altitud: Double?,
        speedKmh: Double?,
        headingDegrees: Double?,
        accuracyMeters: Float?
    ) {
        chatSocketManager?.emitTrackingEquipo(
            idEquipo = idEquipo,
            lat = lat,
            lon = lon,
            nombre = label,
            categoria = categoria,
            tipoEquipo = tipoEquipo,
            numeroSerie = numeroSerie,
            altitud = altitud,
            speedKmh = speedKmh,
            headingDegrees = headingDegrees,
            accuracyMeters = accuracyMeters
        )
    }

    override fun isSimulationCesiumReady(): Boolean = isCesiumReady

    override fun updateSimulationPersonalOnMap(idPersonal: Int, lat: Double, lon: Double, label: String) {
        cesiumWebController.evaluate(
            "if(typeof updateTrackingPersonal === 'function') updateTrackingPersonal($idPersonal, $lat, $lon, '${jsString(label)}')"
        )
    }

    override fun updateSimulationVehiculoOnMap(idVehiculo: Int, lat: Double, lon: Double, label: String) {
        cesiumWebController.evaluate(
            "if(typeof updateTrackingVehiculo === 'function') updateTrackingVehiculo($idVehiculo, $lat, $lon, '${jsString(label)}')"
        )
    }

    override fun updateSimulationEquipoOnMap(
        idEquipo: Int,
        lat: Double,
        lon: Double,
        label: String,
        categoria: String,
        tipoEquipo: String,
        numeroSerie: String,
        headingDegrees: Double?
    ) {
        val meta = JSONObject()
            .put("categoria", categoria)
            .put("tipo_equipo", tipoEquipo)
            .put("nombre", label)
            .put("numero_serie", numeroSerie)
            .apply { headingDegrees?.let { put("rumbo_grados", it) } }
        cesiumWebController.evaluate(
            "if(typeof updateTrackingEquipo === 'function') updateTrackingEquipo($idEquipo, $lat, $lon, '${jsString(label)}', ${meta})"
        )
    }

    override fun updateSimulationPersonalPanel(idPersonal: Int, lat: Double, lon: Double) {
        panelRenderer.updatePersonalLocation(idPersonal, lat, lon)
    }

    override fun updateSimulationEquipoPanel(idEquipo: Int, lat: Double, lon: Double) {
        if (recordEquipoLocation(idEquipo, lat, lon)) {
            panelRenderer.updateEquipoLocation(idEquipo, lat, lon)
        }
    }

    override fun inflateChatPanel() {
        inflateChatPanelForSelection(null)
    }

    override fun onChatUnreadCountsChanged() {
        runOnUiThread {
            val unreadCount = chatController.totalUnreadCount()
            chatUnreadBadge.text = if (unreadCount > 99) "99+" else unreadCount.toString()
            chatUnreadBadge.visibility = if (unreadCount > 0) View.VISIBLE else View.GONE
            chatUnreadBadge.contentDescription = "$unreadCount mensajes no leídos"

            if (isChatPanelActive() && chatContactsVisible) {
                inflateChatPanelForSelection(null)
            }
        }
    }

    private fun inflateChatPanelForSelection(initialSelection: ChatChannelSelection?) {
        applyPanelContentSize(expanded = true)
        initialSelection?.let { chatController.setActiveSelection(it) }
        chatController.refreshVisibleMessages(notify = false)
        lateinit var showChat: (ChatChannelSelection) -> Unit

        fun showContacts() {
            chatContactsVisible = true
            chatController.setConversationOpen(false)
            panelContent.removeAllViews()
            panelRenderer.inflateChatContacts(
                panelContent = panelContent,
                currentUser = currentUser,
                personalList = personalList,
                vehiculosList = vehiculosList,
                onBack = {
                    panelNavigationController.showPanel(PanelNavigationController.Panel.NONE)
                },
                unreadCountFor = chatController::unreadCountFor,
                lastMessageFor = chatController::lastMessagePreviewFor,
                onContactSelected = { selection ->
                    chatController.setActiveSelection(selection)
                    chatController.refreshVisibleMessages(notify = false)
                    showChat(selection)
                }
            )
        }

        fun chatTitle(selection: ChatChannelSelection): String =
            selection.destinoLabel?.takeIf { it.isNotBlank() }
                ?: selection.type.replace('_', ' ').lowercase().replaceFirstChar { it.uppercase() }

        showChat = { selection ->
            chatContactsVisible = false
            chatController.setConversationOpen(true)
            panelContent.removeAllViews()

            val isGroupChat = selection.type.uppercase() in listOf("GRUPO", "FLOTILLA", "GLOBAL", "CETS")
            val membersList = if (isGroupChat) {
                val typeUpper = selection.type.uppercase()
                personalList.filter { person ->
                    when (typeUpper) {
                        "GLOBAL" -> true
                        "CETS" -> person.rol.equals("CET", ignoreCase = true)
                        "GRUPO" -> {
                            person.idGrupoOperacion?.toString() == selection.destinoId ||
                                person.grupoNombre == selection.destinoId ||
                                person.grupoNombre == selection.destinoLabel
                        }
                        "FLOTILLA" -> {
                            person.idGrupoPadre?.toString() == selection.destinoId ||
                                person.grupoPadreNombre == selection.destinoId ||
                                person.grupoPadreNombre == selection.destinoLabel ||
                                person.cetFlotilla == selection.destinoId ||
                                person.cetFlotilla == selection.destinoLabel
                        }
                        else -> false
                    }
                }.map { person ->
                    ChatGroupMember(
                        id = person.idPersonal.toString(),
                        label = ("${person.nombre} ${person.apellido}").trim().ifBlank { person.apodo }.ifBlank { "Personal ${person.idPersonal}" },
                        role = person.rol
                    )
                }
            } else {
                emptyList()
            }

            val refs = panelRenderer.inflateChatPanel(
                panelContent = panelContent,
                messages = chatController.visibleMessages,
                currentUser = currentUser,
                personalList = personalList,
                vehiculosList = vehiculosList,
                initialSelection = selection,
                onFilterChanged = { changedSelection ->
                    chatController.setActiveSelection(changedSelection)
                    chatController.markActiveSelectionRead()
                    markVisibleChatMessagesRead()
                },
                headerTitle = chatTitle(selection),
                headerSubtitle = null,
                isGroup = isGroupChat && membersList.isNotEmpty(),
                groupMembers = membersList,
                onGroupMemberSelected = { member ->
                    val sel = ChatChannelSelection(
                        type = "${member.role.uppercase()}_SPECIFIC",
                        destinatarioRol = member.role.uppercase(),
                        destinoTipo = member.role.uppercase(),
                        destinoId = member.id,
                        destinoLabel = member.label,
                        destinoSendId = member.id
                    )
                    chatController.setActiveSelection(sel)
                    chatController.refreshVisibleMessages(notify = false)
                    showChat(sel)
                },
                onBack = { showContacts() }
            )

            chatController.bindPanel(refs)
            chatController.refreshVisibleMessages()
            markVisibleChatMessagesRead()
        }

        if (initialSelection != null) {
            showChat(initialSelection)
        } else {
            showContacts()
        }
        loadChatHistoryIfNeeded()
    }

    override fun inflatePersonalPanel() {
        applyPanelContentSize(expanded = false)
        panelRenderer.inflatePersonalPanel(
            panelContent = panelContent,
            personalList = personalList,
            currentUser = currentUser
        )

        if (currentOperation.id > 0 && personalList.isEmpty()) {
            fetchPersonalPanelData()
        }
    }

    override fun inflateVehiculoPanel() {
        applyPanelContentSize(expanded = false)
        panelRenderer.inflateVehiculoPanel(
            panelContent = panelContent,
            vehiculosList = vehiculosList
        )

        if (currentOperation.id > 0 && vehiculosList.isEmpty()) {
            fetchVehiculosPanelData()
        }
    }

    override fun inflateEquipoPanel() {
        applyPanelContentSize(expanded = false)
        panelRenderer.inflateEquipoPanel(
            panelContent = panelContent,
            equiposList = equiposList
        )
        refreshEquipmentLocationsFromAssignments()

        if (currentOperation.id > 0 && equiposList.isEmpty()) {
            fetchEquiposPanelData()
        }
    }

    override fun inflateDispositivoPanel() {
        applyPanelContentSize(expanded = false)
        panelRenderer.inflateDispositivoPanel(
            panelContent = panelContent,
            dispositivosList = dispositivosList
        )

        if (currentOperation.id > 0 && dispositivosList.isEmpty()) {
            fetchDispositivosPanelData()
        }
    }

    override fun onResume() {
        super.onResume()
        if (chatSocketManager?.isConnected() != true) {
            chatSocketManager?.connect()
        }
        if (::locationHelper.isInitialized) {
            locationHelper.requestLocationPermissionOrStart()
        }
        if (::mediaStreamController.isInitialized) {
            mediaStreamController.updateButton()
        }
        if (isCesiumReady) {
            syncMapStateFromBackend()
        }
    }

    override fun onStop() {
        super.onStop()
        stopSimulation()
        if (::locationHelper.isInitialized) {
            locationHelper.stopLocationUpdates()
        }
    }

    fun showMapActionDialogFromBridge(lat: Double, lon: Double): Boolean {
        return mapObjectsController.showMapActionDialogFromBridge(lat, lon)
    }

    fun deleteMapObjectFromBridge(payloadJson: String) {
        mapObjectsController.deleteMapObjectFromBridge(payloadJson)
    }

    fun applyOperationViewFromBridge() {
        isCesiumReady = true
        cesiumWebController.applyOperationView()
        mapDataController.applyOperationView()
    }

    fun getCurrentUserRoleForBridge(): String = currentUser.rol.name

    fun getCurrentOperationNameForBridge(): String = currentOperation.nombre

    fun getCurrentOperationIdForBridge(): Int = currentOperation.id

    fun onRouteCreatedFromBridge(payloadJson: String) {
        mapObjectsController.onRouteCreatedFromBridge(payloadJson)
    }

    fun sendClearRouteToBackend() {
        mapObjectsController.sendClearRouteToBackend()
    }

    fun setupObjectToolsMenu() {
        mapObjectsController.setupObjectToolsMenu()
    }

    private fun setupMapToolsDrawer() {
        val btnMapToolsDrawer = findViewById<View>(R.id.btnMapToolsDrawer)
        val mapToolsDrawer = findViewById<View>(R.id.mapToolsDrawer)
        val btnCloseMapToolsDrawer = findViewById<View>(R.id.btnCloseMapToolsDrawer)
        findViewById<TextView>(R.id.tvMapDrawerUser)?.text =
            currentUser.nombreCompleto.trim()
                .ifBlank { currentUser.username.trim() }
                .ifBlank { "Usuario" }

        btnMapToolsDrawer?.setOnClickListener {
            val isVisible = mapToolsDrawer?.visibility == View.VISIBLE
            mapToolsDrawer?.visibility = if (isVisible) View.GONE else View.VISIBLE
        }

        btnCloseMapToolsDrawer?.setOnClickListener {
            mapToolsDrawer?.visibility = View.GONE
        }

        findViewById<View>(R.id.btnLayerMap)?.setOnClickListener {
            mapToolsDrawer?.visibility = View.GONE
            cesiumWebController.setMobileBaseLayer("map")
        }

        findViewById<View>(R.id.btnLayerSatellite)?.setOnClickListener {
            mapToolsDrawer?.visibility = View.GONE
            cesiumWebController.setMobileBaseLayer("satellite")
        }

        findViewById<View>(R.id.btnMeasureDistance)?.setOnClickListener {
            mapToolsDrawer?.visibility = View.GONE
            cesiumWebController.startMobileMapTool("distance")
        }

        findViewById<View>(R.id.btnMeasureArea)?.setOnClickListener {
            mapToolsDrawer?.visibility = View.GONE
            cesiumWebController.startMobileMapTool("area")
        }

        findViewById<View>(R.id.btnCreateRoute)?.setOnClickListener {
            mapToolsDrawer?.visibility = View.GONE
            showCreateRouteDialog()
        }

        findViewById<View>(R.id.btnLayerMgrs)?.setOnClickListener {
            mapToolsDrawer?.visibility = View.GONE
            isMgrsActive = !isMgrsActive
            cesiumWebController.evaluate("(function(){ if(typeof toggleMgrsGrid==='function') toggleMgrsGrid($isMgrsActive); })();")
            chatSocketManager?.emitMgrsToggled(isMgrsActive)
        }

        findViewById<View>(R.id.btnLayerGeoMsg)?.setOnClickListener {
            mapToolsDrawer?.visibility = View.GONE
            cesiumWebController.startGeoMsgMode()
            Toast.makeText(this, "Toca el mapa en la ubicación del Mensaje Geo-anclado", Toast.LENGTH_LONG).show()
        }

        findViewById<View>(R.id.btnLayerSectors)?.setOnClickListener {
            mapToolsDrawer?.visibility = View.GONE
            showSectorsDialog()
        }

        findViewById<View>(R.id.btnDrawLine)?.setOnClickListener {
            mapToolsDrawer?.visibility = View.GONE
            cesiumWebController.startMobileMapTool("line")
        }

        findViewById<View>(R.id.btnDrawZone)?.setOnClickListener {
            mapToolsDrawer?.visibility = View.GONE
            cesiumWebController.startMobileMapTool("zone")
        }

        findViewById<View>(R.id.btnDrawRectangle)?.setOnClickListener {
            mapToolsDrawer?.visibility = View.GONE
            cesiumWebController.startMobileMapTool("rectangle")
        }

        findViewById<View>(R.id.btnDrawRadius)?.setOnClickListener {
            mapToolsDrawer?.visibility = View.GONE
            cesiumWebController.startMobileMapTool("radius")
        }

        findViewById<View>(R.id.btnClearMapTools)?.setOnClickListener {
            mapToolsDrawer?.visibility = View.GONE
            cesiumWebController.clearMobileMapTools()
        }

        findViewById<View>(R.id.btnMapDrawerLogout)?.setOnClickListener {
            mapToolsDrawer?.visibility = View.GONE
            showLogoutDialog()
        }
    }

    private fun showDirectedAlertBanner(message: ChatMessage) {
        if (!::directedAlertBanner.isInitialized || !::directedAlertMessage.isInitialized) return
        val sender = message.user.trim().ifBlank { "Personal" }
        val senderRecord = message.idPersonal?.let { senderId ->
            personalList.firstOrNull { it.idPersonal == senderId }
        }
        val rank = senderRecord?.puesto?.trim().orEmpty()
            .ifBlank { senderRecord?.rol?.trim().orEmpty() }
            .takeUnless { it.equals("Personal", ignoreCase = true) }
        val senderWithRank = if (rank.isNullOrBlank()) sender else "$sender · $rank"

        runOnUiThread {
            directedAlertMessage.text = "ALERTA ENVIADA DE\n$senderWithRank"
            directedAlertBanner.visibility = View.VISIBLE
            directedAlertBanner.bringToFront()
        }
    }

    private fun showCreateRouteDialog() {
        val view = layoutInflater.inflate(R.layout.dialog_create_route, null, false)
        val latitudeInput = view.findViewById<EditText>(R.id.etRouteLatitude)
        val longitudeInput = view.findViewById<EditText>(R.id.etRouteLongitude)
        val pickDestination = view.findViewById<View>(R.id.btnPickRouteDestination)
        val cancel = view.findViewById<TextView>(R.id.btnCancelCreateRoute)
        val confirm = view.findViewById<TextView>(R.id.btnConfirmCreateRoute)

        val dialog = AlertDialog.Builder(this)
            .setView(view)
            .create()
        dialog.window?.setBackgroundDrawableResource(android.R.color.transparent)

        cancel.setOnClickListener { dialog.dismiss() }

        pickDestination.setOnClickListener {
            val origin = validPair(lastKnownLat, lastKnownLon)
            if (origin == null) {
                Toast.makeText(this, "Obteniendo tu ubicación. Inténtalo nuevamente en unos segundos.", Toast.LENGTH_LONG).show()
                locationHelper.requestLocationPermissionOrStart()
                return@setOnClickListener
            }

            dialog.dismiss()
            cesiumWebController.setRouteStart(origin.first, origin.second)
            cesiumWebController.enablePickEnd()
            Toast.makeText(this, "Toca una vez el lugar de destino.", Toast.LENGTH_LONG).show()
        }

        confirm.setOnClickListener {
            val latitude = latitudeInput.text.toString().trim().replace(',', '.').toDoubleOrNull()
            val longitude = longitudeInput.text.toString().trim().replace(',', '.').toDoubleOrNull()
            if (latitude == null || longitude == null || latitude !in -90.0..90.0 || longitude !in -180.0..180.0) {
                Toast.makeText(this, "Ingresa una latitud y longitud válidas.", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }

            dialog.dismiss()
            createRouteFromMyLocation(latitude, longitude, "destino")
        }

        dialog.show()
    }

    fun showGeoMsgDialog(lat: Double, lon: Double) {
        val view = layoutInflater.inflate(R.layout.dialog_geo_msg, null, false)
        val tvCoords = view.findViewById<TextView>(R.id.tvGeoMsgCoords)
        val etInput = view.findViewById<EditText>(R.id.etGeoMsgInput)
        val btnCancel = view.findViewById<TextView>(R.id.btnCancelGeoMsg)
        val btnSend = view.findViewById<TextView>(R.id.btnSendGeoMsg)

        val formattedLat = String.format(Locale.US, "%.5f", lat)
        val formattedLon = String.format(Locale.US, "%.5f", lon)
        tvCoords.text = "Ubicación: $formattedLat, $formattedLon"

        val dialog = AlertDialog.Builder(this)
            .setView(view)
            .create()

        dialog.window?.setBackgroundDrawableResource(android.R.color.transparent)

        btnCancel.setOnClickListener {
            dialog.dismiss()
        }

        btnSend.setOnClickListener {
            val text = etInput.text.toString().trim()
            if (text.isBlank()) {
                Toast.makeText(this, "Escribe un mensaje", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            dialog.dismiss()

            val userName = currentUser.nombreCompleto.ifBlank { currentUser.username }.ifBlank { "Yo" }
            val idPoi = (System.currentTimeMillis() and 0x7FFFFFFF).toInt()

            cesiumWebController.addGeoMsgToMap(idPoi, lat, lon, text, userName)

            val chatText = "[GEO-MSG] ($formattedLat, $formattedLon) $text"
            sendChatMessage(chatText)

            Toast.makeText(this, "Mensaje Geo-anclado enviado", Toast.LENGTH_SHORT).show()
        }

        dialog.show()
    }

    fun showSectorsDialog() {
        val view = layoutInflater.inflate(R.layout.dialog_sectors, null, false)
        val tvSummary = view.findViewById<TextView>(R.id.tvSectorsSummary)
        val containerInputs = view.findViewById<LinearLayout>(R.id.containerSectorInputs)
        val btnClose = view.findViewById<TextView>(R.id.btnCloseSectorsDialog)
        val btn2x2 = view.findViewById<TextView>(R.id.btnSize2x2)
        val btn2x3 = view.findViewById<TextView>(R.id.btnSize2x3)
        val btn3x3 = view.findViewById<TextView>(R.id.btnSize3x3)
        val btn4x4 = view.findViewById<TextView>(R.id.btnSize4x4)
        val btnApply = view.findViewById<TextView>(R.id.btnApplySectors)
        val btnClear = view.findViewById<TextView>(R.id.btnClearSectors)

        var selectedRows = 2
        var selectedCols = 2
        val inputFields = mutableListOf<EditText>()

        val phonetic = listOf(
            "ALFA", "BRAVO", "CHARLIE", "DELTA", "ECHO", "FOXTROT",
            "GOLF", "HOTEL", "INDIA", "JULIETT", "KILO", "LIMA",
            "MIKE", "NOVEMBER", "OSCAR", "PAPA"
        )

        fun updateGridInputs(rows: Int, cols: Int) {
            selectedRows = rows
            selectedCols = cols
            val totalSectors = rows * cols
            tvSummary.text = "${rows}×${cols} - $totalSectors sectores"

            listOf(
                btn2x2 to (rows == 2 && cols == 2),
                btn2x3 to (rows == 2 && cols == 3),
                btn3x3 to (rows == 3 && cols == 3),
                btn4x4 to (rows == 4 && cols == 4)
            ).forEach { (btn, isSel) ->
                btn.setBackgroundResource(if (isSel) R.drawable.bg_sector_size_btn_selected else R.drawable.bg_sector_size_btn_normal)
                btn.setTextColor(Color.parseColor(if (isSel) "#F3C84B" else "#F8FAFC"))
            }

            containerInputs.removeAllViews()
            inputFields.clear()

            val density = resources.displayMetrics.density
            fun toPx(dp: Int) = (dp * density).toInt()

            var sectorIdx = 0
            for (r in 0 until rows) {
                val rowLayout = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    layoutParams = LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT,
                        LinearLayout.LayoutParams.WRAP_CONTENT
                    ).apply {
                        if (r > 0) topMargin = toPx(8)
                    }
                }

                for (c in 0 until cols) {
                    val defaultName = phonetic.getOrElse(sectorIdx) { "SEC-${sectorIdx + 1}" }
                    val et = EditText(this).apply {
                        layoutParams = LinearLayout.LayoutParams(0, toPx(44), 1f).apply {
                            if (c > 0) marginStart = toPx(8)
                        }
                        background = ContextCompat.getDrawable(this@MainActivity, R.drawable.bg_sector_input)
                        setPadding(toPx(12), toPx(8), toPx(12), toPx(8))
                        setText(defaultName)
                        setTextColor(Color.parseColor("#F8FAFC"))
                        setHintTextColor(Color.parseColor("#64748B"))
                        textSize = 13f
                        typeface = android.graphics.Typeface.DEFAULT_BOLD
                        maxLines = 1
                        inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS
                    }
                    inputFields.add(et)
                    rowLayout.addView(et)
                    sectorIdx++
                }
                containerInputs.addView(rowLayout)
            }
        }

        updateGridInputs(2, 2)

        val dialog = AlertDialog.Builder(this)
            .setView(view)
            .create()

        dialog.window?.setBackgroundDrawableResource(android.R.color.transparent)

        btnClose.setOnClickListener { dialog.dismiss() }

        btn2x2.setOnClickListener { updateGridInputs(2, 2) }
        btn2x3.setOnClickListener { updateGridInputs(2, 3) }
        btn3x3.setOnClickListener { updateGridInputs(3, 3) }
        btn4x4.setOnClickListener { updateGridInputs(4, 4) }

        btnApply.setOnClickListener {
            dialog.dismiss()
            val names = inputFields.map { it.text.toString().trim() }
            val namesJson = org.json.JSONArray(names).toString()
            val js = "(function(){ if(typeof renderOperationGrid==='function') renderOperationGrid({ rows: $selectedRows, cols: $selectedCols, size: '${selectedRows}x${selectedCols}', names: $namesJson }); })();"
            cesiumWebController.evaluate(js)

            val sizeStr = "${selectedRows}x${selectedCols}"
            chatSocketManager?.emitGridUpdated(selectedRows, selectedCols, sizeStr, names)

            val opId = currentOperation.id
            val token = com.operaciones.operaciones_android.auth.AuthManager.getToken(this)
            if (opId > 0 && !token.isNullOrEmpty()) {
                com.operaciones.operaciones_android.network.OperationMapRepository().saveGrid(
                    operationId = opId,
                    token = token,
                    rows = selectedRows,
                    cols = selectedCols,
                    size = sizeStr,
                    names = names
                )
            }

            Toast.makeText(this, "Sectores aplicados y compartidos (${selectedRows}×${selectedCols})", Toast.LENGTH_SHORT).show()
        }

        btnClear.setOnClickListener {
            dialog.dismiss()
            isMgrsActive = false
            cesiumWebController.evaluate("(function(){ if(typeof clearOperationGrid==='function') clearOperationGrid(); if(typeof toggleMgrsGrid==='function') toggleMgrsGrid(false); })();")

            chatSocketManager?.emitGridDeleted()
            chatSocketManager?.emitMgrsToggled(false)

            val opId = currentOperation.id
            val token = com.operaciones.operaciones_android.auth.AuthManager.getToken(this)
            if (opId > 0 && !token.isNullOrEmpty()) {
                com.operaciones.operaciones_android.network.OperationMapRepository().deleteGrid(
                    operationId = opId,
                    token = token
                )
            }

            Toast.makeText(this, "Sectores eliminados del mapa", Toast.LENGTH_SHORT).show()
        }

        dialog.show()
    }

    fun loadDrawingsFromBackend(replace: Boolean = true) {
        mapObjectsController.loadDrawingsFromBackend(replace)
    }

    fun onDrawingSavedFromBridge(strokeJson: String) {
        mapObjectsController.onDrawingSavedFromBridge(strokeJson)
    }

    fun onDrawingDeletedFromBridge(localId: String) {
        mapObjectsController.onDrawingDeletedFromBridge(localId)
    }
    private fun setupBackPress() {
        onBackPressedDispatcher.addCallback(this, object : androidx.activity.OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                showLogoutDialog()
            }
        })
    }

    private fun showLogoutDialog() {
        val content = layoutInflater.inflate(R.layout.dialog_logout, null, false)
        val userName = currentUser.nombreCompleto.trim()
            .ifBlank { currentUser.username }
            .ifBlank { "Usuario" }
        val initials = listOf(currentUser.nombre, currentUser.apellido)
            .mapNotNull { value -> value.trim().firstOrNull()?.uppercaseChar()?.toString() }
            .joinToString("")
            .take(2)
            .ifBlank { userName.take(1).uppercase() }

        content.findViewById<TextView>(R.id.tvLogoutAvatar).text = initials
        content.findViewById<TextView>(R.id.tvLogoutUser).text = userName

        val dialog = AlertDialog.Builder(this)
            .setView(content)
            .create()

        content.findViewById<TextView>(R.id.btnCancelLogout).setOnClickListener {
            dialog.dismiss()
        }
        content.findViewById<TextView>(R.id.btnConfirmLogout).setOnClickListener {
            dialog.dismiss()
            AuthManager.logout(this)
            goToLogin()
        }

        dialog.setOnShowListener {
            dialog.window?.apply {
                setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
                attributes = attributes.apply { dimAmount = 0.72f }
                val widthRatio = if (
                    resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
                ) 0.56f else 0.90f
                setLayout(
                    (resources.displayMetrics.widthPixels * widthRatio).toInt(),
                    ViewGroup.LayoutParams.WRAP_CONTENT
                )
            }
        }
        dialog.show()
    }

    override fun inflateResourcesPanel() {
        applyPanelContentSize(expanded = false)
        panelRenderer.inflateResourcesPanel(
            panelContent = panelContent,
            personalList = personalList,
            vehiculosList = vehiculosList,
            equiposList = equiposList,
            dispositivosList = dispositivosList,
            currentUser = currentUser,
            poisList = mapDataController.getPois()
        )

        if (currentOperation.id > 0) {
            if (personalList.isEmpty()) fetchPersonalPanelData()
            if (vehiculosList.isEmpty()) fetchVehiculosPanelData()
            if (equiposList.isEmpty()) fetchEquiposPanelData()
            if (dispositivosList.isEmpty()) fetchDispositivosPanelData()
        }
    }

    override fun requestLogout() {
        showLogoutDialog()
    }

    override fun onPanelChanged(panel: PanelNavigationController.Panel) {
        val chatExpanded = ::panelNavigationController.isInitialized &&
            panelNavigationController.activePanel == Panel.CHAT
        applyPanelContentSize(expanded = chatExpanded)
        if (!chatExpanded && ::chatController.isInitialized) {
            chatContactsVisible = false
            chatController.setConversationOpen(false)
        }
        if (::mediaStreamController.isInitialized) {
            mediaStreamController.updateButton()
        }
    }

    override fun hideSimulationPersonalOnMap(idPersonal: Int) {
        cesiumWebController.evaluate(
            "if(typeof removeTrackingPersonal === 'function') removeTrackingPersonal($idPersonal)"
        )
    }

    override fun updateSimulationVehicleOccupants(idVehiculo: Int, occupants: List<PersonalItem>) {
        val occupantsJson = org.json.JSONArray().apply {
            occupants.forEach { occupant ->
                put(org.json.JSONObject().apply {
                    put("id_personal", occupant.idPersonal)
                    put("apodo", occupant.apodo)
                    put("nombre", occupant.nombre)
                    put("apellido", occupant.apellido)
                    put("rol", occupant.rol)
                })
            }
        }
        cesiumWebController.evaluate(
            "if(typeof updateVehicleOccupants === 'function') updateVehicleOccupants($idVehiculo, $occupantsJson)"
        )
    }

    override fun getSelectedMapVehiculoId(): Int? = selectedVehiculoId

    override fun getMapDataCurrentUserLabel(): String =
        currentUser.nombreCompleto.ifBlank { currentUser.username }.ifBlank { "Usuario" }

    private val simulationVehicleOccupants = mutableMapOf<Int, List<PersonalItem>>()

    private fun resolveVehicleOccupants(idVehiculo: Int): List<PersonalItem> {
        val vehicleRows = vehiculosList.filter { it.idVehiculo == idVehiculo }
        val directIds = vehicleRows.mapNotNull { it.idPersonalAsignado }.distinct()
        val direct = personalList.filter { it.idPersonal in directIds }

        if (direct.isNotEmpty()) {
            return direct
        }

        val groupNames = vehicleRows
            .flatMap { listOf(it.grupoNombre, it.grupoPadreNombre) }
            .map { it.trim() }
            .filter { it.isNotBlank() }
            .toSet()

        return personalList.filter { person ->
            person.grupoNombre.trim() in groupNames || person.grupoPadreNombre.trim() in groupNames
        }
    }

    fun openChatForVehicle(idVehiculo: Int) {
        val simulated = simulationVehicleOccupants[idVehiculo].orEmpty()
        val occupants = if (simulated.isNotEmpty()) {
            simulated
        } else {
            resolveVehicleOccupants(idVehiculo)
        }
        val vehicleName = vehiculosList
            .firstOrNull { it.idVehiculo == idVehiculo }
            ?.let { it.alias.ifBlank { it.codigoInterno }.ifBlank { it.nombre } }
            ?.ifBlank { "Vehículo $idVehiculo" }
            ?: "Vehículo $idVehiculo"
        val occupantIds = occupants.map { it.idPersonal.toString() }.distinct()
        val destinoSendId = if (occupantIds.isNotEmpty()) occupantIds.joinToString(",") else ""

        val selection = ChatChannelSelection(
            type = "VEHICULO",
            destinatarioRol = "CELL,CET",
            destinoTipo = "CELL_LIST",
            destinoId = idVehiculo.toString(),
            destinoLabel = vehicleName,
            destinoSendId = destinoSendId
        )
        runOnUiThread {
            panelNavigationController.showPanel(Panel.CHAT)
            chatController.setActiveSelection(selection)
            inflateChatPanelForSelection(selection)
        }
    }

    fun openChatForPersonal(idPersonal: Int) {
        if (isCurrentPersonal(idPersonal)) {
            Toast.makeText(this, "No puedes abrir un chat contigo mismo.", Toast.LENGTH_SHORT).show()
            return
        }

        val person = personalList.firstOrNull { it.idPersonal == idPersonal }
        val personName = person?.let { personDisplayName(it) } ?: "Personal $idPersonal"
        val role = person?.rol?.uppercase(java.util.Locale.US) ?: "CELL"

        val (type, destinatarioRol, destinoTipo) = when {
            role.contains("CET") -> Triple("CET_SPECIFIC", "CET", "CET")
            role.contains("CUT") -> Triple("CUT_SPECIFIC", "CUT", "CUT")
            else -> Triple("CELL_SPECIFIC", "CELL", "CELL")
        }

        val selection = ChatChannelSelection(
            type = type,
            destinatarioRol = destinatarioRol,
            destinoTipo = destinoTipo,
            destinoId = idPersonal.toString(),
            destinoLabel = personName,
            destinoSendId = idPersonal.toString()
        )

        runOnUiThread {
            panelNavigationController.showPanel(Panel.CHAT)
            chatController.setActiveSelection(selection)
            inflateChatPanelForSelection(selection)
        }
    }

    private fun isCurrentPersonal(idPersonal: Int): Boolean =
        currentUser.tabla.equals("personal", ignoreCase = true) && currentUser.id == idPersonal

    override fun showMapVehiculoInfo(
        idVehiculo: Int,
        screenX: Double?,
        screenY: Double?,
        viewportWidth: Double?,
        viewportHeight: Double?
    ) {
        val vehicle = vehiculosList.firstOrNull { it.idVehiculo == idVehiculo }
        val vehicleName = vehicle?.let { vehicleDisplayName(it) } ?: "Vehiculo $idVehiculo"
        val simulated = simulationVehicleOccupants[idVehiculo].orEmpty()
        val occupants = (if (simulated.isNotEmpty()) simulated else resolveVehicleOccupants(idVehiculo))
            .distinctBy { it.idPersonal }

        vehicleInfoPopup?.dismiss()

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), dp(10), dp(12), dp(12))
            setBackgroundResource(R.drawable.bg_logout_dialog)
        }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
        }
        header.addView(TextView(this).apply {
            text = vehicleName
            setTextColor(Color.parseColor("#F1F7FA"))
            textSize = 15f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            maxLines = 1
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        })
        header.addView(TextView(this).apply {
            text = "X"
            gravity = android.view.Gravity.CENTER
            setTextColor(Color.parseColor("#9EC7E8"))
            textSize = 13f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setBackgroundResource(R.drawable.bg_object_tools_button)
            layoutParams = LinearLayout.LayoutParams(dp(32), dp(32))
            setOnClickListener { vehicleInfoPopup?.dismiss() }
        })
        content.addView(header)

        content.addView(TextView(this).apply {
            text = "Personal en el vehiculo"
            setTextColor(Color.parseColor("#7DB8C8"))
            textSize = 11f
            setPadding(0, dp(3), 0, dp(8))
        })

        val occupantList = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
        }
        if (occupants.isEmpty()) {
            occupantList.addView(TextView(this).apply {
                text = "Sin personal asignado."
                setTextColor(Color.parseColor("#C7D8DE"))
                textSize = 12f
                setPadding(dp(9), dp(8), dp(9), dp(8))
                setBackgroundResource(R.drawable.bg_object_tools_menu_item)
            })
        } else {
            occupants.forEach { person ->
                occupantList.addView(TextView(this).apply {
                    text = listOf(personDisplayName(person), listOf(person.rol, person.puesto).filter { it.isNotBlank() }.joinToString(" - "))
                        .filter { it.isNotBlank() }
                        .joinToString("\n")
                    setTextColor(Color.parseColor("#E2E8F0"))
                    textSize = 12f
                    setPadding(dp(9), dp(7), dp(9), dp(7))
                    setBackgroundResource(R.drawable.bg_object_tools_menu_item)
                })
                occupantList.addView(View(this).apply {
                    layoutParams = LinearLayout.LayoutParams(1, dp(5))
                })
            }
        }

        content.addView(ScrollView(this).apply {
            addView(occupantList)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                dp(occupants.size.coerceAtLeast(1).coerceAtMost(3) * 42)
            )
        })

        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(10), 0, 0)
        }

        actions.addView(TextView(this).apply {
            text = "Ver ruta"
            gravity = android.view.Gravity.CENTER
            setTextColor(Color.parseColor("#D9E8EC"))
            textSize = 12f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setBackgroundResource(R.drawable.bg_logout_cancel)
            layoutParams = LinearLayout.LayoutParams(0, dp(38), 1f)
            setOnClickListener {
                vehicleInfoPopup?.dismiss()
                showVehicleRouteOnMap(idVehiculo, vehicleName)
            }
        })

        actions.addView(TextView(this).apply {
            text = "Mandar alerta"
            gravity = android.view.Gravity.CENTER
            setTextColor(Color.WHITE)
            textSize = 12f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setBackgroundResource(R.drawable.bg_logout_confirm)
            layoutParams = LinearLayout.LayoutParams(0, dp(38), 1f).apply {
                marginStart = dp(8)
            }
            setOnClickListener {
                vehicleInfoPopup?.dismiss()
                sendVehicleAlert(idVehiculo, vehicleName, occupants)
            }
        })

        content.addView(actions)

        val popupWidth = dp(260)
        val popupHeight = ViewGroup.LayoutParams.WRAP_CONTENT
        vehicleInfoPopup = PopupWindow(content, popupWidth, popupHeight, true).apply {
            isOutsideTouchable = true
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            elevation = dp(10).toFloat()
            showAtLocation(webView, android.view.Gravity.NO_GRAVITY, popupX(screenX, viewportWidth, popupWidth), popupY(screenY, viewportHeight))
        }
    }

    override fun showMapPersonalInfo(
        idPersonal: Int,
        label: String?,
        screenX: Double?,
        screenY: Double?,
        viewportWidth: Double?,
        viewportHeight: Double?
    ) {
        android.util.Log.d("POPUP_DEBUG", "showMapPersonalInfo: id=$idPersonal, label=$label, screenX=$screenX, screenY=$screenY")
        val currentLat = livePersonalLocations[idPersonal]?.first
        val currentLon = livePersonalLocations[idPersonal]?.second

        var person = personalList.firstOrNull { it.idPersonal == idPersonal }
        if (person == null) {
            person = PersonalItem(
                idPersonal = idPersonal,
                apodo = label ?: "P-$idPersonal",
                nombre = "",
                apellido = "",
                rol = "Personal",
                puesto = "",
                lat = currentLat,
                lon = currentLon,
                velocidadKmh = 0.0,
                frecuenciaCardiacaBpm = null,
                presionBarometricaHpa = null,
                bateriaPct = null,
                ultimaActualizacion = ""
            )
        }
        val personName = personDisplayName(person).ifBlank { label ?: "Personal $idPersonal" }
        val isSelfPersonal = isCurrentPersonal(idPersonal)
        val displayedPersonName = if (isSelfPersonal) "$personName (YO)" else personName

        selectedPersonalInfoId = idPersonal
        lastPersonalCoordinates = screenX to screenY
        lastPersonalViewport = viewportWidth to viewportHeight

        personalInfoPopup?.dismiss()

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), dp(10), dp(12), dp(12))
            setBackgroundResource(R.drawable.bg_logout_dialog)
        }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
        }
        header.addView(TextView(this).apply {
            text = displayedPersonName
            setTextColor(Color.parseColor("#F1F7FA"))
            textSize = 15f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            maxLines = 1
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        })
        header.addView(TextView(this).apply {
            text = "X"
            gravity = android.view.Gravity.CENTER
            setTextColor(Color.parseColor("#9EC7E8"))
            textSize = 13f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setBackgroundResource(R.drawable.bg_object_tools_button)
            layoutParams = LinearLayout.LayoutParams(dp(32), dp(32))
            setOnClickListener {
                personalInfoPopup?.dismiss()
                selectedPersonalInfoId = null
            }
        })
        content.addView(header)

        val subtitleText = listOf(person.rol, person.puesto, person.grupoNombre)
            .filter { it.isNotBlank() }
            .joinToString(" - ")
        if (subtitleText.isNotBlank()) {
            content.addView(TextView(this).apply {
                text = subtitleText
                setTextColor(Color.parseColor("#7DB8C8"))
                textSize = 11f
                setPadding(0, dp(2), 0, dp(6))
            })
        }

        fun addGridRow(label: String, value: String) {
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
                    setMargins(0, dp(2), 0, dp(2))
                }
                addView(TextView(this@MainActivity).apply {
                    text = label
                    setTextColor(Color.parseColor("#7DB8C8"))
                    textSize = 12f
                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                })
                addView(TextView(this@MainActivity).apply {
                    text = value
                    setTextColor(Color.parseColor("#E2E8F0"))
                    textSize = 12f
                    setTypeface(typeface, android.graphics.Typeface.BOLD)
                    gravity = android.view.Gravity.END
                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
                })
            }
            content.addView(row)
        }

        val displayLat = livePersonalLocations[idPersonal]?.first ?: person.lat
        val displayLon = livePersonalLocations[idPersonal]?.second ?: person.lon

        addGridRow("Lat:", displayLat?.let { String.format(java.util.Locale.US, "%.6f", it) } ?: "-")
        addGridRow("Lng:", displayLon?.let { String.format(java.util.Locale.US, "%.6f", it) } ?: "-")
        addGridRow("Vel:", String.format(java.util.Locale.US, "%.2f km/h", person.velocidadKmh ?: 0.0))

        content.addView(View(this).apply {
            setBackgroundColor(Color.parseColor("#334155"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)).apply {
                setMargins(0, dp(6), 0, dp(6))
            }
        })

        content.addView(TextView(this).apply {
            text = "Biométricos (Galaxy Watch)"
            setTextColor(Color.parseColor("#7DB8C8"))
            textSize = 12f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setPadding(0, dp(2), 0, dp(4))
        })

        addGridRow("FC:", person.frecuenciaCardiacaBpm?.let { "$it bpm" } ?: "--")
        addGridRow("Baro:", person.presionBarometricaHpa?.let { "${it.toInt()} hPa" } ?: "--")
        addGridRow("Batería:", person.bateriaPct?.let { "${it.toInt()}%" } ?: "--")

        content.addView(TextView(this).apply {
            text = if (person.ultimaActualizacion.isNotBlank()) {
                "Actualizado ${formatTimestampTime(person.ultimaActualizacion)}"
            } else {
                "Actualizado -"
            }
            setTextColor(Color.parseColor("#94A3B8"))
            textSize = 10f
            setPadding(0, dp(4), 0, dp(6))
        })

        val actions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(6), 0, 0)
        }

        if (!isSelfPersonal) {
            actions.addView(TextView(this).apply {
                text = "Enviar mensaje"
                gravity = android.view.Gravity.CENTER
                setTextColor(Color.parseColor("#D9E8EC"))
                textSize = 12f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
                setBackgroundResource(R.drawable.bg_logout_cancel)
                layoutParams = LinearLayout.LayoutParams(0, dp(38), 1f)
                setOnClickListener {
                    personalInfoPopup?.dismiss()
                    selectedPersonalInfoId = null
                    openChatForPersonal(idPersonal)
                }
            })
        }

        if (!isSelfPersonal) {
            actions.addView(TextView(this).apply {
                text = "Mandar alerta"
                gravity = android.view.Gravity.CENTER
                setTextColor(Color.WHITE)
                textSize = 12f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
                setBackgroundResource(R.drawable.bg_logout_confirm)
                layoutParams = LinearLayout.LayoutParams(0, dp(38), 1f).apply {
                    marginStart = dp(8)
                }
                setOnClickListener {
                    personalInfoPopup?.dismiss()
                    selectedPersonalInfoId = null
                    sendPersonalAlert(idPersonal, personName)
                }
            })
            content.addView(actions)

            content.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER
            contentDescription = "IR DESDE MI UBICACIÓN"
            setBackgroundResource(R.drawable.bg_logout_cancel)
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(42)).apply {
                topMargin = dp(8)
            }

            addView(android.widget.ImageView(this@MainActivity).apply {
                setImageResource(R.drawable.ic_navigate_from_location)
                scaleType = android.widget.ImageView.ScaleType.CENTER_INSIDE
                layoutParams = LinearLayout.LayoutParams(dp(14), dp(14)).apply {
                    marginEnd = dp(6)
                }
            })
            addView(TextView(this@MainActivity).apply {
                text = "IR DESDE MI UBICACIÓN"
                gravity = android.view.Gravity.CENTER
                setTextColor(Color.parseColor("#EAF6F8"))
                textSize = 12f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                )
            })

            setOnClickListener {
                personalInfoPopup?.dismiss()
                selectedPersonalInfoId = null
                createRouteFromMyLocation(displayLat, displayLon, personName)
            }
            })
        }

        val popupWidth = dp(260)
        val popupHeight = ViewGroup.LayoutParams.WRAP_CONTENT
        personalInfoPopup = PopupWindow(content, popupWidth, popupHeight, true).apply {
            isOutsideTouchable = true
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            elevation = dp(10).toFloat()
            setOnDismissListener {
                selectedPersonalInfoId = null
            }
            showAtLocation(webView, android.view.Gravity.NO_GRAVITY, popupX(screenX, viewportWidth, popupWidth), popupY(screenY, viewportHeight))
        }
    }

    override fun showMapEquipoInfo(
        idEquipo: Int,
        screenX: Double?,
        screenY: Double?,
        viewportWidth: Double?,
        viewportHeight: Double?
    ) {
        val equipo = equiposList.firstOrNull { it.idEquipo == idEquipo }
        val equipmentName = equipo?.nombre?.ifBlank { "Equipo $idEquipo" } ?: "Equipo $idEquipo"
        val equipmentType = equipo?.tipoEquipo?.ifBlank { equipo.categoria }?.ifBlank { "Equipo" } ?: "Equipo"
        val assignedTo = equipo?.personalAsignado
            ?.ifBlank { equipo.vehiculoAsignado }
            ?.ifBlank { equipo.grupoAsignado }
            ?.ifBlank { equipo.flotillaAsignada }
            ?.ifBlank { equipo.asignadoA }
            ?.ifBlank { "Sin responsable asignado" }
            ?: "Sin responsable asignado"
        val position = liveEquipoLocations[idEquipo]
            ?: equipo?.lat?.let { lat -> equipo.lon?.let { lon -> lat to lon } }
        val isDrone = listOf(equipmentName, equipmentType, equipo?.categoria.orEmpty(), equipo?.detalle.orEmpty())
            .joinToString(" ")
            .uppercase(Locale.US)
            .let { text -> text.contains("DRON") || text.contains("DRONE") || text.contains("UAV") || text.contains("VANT") }

        equipmentInfoPopup?.dismiss()

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(11), dp(14), dp(14))
            setBackgroundResource(R.drawable.bg_logout_dialog)
        }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
        }
        header.addView(TextView(this).apply {
            text = listOf(equipo?.numeroSerie.orEmpty(), equipmentName, equipmentType)
                .filter { it.isNotBlank() }
                .distinct()
                .joinToString(" - ")
            setTextColor(Color.parseColor("#A9E7F2"))
            textSize = 14f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            maxLines = 2
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        })
        header.addView(TextView(this).apply {
            text = "X"
            gravity = android.view.Gravity.CENTER
            setTextColor(Color.parseColor("#9EC7E8"))
            textSize = 13f
            setTypeface(typeface, android.graphics.Typeface.BOLD)
            setBackgroundResource(R.drawable.bg_object_tools_button)
            layoutParams = LinearLayout.LayoutParams(dp(32), dp(32))
            setOnClickListener { equipmentInfoPopup?.dismiss() }
        })
        content.addView(header)

        content.addView(View(this).apply {
            setBackgroundColor(Color.parseColor("#31516A"))
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)).apply {
                setMargins(0, dp(7), 0, dp(8))
            }
        })

        fun addInfoRow(label: String, value: String) {
            content.addView(LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(0, dp(3), 0, dp(3))
                addView(TextView(this@MainActivity).apply {
                    text = label
                    setTextColor(Color.parseColor("#8EA7BC"))
                    textSize = 12f
                    layoutParams = LinearLayout.LayoutParams(dp(76), ViewGroup.LayoutParams.WRAP_CONTENT)
                })
                addView(TextView(this@MainActivity).apply {
                    text = value
                    setTextColor(Color.parseColor("#E7F0F7"))
                    textSize = 12f
                    setTypeface(typeface, android.graphics.Typeface.BOLD)
                    maxLines = 2
                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                })
            })
        }

        addInfoRow("Modelo", equipmentType)
        addInfoRow("Serie", equipo?.numeroSerie?.ifBlank { "-" } ?: "-")
        addInfoRow("Asignado a", assignedTo)
        addInfoRow(
            "Posicion",
            position?.let {
                String.format(Locale.US, "%.6f, %.6f", it.first, it.second)
            } ?: "Sin ubicacion activa"
        )

        if (isDrone) {
            val cameraPanel = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = android.view.Gravity.CENTER
                setPadding(dp(10), dp(10), dp(10), dp(12))
                setBackgroundResource(R.drawable.bg_object_tools_menu_item)
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    dp(145)
                ).apply { topMargin = dp(10) }
            }
            cameraPanel.addView(ImageView(this).apply {
                setImageResource(R.drawable.ic_stream_camera_on)
                setColorFilter(Color.parseColor("#69B4FF"))
                contentDescription = "Camara del dron"
                layoutParams = LinearLayout.LayoutParams(dp(34), dp(34)).apply {
                    topMargin = dp(8)
                }
            })
            cameraPanel.addView(TextView(this).apply {
                text = "ESPERANDO SEÑAL"
                setTextColor(Color.parseColor("#BFD8E8"))
                textSize = 11f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
                gravity = android.view.Gravity.CENTER
                setPadding(dp(12), dp(7), dp(12), dp(7))
                setBackgroundResource(R.drawable.bg_logout_cancel)
            })
            content.addView(cameraPanel)
        }

        val popupWidth = dp(294)
        equipmentInfoPopup = PopupWindow(content, popupWidth, ViewGroup.LayoutParams.WRAP_CONTENT, true).apply {
            isOutsideTouchable = true
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            elevation = dp(10).toFloat()
            showAtLocation(
                webView,
                android.view.Gravity.NO_GRAVITY,
                popupX(screenX, viewportWidth, popupWidth),
                popupY(screenY, viewportHeight)
            )
        }
    }

    private fun showVehicleRouteOnMap(idVehiculo: Int, vehicleName: String) {
        val vehicle = vehiculosList.firstOrNull { it.idVehiculo == idVehiculo }
        val location = liveVehiculoLocations[idVehiculo]
            ?: vehicle?.lat?.let { lat -> vehicle.lon?.let { lon -> lat to lon } }
        val (lat, lon) = location ?: run {
            Toast.makeText(this, "$vehicleName sin ubicacion activa.", Toast.LENGTH_SHORT).show()
            return
        }
        selectVehiculoOnMap(idVehiculo, lat, lon, vehicleName)
    }

    private fun sendVehicleAlert(idVehiculo: Int, vehicleName: String, occupants: List<PersonalItem>) {
        val occupantIds = occupants.map { it.idPersonal.toString() }.distinct()
        if (occupantIds.isEmpty()) {
            Toast.makeText(this, "No hay personal asignado a $vehicleName.", Toast.LENGTH_SHORT).show()
            return
        }
        chatController.sendMessage(
            text = "ALERTA para $vehicleName",
            alert = true,
            destinatarioRol = "CELL,CET",
            destinoTipo = "CELL_LIST",
            destinoId = occupantIds.joinToString(","),
            destinoLabel = vehicleName
        )
        Toast.makeText(this, "Alerta enviada a $vehicleName.", Toast.LENGTH_SHORT).show()
    }

    private fun vehicleDisplayName(vehicle: VehiculoItem): String =
        vehicle.alias.ifBlank { vehicle.codigoInterno }.ifBlank { vehicle.nombre }.ifBlank { "Vehiculo ${vehicle.idVehiculo}" }

    private fun personDisplayName(person: PersonalItem): String {
        val fullName = "${person.nombre} ${person.apellido}".trim()
        return fullName.ifBlank { person.apodo }.ifBlank { "Personal" }
    }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()

    private fun popupX(screenX: Double?, viewportWidth: Double?, popupWidth: Int): Int {
        val location = IntArray(2)
        webView.getLocationInWindow(location)
        val webViewX = location[0]

        val viewport = viewportWidth?.takeIf { it > 0.0 } ?: webView.width.toDouble().takeIf { it > 0.0 } ?: 1.0
        val rawX = screenX ?: (viewport * 0.5)
        val anchorX = webViewX + (rawX / viewport * webView.width)
        val gap = dp(10)
        val edge = dp(8)
        val parentWidth = (webView.parent as? View)?.width?.takeIf { it > 0 } ?: resources.displayMetrics.widthPixels
        val rightX = (anchorX + gap).toInt()
        val leftX = (anchorX - popupWidth - gap).toInt()
        val target = if (rightX + popupWidth <= parentWidth - edge) rightX else leftX
        val finalX = target.coerceIn(edge, (parentWidth - popupWidth - edge).coerceAtLeast(edge))
        android.util.Log.d("POPUP_DEBUG", "popupX: screenX=$screenX, viewportWidth=$viewportWidth, webViewX=$webViewX, rawX=$rawX, anchorX=$anchorX, parentWidth=$parentWidth, finalX=$finalX")
        return finalX
    }

    private fun popupY(screenY: Double?, viewportHeight: Double?): Int {
        val location = IntArray(2)
        webView.getLocationInWindow(location)
        val webViewY = location[1]

        val viewport = viewportHeight?.takeIf { it > 0.0 } ?: webView.height.toDouble().takeIf { it > 0.0 } ?: 1.0
        val rawY = screenY ?: (viewport * 0.5)
        val anchorY = webViewY + (rawY / viewport * webView.height)
        val edge = dp(8)
        val estimatedHeight = dp(235)
        val parentHeight = (webView.parent as? View)?.height?.takeIf { it > 0 } ?: resources.displayMetrics.heightPixels
        val target = (anchorY - dp(24)).toInt()
        val finalY = target.coerceIn(edge, (parentHeight - estimatedHeight - edge).coerceAtLeast(edge))
        android.util.Log.d("POPUP_DEBUG", "popupY: screenY=$screenY, viewportHeight=$viewportHeight, webViewY=$webViewY, rawY=$rawY, anchorY=$anchorY, parentHeight=$parentHeight, finalY=$finalY")
        return finalY
    }

    private fun resolvePersonalSidc(person: PersonalItem): String {
        val text = (person.apodo + " " + person.nombre + " " + person.rol + " " + person.puesto).uppercase()
        if (text.contains("CUT") || text.contains("CET")) return "SFGPE-------MXN"
        if (text.contains("CELL") || text.contains("CELULA")) return "SFGPUCI----K"
        if (text.contains("PATRULL") || text.contains("POLIC") || text.contains("SEGUR")) return "SFGPUCF----K"
        return "SFGPUCI----K"
    }

    private fun formatTimestampTime(isoString: String): String {
        if (isoString.isBlank()) return "-"
        for (sdf in trackingTimestampFormats) {
            try {
                val date = sdf.parse(isoString) ?: continue
                val localFormat = SimpleDateFormat("hh:mm:ss a", Locale.getDefault())
                return localFormat.format(date)
            } catch (e: Exception) {
                // Try next
            }
        }
        return isoString.substringAfter("T").substringBefore(".")
    }

    private fun showPersonalRouteOnMap(idPersonal: Int, personName: String) {
        val person = personalList.firstOrNull { it.idPersonal == idPersonal }
        val location = livePersonalLocations[idPersonal]
            ?: person?.lat?.let { lat -> person.lon?.let { lon -> lat to lon } }
        val (lat, lon) = location ?: run {
            Toast.makeText(this, "$personName sin ubicacion activa.", Toast.LENGTH_SHORT).show()
            return
        }
        selectPersonalOnMap(idPersonal, lat, lon, personName)
    }

    fun createRouteFromMyLocation(destinationLat: Double?, destinationLon: Double?, label: String) {
        val destination = validPair(destinationLat, destinationLon)
        if (destination == null) {
            Toast.makeText(this, "$label no tiene una ubicación válida.", Toast.LENGTH_SHORT).show()
            return
        }

        val origin = validPair(lastKnownLat, lastKnownLon)
        if (origin == null) {
            Toast.makeText(this, "Obteniendo tu ubicación. Inténtalo nuevamente en unos segundos.", Toast.LENGTH_LONG).show()
            locationHelper.requestLocationPermissionOrStart()
            return
        }

        panelNavigationController.showPanel(Panel.NONE)
        cesiumWebController.evaluate(
            "if(typeof setRouteStart==='function'&&typeof setRouteEnd==='function'){setRouteStart(${origin.first},${origin.second});setRouteEnd(${destination.first},${destination.second});}"
        )
        Toast.makeText(this, "Ruta hacia $label.", Toast.LENGTH_SHORT).show()
    }

    private fun sendPersonalAlert(idPersonal: Int, personName: String) {
        chatController.sendMessage(
            text = "ALERTA para $personName",
            alert = true,
            destinatarioRol = "CELL,CET",
            destinoTipo = "CELL_LIST",
            destinoId = idPersonal.toString(),
            destinoLabel = personName
        )
        Toast.makeText(this, "Alerta enviada a $personName.", Toast.LENGTH_SHORT).show()
    }

    private fun goToLogin() {
        if (::currentOperation.isInitialized && ::currentUser.isInitialized) {
            stopMediaStream(showToast = false)
        }
        startActivity(Intent(this, LoginActivity::class.java))
        finish()
    }

    private companion object {
        private const val KEY_ACTIVE_PANEL = "main_active_panel"
        private const val REQUEST_CHAT_CAMERA_PERMISSION = 303
        private const val REQUEST_CHAT_AUDIO_PERMISSION = 304
        private const val REQUEST_CHAT_NOTIFICATION_PERMISSION = 305
        private const val REQUEST_VOICE_CALL_AUDIO_PERMISSION = 306
        private const val REQUEST_INCOMING_CALL_AUDIO_PERMISSION = 307
        private const val TRACKING_ACTIVE_STALE_MS = 30_000L
    }
}
