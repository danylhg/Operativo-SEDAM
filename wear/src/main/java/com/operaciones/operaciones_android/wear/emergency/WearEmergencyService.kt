package com.operaciones.operaciones_android.wear.emergency

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.IBinder
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.Log
import androidx.core.content.ContextCompat
import com.operaciones.operaciones_android.wear.R
import com.operaciones.operaciones_android.wear.auth.WearSession
import com.operaciones.operaciones_android.wear.bridge.PhoneBridge
import com.operaciones.operaciones_android.wear.bridge.WearPhoneListenerService
import com.operaciones.operaciones_android.wear.call.WearIncomingCallActivity
import com.operaciones.operaciones_android.wear.call.WearVoiceCallManager
import com.operaciones.operaciones_android.wear.config.WearApiConfig
import com.operaciones.operaciones_android.wear.data.WearOperationStatus
import com.operaciones.operaciones_android.wear.network.WearApiClient
import com.operaciones.operaciones_android.wear.network.WearSocketManager
import com.operaciones.operaciones_android.wear.ui.WearOperationStatusActivity
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.sqrt

class WearEmergencyService : Service(), SensorEventListener {
    companion object {
        const val ACTION_TRIGGER_SOS =
            "com.operaciones.operaciones_android.wear.action.TRIGGER_SOS"
        const val EXTRA_SOURCE = "source"
        const val ACTION_VOICE_CALL =
            "com.operaciones.operaciones_android.wear.action.VOICE_CALL"
        const val EXTRA_CALL_ID = "call_id"
        const val EXTRA_CALL_ACTION = "call_action"
        private const val TAG = "WearEmergency"
        private const val CHANNEL_ID = "sedam_wear_emergency"
        private const val NOTIFICATION_ID = 2101
        private const val SHAKE_THRESHOLD = 13f
        private const val SHAKE_RESET_MS = 1_500L
        private const val SHAKE_MIN_GAP_MS = 300L
        private const val MIN_TRACKING_UPLOAD_MS = 15_000L
        private const val MIN_LOCATION_INTERVAL_MS = 10_000L
        private const val MIN_LOCATION_DISTANCE_M = 0f
        private const val FUSED_PROVIDER = "fused"
        private const val OPERATION_STATUS_INTERVAL_MS = 10_000L
    }

    private val api = WearApiClient()
    private lateinit var phoneBridge: PhoneBridge
    private lateinit var sensorManager: SensorManager
    private var accelerometer: Sensor? = null
    private var shakeCount = 0
    private var lastShakeTime = 0L
    private var emergencyPending = false
    private var lastLat: Double? = null
    private var lastLon: Double? = null
    private var lastTrackingUploadAt = 0L
    private var locationManager: LocationManager? = null
    private var locationListener: LocationListener? = null
    private var voiceSocket: WearSocketManager? = null
    private var incomingVoiceCall: JSONObject? = null
    private var voiceCallManager: WearVoiceCallManager? = null
    private val operationStatusHandler = Handler(Looper.getMainLooper())
    private var operationStatusCheckRunning = false
    private var operationClosedShown = false
    private val operationStatusRunnable = object : Runnable {
        override fun run() {
            checkOperationStatus()
            operationStatusHandler.postDelayed(this, OPERATION_STATUS_INTERVAL_MS)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        WearApiConfig.load(this)
        phoneBridge = PhoneBridge(this)
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification())
        registerAccelerometer()
        registerLocationListener()
        startVoiceCallSocket()
        startOperationStatusMonitor()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (voiceSocket == null) startVoiceCallSocket()
        if (intent?.action == ACTION_TRIGGER_SOS) {
            triggerEmergency(intent.getStringExtra(EXTRA_SOURCE) ?: "ACCESO_BOTON_LATERAL")
        }
        if (intent?.action == ACTION_VOICE_CALL) {
            handleVoiceCallAction(
                intent.getStringExtra(EXTRA_CALL_ID).orEmpty(),
                intent.getStringExtra(EXTRA_CALL_ACTION).orEmpty()
            )
        }
        return START_STICKY
    }

    override fun onDestroy() {
        unregisterAccelerometer()
        unregisterLocationListener()
        voiceCallManager?.close()
        voiceCallManager = null
        voiceSocket?.disconnect()
        voiceSocket = null
        operationStatusHandler.removeCallbacks(operationStatusRunnable)
        super.onDestroy()
    }

    private fun startOperationStatusMonitor() {
        operationStatusHandler.removeCallbacks(operationStatusRunnable)
        operationStatusHandler.post(operationStatusRunnable)
    }

    private fun checkOperationStatus() {
        if (operationStatusCheckRunning || operationClosedShown) return
        val user = WearSession.user(this) ?: return
        val currentOperation = WearSession.operation(this) ?: return
        val token = WearSession.token(this)
        if (token.isBlank() || currentOperation.status != WearOperationStatus.ACTIVA) return
        operationStatusCheckRunning = true
        api.fetchAssignedOperation(
            userId = user.id,
            token = token,
            onSuccess = { operation ->
                operationStatusCheckRunning = false
                if (operation != null && operation.id == currentOperation.id &&
                    operation.status == WearOperationStatus.ACTIVA) return@fetchAssignedOperation
                operationClosedShown = true
                WearSession.saveOperation(this, operation)
                WearOperationStatusActivity.show(
                    this,
                    operation?.status ?: WearOperationStatus.CERRADA
                )
                stopSelf()
            },
            onError = { operationStatusCheckRunning = false }
        )
    }

    private fun startVoiceCallSocket() {
        val user = WearSession.user(this) ?: return
        val operation = WearSession.operation(this) ?: return
        if (user.tabla != "personal" || operation.status != WearOperationStatus.ACTIVA) return
        voiceSocket?.disconnect()
        voiceSocket = WearSocketManager(
            baseUrl = WearApiConfig.baseUrl,
            operationId = operation.id,
            idPersonal = user.id,
            rol = user.rol.name,
            onVoiceCallEvent = { event, data ->
                when (event) {
                    "voice_call_invite" -> {
                        voiceCallManager?.close()
                        voiceCallManager = null
                        incomingVoiceCall = data
                        WearPhoneListenerService.showVoiceCall(
                            this,
                            JSONObject(data.toString()).put("event", event)
                        )
                    }
                    "voice_call_offer" -> {
                        val call = incomingVoiceCall
                        if (call != null && data.optString("call_id") == call.optString("call_id")) {
                            ensureWearVoiceCallManager()
                            voiceCallManager?.acceptOffer(data.optString("sdp"))
                        }
                    }
                    "voice_call_ice" -> {
                        val call = incomingVoiceCall
                        if (call != null && data.optString("call_id") == call.optString("call_id")) {
                            ensureWearVoiceCallManager()
                            voiceCallManager?.addIce(data)
                        }
                    }
                    "voice_call_end", "voice_call_reject" -> {
                        voiceCallManager?.close()
                        voiceCallManager = null
                        incomingVoiceCall = null
                        WearPhoneListenerService.showVoiceCall(
                            this,
                            JSONObject(data.toString()).put("event", event)
                        )
                    }
                }
            }
        ).also { it.connect() }
    }

    private fun handleVoiceCallAction(callId: String, action: String) {
        val call = incomingVoiceCall
        if (callId.isBlank() || call?.optString("call_id") != callId) return
        val event = when (action) {
            "accept" -> "voice_call_accept"
            "end" -> "voice_call_end"
            else -> "voice_call_reject"
        }
        voiceSocket?.emitVoiceCall(event, JSONObject().apply {
            put("call_id", callId)
            put("to_personal_id", call.optInt("from_personal_id"))
        })
        if (action == "accept") {
            ensureWearVoiceCallManager()
        } else {
            voiceCallManager?.close()
            voiceCallManager = null
            incomingVoiceCall = null
        }
    }

    private fun ensureWearVoiceCallManager() {
        if (voiceCallManager != null) return
        val call = incomingVoiceCall ?: return
        val callId = call.optString("call_id")
        val peerId = call.optInt("from_personal_id")
        if (callId.isBlank() || peerId <= 0) return
        voiceCallManager = WearVoiceCallManager(
            context = this,
            onSignal = { event, payload ->
                payload.put("call_id", callId)
                payload.put("to_personal_id", peerId)
                voiceSocket?.emitVoiceCall(event, payload)
            },
            onConnected = {
                Log.i(TAG, "Llamada WebRTC conectada en smartwatch")
            },
            onFailed = {
                Log.e(TAG, "No se pudo establecer la llamada WebRTC en smartwatch")
                voiceSocket?.emitVoiceCall("voice_call_end", JSONObject().apply {
                    put("call_id", callId)
                    put("to_personal_id", peerId)
                })
                voiceCallManager?.close()
                voiceCallManager = null
                incomingVoiceCall = null
                WearIncomingCallActivity.finishCall(callId)
            }
        )
    }

    private fun registerAccelerometer() {
        sensorManager = getSystemService(Context.SENSOR_SERVICE) as SensorManager
        accelerometer = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        accelerometer?.let {
            sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME)
        }
    }

    private fun unregisterAccelerometer() {
        if (::sensorManager.isInitialized) sensorManager.unregisterListener(this)
    }

    override fun onSensorChanged(event: SensorEvent?) {
        if (event?.sensor?.type != Sensor.TYPE_ACCELEROMETER) return
        val acceleration = sqrt(
            event.values[0] * event.values[0] +
                event.values[1] * event.values[1] +
                event.values[2] * event.values[2]
        ) - SensorManager.GRAVITY_EARTH
        val now = System.currentTimeMillis()
        if (acceleration <= SHAKE_THRESHOLD) return

        val delta = now - lastShakeTime
        if (delta < SHAKE_MIN_GAP_MS) return
        if (delta > SHAKE_RESET_MS) shakeCount = 0

        shakeCount++
        lastShakeTime = now
        if (shakeCount >= 2) {
            shakeCount = 0
            triggerEmergency("AGITAR_RELOJ")
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    @SuppressLint("MissingPermission")
    private fun registerLocationListener() {
        val fineOk = ContextCompat.checkSelfPermission(
            this,
            android.Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        val coarseOk = ContextCompat.checkSelfPermission(
            this,
            android.Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        if (!fineOk && !coarseOk) return

        locationManager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        locationListener = LocationListener { loc: Location ->
            onLocation(loc)
        }

        listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER, FUSED_PROVIDER).forEach { provider ->
            runCatching {
                locationManager?.requestLocationUpdates(
                    provider,
                    MIN_LOCATION_INTERVAL_MS,
                    MIN_LOCATION_DISTANCE_M,
                    locationListener!!
                )
                locationManager?.getLastKnownLocation(provider)?.let { onLocation(it) }
            }.onFailure {
                Log.w(TAG, "No se pudo activar ubicacion $provider: ${it.message}")
            }
        }
    }

    private fun onLocation(location: Location) {
        lastLat = location.latitude
        lastLon = location.longitude
        Log.d(TAG, "Ubicacion ${location.provider}: ${location.latitude}, ${location.longitude}")
        maybeSendTracking(location)
    }

    private fun maybeSendTracking(location: Location) {
        val now = System.currentTimeMillis()
        if (lastTrackingUploadAt > 0L && now - lastTrackingUploadAt < MIN_TRACKING_UPLOAD_MS) return

        val user = WearSession.user(this) ?: return
        val operation = WearSession.operation(this) ?: return
        val token = WearSession.token(this)
        if (token.isBlank() || user.tabla != "personal" || operation.status != WearOperationStatus.ACTIVA) return

        lastTrackingUploadAt = now
        api.sendTracking(
            operationId = operation.id,
            token = token,
            idPersonal = user.id,
            latitude = location.latitude,
            longitude = location.longitude,
            accuracyMeters = if (location.hasAccuracy()) location.accuracy else null,
            speedKmh = if (location.hasSpeed()) location.speed.toDouble() * 3.6 else null,
            headingDegrees = if (location.hasBearing()) location.bearing.toDouble() else null,
            onSuccess = { Log.i(TAG, "Tracking enviado op=${operation.id} personal=${user.id}") },
            onError = { Log.w(TAG, it) }
        )
    }

    private fun unregisterLocationListener() {
        locationListener?.let { listener ->
            runCatching { locationManager?.removeUpdates(listener) }
        }
        locationListener = null
    }

    private fun triggerEmergency(source: String) {
        if (emergencyPending) return
        val user = WearSession.user(this)
        val operation = WearSession.operation(this)
        val token = WearSession.token(this)
        if (user == null || operation == null || token.isBlank()) {
            Log.w(TAG, "Emergencia sin sesion u operacion")
            return
        }

        emergencyPending = true
        vibrateEmergency()
        phoneBridge.mirrorEmergency(operation.id, source)

        val timestamp = SimpleDateFormat("HH:mm:ss dd/MM/yyyy", Locale.getDefault()).format(Date())
        val lat = lastLat
        val lon = lastLon
        val location = if (lat != null && lon != null) {
            "%.6f, %.6f".format(lat, lon)
        } else {
            "ubicacion no disponible"
        }
        val content = "EMERGENCIA RELOJ:\n" +
            "USUARIO: ${user.nombreCompleto}\n" +
            "ORIGEN: $source\n" +
            "UBICACION: $location\n" +
            "HORA: $timestamp"

        api.sendMessage(
            operationId = operation.id,
            token = token,
            contenido = content,
            tipoMensaje = "URGENTE",
            onSuccess = { emergencyPending = false },
            onError = {
                Log.e(TAG, it)
                emergencyPending = false
            }
        )
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

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "SEDAM Reloj",
                NotificationManager.IMPORTANCE_LOW
            )
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }
        return builder
            .setContentTitle("SEDAM Reloj activo")
            .setContentText("SOS por boton o agitada listo")
            .setSmallIcon(R.drawable.ic_watch_notification)
            .setOngoing(true)
            .build()
    }
}
