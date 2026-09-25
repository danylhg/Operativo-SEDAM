package com.operaciones.operaciones_android.wear.ui

import android.Manifest
import android.annotation.SuppressLint
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Canvas
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.media.MediaRecorder
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.text.InputType
import android.text.TextUtils
import android.view.Gravity
import android.view.InputDevice
import android.view.WindowManager
import android.view.MotionEvent
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.ContextCompat
import com.google.android.gms.wearable.MessageClient
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import com.operaciones.operaciones_android.wear.auth.WearSession
import com.operaciones.operaciones_android.wear.bridge.PhoneBridge
import com.operaciones.operaciones_android.wear.bridge.WearPhoneListenerService
import com.operaciones.operaciones_android.wear.call.WearIncomingCallActivity
import com.operaciones.operaciones_android.wear.bridge.WearPhoneSessionSync
import com.operaciones.operaciones_android.wear.config.WearApiConfig
import com.operaciones.operaciones_android.wear.data.WearChatMessage
import com.operaciones.operaciones_android.wear.data.WearOperation
import com.operaciones.operaciones_android.wear.data.WearOperationStatus
import com.operaciones.operaciones_android.wear.data.WearUser
import com.operaciones.operaciones_android.wear.device.WearDeviceInfo
import com.operaciones.operaciones_android.wear.emergency.WearEmergencyService
import com.operaciones.operaciones_android.wear.health.HeartRateMonitor
import com.operaciones.operaciones_android.wear.network.WearApiClient
import com.operaciones.operaciones_android.wear.network.WearSocketManager
import com.operaciones.operaciones_android.wear.R
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.URL
import java.text.SimpleDateFormat
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Date
import java.util.Locale
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.pow
import kotlin.math.tan

class WearMainActivity : Activity(), SensorEventListener, MessageClient.OnMessageReceivedListener {
    companion object {
        private const val REQUEST_RUNTIME_PERMISSIONS = 7001
        private const val REQUEST_AUDIO_PERMISSION = 7002
        private const val MIN_VITAL_UPLOAD_MS = 15_000L
        private const val CHAT_NOTIFICATION_CHANNEL = "sedam_wear_chat"
        private const val URGENT_NOTIFICATION_CHANNEL = "sedam_wear_emergency"
        private const val CHAT_NOTIFICATION_ID_BASE = 30_000
        private const val UNREAD_MESSAGES_PREFS = "sedam_wear_unread_messages"

        private val EXTRA_HEALTH_PERMISSIONS = arrayOf(
            "android.permission.health.READ_HEART_RATE",
            "android.permission.health.READ_OXYGEN_SATURATION",
            "android.permission.health.READ_BODY_TEMPERATURE",
            "android.permission.health.READ_RESPIRATORY_RATE",
            "android.permission.health.READ_BLOOD_PRESSURE"
        )

        val C_BG: Int = Color.parseColor("#081113")
        val C_INPUT: Int = Color.parseColor("#111D1F")
        val C_PANEL: Int = Color.parseColor("#19282A")
        val C_PANEL_ALT: Int = Color.parseColor("#293A3B")
        val C_DIVIDER: Int = Color.parseColor("#3B5556")
        val C_GOLD: Int = Color.parseColor("#70b4bd")
        val C_TEXT: Int = Color.parseColor("#F1F5F2")
        val C_MUTED: Int = Color.parseColor("#A5B7B3")
        val C_MUTED_DARK: Int = Color.parseColor("#607873")
        val C_GREEN: Int = Color.parseColor("#48C58B")
        val C_GREEN_DARK: Int = Color.parseColor("#0c5b8f")
        val C_RED: Int = Color.parseColor("#a06fc7")
        val C_ALERT_BG: Int = Color.parseColor("#5A1118")
        val C_LOGOUT_TEXT: Int = Color.parseColor("#FFFFFF")
        val C_LOGOUT_BG: Int = Color.parseColor("#164E63")
        val C_BLUE: Int = Color.parseColor("#6f8ccc")
        val C_BLUE_DARK: Int = Color.parseColor("#163A46")
    }

    private enum class Panel(val label: String, val title: String) {
        OPERACION("OP", "OPERACIÓN"),
        MENSAJES("MSG", "MENSAJES"),
        MAPA("MAPA", "MAPA"),
        VITALES("VIT", "SALUD")
    }

    private enum class ChatChannel(
        val shortLabel: String,
        val title: String,
        val destinatarioRol: String,
        val destinoTipo: String? = null,
        val destinoId: String? = null,
        val destinoLabel: String? = null
    ) {
        TODOS("TOD", "Todos", "GLOBAL"),
        CETS("CET", "Todos los CET", "CET", "CETS", "ALL", "Todos los CETs"),
        CELULAS("CEL", "Celulas y CET", "CELL,CET"),
        CET_ASIGNADO("CET", "CET asignado", "CET", "CET")
    }

    private val api = WearApiClient()
    private lateinit var phoneBridge: PhoneBridge
    private var wearSocketManager: WearSocketManager? = null
    private var incomingVoiceCall: JSONObject? = null
    private var activePanel = Panel.OPERACION
    private var homeMenuOpen = true
    private var mapWebView: WebView? = null
    private var activeOperationMap: OperationMapView? = null
    private val mapSyncHandler = Handler(Looper.getMainLooper())
    private var drawingSyncRunnable: Runnable? = null
    private var militarySymbolRenderer: MilitarySymbolRenderer? = null
    private var selectedChatChannel = ChatChannel.TODOS
    private var chatConversationOpen = false
    private val cachedChatMessages = mutableListOf<WearChatMessage>()
    private var chatHistoryLoaded = false
    private var chatRefreshInFlight = false
    private var unreadMessageCount = 0
    private val unreadMessagesByChannel = ChatChannel.entries.associateWith { 0 }.toMutableMap()
    private var assignedCet: WearApiClient.AssignedCet? = null
    private var assignedCetLoaded = false
    private var assignedCetLoading = false
    private var messagesBadge: TextView? = null

    private var panelContainer: LinearLayout? = null
    private var statusText: TextView? = null
    private var topTitleText: TextView? = null
    private var topSubtitleText: TextView? = null
    private var homeScrollView: ScrollView? = null
    private var chatSwipeStartX = 0f
    private var chatSwipeStartY = 0f
    private var heartRateValue: TextView? = null
    private var gpsValue: TextView? = null
    private var spo2Value: TextView? = null
    private var tempValue: TextView? = null
    private var respValue: TextView? = null
    private var bpValue: TextView? = null
    private var stepsValue: TextView? = null
    private var baroValue: TextView? = null
    private var chatList: LinearLayout? = null
    private var resourceList: LinearLayout? = null
    private var voiceButton: Button? = null
    private var resourceSummary: WearApiClient.ResourceSummary? = null

    private var usernameInput: EditText? = null
    private var passwordInput: EditText? = null

    private var heartRateMonitor: HeartRateMonitor? = null
    private var lastHeartRate: Double? = null
    private var lastLat: Double? = null
    private var lastLon: Double? = null
    private var lastPressure: Float? = null
    private var initialSteps: Float? = null
    private var todaySteps: Long? = null
    private var lastVitalUploadAt = 0L

    private var sensorManager: SensorManager? = null
    private var stepSensor: Sensor? = null
    private var pressureSensor: Sensor? = null
    private var locationManager: LocationManager? = null
    private var locationListener: LocationListener? = null

    private var voiceRecorder: MediaRecorder? = null
    private var voiceOutputFile: File? = null
    private var voiceStartedAt = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WearApiConfig.load(this)
        phoneBridge = PhoneBridge(this)
        loadUnreadMessages()
        createChatNotificationChannels()
        requestRuntimePermissions()
        if (hasActiveSession()) {
            renderHome()
        } else {
            WearSession.clear(this)
            renderLogin()
        }
    }

    override fun onStart() {
        super.onStart()
        Wearable.getMessageClient(this).addListener(this)
        requestPhoneSessionSync()
    }

    override fun onResume() {
        super.onResume()
        if (hasActiveSession()) startWearRuntime()
    }

    override fun onPause() {
        heartRateMonitor?.stop()
        stopMotionSensors()
        super.onPause()
    }

    override fun onStop() {
        Wearable.getMessageClient(this).removeListener(this)
        super.onStop()
    }

    override fun onDestroy() {
        stopDrawingSync()
        stopWearRuntime()
        militarySymbolRenderer?.destroy()
        militarySymbolRenderer = null
        super.onDestroy()
    }

    override fun onMessageReceived(messageEvent: MessageEvent) {
        when (messageEvent.path) {
            WearPhoneSessionSync.PATH_SESSION_SYNC -> applyPhoneSession(messageEvent)
            WearPhoneSessionSync.PATH_SESSION_ERROR -> showPhoneSessionError(messageEvent)
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_AUDIO_PERMISSION) {
            if (hasPermission(Manifest.permission.RECORD_AUDIO)) startVoiceRecording()
            return
        }
        if (WearSession.isLoggedIn(this)) startWearRuntime()
        if (activePanel == Panel.VITALES) renderActivePanel()
    }

    private fun requestPhoneSessionSync() {
        if (!::phoneBridge.isInitialized) return
        phoneBridge.requestSessionSync(WearDeviceInfo.toJson(this)) { ok ->
            if (!ok && !WearSession.isLoggedIn(this)) {
                runOnUiThread { setStatus("telefono no conectado") }
            }
        }
    }

    private fun applyPhoneSession(messageEvent: MessageEvent) {
        runCatching {
            JSONObject(String(messageEvent.data, Charsets.UTF_8))
        }.onSuccess { payload ->
            val applied = WearPhoneSessionSync.apply(this, payload)
            runOnUiThread {
                if (applied) {
                    setStatus("sincronizado telefono")
                    activePanel = Panel.OPERACION
                    renderHome()
                    startWearRuntime()
                } else {
                    WearSession.clear(this@WearMainActivity)
                    renderLogin()
                    setStatus("operacion no activa")
                }
            }
        }.onFailure {
            runOnUiThread { setStatus("sync invalida") }
        }
    }

    private fun showPhoneSessionError(messageEvent: MessageEvent) {
        val message = runCatching {
            JSONObject(String(messageEvent.data, Charsets.UTF_8)).optString("mensaje", "smartwatch no autorizado")
        }.getOrElse { "smartwatch no autorizado" }
        runOnUiThread { setStatus(message); toast(message) }
    }

    private fun renderLogin() {
        val content = compactColumn()
        content.addView(brandHeader("ACCESO"))
        content.addView(thinDivider(fieldWidthDp()))

        content.addView(fieldLabel("USUARIO"))
        usernameInput = loginInput("", "Usuario", InputType.TYPE_CLASS_TEXT)
        content.addView(usernameInput)

        content.addView(fieldLabel("CONTRASE\u00d1A"))
        passwordInput = loginInput(
            "",
            "Contrase\u00f1a",
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        )
        content.addView(passwordInput)

        content.addView(proButton("INICIAR SESI\u00d3N", fieldWidthDp(), C_GREEN, C_GREEN_DARK) { attemptLogin() })
        content.addView(proButton("DIRECCI\u00d3N", fieldWidthDp(), C_MUTED, C_PANEL) { renderServerAddress() })
        statusText = mutedText("", 7f).apply { layoutParams = blockParams(fieldWidthDp(), top = 4) }
        content.addView(statusText)
        setCenteredContent(content)
    }

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        if (!homeMenuOpen && activePanel != Panel.MAPA) {
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    chatSwipeStartX = event.x
                    chatSwipeStartY = event.y
                }
                MotionEvent.ACTION_UP -> {
                    val deltaX = event.x - chatSwipeStartX
                    val deltaY = kotlin.math.abs(event.y - chatSwipeStartY)
                    if (deltaX > dp(55) && deltaY < dp(48)) {
                        if (activePanel == Panel.MENSAJES && chatConversationOpen) {
                            chatConversationOpen = false
                            renderActivePanel()
                        } else {
                            homeMenuOpen = true
                            renderHome()
                        }
                        return true
                    }
                }
            }
        }
        return super.dispatchTouchEvent(event)
    }

    override fun onGenericMotionEvent(event: MotionEvent): Boolean {
        if (!homeMenuOpen && activePanel == Panel.MAPA &&
            event.action == MotionEvent.ACTION_SCROLL &&
            event.isFromSource(InputDevice.SOURCE_ROTARY_ENCODER)
        ) {
            val rotation = event.getAxisValue(MotionEvent.AXIS_SCROLL)
            if (rotation != 0f) activeOperationMap?.adjustZoom(rotation.coerceIn(-1f, 1f) * 0.16f)
            return true
        }
        return super.onGenericMotionEvent(event)
    }

    private fun renderServerAddress() {
        val addressInput = loginInput(
            WearApiConfig.baseUrl,
            "192.168.1.20:3001",
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
        ).apply {
            layoutParams = blockParams(contentWidthDp().coerceAtMost(172), height = 36, top = 4)
            textSize = 9.5f
            setSelectAllOnFocus(true)
        }

        val content = compactColumn().apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            addView(View(context).apply {
                layoutParams = LinearLayout.LayoutParams(1, dp(if (isRoundScreen()) 24 else 16))
            })
            addView(valueText("DIRECCI\u00d3N", 11f, C_BLUE))
            addView(thinDivider(fieldWidthDp()))
            addView(addressInput)
            addView(View(context).apply {
                layoutParams = LinearLayout.LayoutParams(1, dp(9))
            })
            addView(
                proButton("GUARDAR", fieldWidthDp(), C_BLUE, C_PANEL_ALT) {
                    try {
                        WearApiConfig.saveBaseUrl(this@WearMainActivity, addressInput.text.toString())
                        toast("Direcci\u00f3n guardada")
                        renderLogin()
                    } catch (error: IllegalArgumentException) {
                        addressInput.error = error.message ?: "Direcci\u00f3n inv\u00e1lida"
                    }
                }
            )
            addView(
                proButton("CANCELAR", fieldWidthDp(), C_MUTED, C_INPUT) { renderLogin() }
            )
        }
        setCenteredContent(content)
        addressInput.requestFocus()
    }

    private fun renderHome() {
        if (!homeMenuOpen && activePanel == Panel.MAPA) {
            renderNativeOperationMap()
            return
        }
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        mapWebView?.destroy()
        mapWebView = null
        militarySymbolRenderer?.destroy()
        militarySymbolRenderer = null
        stopDrawingSync()
        activeOperationMap = null
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_VISIBLE
        val content = homeColumn()
        content.addView(topBar())
        content.addView(thinDivider(contentWidthDp()))
        if (homeMenuOpen) {
            content.addView(mainMenu())
            panelContainer = null
            statusText = null
            setHomeContent(content, null)
            refreshOperation()
            return
        }
        panelContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
        }
        content.addView(panelContainer)
        statusText = null
        setHomeContent(content, null)
        renderActivePanel()
        refreshOperation()
    }

    private fun renderActivePanel() {
        val container = panelContainer ?: return
        container.removeAllViews()
        topTitleText?.text = currentTopTitle()
        topTitleText?.setTextColor(
            if (activePanel == Panel.MENSAJES && chatConversationOpen) {
                chatChannelColor(selectedChatChannel)
            } else {
                C_GOLD
            }
        )
        when (activePanel) {
            Panel.OPERACION -> renderOperationPanel(container)
            Panel.MENSAJES -> renderChatPanel(container)
            Panel.MAPA -> renderMapPanel(container)
            Panel.VITALES -> renderVitalsPanel(container)
        }
    }

    private fun renderOperationPanel(container: LinearLayout) {
        val user = WearSession.user(this)
        val operation = WearSession.operation(this)
        container.addView(sectionBlock("USUARIO", user?.nombreCompleto ?: "--", user?.rol?.name ?: "--"))
        container.addView(sectionBlock(
            if (operation?.status == WearOperationStatus.ACTIVA) "OPERACION ACTIVA" else "OPERACION",
            operation?.nombre?.ifBlank { operationTitle(operation) } ?: "--",
            ""
        ))
        container.addView(gpsBlock())
        container.addView(proButton("CERRAR SESION", contentWidthDp(), C_LOGOUT_TEXT, C_LOGOUT_BG) { logout() })
    }

    private fun renderVitalsPanel(container: LinearLayout) {
        val heart = "%.0f".format(lastHeartRate ?: Double.NaN).takeUnless { it == "NaN" } ?: "--"
        container.addView(vitalHero(heart))

        val grid = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
        }
        grid.addView(twoMetricRow(
            metricCard("SpO2", "-- %", C_GOLD).also { spo2Value = it.value },
            metricCard("TEMP", "-- C", C_GOLD).also { tempValue = it.value }
        ))
        grid.addView(twoMetricRow(
            metricCard("RESP", "-- rpm", C_GOLD).also { respValue = it.value },
            metricCard("PA", "--/--", C_GOLD).also { bpValue = it.value }
        ))
        grid.addView(twoMetricRow(
            metricCard("PASOS", todaySteps?.toString() ?: "--", C_GREEN).also { stepsValue = it.value },
            metricCard("BARO", lastPressure?.let { "%.0f hPa".format(it) } ?: "--", C_BLUE).also { baroValue = it.value }
        ))
        container.addView(grid)
        container.addView(proButton(
            "PROBAR LINEA DE VIDA",
            contentWidthDp(),
            C_TEXT,
            C_ALERT_BG
        ) { sendLifeLineTest() })
    }

    private fun renderChatPanel(container: LinearLayout) {
        if (!chatConversationOpen) {
            availableChatChannels().forEach { channel ->
                container.addView(chatContactRow(channel))
            }
            loadAssignedCetIfNeeded()
            if (!chatHistoryLoaded) refreshChat(showLoading = false)
            return
        }

        chatList = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.FILL_HORIZONTAL
        }
        container.addView(chatList)
        renderChatPlaceholder("cargando", selectedChatChannel.shortLabel)
        container.addView(thinDivider(contentWidthDp() - if (isRoundScreen()) 30 else 14).apply {
            layoutParams = blockParams(
                contentWidthDp() - if (isRoundScreen()) 30 else 14,
                height = 1,
                top = 9
            ).apply { bottomMargin = dp(4) }
        })
        container.addView(proButton("GRABAR AUDIO", contentWidthDp(), C_TEXT, C_GREEN_DARK) {
            toggleVoiceRecording()
        }.also { voiceButton = it })
        container.addView(twoButtonRow(
            proButton("OK", 44, C_TEXT, Color.parseColor("#0c5b8f")) { sendQuickMessage("OK") },
            proButton("VOY", 44, C_TEXT, Color.parseColor("#0c5b8f")) { sendQuickMessage("En camino") },
            proButton("APOYO", 54, C_TEXT, Color.parseColor("#a00e32")) {
                sendQuickMessage("Necesito apoyo", urgent = true)
            }
        ))
        refreshChat()
    }

    private fun chatContactRow(channel: ChatChannel): LinearLayout =
        LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            val horizontalInset = if (isRoundScreen()) 15 else 7
            val row = FrameLayout(this@WearMainActivity).apply {
                setPadding(dp(horizontalInset), dp(7), dp(horizontalInset), dp(7))

                val labels = LinearLayout(this@WearMainActivity).apply {
                    orientation = LinearLayout.VERTICAL
                    gravity = Gravity.CENTER_HORIZONTAL
                    addView(valueText(chatChannelTitle(channel), 11f, chatChannelColor(channel)).apply {
                        maxLines = 1
                        ellipsize = TextUtils.TruncateAt.END
                        typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
                        gravity = Gravity.CENTER
                    })
                    addView(mutedText(lastMessagePreview(channel), 7f).apply {
                        maxLines = 1
                        ellipsize = TextUtils.TruncateAt.END
                        gravity = Gravity.CENTER
                    })
                }
                addView(labels, FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.WRAP_CONTENT,
                    Gravity.CENTER
                ).apply {
                    leftMargin = dp(20)
                    rightMargin = dp(20)
                })

                val unread = unreadMessagesByChannel.getValue(channel)
                if (unread > 0) {
                    addView(unreadBadge(unread), FrameLayout.LayoutParams(
                        dp(18),
                        dp(18),
                        Gravity.END or Gravity.CENTER_VERTICAL
                    ))
                }
            }
            addView(row, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ))
            addView(thinDivider(contentWidthDp() - (horizontalInset * 2)))
            layoutParams = blockParams(contentWidthDp())
            minimumHeight = dp(52)
            isClickable = true
            isFocusable = true
            contentDescription = "${chatChannelTitle(channel)}. ${lastMessagePreview(channel)}"
            setOnClickListener {
                selectedChatChannel = channel
                clearUnreadChannel(channel)
                chatConversationOpen = true
                renderActivePanel()
            }
        }

    private fun chatChannelColor(channel: ChatChannel): Int =
        when (channel) {
            ChatChannel.TODOS -> Color.parseColor("#4d88e1")
            ChatChannel.CETS -> Color.parseColor("#B39DDB")
            ChatChannel.CELULAS -> Color.parseColor("#58b17d")
            ChatChannel.CET_ASIGNADO -> Color.parseColor("#69BFF2")
        }

    private fun availableChatChannels(): List<ChatChannel> =
        if (WearSession.user(this)?.rol == com.operaciones.operaciones_android.wear.data.WearUserRole.CELL) {
            buildList {
                add(ChatChannel.TODOS)
                if (assignedCet != null) add(ChatChannel.CET_ASIGNADO)
                add(ChatChannel.CELULAS)
            }
        } else {
            ChatChannel.entries.filterNot { it == ChatChannel.CET_ASIGNADO }
        }

    private fun chatChannelTitle(channel: ChatChannel): String {
        if (channel == ChatChannel.CET_ASIGNADO) return assignedCet?.label ?: channel.title
        if (WearSession.user(this)?.rol == com.operaciones.operaciones_android.wear.data.WearUserRole.CELL) {
            return when (channel) {
                ChatChannel.TODOS -> "General"
                ChatChannel.CELULAS -> "Celulas"
                else -> channel.title
            }
        }
        return channel.title
    }

    private fun loadAssignedCetIfNeeded() {
        val user = WearSession.user(this) ?: return
        if (user.rol != com.operaciones.operaciones_android.wear.data.WearUserRole.CELL ||
            assignedCetLoaded || assignedCetLoading
        ) return
        val operation = WearSession.operation(this) ?: return
        val token = WearSession.token(this)
        if (token.isBlank()) return
        assignedCetLoading = true
        api.getAssignedCet(
            operationId = operation.id,
            personalId = user.id,
            token = token,
            onSuccess = { cet -> runOnUiThread {
                assignedCet = cet
                assignedCetLoaded = true
                assignedCetLoading = false
                if (activePanel == Panel.MENSAJES && !chatConversationOpen) renderActivePanel()
            } },
            onError = { runOnUiThread {
                assignedCetLoaded = true
                assignedCetLoading = false
            } }
        )
    }

    private fun renderResourcesPanel(container: LinearLayout) {
        val summary = resourceSummary
        container.addView(twoMetricRow(
            metricCard("PERS", summary?.personal?.size?.toString() ?: "--"),
            metricCard("VEH", summary?.vehiculos?.size?.toString() ?: "--")
        ))
        container.addView(twoMetricRow(
            metricCard("EQP", summary?.equipos?.size?.toString() ?: "--"),
            metricCard("GPS", if (lastLat != null && lastLon != null) "OK" else "--")
        ))
        resourceList = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
        }
        container.addView(resourceList)
        renderResourceRows(summary, if (summary == null) "cargando" else "sin datos")
        container.addView(proButton("ACTUALIZAR", contentWidthDp(), C_BLUE, C_PANEL_ALT) { refreshResources() })
        if (summary == null) refreshResources()
    }

    private fun renderMapPanel(container: LinearLayout) {
        val operation = WearSession.operation(this)
        container.addView(OperationMapView(this).apply {
            operationLat = operation?.zonaLat?.takeIf { it != 0.0 }
            operationLon = operation?.zonaLon?.takeIf { it != 0.0 }
            userLat = lastLat
            userLon = lastLon
            layoutParams = blockParams(contentWidthDp(), top = 7).apply { height = dp(132) }
        })
        container.addView(mutedText(operationTitle(operation), 7f).apply {
            gravity = Gravity.CENTER
            layoutParams = blockParams(contentWidthDp(), top = 5)
        })
    }

    private fun renderNativeOperationMap() {
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.decorView.systemUiVisibility =
            View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        val operation = WearSession.operation(this)
        val user = WearSession.user(this)
        militarySymbolRenderer?.destroy()
        val symbolRenderer = MilitarySymbolRenderer(this).also { militarySymbolRenderer = it }
        val map = OperationMapView(this, symbolRenderer) {
            homeMenuOpen = true
            renderHome()
        }.apply {
            setRouteOwner(
                if (user?.tabla.equals("personal", ignoreCase = true)) "PERSONAL" else "USUARIO",
                user?.id
            )
            operationLat = operation?.zonaLat?.takeIf { it != 0.0 }
            operationLon = operation?.zonaLon?.takeIf { it != 0.0 }
            userLat = lastLat
            userLon = lastLon
        }
        activeOperationMap = map
        val isRoundScreen = resources.configuration.isScreenRound
        val mapControlSize = dp(if (isRoundScreen) 36 else 34)
        val mapControlHorizontalInset = dp(if (isRoundScreen) 22 else 12)
        val mapControlVerticalInset = dp(if (isRoundScreen) 28 else 22)
        setContentView(FrameLayout(this).apply {
            addView(map, FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            ))
            addView(MapBackButton(context) {
                homeMenuOpen = true
                renderHome()
            }, FrameLayout.LayoutParams(mapControlSize, mapControlSize, Gravity.START or Gravity.TOP).apply {
                leftMargin = mapControlHorizontalInset
                topMargin = mapControlVerticalInset
            })
            addView(MapLocateButton(context) { map.centerOnUser() }, FrameLayout.LayoutParams(mapControlSize, mapControlSize, Gravity.END or Gravity.BOTTOM).apply {
                rightMargin = mapControlHorizontalInset
                bottomMargin = mapControlVerticalInset
            })
        })
        val token = WearSession.token(this)
        if (operation != null && token.isNotBlank()) {
            api.getOperationMap(
                operation.id,
                token,
                onSuccess = { data -> runOnUiThread {
                    map.setOperationData(data)
                    refreshOperationTracking(map, operation.id, token)
                } },
                onError = { error ->
                    runOnUiThread {
                        toast(error)
                        if (error.startsWith("Sesion vencida")) requestPhoneSessionSync()
                    }
                }
            )
            api.getOperationDrawings(
                operation.id,
                token,
                onSuccess = { drawings -> runOnUiThread { map.setDrawings(drawings) } },
                onError = { error ->
                    runOnUiThread {
                        if (error.startsWith("Sesion vencida")) requestPhoneSessionSync()
                    }
                }
            )
            startDrawingSync(map, operation.id, token)
        }
    }

    private fun refreshOperationTracking(map: OperationMapView, operationId: Int, token: String) {
        listOf(
            "vehiculos" to "tracking_vehiculo",
            "equipos" to "tracking_equipo",
            "dispositivos" to "tracking_dispositivo"
        ).forEach { (resource, event) ->
            api.getOperationTracking(
                operationId = operationId,
                resource = resource,
                token = token,
                onSuccess = { items -> runOnUiThread {
                    if (activeOperationMap !== map) return@runOnUiThread
                    for (index in 0 until items.length()) {
                        items.optJSONObject(index)?.let { map.applyRealtimeTracking(event, it) }
                    }
                } },
                onError = { error ->
                    if (error.startsWith("Sesion vencida")) runOnUiThread { requestPhoneSessionSync() }
                }
            )
        }
    }

    private fun startDrawingSync(map: OperationMapView, operationId: Int, token: String) {
        stopDrawingSync()
        val task = object : Runnable {
            override fun run() {
                if (activeOperationMap !== map) return
                api.getOperationDrawings(
                    operationId,
                    token,
                    onSuccess = { items -> runOnUiThread {
                        if (activeOperationMap === map) map.setDrawings(items)
                    } },
                    onError = { }
                )
                mapSyncHandler.postDelayed(this, 3_000L)
            }
        }
        drawingSyncRunnable = task
        mapSyncHandler.postDelayed(task, 3_000L)
    }

    private fun stopDrawingSync() {
        drawingSyncRunnable?.let(mapSyncHandler::removeCallbacks)
        drawingSyncRunnable = null
    }

    private fun mapZoomControls(map: OperationMapView): LinearLayout =
        LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            background = GradientDrawable().apply {
                setColor(Color.parseColor("#99143036"))
                cornerRadius = dp(15).toFloat()
            }
            addView(mapControlButton("+") { map.zoomIn() }, LinearLayout.LayoutParams(dp(28), dp(30)))
            addView(View(context).apply { setBackgroundColor(Color.parseColor("#5272C4CF")) }, LinearLayout.LayoutParams(dp(16), dp(1)))
            addView(mapControlButton("−") { map.zoomOut() }, LinearLayout.LayoutParams(dp(28), dp(30)))
        }

    private fun mapControlButton(symbol: String, action: () -> Unit): Button =
        Button(this).apply {
            text = symbol
            setTextColor(C_TEXT)
            textSize = 15f
            includeFontPadding = false
            minWidth = 0
            minHeight = 0
            setPadding(0, 0, 0, 0)
            stateListAnimator = null
            background = null
            setOnClickListener { action() }
        }

    private class MapBackButton(context: Context, action: () -> Unit) : View(context) {
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            style = Paint.Style.STROKE
            strokeWidth = 3.8f
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }
        private val backgroundPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.parseColor("#B3143036")
            style = Paint.Style.FILL
        }

        init {
            isClickable = true
            isFocusable = true
            setBackgroundColor(Color.TRANSPARENT)
            setOnClickListener { action() }
        }

        override fun onDraw(canvas: Canvas) {
            val cx = width / 2f
            val cy = height / 2f
            canvas.drawCircle(cx, cy, width.coerceAtMost(height) * 0.44f, backgroundPaint)
            val path = Path().apply {
                moveTo(cx + 8f, cy - 12f)
                lineTo(cx - 6f, cy)
                lineTo(cx + 8f, cy + 12f)
            }
            canvas.drawPath(path, paint)
        }
    }

    private class MapLocateButton(context: Context, action: () -> Unit) : View(context) {
        private val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            style = Paint.Style.STROKE
            strokeWidth = 2.6f
            strokeCap = Paint.Cap.ROUND
        }
        private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.parseColor("#B3143036")
            style = Paint.Style.FILL
        }

        init {
            isClickable = true
            setOnClickListener { action() }
        }

        override fun onDraw(canvas: Canvas) {
            val cx = width / 2f
            val cy = height / 2f
            canvas.drawCircle(cx, cy, width * 0.44f, fillPaint)
            canvas.drawCircle(cx, cy, 7f, linePaint)
            canvas.drawCircle(cx, cy, 2f, linePaint)
            canvas.drawLine(cx, cy - 13f, cx, cy - 9f, linePaint)
            canvas.drawLine(cx, cy + 9f, cx, cy + 13f, linePaint)
            canvas.drawLine(cx - 13f, cy, cx - 9f, cy, linePaint)
            canvas.drawLine(cx + 9f, cy, cx + 13f, cy, linePaint)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun renderCesiumMap() {
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.decorView.systemUiVisibility =
            View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        val operation = WearSession.operation(this)
        val webView = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            setLayerType(View.LAYER_TYPE_HARDWARE, null)
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                allowFileAccess = true
                allowContentAccess = true
                allowFileAccessFromFileURLs = true
                allowUniversalAccessFromFileURLs = true
                mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                loadWithOverviewMode = false
                useWideViewPort = false
                setSupportZoom(false)
                builtInZoomControls = false
                displayZoomControls = false
            }
            addJavascriptInterface(WearMapBridge(operation?.id ?: 0), "Android")
            webChromeClient = WebChromeClient()
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String) {
                    super.onPageFinished(view, url)
                    val lat = operation?.zonaLat ?: 0.0
                    val lon = operation?.zonaLon ?: 0.0
                    view.evaluateJavascript(
                        "if(typeof setOperationView==='function')setOperationView($lat,$lon,700);" +
                            "if(typeof resizeCesium==='function')resizeCesium();",
                        null
                    )
                    fetchCesiumOperation(view)
                }
            }
            loadUrl("file:///android_asset/map.html")
        }
        mapWebView?.destroy()
        mapWebView = webView
        setContentView(FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
            addView(webView, FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            ))
            val isRoundScreen = resources.configuration.isScreenRound
            val controlSize = dp(if (isRoundScreen) 36 else 34)
            val horizontalInset = dp(if (isRoundScreen) 22 else 12)
            val verticalInset = dp(if (isRoundScreen) 28 else 22)
            addView(MapBackButton(context) {
                mapWebView?.destroy()
                mapWebView = null
                homeMenuOpen = true
                renderHome()
            }, FrameLayout.LayoutParams(controlSize, controlSize, Gravity.START or Gravity.TOP).apply {
                leftMargin = horizontalInset
                topMargin = verticalInset
            })
            addView(MapLocateButton(context) {
                val lat = lastLat
                val lon = lastLon
                if (lat != null && lon != null) {
                    webView.evaluateJavascript(
                        "if(typeof centerOnLocation==='function')centerOnLocation($lat,$lon,250,true);",
                        null
                    )
                }
            }, FrameLayout.LayoutParams(controlSize, controlSize, Gravity.END or Gravity.BOTTOM).apply {
                rightMargin = horizontalInset
                bottomMargin = verticalInset
            })
        })
    }

    private fun fetchCesiumOperation(webView: WebView) {
        val operation = WearSession.operation(this) ?: return
        val token = WearSession.token(this)
        if (token.isBlank()) return
        api.getOperationMap(
            operationId = operation.id,
            token = token,
            onSuccess = { payload -> runOnUiThread {
                if (mapWebView !== webView) return@runOnUiThread
                webView.evaluateJavascript(operationMapScript(payload.toString()), null)
            } },
            onError = { error -> runOnUiThread { toast(error) } }
        )
    }

    private fun operationMapScript(payload: String): String =
        """
        (function(data){
          const layers=Array.isArray(data.capas)?data.capas:[];
          const zone=data.zona_operacion;
          if(zone&&zone.geometria&&zone.geometria.coordinates){
            const ring=zone.geometria.coordinates[0]||[];
            zone.points=ring.slice(0,-1).map(p=>({lat:Number(p[1]),lon:Number(p[0])}));
            if(typeof loadOperationZone==='function')loadOperationZone(zone);
            if(typeof setOperationView==='function')setOperationView(Number(zone.centroide_lat),Number(zone.centroide_lon),Number(zone.zoom_inicial||700));
          }
          const grid=data.grid||data.cuadricula_operacion;
          if(grid&&typeof loadOperationGrid==='function'){
            grid.names=grid.names||grid.nombres||[];
            loadOperationGrid(grid);
          }
          const pois=(Array.isArray(data.pois)?data.pois:layers.filter(x=>x.tipo_capa==='POI')).map(x=>({
            id_poi:Number(x.id_poi||x.id_elemento),nombre:x.nombre||'PDI',tipo_poi:x.tipo_poi||x.subtipo||'',
            latitud:Number(x.latitud),longitud:Number(x.longitud),color:x.color||'#FFD700',icono_src:x.icono_src||null,sidc:x.sidc||null
          })).filter(x=>x.id_poi>0);
          if(typeof loadPois==='function')loadPois(pois,true);
          const circles=[],polygons=[];
          layers.filter(x=>x.tipo_capa==='AREA').forEach(x=>{
            const g=typeof x.geometria==='string'?JSON.parse(x.geometria):x.geometria;
            const m=(g&&g.meta)||{};
            if(m.shape==='circle'&&Array.isArray(m.center))circles.push({id_area:Number(x.id_elemento),nombre:x.nombre,center_lat:Number(m.center[1]),center_lon:Number(m.center[0]),radius_m:Number(m.radius_m),color:x.color||'#FF4500',opacity:Number(m.opacity||.35),outline_width:Number(m.outline_width||3)});
            if(m.shape==='polygon'&&g&&g.coordinates){const r=g.coordinates[0]||[];polygons.push({id_area:Number(x.id_elemento),nombre:x.nombre,color:x.color||'#FFD700',opacity:Number(m.opacity||.35),outline_width:Number(m.outline_width||3),points:r.slice(0,-1).map(p=>({lat:Number(p[1]),lon:Number(p[0])}))});}
          });
          if(typeof syncAreas==='function')syncAreas(circles,polygons);
          const structures=layers.filter(x=>x.tipo_capa==='EDIFICIO'||x.tipo_estructura).map(x=>({id_marca:Number(x.id_marca||x.id_elemento),nombre:x.nombre||'Estructura',tipo_estructura:x.tipo_estructura||x.subtipo||'EDIFICIO',latitud:Number(x.latitud),longitud:Number(x.longitud),icono_src:x.icono_src||null}));
          if(typeof loadStructures==='function')loadStructures(structures,true);
          const routes=layers.filter(x=>x.tipo_capa==='RUTA').map(x=>({id_ruta:Number(x.id_ruta||x.id_elemento),nombre:x.nombre||'Ruta',geometria:typeof x.geometria==='string'?JSON.parse(x.geometria):x.geometria,color:x.color||'#1E90FF',estado:x.estado||'ACTIVA'}));
          if(typeof loadTacticalRoutes==='function')loadTacticalRoutes(routes,true);
          if(typeof loadRemoteRoutes==='function')loadRemoteRoutes(data.rutas_navegacion||[],true);
          const positions={};(data.personal||[]).forEach(p=>positions[p.id_personal]=p);
          layers.filter(x=>x.tipo_capa==='PERSONAL').forEach(p=>{const q=positions[p.id_referencia];if(q&&typeof updateTrackingPersonal==='function')updateTrackingPersonal(Number(p.id_referencia),Number(q.latitud),Number(q.longitud),p.apodo||p.nombre||('P-'+p.id_referencia),p);});
          (data.vehiculos||[]).forEach(v=>{if(typeof updateTrackingVehiculo==='function'&&v.latitud!=null)updateTrackingVehiculo(Number(v.id_vehiculo),Number(v.latitud),Number(v.longitud),v.alias||v.codigo_interno||v.nombre||('V-'+v.id_vehiculo),v);});
          layers.filter(x=>x.tipo_capa==='EQUIPO').forEach(e=>{if(typeof updateTrackingEquipo==='function'&&e.latitud!=null)updateTrackingEquipo(Number(e.id_equipo||e.id_referencia),Number(e.latitud),Number(e.longitud),e.nombre||('E-'+(e.id_equipo||e.id_referencia)),e);});
          if(typeof resizeCesium==='function')resizeCesium();
        })($payload);
        """.trimIndent()

    private class WearMapBridge(private val operationId: Int) {
        @JavascriptInterface fun getOperationId(): Int = operationId
        @JavascriptInterface fun getOperationName(): String = "Operacion"
        @JavascriptInterface fun getUserRole(): String = "OPERADOR"
        @JavascriptInterface fun requestLocation() = Unit
        @JavascriptInterface fun onMapTapped(lat: Double, lon: Double): Boolean = false
        @JavascriptInterface fun onMapObjectSelected(payload: String) = Unit
        @JavascriptInterface fun onMapObjectDeleteRequested(payload: String) = Unit
        @JavascriptInterface fun onMapSelectionCleared() = Unit
        @JavascriptInterface fun onRouteCreated(payload: String) = Unit
        @JavascriptInterface fun onDrawingSaved(payload: String) = Unit
        @JavascriptInterface fun onDrawingDeleted(id: String) = Unit
        @JavascriptInterface fun sendTrafficAlert(payload: String) = Unit
    }

    private fun attemptLogin() {
        val username = usernameInput?.text?.toString()?.trim().orEmpty()
        val password = passwordInput?.text?.toString().orEmpty()
        if (username.isBlank() || password.isBlank()) {
            setStatus("faltan credenciales")
            return
        }
        setStatus("conectando...")
        api.login(
            context = this,
            username = username,
            password = password,
            onSuccess = { login ->
                api.fetchAssignedOperation(
                    userId = login.user.id,
                    token = login.token,
                    onSuccess = { operation ->
                        if (operation?.status != WearOperationStatus.ACTIVA) {
                            WearSession.clear(this)
                            runOnUiThread {
                                setStatus("operacion no activa")
                                toast("No puedes iniciar sesion: la operacion no esta activa")
                            }
                            return@fetchAssignedOperation
                        }
                        WearSession.save(this, login.user, login.token, operation)
                        runOnUiThread {
                            toast("Sesion iniciada")
                            activePanel = Panel.OPERACION
                            renderHome()
                            startWearRuntime()
                        }
                    },
                    onError = { error ->
                        WearSession.clear(this)
                        runOnUiThread {
                            setStatus(error)
                            toast("No se pudo validar una operacion activa")
                        }
                    }
                )
            },
            onError = { error -> runOnUiThread { setStatus(error); toast(error) } }
        )
    }

    private fun hasActiveSession(): Boolean =
        WearSession.isLoggedIn(this) && WearSession.operation(this)?.status == WearOperationStatus.ACTIVA

    private fun refreshOperation() {
        val user = WearSession.user(this) ?: return
        val token = WearSession.token(this)
        if (token.isBlank()) return
        setStatus("cargando operacion")
        api.fetchAssignedOperation(
            userId = user.id,
            token = token,
            onSuccess = { operation ->
                WearSession.saveOperation(this, operation)
                runOnUiThread {
                    setStatus(if (operation == null) "sin operacion" else "")
                    if (activePanel == Panel.OPERACION) renderActivePanel()
                }
            },
            onError = { error -> runOnUiThread { setStatus(error) } }
        )
    }

    private fun refreshChat(showLoading: Boolean = true) {
        val operation = WearSession.operation(this)
        val token = WearSession.token(this)
        if (operation == null || token.isBlank()) {
            if (chatConversationOpen) renderChatPlaceholder("sin operacion", selectedChatChannel.shortLabel)
            return
        }
        if (chatRefreshInFlight) return
        chatRefreshInFlight = true
        if (showLoading) renderChatPlaceholder("cargando", selectedChatChannel.shortLabel)
        api.getMessages(
            operationId = operation.id,
            token = token,
            onSuccess = { messages -> runOnUiThread {
                chatRefreshInFlight = false
                chatHistoryLoaded = true
                cachedChatMessages.clear()
                cachedChatMessages.addAll(messages)
                if (activePanel == Panel.MENSAJES) {
                    if (chatConversationOpen) renderMessages(cachedChatMessages) else renderActivePanel()
                }
            } },
            onError = { error ->
                runOnUiThread {
                    chatRefreshInFlight = false
                    setStatus(error)
                    if (showLoading && chatConversationOpen) {
                        renderChatPlaceholder("error red", selectedChatChannel.shortLabel)
                    }
                }
            }
        )
    }

    private fun refreshResources() {
        val operation = WearSession.operation(this)
        val token = WearSession.token(this)
        if (operation == null || token.isBlank()) {
            renderResourceRows(null, "sin operacion")
            return
        }
        renderResourceRows(resourceSummary, if (resourceSummary == null) "cargando" else "actualizando")
        api.getResourceSummary(
            operationId = operation.id,
            token = token,
            onSuccess = { summary ->
                resourceSummary = summary
                runOnUiThread {
                    if (activePanel == Panel.MAPA) renderActivePanel()
                }
            },
            onError = { error ->
                runOnUiThread {
                    setStatus(error)
                    if (resourceSummary == null) renderResourceRows(null, "error red")
                }
            }
        )
    }

    private fun renderChatPlaceholder(value: String, sub: String) {
        val list = chatList ?: return
        list.removeAllViews()
        list.addView(chatStatusBlock(value, sub))
    }

    private fun renderMessages(messages: List<WearChatMessage>) {
        val list = chatList ?: return
        list.removeAllViews()
        // Las emergencias sólo se ven como alerta operativa; nunca forman parte
        // del historial ni de una conversación del reloj.
        val last = messages.filterNot(::isOperationalAlert).filterForSelectedChat().takeLast(6)
        if (last.isEmpty()) {
            list.addView(chatStatusBlock("sin mensajes", selectedChatChannel.shortLabel))
            return
        }
        val user = WearSession.user(this)
        val bubbleWidth = (contentWidthDp() * 0.78f).toInt().coerceAtLeast(112)
        last.forEach { message ->
            val mine = message.autor.equals(user?.nombreCompleto, ignoreCase = true) ||
                message.autor.equals(user?.username, ignoreCase = true)
            val urgent = message.tipo == "URGENTE"
            val bubbleColor = when {
                urgent -> C_ALERT_BG
                mine -> C_BLUE_DARK
                else -> C_PANEL_ALT
            }
            val accentColor = when {
                urgent -> Color.WHITE
                mine -> C_BLUE
                else -> C_BLUE
            }
            val bubble = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = if (mine) Gravity.END else Gravity.START
                background = rounded(bubbleColor)
                setPadding(dp(8), dp(5), dp(8), dp(6))
                if (!mine) {
                    addView(TextView(this@WearMainActivity).apply {
                        text = message.autor
                        setTextColor(accentColor)
                        textSize = 6f
                        typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
                        includeFontPadding = false
                        maxWidth = dp(bubbleWidth)
                        maxLines = 1
                        ellipsize = TextUtils.TruncateAt.END
                        gravity = Gravity.START
                    })
                }
                addView(TextView(this@WearMainActivity).apply {
                    text = messageBody(message)
                    setTextColor(if (urgent) Color.parseColor("#FFD6D6") else C_TEXT)
                    textSize = 9f
                    typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL)
                    includeFontPadding = false
                    maxWidth = dp(bubbleWidth)
                    maxLines = 4
                    ellipsize = TextUtils.TruncateAt.END
                    gravity = if (mine) Gravity.END else Gravity.START
                    if (message.attachmentUrl != null) setOnClickListener { openAttachment(message) }
                })
                addView(TextView(this@WearMainActivity).apply {
                    text = messageTime(message)
                    setTextColor(if (urgent) Color.WHITE else C_MUTED)
                    textSize = 6f
                    typeface = Typeface.create(Typeface.MONOSPACE, Typeface.NORMAL)
                    includeFontPadding = false
                    maxLines = 1
                    gravity = if (mine) Gravity.START else Gravity.END
                })
            }
            val row = LinearLayout(this).apply {
                gravity = if (mine) Gravity.END else Gravity.START
                addView(bubble, LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ))
            }
            list.addView(row, blockParams(contentWidthDp(), top = 5))
        }
        homeScrollView?.post { homeScrollView?.fullScroll(View.FOCUS_DOWN) }
    }

    private fun messageBody(message: WearChatMessage): String =
        when (message.attachmentKind) {
            "AUDIO" -> "▶  Audio"
            "IMAGE" -> "Imagen adjunta"
            "VIDEO" -> "Video adjunto"
            else -> message.contenido.ifBlank { "--" }
        }

    private fun lastMessagePreview(channel: ChatChannel): String {
        val message = cachedChatMessages.lastOrNull { messageMatchesChannel(it, channel) }
            ?: return "Sin mensajes todavía"
        return when (message.attachmentKind?.uppercase(Locale.US)) {
            "AUDIO" -> "Mensaje de voz"
            "IMAGE" -> "Imagen"
            "VIDEO" -> "Video"
            "FILE" -> "Archivo adjunto"
            else -> message.contenido.trim().ifBlank { "Archivo adjunto" }
        }
    }

    private fun messageTime(message: WearChatMessage): String {
        val raw = message.fecha.trim()
        if (raw.isBlank()) return ""
        val localZone = ZoneId.systemDefault()
        val output = DateTimeFormatter.ofPattern("HH:mm", Locale.getDefault())

        return runCatching {
            OffsetDateTime.parse(raw, DateTimeFormatter.ISO_DATE_TIME)
                .atZoneSameInstant(localZone)
                .format(output)
        }.recoverCatching {
            Instant.parse(raw)
                .atZone(localZone)
                .format(output)
        }.recoverCatching {
            val normalized = raw.replace(' ', 'T').substringBeforeLast(".")
            LocalDateTime.parse(normalized, DateTimeFormatter.ISO_LOCAL_DATE_TIME)
                .atZone(ZoneId.of("UTC"))
                .withZoneSameInstant(localZone)
                .format(output)
        }.getOrElse {
            Regex("(\\d{2}):(\\d{2})").find(raw)?.value.orEmpty()
        }
    }

    private fun List<WearChatMessage>.filterForSelectedChat(): List<WearChatMessage> =
        filter { message -> messageMatchesChannel(message, selectedChatChannel) }

    private fun channelForMessage(message: WearChatMessage): ChatChannel =
        ChatChannel.entries.firstOrNull { messageMatchesChannel(message, it) } ?: ChatChannel.TODOS

    private fun messageMatchesChannel(message: WearChatMessage, channel: ChatChannel): Boolean {
        val rol = message.destinatarioRol.uppercase(Locale.US)
        val tipo = message.destinoTipo?.uppercase(Locale.US).orEmpty()
        return when (channel) {
            ChatChannel.TODOS -> tipo in setOf("", "GLOBAL", "TODOS") && rol == "GLOBAL"
            ChatChannel.CETS -> tipo == "CETS" || tipo == "CET" || (tipo.isBlank() && rol == "CET")
            ChatChannel.CELULAS -> tipo in setOf("CELL", "CELL_LIST", "FLOTILLA", "GRUPO", "VEHICULO") ||
                (tipo.isBlank() && rol == "CELL,CET")
            ChatChannel.CET_ASIGNADO -> {
                val cetId = assignedCet?.id ?: return false
                val userId = WearSession.user(this)?.id?.toString().orEmpty()
                (tipo == "CET" && message.destinoId == cetId) ||
                    (tipo == "CELL" && message.destinoId == userId && message.authorId?.toString() == cetId)
            }
        }
    }

    private fun renderResourceRows(summary: WearApiClient.ResourceSummary?, placeholder: String = "sin datos") {
        val list = resourceList ?: return
        list.removeAllViews()
        if (summary == null) {
            list.addView(sectionBlock("RECURSOS", placeholder, ""))
            return
        }
        if (summary.personal.isEmpty() && summary.vehiculos.isEmpty() && summary.equipos.isEmpty()) {
            list.addView(sectionBlock("RECURSOS", "sin asignaciones", ""))
            return
        }
        addResourceGroup(list, "PERSONAL", summary.personal)
        addResourceGroup(list, "VEHICULOS", summary.vehiculos)
        addResourceGroup(list, "EQUIPOS", summary.equipos)
    }

    private fun addResourceGroup(list: LinearLayout, label: String, items: List<String>) {
        val shown = items.take(2).joinToString("\n").ifBlank { "--" }
        val suffix = if (items.size > 2) "+${items.size - 2}" else ""
        list.addView(sectionBlock(label, shown, suffix))
    }

    private fun messageLabel(message: WearChatMessage): String {
        val body = when (message.attachmentKind) {
            "AUDIO" -> "AUDIO ${message.attachmentName ?: ""}".trim()
            "IMAGE" -> "IMAGEN ${message.attachmentName ?: ""}".trim()
            "VIDEO" -> "VIDEO ${message.attachmentName ?: ""}".trim()
            else -> message.contenido.ifBlank { "--" }
        }
        val destination = message.destinoLabel?.takeIf { it.isNotBlank() }
        val header = if (destination != null) "${message.autor} > $destination" else message.autor
        return "$header\n$body"
    }

    private fun openAttachment(message: WearChatMessage) {
        val url = message.attachmentUrl ?: return
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(WearApiConfig.absoluteUrl(url)))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { startActivity(intent) }
            .onFailure { toast("No se pudo abrir") }
    }

    private fun chatDestinationRole(): String = selectedChatChannel.destinatarioRol

    private fun chatDestinationType(): String? = selectedChatChannel.destinoTipo

    private fun chatDestinationId(): String? =
        if (selectedChatChannel == ChatChannel.CET_ASIGNADO) assignedCet?.id
        else selectedChatChannel.destinoId

    private fun chatDestinationLabel(): String? =
        if (selectedChatChannel == ChatChannel.CET_ASIGNADO) assignedCet?.label
        else selectedChatChannel.destinoLabel

    private fun sendQuickMessage(text: String, urgent: Boolean = false) {
        val operation = WearSession.operation(this)
        val token = WearSession.token(this)
        if (operation == null || token.isBlank()) {
            toast("Sin operacion")
            return
        }
        api.sendMessage(
            operationId = operation.id,
            token = token,
            contenido = text,
            tipoMensaje = if (urgent) "URGENTE" else "NORMAL",
            destinatarioRol = chatDestinationRole(),
            destinoTipo = chatDestinationType(),
            destinoId = chatDestinationId(),
            destinoLabel = chatDestinationLabel(),
            onSuccess = { runOnUiThread { refreshChat(showLoading = false) } },
            onError = { error -> runOnUiThread { setStatus(error) } }
        )
    }

    private fun sendEmergency(source: String) {
        val user = WearSession.user(this)
        val operation = WearSession.operation(this)
        val token = WearSession.token(this)
        if (user == null || operation == null || token.isBlank()) {
            toast("Sin sesion u operacion")
            return
        }
        vibrateEmergency()
        phoneBridge.mirrorEmergency(operation.id, source)
        setStatus("enviando SOS")
        api.sendMessage(
            operationId = operation.id,
            token = token,
            contenido = emergencyContent(user, source),
            tipoMensaje = "URGENTE",
            onSuccess = { runOnUiThread { setStatus("SOS enviado"); refreshChat() } },
            onError = { error -> runOnUiThread { setStatus(error) } }
        )
    }

    /** Sends a clearly labelled global test without altering the real vital-sign detector. */
    private fun sendLifeLineTest() {
        val user = WearSession.user(this)
        val operation = WearSession.operation(this)
        val token = WearSession.token(this)
        if (user == null || operation == null || token.isBlank()) {
            toast("Sin sesion u operacion")
            return
        }

        setStatus("enviando prueba")
        api.sendMessage(
            operationId = operation.id,
            token = token,
            contenido = lifeLineTestContent(user),
            tipoMensaje = "URGENTE",
            destinatarioRol = "GLOBAL",
            onSuccess = {
                runOnUiThread {
                    setStatus("prueba enviada a todos")
                    toast("Prueba de linea de vida enviada")
                }
            },
            onError = { error -> runOnUiThread { setStatus(error) } }
        )
    }

    private fun emergencyContent(user: WearUser, source: String): String {
        val timestamp = SimpleDateFormat("HH:mm:ss dd/MM/yyyy", Locale.getDefault()).format(Date())
        val location = if (lastLat != null && lastLon != null) {
            "%.6f, %.6f".format(lastLat, lastLon)
        } else {
            "ubicacion no disponible"
        }
        val heart = lastHeartRate?.let { "%.0f bpm".format(it) } ?: "no disponible"
        return "EMERGENCIA RELOJ:\n" +
            "USUARIO: ${user.nombreCompleto}\n" +
            "ORIGEN: $source\n" +
            "PULSO: $heart\n" +
            "UBICACION: $location\n" +
            "HORA: $timestamp"
    }

    private fun lifeLineTestContent(user: WearUser): String {
        val timestamp = SimpleDateFormat("HH:mm:ss dd/MM/yyyy", Locale.getDefault()).format(Date())
        val location = if (lastLat != null && lastLon != null) {
            "%.6f, %.6f".format(lastLat, lastLon)
        } else {
            "ubicacion no disponible"
        }
        val heart = lastHeartRate?.let { "%.0f bpm".format(it) } ?: "no disponible"
        return "PRUEBA - ALERTA LINEA DE VIDA:\n" +
            "ESTE MENSAJE ES UNA PRUEBA; NO ES UNA EMERGENCIA REAL.\n" +
            "USUARIO: ${user.nombreCompleto}\n" +
            "SIGNOS VITALES:\n" +
            "FRECUENCIA CARDIACA: $heart\n" +
            "OXIGENO EN SANGRE: no disponible\n" +
            "FRECUENCIA RESPIRATORIA: no disponible\n" +
            "TEMPERATURA CORPORAL: no disponible\n" +
            "PRESION ARTERIAL: no disponible\n" +
            "UBICACION: $location\n" +
            "HORA: $timestamp"
    }

    private fun toggleVoiceRecording() {
        if (voiceRecorder != null) {
            stopVoiceRecording(send = true)
            return
        }
        if (!hasPermission(Manifest.permission.RECORD_AUDIO)) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQUEST_AUDIO_PERMISSION)
            return
        }
        startVoiceRecording()
    }

    @Suppress("DEPRECATION")
    private fun startVoiceRecording() {
        val file = createAudioFile()
        voiceOutputFile = file
        voiceStartedAt = System.currentTimeMillis()
        try {
            voiceRecorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                MediaRecorder(this)
            } else {
                MediaRecorder()
            }.apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setOutputFile(file.absolutePath)
                prepare()
                start()
            }
            voiceButton?.text = "ENVIAR"
            setStatus("grabando")
        } catch (e: Exception) {
            voiceRecorder?.release()
            voiceRecorder = null
            voiceOutputFile = null
            setStatus("microfono no disponible")
        }
    }

    private fun stopVoiceRecording(send: Boolean) {
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
            voiceButton?.text = "GRABAR AUDIO"
        }
        if (!send || file == null || !file.exists() || file.length() == 0L) {
            file?.delete()
            return
        }
        val operation = WearSession.operation(this)
        val token = WearSession.token(this)
        if (operation == null || token.isBlank()) {
            file.delete()
            toast("Sin operacion")
            return
        }
        setStatus("enviando audio")
        api.sendAttachment(
            operationId = operation.id,
            token = token,
            file = file,
            fileName = file.name,
            mimeType = "audio/mp4",
            attachmentKind = "AUDIO",
            durationMs = duration,
            destinatarioRol = chatDestinationRole(),
            destinoTipo = chatDestinationType(),
            destinoId = chatDestinationId(),
            destinoLabel = chatDestinationLabel(),
            onSuccess = {
                file.delete()
                runOnUiThread {
                    setStatus("")
                    refreshChat(showLoading = false)
                }
            },
            onError = { error ->
                file.delete()
                runOnUiThread { setStatus(error) }
            }
        )
    }

    private fun createAudioFile(): File {
        val dir = File(cacheDir, "wear_audio").apply { mkdirs() }
        return File.createTempFile("wear_voice_", ".m4a", dir)
    }

    private fun startHeartRateIfPossible() {
        val permission = if (Build.VERSION.SDK_INT >= 36) {
            HeartRateMonitor.READ_HEART_RATE_PERMISSION
        } else {
            Manifest.permission.BODY_SENSORS
        }
        if (!hasPermission(permission)) return
        if (heartRateMonitor == null) {
            heartRateMonitor = HeartRateMonitor(
                context = this,
                onHeartRate = { bpm ->
                    lastHeartRate = bpm
                    runOnUiThread {
                        heartRateValue?.text = "%.0f".format(bpm)
                    }
                    maybeSendVitals()
                },
                onStatus = { state ->
                    runOnUiThread {
                        if (activePanel == Panel.VITALES) setStatus(state.lowercase())
                    }
                }
            )
        }
        heartRateMonitor?.start()
    }

    private fun startMotionSensors() {
        if (sensorManager == null) {
            sensorManager = getSystemService(Context.SENSOR_SERVICE) as SensorManager
        }
        stepSensor = sensorManager?.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
        pressureSensor = sensorManager?.getDefaultSensor(Sensor.TYPE_PRESSURE)
        stepSensor?.let { sensorManager?.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL) }
        pressureSensor?.let { sensorManager?.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL) }
    }

    private fun stopMotionSensors() {
        sensorManager?.unregisterListener(this)
    }

    override fun onSensorChanged(event: SensorEvent?) {
        when (event?.sensor?.type) {
            Sensor.TYPE_STEP_COUNTER -> {
                val total = event.values.firstOrNull() ?: return
                val base = initialSteps ?: total.also { initialSteps = it }
                todaySteps = (total - base).coerceAtLeast(0f).toLong()
                stepsValue?.text = todaySteps?.toString() ?: "--"
                maybeSendVitals()
            }
            Sensor.TYPE_PRESSURE -> {
                lastPressure = event.values.firstOrNull()
                baroValue?.text = lastPressure?.let { "%.0f hPa".format(it) } ?: "--"
                maybeSendVitals()
            }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    @SuppressLint("MissingPermission")
    private fun startLocationUpdates() {
        if (!hasPermission(Manifest.permission.ACCESS_FINE_LOCATION) &&
            !hasPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
        ) return
        stopLocationUpdates()
        locationManager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        locationListener = LocationListener { location -> onLocation(location) }
        listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).forEach { provider ->
            runCatching {
                locationManager?.requestLocationUpdates(provider, 15_000L, 10f, locationListener!!)
                locationManager?.getLastKnownLocation(provider)?.let { onLocation(it) }
            }
        }
    }

    private fun stopLocationUpdates() {
        locationListener?.let { listener -> runCatching { locationManager?.removeUpdates(listener) } }
        locationListener = null
    }

    private fun onLocation(location: Location) {
        lastLat = location.latitude
        lastLon = location.longitude
        activeOperationMap?.updateUserLocation(location.latitude, location.longitude)
        gpsValue?.text = locationText()
        gpsValue?.setTextColor(C_BLUE)
        maybeSendVitals()
    }

    private fun maybeSendVitals(force: Boolean = false) {
        val now = System.currentTimeMillis()
        if (!force && now - lastVitalUploadAt < MIN_VITAL_UPLOAD_MS) return

        val user = WearSession.user(this) ?: return
        val operation = WearSession.operation(this) ?: return
        val token = WearSession.token(this)
        if (token.isBlank() || user.tabla != "personal" || operation.status != WearOperationStatus.ACTIVA) return
        if (lastHeartRate == null && todaySteps == null && lastPressure == null && currentBatteryPct() == null) return

        lastVitalUploadAt = now
        val sentBySocket = wearSocketManager?.emitVitalSigns(
            heartRateBpm = lastHeartRate,
            steps = todaySteps,
            pressureHpa = lastPressure,
            batteryPct = currentBatteryPct(),
            lat = lastLat,
            lon = lastLon
        ) == true
        if (!sentBySocket) {
            api.sendVitalSigns(
                operationId = operation.id,
                token = token,
                idPersonal = user.id,
                heartRateBpm = lastHeartRate,
                steps = todaySteps,
                pressureHpa = lastPressure,
                batteryPct = currentBatteryPct(),
                latitude = lastLat,
                longitude = lastLon
            )
        }
    }

    private fun currentBatteryPct(): Double? {
        val battery = getSystemService(BATTERY_SERVICE) as? BatteryManager ?: return null
        val pct = battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        return pct.takeIf { it in 0..100 }?.toDouble()
    }

    private fun startEmergencyMonitorIfPossible() {
        if (!WearSession.isLoggedIn(this)) return
        val intent = Intent(this, WearEmergencyService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent) else startService(intent)
    }

    private fun logout() {
        setStatus("cerrando sesion")
        stopWearRuntime()
        stopService(Intent(this, WearEmergencyService::class.java))
        WearSession.clear(this)
        activePanel = Panel.OPERACION
        resourceSummary = null
        renderLogin()
    }

    private fun startWearRuntime() {
        WearIncomingCallActivity.actionHandler = { callId, action ->
            val current = incomingVoiceCall
            if (current?.optString("call_id") == callId) {
                val event = when (action) {
                    "accept" -> "voice_call_accept"
                    "end" -> "voice_call_end"
                    else -> "voice_call_reject"
                }
                wearSocketManager?.emitVoiceCall(event, JSONObject().apply {
                    put("call_id", callId)
                    put("to_personal_id", current.optInt("from_personal_id"))
                })
                if (action != "accept") incomingVoiceCall = null
            }
        }
        startWearSocketIfPossible()
        startLocationUpdates()
        startMotionSensors()
        startHeartRateIfPossible()
        startEmergencyMonitorIfPossible()
    }

    private fun stopWearRuntime() {
        WearIncomingCallActivity.actionHandler = null
        wearSocketManager?.disconnect()
        wearSocketManager = null
        heartRateMonitor?.stop()
        stopLocationUpdates()
        stopMotionSensors()
        stopVoiceRecording(send = false)
    }

    private fun startWearSocketIfPossible() {
        val user = WearSession.user(this) ?: return
        val operation = WearSession.operation(this) ?: return
        val token = WearSession.token(this)
        if (token.isBlank() || user.tabla != "personal" || operation.status != WearOperationStatus.ACTIVA) return

        if (wearSocketManager?.matches(WearApiConfig.baseUrl, operation.id, user.id) == true) {
            wearSocketManager?.connect()
            return
        }

        wearSocketManager?.disconnect()
        wearSocketManager = WearSocketManager(
            baseUrl = WearApiConfig.baseUrl,
            operationId = operation.id,
            idPersonal = user.id,
            rol = user.rol.name,
            onConnected = { runOnUiThread { setStatus("socket reloj conectado") } },
            onDisconnected = { runOnUiThread { setStatus("socket reloj desconectado") } },
            onConnectionError = { runOnUiThread { setStatus("socket reloj error") } },
            onChatMessage = { data -> runOnUiThread {
                val message = WearChatMessage.fromJson(data)
                if (message.id <= 0 || cachedChatMessages.none { it.id == message.id }) {
                    cachedChatMessages.add(message)
                }
                val currentUser = WearSession.user(this)
                val mine = message.autor.equals(currentUser?.nombreCompleto, ignoreCase = true) ||
                    message.autor.equals(currentUser?.username, ignoreCase = true)
                if (!mine && !isOperationalAlert(message)) {
                    showChatNotification(message)
                    val messageChannel = channelForMessage(message)
                    if (activePanel != Panel.MENSAJES || !chatConversationOpen ||
                        selectedChatChannel != messageChannel
                    ) {
                        unreadMessagesByChannel[messageChannel] =
                            unreadMessagesByChannel.getValue(messageChannel) + 1
                        unreadMessageCount = unreadMessagesByChannel.values.sum()
                        saveUnreadMessages()
                        updateMessagesBadge()
                        if (activePanel == Panel.MENSAJES && !chatConversationOpen) renderActivePanel()
                    }
                }
                if (activePanel == Panel.MENSAJES && chatConversationOpen) {
                    refreshChat(showLoading = false)
                } else if (activePanel == Panel.MENSAJES) {
                    renderActivePanel()
                }
            } },
            onMapEvent = { event, data -> runOnUiThread {
                val webMap = mapWebView
                if (webMap != null) {
                    if (event.startsWith("tracking_")) {
                        webMap.evaluateJavascript(realtimeCesiumMapScript(event, data), null)
                    } else {
                        fetchCesiumOperation(webMap)
                    }
                } else {
                    val map = activeOperationMap ?: return@runOnUiThread
                    if (event.startsWith("tracking_")) {
                        map.applyRealtimeTracking(event, data)
                    } else {
                        if (event == "personal_desconectado") {
                            map.removeRealtimePersonal(data.optInt("id_personal", -1))
                        }
                        if (event == "dibujo_eliminado") {
                            map.removeDrawing(data.optInt("id_dibujo", -1))
                        }
                        refreshActiveOperationMap(map)
                    }
                }
            } },
            onVoiceCallEvent = { event, data -> runOnUiThread {
                when (event) {
                    "voice_call_invite" -> {
                        incomingVoiceCall = data
                        WearPhoneListenerService.showVoiceCall(
                            this,
                            JSONObject(data.toString()).put("event", event)
                        )
                    }
                    "voice_call_end", "voice_call_reject" -> {
                        incomingVoiceCall = null
                        WearPhoneListenerService.showVoiceCall(
                            this,
                            JSONObject(data.toString()).put("event", event)
                        )
                    }
                }
            } }
        ).also { it.connect() }
    }

    private fun realtimeCesiumMapScript(event: String, data: JSONObject): String {
        val payload = data.toString()
        return when (event) {
            "tracking_personal" ->
                "if(typeof updateTrackingPersonal==='function'){const d=$payload;updateTrackingPersonal(Number(d.id_personal),Number(d.latitud),Number(d.longitud),d.apodo||d.nombre||('P-'+d.id_personal),d);}"
            "tracking_vehiculo" ->
                "if(typeof updateTrackingVehiculo==='function'){const d=$payload;updateTrackingVehiculo(Number(d.id_vehiculo),Number(d.latitud),Number(d.longitud),d.alias||d.nombre||('V-'+d.id_vehiculo),d);}"
            "tracking_equipo" ->
                "if(typeof updateTrackingEquipo==='function'){const d=$payload;updateTrackingEquipo(Number(d.id_equipo),Number(d.latitud),Number(d.longitud),d.nombre||('E-'+d.id_equipo),d);}"
            "tracking_dispositivo" ->
                "if(typeof updateTrackingDispositivo==='function'){const d=$payload;updateTrackingDispositivo(Number(d.id_dispositivo),Number(d.latitud),Number(d.longitud),d.nombre||d.numero_serie||('D-'+d.id_dispositivo),d);}"
            else -> ""
        }
    }

    private fun refreshActiveOperationMap(map: OperationMapView) {
        val operation = WearSession.operation(this) ?: return
        val token = WearSession.token(this)
        if (token.isBlank()) return
        api.getOperationMap(operation.id, token,
            onSuccess = { data -> runOnUiThread { if (activeOperationMap === map) map.setOperationData(data) } },
            onError = { }
        )
        // Drawings live in a separate endpoint from the regular map layers.
        // Reload it on every map socket event so browser-created/deleted strokes
        // are reflected immediately on the watch as well.
        api.getOperationDrawings(operation.id, token,
            onSuccess = { items -> runOnUiThread {
                if (activeOperationMap === map) map.setDrawings(items)
            } },
            onError = { }
        )
    }

    private fun requestRuntimePermissions() {
        val permissions = buildList {
            add(Manifest.permission.ACCESS_FINE_LOCATION)
            add(Manifest.permission.ACCESS_COARSE_LOCATION)
            add(Manifest.permission.RECORD_AUDIO)
            if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
            if (Build.VERSION.SDK_INT >= 36) addAll(EXTRA_HEALTH_PERMISSIONS) else add(Manifest.permission.BODY_SENSORS)
        }.filterNot { hasPermission(it) }.toTypedArray()
        if (permissions.isNotEmpty()) requestPermissions(permissions, REQUEST_RUNTIME_PERMISSIONS)
    }

    private fun hasPermission(permission: String): Boolean =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    private fun createChatNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannels(
            listOf(
                NotificationChannel(
                    CHAT_NOTIFICATION_CHANNEL,
                    "Mensajes SEDAM",
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = "Mensajes nuevos de la operación"
                    enableVibration(true)
                    vibrationPattern = longArrayOf(0L, 120L, 80L, 120L)
                },
                NotificationChannel(
                    URGENT_NOTIFICATION_CHANNEL,
                    "Emergencias SEDAM",
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = "Mensajes urgentes de la operación"
                    enableVibration(true)
                    vibrationPattern = longArrayOf(0L, 220L, 100L, 220L, 100L, 350L)
                }
            )
        )
    }

    private fun showChatNotification(message: WearChatMessage) {
        if (isOperationalAlert(message)) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            !hasPermission(Manifest.permission.POST_NOTIFICATIONS)
        ) return

        val urgent = message.tipo == "URGENTE"
        val channel = if (urgent) URGENT_NOTIFICATION_CHANNEL else CHAT_NOTIFICATION_CHANNEL
        val preview = messageBody(message).take(120)
        val openApp = PendingIntent.getActivity(
            this,
            0,
            Intent(this, WearMainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, channel)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        val notification = builder
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(if (urgent) "EMERGENCIA · ${message.autor}" else message.autor)
            .setContentText(preview)
            .setStyle(Notification.BigTextStyle().bigText(preview))
            .setContentIntent(openApp)
            .setAutoCancel(true)
            .setCategory(if (urgent) Notification.CATEGORY_ALARM else Notification.CATEGORY_MESSAGE)
            .setPriority(if (urgent) Notification.PRIORITY_MAX else Notification.PRIORITY_HIGH)
            .setColor(if (urgent) C_RED else C_GREEN)
            .build()
        val notificationId = if (message.id > 0) {
            CHAT_NOTIFICATION_ID_BASE + message.id
        } else {
            CHAT_NOTIFICATION_ID_BASE + (System.currentTimeMillis() % 10_000).toInt()
        }
        getSystemService(NotificationManager::class.java).notify(notificationId, notification)
    }

    private fun isOperationalAlert(message: WearChatMessage): Boolean =
        message.tipo.equals("URGENTE", ignoreCase = true) ||
            message.tipo.equals("ALERTA", ignoreCase = true) ||
            message.tipo.equals("ALERT", ignoreCase = true)

    private fun setStatus(message: String) {
        statusText?.text = message.take(34)
    }

    private fun operationTitle(operation: WearOperation?): String {
        if (operation == null) return "--"
        return operation.codigo.ifBlank { operation.id.toString() }
    }

    private fun locationText(): String =
        if (lastLat != null && lastLon != null) {
            "LAT %.5f\nLON %.5f".format(Locale.US, lastLat, lastLon)
        } else {
            "Buscando ubicacion..."
        }

    private fun vibrateEmergency() {
        val vibrator = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 250, 120, 250, 120, 450), -1))
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(longArrayOf(0, 250, 120, 250, 120, 450), -1)
        }
    }

    private fun setCenteredContent(content: LinearLayout) {
        setContentView(
            FrameLayout(this).apply {
                setBackgroundColor(C_BG)
                addView(
                    ScrollView(context).apply {
                        isFillViewport = true
                        addView(content)
                    },
                    FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.MATCH_PARENT
                    )
                )
            }
        )
    }

    private fun setHomeContent(content: LinearLayout, bottomNav: LinearLayout?) {
        setContentView(
            FrameLayout(this).apply {
                setBackgroundColor(C_BG)
                homeScrollView = ScrollView(context).apply {
                        isFillViewport = false
                        clipToPadding = false
                        setPadding(0, 0, 0, dp(8))
                        addView(content)
                    }
                addView(
                    homeScrollView,
                    FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.MATCH_PARENT
                    )
                )
                bottomNav?.let {
                    addView(
                        it,
                        FrameLayout.LayoutParams(
                            dp(contentWidthDp()),
                            dp(48),
                            Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
                        ).apply { bottomMargin = dp(5) }
                    )
                }
            }
        )
    }

    private fun compactColumn(): LinearLayout =
        LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(0, dp(if (isRoundScreen()) 12 else 8), 0, dp(8))
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER
            )
        }

    private fun homeColumn(): LinearLayout =
        LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(0, dp(if (isRoundScreen()) 14 else 10), 0, dp(12))
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP or Gravity.CENTER_HORIZONTAL
            )
        }

    private fun brandHeader(subtitle: String): LinearLayout =
        LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            addView(TextView(context).apply {
                text = "SEDAM"
                setTextColor(C_GOLD)
                textSize = 12f
                typeface = Typeface.MONOSPACE
                letterSpacing = 0.2f
                gravity = Gravity.CENTER
                includeFontPadding = false
            })
            addView(mutedText(subtitle, 7f).apply { letterSpacing = 0.12f })
        }

    private fun topBar(): LinearLayout =
        LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            topTitleText = TextView(context).apply {
                text = if (homeMenuOpen) "SEDAM" else currentTopTitle()
                setTextColor(C_GOLD)
                textSize = 10f
                typeface = Typeface.MONOSPACE
                letterSpacing = 0.24f
                includeFontPadding = false
                gravity = Gravity.CENTER
            }
            addView(topTitleText)
            topSubtitleText = null
        }

    private fun currentTopTitle(): String =
        if (activePanel == Panel.MENSAJES && chatConversationOpen) {
            chatChannelTitle(selectedChatChannel).uppercase(Locale.US)
        } else {
            activePanel.title
        }

    private fun bottomNav(): LinearLayout =
        LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(dp(4), dp(5), dp(4), dp(5))
            background = rounded(C_INPUT)
            Panel.entries.forEach { panel ->
                addView(navButton(panel), LinearLayout.LayoutParams(0, dp(38), 1f).apply {
                    leftMargin = dp(1)
                    rightMargin = dp(1)
                })
            }
        }

    private fun mainMenu(): LinearLayout =
        LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(8), dp(7), dp(8), dp(6))
            val panels = Panel.entries
            for (rowIndex in 0..1) {
                addView(LinearLayout(context).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER
                    for (columnIndex in 0..1) {
                        val panel = panels[rowIndex * 2 + columnIndex]
                        addView(menuButton(panel), LinearLayout.LayoutParams(dp(64), dp(64)).apply {
                            leftMargin = dp(5)
                            rightMargin = dp(5)
                            topMargin = dp(3)
                            bottomMargin = dp(3)
                        })
                    }
                })
            }
            addView(sosMenuButton(), LinearLayout.LayoutParams(dp(64), dp(64)).apply {
                topMargin = dp(3)
                bottomMargin = dp(3)
            })
        }

    private fun sosMenuButton(): FrameLayout =
        FrameLayout(this).apply {
            background = glassButtonBackground(Color.parseColor("#D32F2F"))
            elevation = dp(2).toFloat()
            addView(TextView(context).apply {
                text = "SOS"
                setTextColor(Color.WHITE)
                textSize = 13f
                typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
                gravity = Gravity.CENTER
                includeFontPadding = false
            }, FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            ))
            isClickable = true
            isFocusable = true
            setOnClickListener { sendEmergency("BOTON_SOS_MENU") }
        }

    private fun menuButton(panel: Panel): FrameLayout =
        FrameLayout(this).apply {
            val color = when (panel) {
                Panel.OPERACION -> Color.parseColor("#2D8A72")
                Panel.MENSAJES -> Color.parseColor("#267C91")
                Panel.MAPA -> Color.parseColor("#356FA8")
                Panel.VITALES -> Color.parseColor("#8A5576")
            }
            addView(LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                background = glassButtonBackground(color)
                elevation = dp(2).toFloat()
                addView(MenuIconView(context, panel), LinearLayout.LayoutParams(dp(44), dp(44)))
            }, FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            ))
            if (panel == Panel.MENSAJES) {
                messagesBadge = TextView(context).apply {
                    setTextColor(Color.parseColor("#07333A"))
                    textSize = 9f
                    typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
                    gravity = Gravity.CENTER
                    includeFontPadding = false
                    minWidth = 0
                    minHeight = 0
                    setPadding(0, 0, 0, 0)
                    elevation = dp(3).toFloat()
                    background = GradientDrawable().apply {
                        shape = GradientDrawable.OVAL
                        setColor(Color.parseColor("#a08cd6"))
                    }
                }
                addView(messagesBadge, FrameLayout.LayoutParams(dp(22), dp(22), Gravity.END or Gravity.TOP).apply {
                    topMargin = dp(1)
                    rightMargin = dp(1)
                })
                updateMessagesBadge()
            }
            isClickable = true
            isFocusable = true
            setOnClickListener {
                activePanel = panel
                homeMenuOpen = false
                chatConversationOpen = false
                renderHome()
            }
        }

    private fun glassButtonBackground(baseColor: Int): GradientDrawable {
        fun mixWithWhite(color: Int, amount: Float, alpha: Int): Int {
            val inverse = 1f - amount
            return Color.argb(
                alpha,
                (Color.red(color) * inverse + 255f * amount).toInt(),
                (Color.green(color) * inverse + 255f * amount).toInt(),
                (Color.blue(color) * inverse + 255f * amount).toInt()
            )
        }

        fun darken(color: Int, amount: Float, alpha: Int): Int {
            val factor = 1f - amount
            return Color.argb(
                alpha,
                (Color.red(color) * factor).toInt(),
                (Color.green(color) * factor).toInt(),
                (Color.blue(color) * factor).toInt()
            )
        }

        return GradientDrawable(
            GradientDrawable.Orientation.TL_BR,
            intArrayOf(
                mixWithWhite(baseColor, 0.12f, 242),
                Color.argb(232, Color.red(baseColor), Color.green(baseColor), Color.blue(baseColor)),
                darken(baseColor, 0.12f, 242)
            )
        ).apply {
            shape = GradientDrawable.OVAL
            gradientType = GradientDrawable.LINEAR_GRADIENT
        }
    }

    private fun updateMessagesBadge() {
        messagesBadge?.apply {
            text = if (unreadMessageCount > 9) "9+" else unreadMessageCount.toString()
            visibility = if (unreadMessageCount > 0) View.VISIBLE else View.GONE
        }
    }

    private fun clearUnreadChannel(channel: ChatChannel) {
        unreadMessagesByChannel[channel] = 0
        unreadMessageCount = unreadMessagesByChannel.values.sum()
        saveUnreadMessages()
        updateMessagesBadge()
    }

    private fun loadUnreadMessages() {
        val preferences = getSharedPreferences(UNREAD_MESSAGES_PREFS, Context.MODE_PRIVATE)
        ChatChannel.entries.forEach { channel ->
            unreadMessagesByChannel[channel] =
                preferences.getInt(channel.name, 0).coerceAtLeast(0)
        }
        unreadMessageCount = unreadMessagesByChannel.values.sum()
    }

    private fun saveUnreadMessages() {
        getSharedPreferences(UNREAD_MESSAGES_PREFS, Context.MODE_PRIVATE)
            .edit()
            .apply {
                unreadMessagesByChannel.forEach { (channel, count) ->
                    putInt(channel.name, count)
                }
            }
            .apply()
    }

    private fun unreadBadge(count: Int): TextView =
        TextView(this).apply {
            text = if (count > 9) "9+" else count.toString()
            setTextColor(Color.WHITE)
            textSize = 6.5f
            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
            gravity = Gravity.CENTER
            includeFontPadding = false
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(C_RED)
            }
        }

    private class MenuIconView(context: Context, private val panel: Panel) : View(context) {
        private val iconPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.parseColor("#F1F5F2")
            style = Paint.Style.STROKE
            strokeWidth = 2.4f
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }

        override fun onDraw(canvas: Canvas) {
            val cx = width / 2f
            val cy = height / 2f
            canvas.save()
            canvas.scale(1.25f, 1.25f, cx, cy)
            when (panel) {
                Panel.OPERACION -> {
                    val clipboard = RectF(cx - 9f, cy - 12f, cx + 9f, cy + 13f)
                    canvas.drawRoundRect(clipboard, 2.5f, 2.5f, iconPaint)
                    canvas.drawRoundRect(
                        RectF(cx - 4.5f, cy - 14f, cx + 4.5f, cy - 9f),
                        2f,
                        2f,
                        iconPaint
                    )
                    canvas.drawLine(cx - 4.5f, cy - 4f, cx + 4.5f, cy - 4f, iconPaint)
                    canvas.drawLine(cx - 4.5f, cy + 1.5f, cx + 4.5f, cy + 1.5f, iconPaint)
                    canvas.drawLine(cx - 4.5f, cy + 7f, cx + 2f, cy + 7f, iconPaint)
                }
                Panel.MENSAJES -> {
                    val bubble = RectF(cx - 13f, cy - 10f, cx + 13f, cy + 8f)
                    canvas.drawRoundRect(bubble, 4f, 4f, iconPaint)
                    val tail = Path().apply {
                        moveTo(cx - 6f, cy + 8f)
                        lineTo(cx - 10f, cy + 14f)
                        lineTo(cx, cy + 8f)
                    }
                    canvas.drawPath(tail, iconPaint)
                    canvas.drawLine(cx - 7f, cy - 4f, cx + 7f, cy - 4f, iconPaint)
                    canvas.drawLine(cx - 7f, cy + 1f, cx + 3f, cy + 1f, iconPaint)
                }
                Panel.MAPA -> {
                    val path = Path().apply {
                        moveTo(cx - 14f, cy - 10f)
                        lineTo(cx - 5f, cy - 14f)
                        lineTo(cx + 5f, cy - 10f)
                        lineTo(cx + 14f, cy - 14f)
                        lineTo(cx + 14f, cy + 10f)
                        lineTo(cx + 5f, cy + 14f)
                        lineTo(cx - 5f, cy + 10f)
                        lineTo(cx - 14f, cy + 14f)
                        close()
                    }
                    canvas.drawPath(path, iconPaint)
                    canvas.drawLine(cx - 5f, cy - 14f, cx - 5f, cy + 10f, iconPaint)
                    canvas.drawLine(cx + 5f, cy - 10f, cx + 5f, cy + 14f, iconPaint)
                }
                Panel.VITALES -> {
                    val pulse = Path().apply {
                        moveTo(cx - 15f, cy)
                        lineTo(cx - 8f, cy)
                        lineTo(cx - 4f, cy - 9f)
                        lineTo(cx + 1f, cy + 10f)
                        lineTo(cx + 6f, cy - 4f)
                        lineTo(cx + 9f, cy)
                        lineTo(cx + 15f, cy)
                    }
                    canvas.drawPath(pulse, iconPaint)
                }
            }
            canvas.restore()
        }
    }

    private class OperationMapView(
        context: Context,
        private val symbolRenderer: MilitarySymbolRenderer? = null,
        private val onExit: () -> Unit = {}
    ) : View(context) {
        var operationLat: Double? = null
        var operationLon: Double? = null
        var userLat: Double? = null
        var userLon: Double? = null
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        private val imageryTiles = mutableMapOf<Pair<Int, Int>, Bitmap>()
        private val labelTiles = mutableMapOf<Pair<Int, Int>, Bitmap>()
        private val buildingBitmap: Bitmap? by lazy {
            runCatching {
                context.assets.open("estructuras/casa.png").use(BitmapFactory::decodeStream)
            }.getOrNull()
        }
        private var operationData: JSONObject? = null
        private var zoom = 16f
        private var lastTouchX = 0f
        private var lastTouchY = 0f
        private var pinchDistance = 0f
        private var isPinching = false
        private var edgeSwipeStartX = 0f
        private var edgeSwipeStartY = 0f
        private var edgeSwipeActive = false
        private val realtimeMarkers = mutableMapOf<String, JSONObject>()
        private var drawings = JSONArray()
        private var routeOwnerType: String? = null
        private var routeOwnerId: Int? = null

        fun zoomIn() = adjustZoom(0.25f)
        fun zoomOut() = adjustZoom(-0.25f)
        fun adjustZoom(delta: Float) = changeZoom(zoom + delta)

        fun setRouteOwner(type: String, id: Int?) {
            routeOwnerType = type.uppercase(Locale.US)
            routeOwnerId = id?.takeIf { it > 0 }
        }

        fun updateUserLocation(lat: Double, lon: Double) {
            userLat = lat
            userLon = lon
            invalidate()
        }

        fun centerOnUser() {
            val lat = userLat ?: return
            val lon = userLon ?: return
            operationLat = lat
            operationLon = lon
            imageryTiles.clear()
            labelTiles.clear()
            loadTiles()
            invalidate()
        }

        fun applyRealtimeTracking(event: String, data: JSONObject) {
            val id = when (event) {
                "tracking_personal" -> data.optInt("id_personal")
                "tracking_vehiculo" -> data.optInt("id_vehiculo")
                "tracking_equipo" -> data.optInt("id_equipo")
                else -> data.optInt("id_dispositivo")
            }
            val collection = when (event) {
                "tracking_personal" -> "personal"
                "tracking_vehiculo" -> "vehiculos"
                "tracking_equipo" -> "equipos"
                else -> "dispositivos"
            }
            val idField = when (event) {
                "tracking_personal" -> "id_personal"
                "tracking_vehiculo" -> "id_vehiculo"
                "tracking_equipo" -> "id_equipo"
                else -> "id_dispositivo"
            }
            val assignedItems = operationData?.optJSONArray(collection)
            val assigned = (0 until (assignedItems?.length() ?: 0))
                .mapNotNull { assignedItems?.optJSONObject(it) }
                .firstOrNull { it.optInt(idField) == id }
            val marker = JSONObject(assigned?.toString() ?: "{}")
            data.keys().forEach { key -> marker.put(key, data.opt(key)) }
            realtimeMarkers["$event:$id"] = marker
            invalidate()
        }

        fun removeRealtimePersonal(idPersonal: Int) {
            if (idPersonal <= 0) return
            realtimeMarkers.remove("tracking_personal:$idPersonal")
            invalidate()
        }

        fun setOperationData(data: JSONObject) {
            operationData = data
            val personal = data.optJSONArray("personal") ?: JSONArray()
            val activePersonalIds = (0 until personal.length())
                .mapNotNull { index ->
                    personal.optJSONObject(index)
                        ?.optInt("id_personal", -1)?.takeIf { it > 0 }
                }.toSet()
            realtimeMarkers.keys
                .filter { key -> key.startsWith("tracking_personal:") && key.substringAfter(':').toIntOrNull() !in activePersonalIds }
                .toList()
                .forEach(realtimeMarkers::remove)
            data.optJSONObject("zona_operacion")?.let { zone ->
                operationLat = zone.optDouble("centroide_lat", operationLat ?: 0.0)
                operationLon = zone.optDouble("centroide_lon", operationLon ?: 0.0)
            }
            loadTiles()
            invalidate()
        }

        fun setDrawings(items: JSONArray) {
            drawings = items
            invalidate()
        }

        fun removeDrawing(idDrawing: Int) {
            if (idDrawing <= 0) return
            drawings = JSONArray().apply {
                for (index in 0 until this@OperationMapView.drawings.length()) {
                    val drawing = this@OperationMapView.drawings.optJSONObject(index) ?: continue
                    if (drawing.optInt("id_dibujo") != idDrawing) put(drawing)
                }
            }
            invalidate()
        }

        override fun onAttachedToWindow() {
            super.onAttachedToWindow()
            loadTiles()
        }

        private fun loadTiles() {
            val lat = operationLat ?: return
            val lon = operationLon ?: return
            val tileZoom = kotlin.math.floor(zoom).toInt()
            val centerX = lonToPixel(lon, tileZoom.toFloat()).toInt() / 256
            val centerY = latToPixel(lat, tileZoom.toFloat()).toInt() / 256
            Thread {
                for (x in centerX - 1..centerX + 1) for (y in centerY - 1..centerY + 1) {
                    if (!imageryTiles.containsKey(x to y)) runCatching {
                        URL("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/$tileZoom/$y/$x").openConnection().apply {
                            connectTimeout = 5000
                            readTimeout = 5000
                            setRequestProperty("User-Agent", "SEDAM-Wear/1.0")
                        }.getInputStream().use(BitmapFactory::decodeStream)
                    }.getOrNull()?.let { bitmap ->
                        if (tileZoom == kotlin.math.floor(zoom).toInt()) {
                            imageryTiles[x to y] = bitmap
                            postInvalidate()
                        }
                    }
                    if (!labelTiles.containsKey(x to y)) runCatching {
                        URL("https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/$tileZoom/$y/$x").openConnection().apply {
                            connectTimeout = 5000
                            readTimeout = 5000
                            setRequestProperty("User-Agent", "SEDAM-Wear/1.0")
                        }.getInputStream().use(BitmapFactory::decodeStream)
                    }.getOrNull()?.let { bitmap ->
                        if (tileZoom == kotlin.math.floor(zoom).toInt()) {
                            labelTiles[x to y] = bitmap
                            postInvalidate()
                        }
                    }
                }
            }.start()
        }

        override fun onTouchEvent(event: MotionEvent): Boolean {
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    lastTouchX = event.x
                    lastTouchY = event.y
                    edgeSwipeActive = false
                    isPinching = false
                    return true
                }
                MotionEvent.ACTION_POINTER_DOWN -> {
                    if (event.pointerCount >= 2) {
                        pinchDistance = pointerDistance(event)
                        isPinching = true
                    }
                    return true
                }
                MotionEvent.ACTION_MOVE -> {
                    if (event.pointerCount >= 2) {
                        val distance = pointerDistance(event)
                        if (pinchDistance > 0f) {
                            val ratio = (distance / pinchDistance).coerceIn(0.7f, 1.3f)
                            changeZoom(zoom + (ln(ratio.toDouble()) / ln(2.0)).toFloat())
                            pinchDistance = distance
                        }
                    } else if (!isPinching) {
                        val lat = operationLat ?: return true
                        val lon = operationLon ?: return true
                        val centerX = lonToPixel(lon) - (event.x - lastTouchX)
                        val centerY = latToPixel(lat) - (event.y - lastTouchY)
                        operationLon = pixelToLon(centerX)
                        operationLat = pixelToLat(centerY)
                        lastTouchX = event.x
                        lastTouchY = event.y
                        invalidate()
                    }
                    return true
                }
                MotionEvent.ACTION_POINTER_UP -> {
                    isPinching = event.pointerCount - 1 >= 2
                    val remainingIndex = if (event.actionIndex == 0) 1 else 0
                    if (remainingIndex < event.pointerCount) {
                        lastTouchX = event.getX(remainingIndex)
                        lastTouchY = event.getY(remainingIndex)
                    }
                    return true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    isPinching = false
                    edgeSwipeActive = false
                    loadTiles()
                    return true
                }
            }
            return true
        }

        private fun pointerDistance(event: MotionEvent): Float {
            if (event.pointerCount < 2) return 0f
            val dx = event.getX(0) - event.getX(1)
            val dy = event.getY(0) - event.getY(1)
            return kotlin.math.sqrt(dx * dx + dy * dy)
        }

        private fun changeZoom(newZoom: Float) {
            val bounded = newZoom.coerceIn(14f, 18.25f)
            if (kotlin.math.abs(bounded - zoom) < 0.001f) return
            val oldTileZoom = kotlin.math.floor(zoom).toInt()
            zoom = bounded
            if (oldTileZoom != kotlin.math.floor(zoom).toInt()) {
                imageryTiles.clear()
                labelTiles.clear()
                loadTiles()
            }
            invalidate()
        }

        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            val opLat = operationLat
            val opLon = operationLon
            val currentLat = userLat
            val currentLon = userLon
            paint.style = Paint.Style.FILL
            paint.color = Color.parseColor("#102326")
            canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), paint)
            if (opLat != null && opLon != null) {
                val tileZoom = kotlin.math.floor(zoom).toInt()
                val tileScale = 2.0.pow((zoom - tileZoom).toDouble()).toFloat()
                val centerPx = lonToPixel(opLon, tileZoom.toFloat())
                val centerPy = latToPixel(opLat, tileZoom.toFloat())
                imageryTiles.forEach { (key, bitmap) ->
                    val left = ((key.first * 256 - centerPx) * tileScale + width / 2.0).toFloat()
                    val top = ((key.second * 256 - centerPy) * tileScale + height / 2.0).toFloat()
                    canvas.save()
                    canvas.translate(left, top)
                    canvas.scale(tileScale, tileScale)
                    canvas.drawBitmap(bitmap, 0f, 0f, paint)
                    canvas.restore()
                }
                labelTiles.forEach { (key, bitmap) ->
                    val left = ((key.first * 256 - centerPx) * tileScale + width / 2.0).toFloat()
                    val top = ((key.second * 256 - centerPy) * tileScale + height / 2.0).toFloat()
                    canvas.save()
                    canvas.translate(left, top)
                    canvas.scale(tileScale, tileScale)
                    canvas.drawBitmap(bitmap, 0f, 0f, paint)
                    canvas.restore()
                }
                if (currentLat != null && currentLon != null) {
                    val point = screenPoint(currentLat, currentLon, opLat, opLon)
                    paint.color = C_GREEN
                    canvas.drawCircle(point.first, point.second, 8f, paint)
                    paint.style = Paint.Style.STROKE
                    paint.strokeWidth = 2f
                    paint.color = Color.WHITE
                    canvas.drawCircle(point.first, point.second, 10f, paint)
                    paint.style = Paint.Style.FILL
                }
                // Las capas tácticas (incluido el destino) van al frente.
                drawOperationLayers(canvas, opLat, opLon)
            }
        }

        private fun drawOperationLayers(canvas: Canvas, centerLat: Double, centerLon: Double) {
            val data = operationData ?: return
            val operationZone = data.optJSONObject("zona_operacion")
            jsonObject(operationZone?.opt("geometria"))
                ?.optJSONArray("coordinates")?.optJSONArray(0)?.let { ring ->
                    val zoneColor = parseCssColor(operationZone?.optString("color").orEmpty(), C_BLUE)
                    drawCoordinateRing(
                        canvas, ring, centerLat, centerLon, zoneColor, true,
                        dashPattern = floatArrayOf(9f, 7f)
                    )
                    drawSectorLabel(canvas, ring, operationZone?.optString("nombre").orEmpty(), centerLat, centerLon)
                    drawOperationGrid(canvas, ring, data.optJSONObject("grid") ?: data.optJSONObject("cuadricula_operacion"), centerLat, centerLon)
                }
            val layers = data.optJSONArray("capas") ?: JSONArray()
            for (index in 0 until layers.length()) {
                val item = layers.optJSONObject(index) ?: continue
                val type = item.optString("tipo_capa")
                when (type) {
                    "RUTA", "AREA" -> {
                        val geometry = jsonObject(item.opt("geometria")) ?: continue
                        val meta = geometry.optJSONObject("meta")
                        if (type == "AREA" && meta?.optString("shape") == "circle") {
                            val center = meta.optJSONArray("center") ?: continue
                            val lat = center.optDouble(1)
                            val lon = center.optDouble(0)
                            val centerPoint = screenPoint(lat, lon, centerLat, centerLon)
                            val edgePoint = screenPoint(lat, lon + meta.optDouble("radius_m", 1.0) / (111320.0 * cos(lat * PI / 180.0)), centerLat, centerLon)
                            val color = parseCssColor(item.optString("color", "#FFD700"), Color.YELLOW)
                            val radius = kotlin.math.abs(edgePoint.first - centerPoint.first)
                            val opacity = meta.optDouble("opacity", .35).coerceIn(0.0, 1.0)
                            paint.style = Paint.Style.FILL
                            paint.color = Color.argb((opacity * 255).toInt(), Color.red(color), Color.green(color), Color.blue(color))
                            canvas.drawCircle(centerPoint.first, centerPoint.second, radius, paint)
                            paint.style = Paint.Style.STROKE
                            paint.strokeWidth = sectorOutlineWidth(meta)
                            paint.color = color
                            canvas.drawCircle(centerPoint.first, centerPoint.second, radius, paint)
                            paint.style = Paint.Style.FILL
                            drawSectorLabel(canvas, lat, lon, item.optString("nombre"), centerLat, centerLon)
                            continue
                        }
                        val coordinates = geometry.optJSONArray("coordinates") ?: continue
                        val ring = if (type == "AREA") coordinates.optJSONArray(0) else coordinates
                        if (ring != null) {
                            val color = parseCssColor(item.optString("color", "#FFD700"), C_BLUE)
                            val opacity = meta?.optDouble("opacity", .35)?.coerceIn(0.0, 1.0) ?: .35
                            drawCoordinateRing(
                                canvas, ring, centerLat, centerLon, color, type == "AREA",
                                fillColor = if (type == "AREA") Color.argb((opacity * 255).toInt(), Color.red(color), Color.green(color), Color.blue(color)) else null,
                                strokeWidth = if (type == "AREA") sectorOutlineWidth(meta) else 3f
                            )
                            if (type == "AREA") {
                                drawSectorLabel(canvas, ring, item.optString("nombre"), centerLat, centerLon)
                            }
                        }
                    }
                    "EDIFICIO", "EQUIPO" -> drawMarker(canvas, item, centerLat, centerLon)
                }
            }
            val pois = data.optJSONArray("pois")
            if (pois != null) for (index in 0 until pois.length()) {
                drawMarker(canvas, pois.optJSONObject(index) ?: continue, centerLat, centerLon)
            }
            val vehicles = data.optJSONArray("vehiculos")
            if (vehicles != null) for (index in 0 until vehicles.length()) {
                drawMarker(canvas, vehicles.optJSONObject(index) ?: continue, centerLat, centerLon)
            }
            // Una actualizaci\u00f3n en tiempo real sustituye la posici\u00f3n inicial
            // de esa persona; de ese modo el mapa no pinta dos copias.
            val realtimePersonalIds = realtimeMarkers.values
                .mapNotNull { marker -> marker.optInt("id_personal", -1).takeIf { it > 0 } }
                .toSet()
            val people = data.optJSONArray("personal")
            if (people != null) for (index in 0 until people.length()) {
                val person = people.optJSONObject(index) ?: continue
                if (person.optInt("id_personal", -1) !in realtimePersonalIds) {
                    drawMarker(canvas, person, centerLat, centerLon)
                }
            }
            val devices = data.optJSONArray("dispositivos")
            if (devices != null) for (index in 0 until devices.length()) {
                drawMarker(canvas, devices.optJSONObject(index) ?: continue, centerLat, centerLon)
            }
            realtimeMarkers.values.forEach { drawMarker(canvas, it, centerLat, centerLon) }
            drawFreehandDrawings(canvas, centerLat, centerLon)
            val remoteRoutes = data.optJSONArray("rutas_navegacion")
            // Igual que el mapa principal, el reloj conserva solamente la última
            // ruta del usuario actual. Así no se acumulan destinos antiguos.
            val latestOwnRoute = remoteRoutes?.let { routes ->
                (0 until routes.length())
                    .mapNotNull { routes.optJSONObject(it) }
                    .filter(::isOwnNavigationRoute)
                    .maxByOrNull { it.optInt("id_ruta", -1) }
            }
            latestOwnRoute?.let { route ->
                // La API entrega las rutas calculadas como `geojson`, mientras que
                // clientes antiguos podían llamarlo `geometria` o `geometry`.
                val geometry = jsonObject(route.opt("geojson"))
                    ?: jsonObject(route.opt("geometria"))
                    ?: jsonObject(route.opt("geometry"))
                geometry?.optJSONArray("coordinates")?.let { coordinates ->
                    val color = navigationRouteColor(route)
                    drawCoordinateRing(canvas, coordinates, centerLat, centerLon, color, false, strokeWidth = 4f)
                    drawNavigationDestination(canvas, coordinates, centerLat, centerLon)
                }
            }
        }

        private fun sectorOutlineWidth(meta: JSONObject?): Float =
            meta?.optDouble("outline_width", meta.optDouble("outlineWidth", 3.0))
                ?.toFloat()?.coerceIn(1.5f, 5f) ?: 3f

        private fun drawSectorLabel(
            canvas: Canvas,
            points: JSONArray,
            label: String,
            centerLat: Double,
            centerLon: Double
        ) {
            if (label.isBlank() || points.length() == 0) return
            var latSum = 0.0
            var lonSum = 0.0
            var count = 0
            for (index in 0 until points.length()) {
                val point = points.optJSONArray(index) ?: continue
                val lon = point.optDouble(0, Double.NaN)
                val lat = point.optDouble(1, Double.NaN)
                if (!lat.isFinite() || !lon.isFinite()) continue
                latSum += lat
                lonSum += lon
                count++
            }
            if (count == 0) return
            drawSectorLabel(canvas, latSum / count, lonSum / count, label, centerLat, centerLon)
        }

        private fun drawSectorLabel(
            canvas: Canvas,
            lat: Double,
            lon: Double,
            label: String,
            centerLat: Double,
            centerLon: Double
        ) {
            val point = screenPoint(lat, lon, centerLat, centerLon)
            val text = label.take(18)
            paint.typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
            paint.textSize = 10f
            paint.textAlign = Paint.Align.CENTER
            val padding = 4f
            val halfWidth = paint.measureText(text) / 2f + padding
            paint.style = Paint.Style.FILL
            paint.color = Color.argb(185, 8, 17, 19)
            canvas.drawRoundRect(RectF(point.first - halfWidth, point.second - 10f, point.first + halfWidth, point.second + 4f), 4f, 4f, paint)
            paint.color = C_TEXT
            paint.setShadowLayer(2f, 0f, 1f, Color.BLACK)
            canvas.drawText(text, point.first, point.second, paint)
            paint.clearShadowLayer()
            paint.textAlign = Paint.Align.LEFT
        }

        private fun drawFreehandDrawings(canvas: Canvas, centerLat: Double, centerLon: Double) {
            for (index in 0 until drawings.length()) {
                val drawing = drawings.optJSONObject(index) ?: continue
                val points = drawing.optJSONArray("puntos") ?: drawing.optJSONArray("coords") ?: continue
                if (points.length() < 2) continue
                val path = Path()
                var count = 0
                for (pointIndex in 0 until points.length()) {
                    val point = points.optJSONObject(pointIndex) ?: continue
                    val lat = point.optDouble("lat", Double.NaN)
                    val lon = point.optDouble("lng", point.optDouble("lon", Double.NaN))
                    if (lat.isNaN() || lon.isNaN()) continue
                    val screen = screenPoint(lat, lon, centerLat, centerLon)
                    if (count++ == 0) path.moveTo(screen.first, screen.second)
                    else path.lineTo(screen.first, screen.second)
                }
                if (count < 2) continue
                paint.style = Paint.Style.STROKE
                paint.strokeCap = Paint.Cap.ROUND
                paint.strokeJoin = Paint.Join.ROUND
                paint.strokeWidth = drawing.optDouble("grosor", 4.0)
                    .toFloat()
                    .coerceAtLeast(1f)
                paint.color = parseCssColor(
                    drawing.optString("color", "#00ffa6"),
                    Color.parseColor("#00ffa6")
                )
                canvas.drawPath(path, paint)
                paint.style = Paint.Style.FILL
            }
        }

        private fun parseCssColor(value: String, fallback: Int): Int {
            val css = value.trim()
            val rgbMatch = Regex(
                """rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([0-9.]+))?\s*\)""",
                RegexOption.IGNORE_CASE
            ).matchEntire(css)
            if (rgbMatch != null) {
                val red = rgbMatch.groupValues[1].toInt().coerceIn(0, 255)
                val green = rgbMatch.groupValues[2].toInt().coerceIn(0, 255)
                val blue = rgbMatch.groupValues[3].toInt().coerceIn(0, 255)
                val alphaValue = rgbMatch.groupValues[4]
                val alpha = if (alphaValue.isBlank()) 255 else {
                    (alphaValue.toFloatOrNull()?.coerceIn(0f, 1f)?.times(255f) ?: 255f)
                        .toInt()
                }
                return Color.argb(alpha, red, green, blue)
            }
            return runCatching { Color.parseColor(css) }.getOrDefault(fallback)
        }

        private fun drawOperationGrid(canvas: Canvas, ring: org.json.JSONArray, grid: JSONObject?, centerLat: Double, centerLon: Double) {
            if (grid == null || ring.length() < 3) return
            val rows = grid.optInt("rows", grid.optString("size").substringBefore('x').toIntOrNull() ?: 0)
            val cols = grid.optInt("cols", grid.optString("size").substringAfter('x').toIntOrNull() ?: 0)
            if (rows <= 0 || cols <= 0) return
            val coordinates = (0 until ring.length()).mapNotNull { index ->
                ring.optJSONArray(index)?.let { it.optDouble(1) to it.optDouble(0) }
            }
            if (coordinates.isEmpty()) return
            val minLat = coordinates.minOf { it.first }
            val maxLat = coordinates.maxOf { it.first }
            val minLon = coordinates.minOf { it.second }
            val maxLon = coordinates.maxOf { it.second }
            // Igual que los mapas Android/web: cada divisoria toma el siguiente
            // color t\u00e1ctico y se dibuja discontinua, sin tapar el sat\u00e9lite.
            val colors = intArrayOf(
                Color.parseColor("#FFA000"), Color.parseColor("#1E88E5"),
                Color.parseColor("#E53935"), Color.parseColor("#00897B"),
                Color.parseColor("#8E24AA"), Color.parseColor("#FB8C00"),
                Color.parseColor("#D81B60"), Color.parseColor("#039BE5"),
                Color.parseColor("#43A047"), Color.parseColor("#FDD835")
            )
            var colorIndex = 0
            paint.strokeWidth = 2.5f
            paint.style = Paint.Style.STROKE
            paint.pathEffect = DashPathEffect(floatArrayOf(10f, 7f), 0f)
            for (col in 1 until cols) {
                val lon = minLon + (maxLon - minLon) * col / cols
                val start = screenPoint(minLat, lon, centerLat, centerLon)
                val end = screenPoint(maxLat, lon, centerLat, centerLon)
                paint.color = colors[colorIndex++ % colors.size]
                canvas.drawLine(start.first, start.second, end.first, end.second, paint)
            }
            for (row in 1 until rows) {
                val lat = minLat + (maxLat - minLat) * row / rows
                val start = screenPoint(lat, minLon, centerLat, centerLon)
                val end = screenPoint(lat, maxLon, centerLat, centerLon)
                paint.color = colors[colorIndex++ % colors.size]
                canvas.drawLine(start.first, start.second, end.first, end.second, paint)
            }
            paint.pathEffect = null
            val names = grid.optJSONArray("names") ?: grid.optJSONArray("nombres") ?: JSONArray()
            var index = 0
            for (row in 0 until rows) {
                val latTop = maxLat - (maxLat - minLat) * row / rows
                for (col in 0 until cols) {
                    val lonLeft = minLon + (maxLon - minLon) * col / cols
                    val label = names.optString(index).trim().ifBlank { operationGridDefaultName(index) }
                    drawGridLabel(canvas, latTop, lonLeft, label, centerLat, centerLon)
                    index += 1
                }
            }
            paint.style = Paint.Style.FILL
        }

        private fun operationGridDefaultName(index: Int): String {
            val phonetic = arrayOf(
                "ALFA", "BRAVO", "CHARLIE", "DELTA", "ECHO", "FOXTROT", "GOLF", "HOTEL",
                "INDIA", "JULIETT", "KILO", "LIMA", "MIKE", "NOVEMBER", "OSCAR", "PAPA",
                "QUEBEC", "ROMEO", "SIERRA", "TANGO", "UNIFORM", "VICTOR", "WHISKEY", "X-RAY",
                "YANKEE", "ZULU"
            )
            val base = phonetic[index % phonetic.size]
            val cycle = index / phonetic.size
            return if (cycle == 0) base else "$base-${cycle + 1}"
        }

        private fun drawGridLabel(canvas: Canvas, lat: Double, lon: Double, label: String, centerLat: Double, centerLon: Double) {
            val point = screenPoint(lat, lon, centerLat, centerLon)
            val text = label.take(18)
            paint.typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
            paint.textSize = 10f
            paint.textAlign = Paint.Align.LEFT
            val width = paint.measureText(text) + 8f
            paint.style = Paint.Style.FILL
            paint.color = Color.argb(184, 0, 0, 0)
            canvas.drawRoundRect(RectF(point.first + 4f, point.second + 4f, point.first + width + 4f, point.second + 18f), 3f, 3f, paint)
            paint.color = Color.WHITE
            canvas.drawText(text, point.first + 8f, point.second + 15f, paint)
            paint.typeface = Typeface.DEFAULT
        }

        private fun jsonObject(raw: Any?): JSONObject? = when (raw) {
            is JSONObject -> raw
            is String -> runCatching { JSONObject(raw) }.getOrNull()
            else -> null
        }

        private fun navigationRouteColor(route: JSONObject): Int {
            val explicit = route.optString("color").trim()
            if (Regex("^#[0-9A-Fa-f]{6}$").matches(explicit) && !explicit.equals("#1E90FF", true)) {
                return parseCssColor(explicit, Color.CYAN)
            }
            val creator = route.optString("creador_nombre").ifBlank { route.optString("routeCreator") }
            return when {
                creator.contains("pineda", true) -> Color.parseColor("#9333EA")
                creator.contains("campos", true) -> Color.parseColor("#F97316")
                else -> {
                    val key = creator.ifBlank { route.optString("id_vehiculo", "global") }
                    val palette = intArrayOf(0xFFFF00FF.toInt(), 0xFFFFA500.toInt(), 0xFF32CD32.toInt(), 0xFFFFC0CB.toInt(), 0xFF00BFFF.toInt(), 0xFFFF69B4.toInt(), 0xFFFFD700.toInt(), 0xFFEE82EE.toInt(), 0xFF00FF7F.toInt())
                    palette[(key.hashCode() and Int.MAX_VALUE) % palette.size]
                }
            }
        }

        /** El reloj es un visor personal: nunca muestra la navegación de otra cuenta. */
        private fun isOwnNavigationRoute(route: JSONObject): Boolean {
            val ownerId = routeOwnerId ?: return false
            return when (route.optString("created_by_tipo").uppercase(Locale.US)) {
                "PERSONAL" -> routeOwnerType == "PERSONAL" && route.optInt("id_personal", -1) == ownerId
                "USUARIO" -> routeOwnerType == "USUARIO" && route.optInt("id_usuario", -1) == ownerId
                else -> false
            }
        }

        private fun drawNavigationDestination(
            canvas: Canvas,
            coordinates: JSONArray,
            centerLat: Double,
            centerLon: Double
        ) {
            val last = coordinates.optJSONArray(coordinates.length() - 1) ?: return
            // La geometría de la ruta es la fuente visual de verdad. Así el pin
            // siempre queda conectado al trazo, incluso si el destino guardado
            // proviene de una posición anterior.
            val lat = last.optDouble(1, Double.NaN)
            val lon = last.optDouble(0, Double.NaN)
            if (!lat.isFinite() || !lon.isFinite()) return
            val point = screenPoint(lat, lon, centerLat, centerLon)
            // Una bandera pequeña distingue el destino sin cubrir el mapa.
            val pin = Path().apply {
                moveTo(point.first, point.second)
                cubicTo(
                    point.first - 9f, point.second - 10f,
                    point.first - 15f, point.second - 21f,
                    point.first - 15f, point.second - 30f
                )
                cubicTo(
                    point.first - 15f, point.second - 39f,
                    point.first - 8.3f, point.second - 46f,
                    point.first, point.second - 46f
                )
                cubicTo(
                    point.first + 8.3f, point.second - 46f,
                    point.first + 15f, point.second - 39f,
                    point.first + 15f, point.second - 30f
                )
                cubicTo(
                    point.first + 15f, point.second - 21f,
                    point.first + 9f, point.second - 10f,
                    point.first, point.second
                )
                close()
            }
            paint.style = Paint.Style.FILL
            paint.color = C_GREEN
            canvas.drawPath(pin, paint)
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 1.5f
            paint.color = C_GREEN_DARK
            canvas.drawPath(pin, paint)
            paint.style = Paint.Style.FILL
            paint.color = C_BG
            canvas.drawCircle(point.first, point.second - 30f, 8f, paint)
        }

        private fun drawCoordinateRing(
            canvas: Canvas,
            points: org.json.JSONArray,
            centerLat: Double,
            centerLon: Double,
            color: Int,
            closed: Boolean,
            fillColor: Int? = null,
            strokeWidth: Float = 3f,
            dashPattern: FloatArray? = null
        ) {
            val path = Path()
            var count = 0
            for (index in 0 until points.length()) {
                val point = points.optJSONArray(index) ?: continue
                val screen = screenPoint(point.optDouble(1), point.optDouble(0), centerLat, centerLon)
                if (count++ == 0) path.moveTo(screen.first, screen.second) else path.lineTo(screen.first, screen.second)
            }
            if (closed) path.close()
            if (closed && fillColor != null) {
                paint.style = Paint.Style.FILL
                paint.color = fillColor
                canvas.drawPath(path, paint)
            }
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = strokeWidth
            paint.color = color
            paint.pathEffect = dashPattern?.let { DashPathEffect(it, 0f) }
            canvas.drawPath(path, paint)
            paint.pathEffect = null
            paint.style = Paint.Style.FILL
        }

        private fun drawMarker(canvas: Canvas, item: JSONObject, centerLat: Double, centerLon: Double) {
            if (!item.has("latitud") || !item.has("longitud")) return
            val lat = item.optDouble("latitud", Double.NaN)
            val lon = item.optDouble("longitud", Double.NaN)
            if (lat.isNaN() || lon.isNaN()) return
            val point = screenPoint(lat, lon, centerLat, centerLon)
            val isBuilding =
                item.optString("tipo_capa").equals("EDIFICIO", ignoreCase = true) ||
                    item.optString("tipo_estructura").equals("EDIFICIO", ignoreCase = true)
            if (isBuilding) {
                drawBuildingMarker(canvas, point.first, point.second, item)
                return
            }
            val markerColor = when {
                item.has("color") -> parseCssColor(item.optString("color"), Color.parseColor("#22D3EE"))
                item.has("id_vehiculo") -> Color.parseColor("#38BDF8")
                item.has("id_equipo") -> Color.parseColor("#F59E0B")
                item.has("id_dispositivo") -> Color.parseColor("#A78BFA")
                item.has("id_personal") -> Color.parseColor("#2DD4BF")
                else -> Color.parseColor("#22D3EE")
            }
            val explicitSidc = sequenceOf("sidc", "codigo_sidc", "mil_sidc")
                .map { item.optString(it) }
                .firstOrNull { it.isNotBlank() }
                ?: item.optString("icono_src").takeIf { it.startsWith("S") }
            val isPoi = item.has("id_poi") ||
                item.optString("tipo_capa").equals("POI", ignoreCase = true)
            // Legacy records can be marked MIL without a usable SIDC. Treat those
            // as ordinary POIs instead of drawing a fake generic symbol with an X.
            // Waypoints (G...) y blancos (S...) usan los mismos SVG que el
            // mapa Android genera con milsymbol; nunca se reducen a un punto.
            val isMilitaryPoi = explicitSidc != null && (
                item.optString("tipo_poi").equals("MIL", ignoreCase = true) ||
                    explicitSidc.startsWith("G", ignoreCase = true) ||
                    explicitSidc.startsWith("S", ignoreCase = true)
                )
            if (isPoi && !isMilitaryPoi) {
                paint.style = Paint.Style.FILL
                paint.color = markerColor
                canvas.drawCircle(point.first, point.second, 6.5f, paint)
                paint.style = Paint.Style.STROKE
                paint.strokeWidth = 2f
                paint.color = Color.WHITE
                canvas.drawCircle(point.first, point.second, 8f, paint)
                paint.style = Paint.Style.FILL
                return
            }
            val sidc = explicitSidc ?: trackingSidc(item)
            val isMilitary = explicitSidc != null ||
                item.has("id_personal") || item.has("id_vehiculo") || item.has("id_equipo") ||
                item.has("id_dispositivo")
            if (isMilitary) {
                drawMilitaryMarker(canvas, point.first, point.second, item, sidc)
            } else {
                paint.style = Paint.Style.FILL
                paint.color = markerColor
                canvas.drawCircle(point.first, point.second, 6f, paint)
                paint.style = Paint.Style.STROKE
                paint.strokeWidth = 1.5f
                paint.color = Color.WHITE
                canvas.drawCircle(point.first, point.second, 7.5f, paint)
                paint.style = Paint.Style.FILL
            }
            if (item.has("id_personal")) {
                personHeadingDegrees(item)?.let { heading ->
                    drawHeadingArrow(canvas, point.first, point.second, heading, C_GREEN, 1.25f)
                }
            }
            drawMarkerLabel(canvas, point.first, point.second, item)
        }

        private fun drawMarkerLabel(canvas: Canvas, x: Float, y: Float, item: JSONObject) {
            val label = item.optString("apodo").ifBlank {
                item.optString("alias").ifBlank {
                    item.optString("nombre").ifBlank { item.optString("codigo_interno") }
                }
            }
            if (label.isNotBlank()) {
                paint.color = Color.WHITE
                paint.textSize = 10f
                paint.style = Paint.Style.FILL
                paint.textAlign = Paint.Align.CENTER
                paint.setShadowLayer(3f, 0f, 1f, Color.BLACK)
                canvas.drawText(label.take(14), x, y + 18f, paint)
                paint.clearShadowLayer()
                paint.textAlign = Paint.Align.LEFT
            }
        }


        /**
         * El servicio de tracking puede llamar al rumbo de distintas formas
         * seg\u00fan el dispositivo que reporta la posici\u00f3n. Todos representan
         * grados con norte = 0, por lo que se normalizan antes de dibujarlos.
         */
        private fun personHeadingDegrees(item: JSONObject): Float? =
            sequenceOf("rumbo_grados", "heading", "curso", "heading_deg")
                .map { item.optDouble(it, Double.NaN) }
                .firstOrNull { it.isFinite() }
                ?.let { (((it % 360.0) + 360.0) % 360.0).toFloat() }

        private fun drawHeadingArrow(
            canvas: Canvas,
            x: Float,
            y: Float,
            headingDegrees: Float,
            color: Int,
            scale: Float
        ) {
            // La flecha se dise\u00f1a apuntando al norte; Canvas rota en sentido
            // horario, igual que los grados de rumbo (90\u00b0 = este).
            val arrow = Path().apply {
                moveTo(x, y - 20f)
                lineTo(x - 5f, y - 10f)
                lineTo(x - 2f, y - 11.5f)
                lineTo(x - 2f, y - 5f)
                lineTo(x + 2f, y - 5f)
                lineTo(x + 2f, y - 11.5f)
                lineTo(x + 5f, y - 10f)
                close()
            }
            canvas.save()
            canvas.scale(scale, scale, x, y)
            canvas.rotate(headingDegrees, x, y)
            paint.style = Paint.Style.FILL
            paint.color = color
            canvas.drawPath(arrow, paint)
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 1.25f
            paint.color = C_BG
            canvas.drawPath(arrow, paint)
            paint.style = Paint.Style.FILL
            canvas.restore()
        }

        private fun drawBuildingMarker(
            canvas: Canvas,
            x: Float,
            y: Float,
            item: JSONObject
        ) {
            buildingBitmap?.takeIf { !it.isRecycled }?.let { bitmap ->
                // Same casa.png asset used by the phone map, anchored at its base.
                val drawWidth = 38f
                val drawHeight = drawWidth * bitmap.height / bitmap.width
                canvas.drawBitmap(
                    bitmap,
                    null,
                    RectF(x - drawWidth / 2f, y - drawHeight, x + drawWidth / 2f, y),
                    paint
                )
            }
            val label = item.optString("nombre").ifBlank { "Estructura" }
            paint.color = Color.WHITE
            paint.textSize = 10f
            paint.style = Paint.Style.FILL
            paint.textAlign = Paint.Align.CENTER
            paint.setShadowLayer(3f, 0f, 1f, Color.BLACK)
            canvas.drawText(label.take(16), x, y + 16f, paint)
            paint.clearShadowLayer()
            paint.textAlign = Paint.Align.LEFT
        }

        private fun drawMilitaryMarker(
            canvas: Canvas,
            x: Float,
            y: Float,
            item: JSONObject,
            sidc: String?
        ) {
            val isPerson = item.has("id_personal")
            // En la pantalla peque\u00f1a del reloj el personal necesita destacar
            // sobre veh\u00edculos y equipos sin alterar el tama\u00f1o de estos \u00faltimos.
            canvas.save()
            if (isPerson) canvas.scale(1.25f, 1.25f, x, y)
            if (sidc != null) {
                val bitmap = symbolRenderer?.bitmap(sidc)
                if (bitmap != null && !bitmap.isRecycled) {
                    val maxSize = 34f
                    val scale = (maxSize / bitmap.width.coerceAtLeast(bitmap.height)).coerceAtMost(1f)
                    val drawWidth = bitmap.width * scale
                    val drawHeight = bitmap.height * scale
                    canvas.drawBitmap(
                        bitmap,
                        null,
                        RectF(
                            x - drawWidth / 2f,
                            y - drawHeight,
                            x + drawWidth / 2f,
                            y
                        ),
                        paint
                    )
                    canvas.restore()
                    return
                }
            }
            val affiliation = sidc?.getOrNull(1)?.uppercaseChar() ?: 'F'
            val frameColor = when (affiliation) {
                'H', 'S', 'J', 'K' -> Color.parseColor("#FF3031")
                'N', 'L' -> Color.parseColor("#00E26E")
                'U', 'P', 'G', 'W' -> Color.parseColor("#FFFF00")
                else -> Color.parseColor("#00A8DC")
            }
            val halfWidth = 10f
            val halfHeight = 7.5f
            paint.style = Paint.Style.FILL
            paint.color = Color.argb(205, 8, 17, 19)

            when (affiliation) {
                'H', 'S', 'J', 'K' -> {
                    val diamond = Path().apply {
                        moveTo(x, y - 10f)
                        lineTo(x + 12f, y)
                        lineTo(x, y + 10f)
                        lineTo(x - 12f, y)
                        close()
                    }
                    canvas.drawPath(diamond, paint)
                    paint.style = Paint.Style.STROKE
                    paint.strokeWidth = 2.3f
                    paint.color = frameColor
                    canvas.drawPath(diamond, paint)
                }
                'U', 'P', 'G', 'W' -> {
                    val unknown = RectF(x - halfWidth, y - halfHeight, x + halfWidth, y + halfHeight)
                    canvas.drawRoundRect(unknown, 7f, 7f, paint)
                    paint.style = Paint.Style.STROKE
                    paint.strokeWidth = 2.3f
                    paint.color = frameColor
                    canvas.drawRoundRect(unknown, 7f, 7f, paint)
                }
                else -> {
                    val frame = RectF(x - halfWidth, y - halfHeight, x + halfWidth, y + halfHeight)
                    canvas.drawRect(frame, paint)
                    paint.style = Paint.Style.STROKE
                    paint.strokeWidth = 2.3f
                    paint.color = frameColor
                    canvas.drawRect(frame, paint)
                }
            }

            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 1.8f
            paint.strokeCap = Paint.Cap.ROUND
            paint.color = frameColor
            when {
                item.has("id_vehiculo") -> {
                    canvas.drawLine(x - 6f, y - 2f, x + 6f, y - 2f, paint)
                    canvas.drawCircle(x - 5f, y + 3f, 2f, paint)
                    canvas.drawCircle(x + 5f, y + 3f, 2f, paint)
                }
                item.has("id_equipo") || item.has("id_dispositivo") -> {
                    canvas.drawLine(x - 5f, y - 4f, x + 5f, y + 4f, paint)
                    canvas.drawLine(x + 5f, y - 4f, x - 5f, y + 4f, paint)
                }
                else -> {
                    canvas.drawLine(x - 6f, y - 4f, x + 6f, y + 4f, paint)
                    canvas.drawLine(x + 6f, y - 4f, x - 6f, y + 4f, paint)
                }
            }
            paint.strokeCap = Paint.Cap.BUTT
            paint.style = Paint.Style.FILL
            canvas.restore()
        }

        private fun trackingSidc(item: JSONObject): String? {
            val kind = when {
                item.has("id_vehiculo") -> "vehiculo"
                item.has("id_equipo") -> "equipo"
                item.has("id_dispositivo") -> "dispositivo"
                item.has("id_personal") -> "personal"
                else -> return null
            }
            val text = sequenceOf(
                kind, item.optString("apodo"), item.optString("rol"),
                item.optString("rol_en_operacion"), item.optString("tipo"),
                item.optString("tipo_equipo"), item.optString("categoria"),
                item.optString("nombre"), item.optString("alias"),
                item.optString("codigo_interno"), item.optString("modelo"),
                item.optString("marca")
            ).joinToString(" ").uppercase(Locale.US)
                .replace('Á', 'A').replace('É', 'E').replace('Í', 'I')
                .replace('Ó', 'O').replace('Ú', 'U').replace('Ñ', 'N')
            fun includes(vararg values: String) = values.any(text::contains)
            fun build(dimension: String, icon: String) =
                "SF${dimension}P${icon.padEnd(6, '-').take(6)}-----"
            return when (kind) {
                "vehiculo" -> when {
                    includes("AMBULANC", "MEDIC") -> build("G", "UCM---")
                    includes("BLIND", "TANQUE", "ARMORED") -> build("G", "UCD---")
                    includes("PATRULL", "POLIC", "SEGUR") -> build("G", "UCF---")
                    else -> build("G", "EV----")
                }
                "equipo" -> when {
                    includes("DRON", "DRONE", "UAV", "MATRICE") -> build("A", "MFQ---")
                    includes("RADIO", "COMUNIC", "SENAL", "SIGNAL") -> build("G", "UCS---")
                    includes("ARMA", "RIFLE", "PISTOLA", "FUSIL") -> build("G", "EW----")
                    includes("CAMARA", "SENSOR", "TACTICO") -> build("G", "EX----")
                    else -> build("G", "E-----")
                }
                "dispositivo" -> when {
                    includes("WATCH", "RELOJ") -> build("G", "U-----")
                    includes("TELEFONO", "CELULAR", "TABLET", "RADIO", "LORA", "COMUNIC") ->
                        build("G", "UCS---")
                    includes("CAMARA", "CAMERA") -> build("G", "EX----")
                    else -> build("G", "E-----")
                }
                else -> if (includes("PATRULL", "POLIC", "SEGUR")) {
                    build("G", "UCF---")
                } else {
                    build("G", "UCI---")
                }
            }
        }

        private fun screenPoint(lat: Double, lon: Double, centerLat: Double, centerLon: Double): Pair<Float, Float> =
            (width / 2.0 + lonToPixel(lon) - lonToPixel(centerLon)).toFloat() to
                (height / 2.0 + latToPixel(lat) - latToPixel(centerLat)).toFloat()

        private fun lonToPixel(lon: Double, atZoom: Float = zoom): Double =
            (lon + 180.0) / 360.0 * 256.0 * 2.0.pow(atZoom.toDouble())

        private fun latToPixel(lat: Double, atZoom: Float = zoom): Double {
            val radians = lat * PI / 180.0
            return (1.0 - ln(tan(radians) + 1.0 / cos(radians)) / PI) / 2.0 * 256.0 * 2.0.pow(atZoom.toDouble())
        }

        private fun pixelToLon(pixel: Double): Double = pixel / (256.0 * 2.0.pow(zoom.toDouble())) * 360.0 - 180.0

        private fun pixelToLat(pixel: Double): Double {
            val n = PI - 2.0 * PI * pixel / (256.0 * 2.0.pow(zoom.toDouble()))
            return 180.0 / PI * kotlin.math.atan(0.5 * (kotlin.math.exp(n) - kotlin.math.exp(-n)))
        }
    }

    private fun navButton(panel: Panel): Button =
        Button(this).apply {
            text = panel.label
            setTextColor(if (panel == activePanel) C_GREEN else C_TEXT)
            textSize = 9f
            typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
            includeFontPadding = false
            minHeight = 0
            minWidth = 0
            stateListAnimator = null
            backgroundTintList = ColorStateList.valueOf(if (panel == activePanel) C_GREEN_DARK else C_PANEL)
            setPadding(0, 0, 0, 0)
            setOnClickListener {
                activePanel = panel
                renderHome()
            }
        }

    private fun chatChannelSelector(): LinearLayout =
        LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            ChatChannel.entries.forEach { channel ->
                val selected = channel == selectedChatChannel
                val button = proButton(
                    text = channel.shortLabel,
                    widthDp = 44,
                    textColor = if (selected) C_GREEN else C_TEXT,
                    bgColor = if (selected) C_GREEN_DARK else C_PANEL
                ) {
                    selectedChatChannel = channel
                    renderActivePanel()
                }
                addView(button, LinearLayout.LayoutParams(0, dp(32), 1f).apply {
                    leftMargin = dp(2)
                    rightMargin = dp(2)
                })
            }
            layoutParams = blockParams(contentWidthDp(), top = 6)
        }

    private fun chatStatusBlock(value: String, sub: String): LinearLayout =
        LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            background = rounded(C_PANEL)
            setPadding(dp(6), dp(4), dp(6), dp(4))
            addView(mutedText("CHAT", 6f))
            addView(valueText(value, 10f, C_TEXT))
            if (sub.isNotBlank()) addView(mutedText(sub, 7f))
            layoutParams = blockParams(contentWidthDp(), top = 4)
        }

    private fun sectionBlock(label: String, value: String, sub: String): LinearLayout =
        LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            background = rounded(C_PANEL)
            setPadding(dp(7), dp(5), dp(7), dp(5))
            addView(mutedText(label, 7f))
            addView(valueText(value, 12f, C_TEXT))
            if (sub.isNotBlank()) addView(mutedText(sub, 8f))
            layoutParams = blockParams(contentWidthDp(), top = 6)
        }

    private fun gpsBlock(): LinearLayout =
        LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            background = rounded(C_PANEL)
            setPadding(dp(7), dp(5), dp(7), dp(5))
            addView(mutedText("MI UBICACION", 7f))
            gpsValue = valueText(locationText(), 10f, if (lastLat != null && lastLon != null) C_BLUE else C_MUTED)
            addView(gpsValue)
            layoutParams = blockParams(contentWidthDp(), top = 6)
        }

    private fun vitalHero(heart: String): LinearLayout =
        LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            background = outlinedRounded(C_PANEL_ALT, C_DIVIDER)
            setPadding(dp(8), dp(6), dp(8), dp(6))
            addView(valueText("HR", 10f, C_RED))
            heartRateValue = valueText(heart, 34f, if (heart == "--") C_MUTED else C_TEXT)
            addView(heartRateValue)
            addView(mutedText("bpm", 8f))
            layoutParams = blockParams(contentWidthDp(), top = 6)
        }

    private data class MetricViews(val root: LinearLayout, val value: TextView)

    private fun metricCard(label: String, value: String, accentColor: Int = C_GOLD): MetricViews {
        val valueView = valueText(value, 10f, accentColor)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            background = outlinedRounded(C_PANEL, C_DIVIDER)
            setPadding(dp(4), dp(5), dp(4), dp(5))
            addView(mutedText(label, 7f))
            addView(valueView)
        }
        return MetricViews(root, valueView)
    }

    private fun twoMetricRow(left: MetricViews, right: MetricViews): LinearLayout =
        twoColumnRow(left.root, right.root)

    private fun twoColumnRow(left: View, right: View): LinearLayout =
        LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            addView(left, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                rightMargin = dp(3)
            })
            addView(right, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                leftMargin = dp(3)
            })
            layoutParams = blockParams(contentWidthDp(), top = 6)
        }

    private fun twoButtonRow(vararg buttons: Button): LinearLayout =
        LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            buttons.forEachIndexed { index, button ->
                addView(button, LinearLayout.LayoutParams(0, dp(32), 1f).apply {
                    if (index > 0) leftMargin = dp(3)
                    if (index < buttons.lastIndex) rightMargin = dp(3)
                })
            }
            layoutParams = blockParams(contentWidthDp(), top = 6)
        }

    private fun proButton(
        text: String,
        widthDp: Int,
        textColor: Int,
        bgColor: Int,
        onClick: () -> Unit
    ): Button =
        Button(this).apply {
            this.text = text
            setTextColor(textColor)
            textSize = 8.5f
            typeface = Typeface.MONOSPACE
            includeFontPadding = false
            minHeight = 0
            minWidth = 0
            stateListAnimator = null
            backgroundTintList = ColorStateList.valueOf(bgColor)
            setPadding(0, 0, 0, 0)
            setOnClickListener { onClick() }
            layoutParams = blockParams(widthDp, height = 32, top = 5)
        }

    private fun loginInput(value: String, hint: String, inputTypeValue: Int): EditText =
        EditText(this).apply {
            setText(value)
            this.hint = hint
            inputType = inputTypeValue
            setSingleLine(true)
            setTextColor(C_BLUE)
            setHintTextColor(C_MUTED_DARK)
            textSize = 8f
            typeface = Typeface.MONOSPACE
            background = rounded(C_INPUT)
            setPadding(dp(8), 0, dp(8), 0)
            includeFontPadding = false
            layoutParams = blockParams(fieldWidthDp(), height = 30, top = 2)
        }

    private fun fieldLabel(text: String): TextView =
        mutedText(text, 6f).apply {
            letterSpacing = 0.12f
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            textAlignment = View.TEXT_ALIGNMENT_VIEW_START
            layoutParams = blockParams(fieldWidthDp(), top = 5)
        }

    private fun mutedText(text: String, size: Float): TextView =
        TextView(this).apply {
            this.text = text
            setTextColor(C_MUTED)
            textSize = size
            typeface = Typeface.MONOSPACE
            gravity = Gravity.CENTER
            includeFontPadding = false
        }

    private fun valueText(text: String, size: Float, color: Int): TextView =
        TextView(this).apply {
            this.text = text
            setTextColor(color)
            textSize = size
            typeface = Typeface.MONOSPACE
            typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
            gravity = Gravity.CENTER
            includeFontPadding = false
            maxLines = 3
            ellipsize = TextUtils.TruncateAt.END
        }

    private fun thinDivider(widthDp: Int): View =
        View(this).apply {
            setBackgroundColor(C_DIVIDER)
            layoutParams = blockParams(widthDp, height = 1, top = 5)
        }

    private fun blockParams(widthDp: Int, height: Int = LinearLayout.LayoutParams.WRAP_CONTENT, top: Int = 0):
        LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(
            dp(widthDp.coerceAtMost(contentWidthDp())),
            if (height > 0) dp(height) else height
        ).apply {
            topMargin = dp(top)
            gravity = Gravity.CENTER_HORIZONTAL
        }

    private fun inlineParams(): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT)

    private fun contentWidthDp(): Int {
        val config = resources.configuration
        val screenWidth = config.screenWidthDp.takeIf { it > 0 }
            ?: pxToDp(resources.displayMetrics.widthPixels)
        val sideInset = if (isRoundScreen()) 20 else 12
        return (screenWidth - sideInset * 2).coerceIn(120, 176)
    }

    private fun fieldWidthDp(): Int =
        contentWidthDp().coerceAtMost(148)

    private fun isRoundScreen(): Boolean =
        resources.configuration.isScreenRound

    private fun pxToDp(px: Int): Int =
        (px / resources.displayMetrics.density).toInt()

    private fun rounded(color: Int): GradientDrawable =
        GradientDrawable().apply {
            setColor(color)
            cornerRadius = dp(6).toFloat()
        }

    private fun outlinedRounded(color: Int, strokeColor: Int): GradientDrawable =
        rounded(color).apply {
            setStroke(dp(1), strokeColor)
        }

    private fun toast(message: String) =
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show()

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()

}
