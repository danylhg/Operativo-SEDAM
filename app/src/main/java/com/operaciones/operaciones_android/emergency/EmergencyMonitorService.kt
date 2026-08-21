package com.operaciones.operaciones_android.emergency

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.core.app.NotificationCompat
import com.operaciones.operaciones_android.R
import com.operaciones.operaciones_android.network.ChatRepository
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.sqrt

class EmergencyMonitorService : Service(), SensorEventListener {

    companion object {
        const val EXTRA_OPERATION_ID = "OPERATION_ID"
        const val EXTRA_TOKEN        = "TOKEN"
        const val EXTRA_UNIT_CODE    = "UNIT_CODE"
        const val EXTRA_USER_NAME    = "USER_NAME"

        private const val CHANNEL_ID       = "sedam_emergency"
        private const val NOTIFICATION_ID  = 1001

        private const val SHAKE_THRESHOLD  = 11f          // m/s² por encima de gravedad (más sensible)
        private const val SHAKE_RESET_MS   = 1_500L       // ventana para el segundo shake
        private const val SHAKE_MIN_GAP_MS = 300L         // gap mínimo entre dos eventos

        private const val TAG = "EMERGENCY_SERVICE"
    }

    // ── Parámetros recibidos desde MainActivity ──────────────────────────────
    private var operationId = -1
    private var token       = ""
    private var unitCode    = ""
    private var userName    = ""

    // ── Sensores ─────────────────────────────────────────────────────────────
    private lateinit var sensorManager: SensorManager
    private var accelerometer: Sensor? = null

    // ── Estado del detector de doble shake ───────────────────────────────────
    private var shakeCount    = 0
    private var lastShakeTime = 0L

    // ── Última ubicación GPS conocida ─────────────────────────────────────────
    private var lastLat = 0.0
    private var lastLon = 0.0

    private var locationManager: LocationManager? = null
    private var locationListener: LocationListener? = null

    // ── Repositorio de chat ───────────────────────────────────────────────────
    private val chatRepository = ChatRepository()

    // ── Bandera anti-flood: evita disparar emergencia dos veces seguidas ──────
    private var emergencyPending = false

    // ─────────────────────────────────────────────────────────────────────────
    // Ciclo de vida
    // ─────────────────────────────────────────────────────────────────────────

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        startForeground(NOTIFICATION_ID, buildNotification())
        registerAccelerometer()
        registerLocationListener()
        Log.d(TAG, "Servicio creado y corriendo en primer plano")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        operationId = intent?.getIntExtra(EXTRA_OPERATION_ID, -1) ?: -1
        token       = intent?.getStringExtra(EXTRA_TOKEN)     ?: ""
        unitCode    = intent?.getStringExtra(EXTRA_UNIT_CODE)  ?: "SIN-UNIDAD"
        userName    = intent?.getStringExtra(EXTRA_USER_NAME)  ?: "Unidad"
        Log.d(TAG, "onStartCommand opId=$operationId unit=$unitCode user=$userName")
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        unregisterAccelerometer()
        unregisterLocationListener()
        Log.d(TAG, "Servicio detenido")
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Acelerómetro — detección de doble shake
    // ─────────────────────────────────────────────────────────────────────────

    private fun registerAccelerometer() {
        sensorManager = getSystemService(Context.SENSOR_SERVICE) as SensorManager
        accelerometer = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)

        if (accelerometer == null) {
            Log.w(TAG, "Dispositivo sin acelerómetro — servicio de emergencia sin sensor")
            return
        }

        sensorManager.registerListener(
            this,
            accelerometer,
            SensorManager.SENSOR_DELAY_GAME   // ~20 ms — suficiente y no consume demasiado
        )
        Log.d(TAG, "Acelerómetro registrado")
    }

    private fun unregisterAccelerometer() {
        sensorManager.unregisterListener(this)
    }

    override fun onSensorChanged(event: SensorEvent?) {
        if (event?.sensor?.type != Sensor.TYPE_ACCELEROMETER) return

        val x = event.values[0]
        val y = event.values[1]
        val z = event.values[2]

        // Aceleración neta eliminando la gravedad (9.81 m/s²)
        val acceleration = sqrt(x * x + y * y + z * z) - SensorManager.GRAVITY_EARTH

        val now = System.currentTimeMillis()

        if (acceleration > SHAKE_THRESHOLD) {
            val timeSinceLastShake = now - lastShakeTime

            // Ignorar si es el mismo gesto continuo (demasiado rápido)
            if (timeSinceLastShake < SHAKE_MIN_GAP_MS) return

            // Resetear contador si la ventana expiró
            if (timeSinceLastShake > SHAKE_RESET_MS) {
                shakeCount = 0
            }

            shakeCount++
            lastShakeTime = now
            Log.d(TAG, "Shake #$shakeCount (acc=$acceleration)")

            if (shakeCount >= 2) {
                shakeCount = 0
                if (!emergencyPending) {
                    emergencyPending = true
                    triggerEmergency()
                }
            }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) { /* no-op */ }

    // ─────────────────────────────────────────────────────────────────────────
    // GPS — escucha pasiva para tener siempre la última ubicación
    // ─────────────────────────────────────────────────────────────────────────

    @SuppressLint("MissingPermission")
    private fun registerLocationListener() {
        val fineOk = ContextCompat.checkSelfPermission(
            this,
            android.Manifest.permission.ACCESS_FINE_LOCATION
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        val coarseOk = ContextCompat.checkSelfPermission(
            this,
            android.Manifest.permission.ACCESS_COARSE_LOCATION
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED

        if (!fineOk && !coarseOk) {
            Log.w(TAG, "Sin permiso de ubicación; no se registra listener del servicio")
            return
        }

        locationManager = getSystemService(Context.LOCATION_SERVICE) as LocationManager

        locationListener = LocationListener { loc: Location ->
            lastLat = loc.latitude
            lastLon = loc.longitude
        }

        // Intentar GPS primero, luego red
        listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).forEach { provider ->
            try {
                locationManager?.requestLocationUpdates(
                    provider,
                    10_000L,   // cada 10 s
                    10f,       // o cada 10 m
                    locationListener!!
                )
                // Tomar última conocida inmediatamente
                locationManager?.getLastKnownLocation(provider)?.let { loc ->
                    lastLat = loc.latitude
                    lastLon = loc.longitude
                }
            } catch (_: Exception) { }
        }
    }

    private fun unregisterLocationListener() {
        locationListener?.let {
            try { locationManager?.removeUpdates(it) } catch (_: Exception) { }
        }
        locationListener = null
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Emergencia
    // ─────────────────────────────────────────────────────────────────────────

    private fun triggerEmergency() {
        if (operationId <= 0 || token.isBlank()) {
            Log.e(TAG, "No hay operación o token válido — emergencia abortada")
            emergencyPending = false
            return
        }

        val timestamp = SimpleDateFormat("HH:mm:ss dd/MM/yyyy", Locale.getDefault())
            .format(Date())

        val locationStr = if (lastLat != 0.0 || lastLon != 0.0)
            "%.6f, %.6f".format(lastLat, lastLon)
        else
            "ubicación no disponible"

        val contenido = "EMERGENCIA:\n" +
                "USUARIO: $userName\n" +
                "UBICACION: $locationStr\n" +
                "HORA: $timestamp"

        Log.d(TAG, "Enviando emergencia: $contenido")

        chatRepository.sendMessage(
            operationId = operationId,
            token       = token,
            contenido   = contenido,
            tipoMensaje = "URGENTE",
            onSuccess   = { item ->
                Log.d(TAG, "Emergencia enviada OK: ${item.optInt("id_mensaje")}")
                emergencyPending = false
            },
            onError     = { error ->
                Log.e(TAG, "Error enviando emergencia: $error")
                emergencyPending = false   // permitir reintento
            }
        )
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Notificación del ForegroundService
    // ─────────────────────────────────────────────────────────────────────────

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Servicio SEDAM",
                NotificationManager.IMPORTANCE_LOW   // discreta, sin sonido
            ).apply {
                description = "Canal operativo SEDAM"
            }
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("SEDAM – Monitor activo")
            .setContentTitle("SEDAM - Servicio activo")
            .setSmallIcon(R.mipmap.ic_launcher)   // ícono existente
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)    // no se puede cerrar con swipe
            .build()
    }
}
