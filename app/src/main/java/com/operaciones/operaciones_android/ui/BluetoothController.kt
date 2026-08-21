package com.operaciones.operaciones_android.ui

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.bluetooth.*
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.LayoutInflater
import android.widget.ImageButton
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.core.app.ActivityCompat
import com.operaciones.operaciones_android.R
import com.operaciones.operaciones_android.auth.AuthManager
import com.operaciones.operaciones_android.config.ApiConfig
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException
import java.util.UUID

/** Conecta un pulsador BLE PTT-Z01 y alterna la alerta con cada pulsacion. */
class BluetoothController(
    private val activity: Activity,
    private val btnBluetooth: ImageButton
) {
    private enum class ConnectionUiState { DISCONNECTED, SEARCHING, CONNECTING, CONFIGURING, CONNECTED, ERROR }

    companion object {
        const val REQUEST_BLUETOOTH_PERMISSIONS = 7401
        private const val TAG = "BlePttZ01"
        private const val DISPLAY_NAME = "PTT"
        private const val PREFS = "ble_ptt"
        private const val PREF_ADDRESS = "device_address"
        private const val PREF_ALIAS = "device_alias"
        private const val SCAN_TIMEOUT_MS = 15_000L
        private const val DEBOUNCE_MS = 350L
        private val SERVICE_UUID = UUID.fromString("0000ffe0-0000-1000-8000-00805f9b34fb")
        private val BUTTON_UUID = UUID.fromString("0000ffe1-0000-1000-8000-00805f9b34fb")
        private val CCCD_UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    }

    private val context: Context = activity
    private val handler = Handler(Looper.getMainLooper())
    private val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    private val adapter get() = manager.adapter
    private val http = OkHttpClient()
    private val discoveredPtts = linkedMapOf<String, ScanResult>()
    private var gatt: BluetoothGatt? = null
    private var scanning = false
    private var connectAfterPermission = false
    private var lastPressAt = 0L
    private var statusView: TextView? = null
    private var pttToggleView: TextView? = null
    private var dialog: AlertDialog? = null
    @Volatile private var connectionUiState = ConnectionUiState.DISCONNECTED
    private var selectionScheduled = false
    private val displayName: String
        get() = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(PREF_ALIAS, null)?.takeIf { it.isNotBlank() } ?: DISPLAY_NAME

    var isConnected = false
        private set
    var connectedDeviceName: String? = null
        private set
    var isAlertActive = false
        private set
    var onPttAlertTriggered: ((active: Boolean) -> Unit)? = null

    init {
        btnBluetooth.setOnClickListener { showBluetoothDialog() }
        btnBluetooth.setOnLongClickListener { showBluetoothDialog(); true }
        updateButtonVisuals()
        reconnectSavedDevice()
    }

    fun onPermissionsResult(granted: Boolean) {
        if (granted && connectAfterPermission) startScan()
        else if (!granted) {
            setStatus("Permiso Bluetooth denegado", "#EF4444")
            toast("Se requiere permiso Bluetooth para conectar el $DISPLAY_NAME")
        }
        connectAfterPermission = false
    }

    fun destroy() {
        stopScan()
        gatt?.disconnect()
        gatt?.close()
        gatt = null
        dialog?.dismiss()
    }

    fun togglePttAlert(active: Boolean) {
        if (isAlertActive == active) return
        isAlertActive = active
        updateButtonVisuals()
        onPttAlertTriggered?.invoke(active)
    }

    private fun physicalPress() {
        val now = System.currentTimeMillis()
        if (now - lastPressAt < DEBOUNCE_MS) return
        lastPressAt = now
        val active = !isAlertActive
        togglePttAlert(active)
        toast(if (active) "ALERTA PTT ACTIVADA" else "Alerta PTT cancelada")
    }

    private fun setConnected(connected: Boolean, name: String? = null) {
        isConnected = connected
        connectedDeviceName = if (connected) displayName else null
        connectionUiState = if (connected) ConnectionUiState.CONNECTED else ConnectionUiState.DISCONNECTED
        updateButtonVisuals()
        updateDialogToggle()
        setStatus(
            if (connected) "Conectado: $connectedDeviceName" else "PTT desconectado",
            if (connected) "#38BDF8" else "#94A3B8"
        )
    }

    private fun updateButtonVisuals() = handler.post {
        when {
            isAlertActive -> {
                btnBluetooth.setBackgroundResource(R.drawable.bg_bluetooth_button_connected)
                btnBluetooth.setColorFilter(Color.parseColor("#EF4444"))
            }
            isConnected -> {
                btnBluetooth.setBackgroundResource(R.drawable.bg_bluetooth_button_connected)
                btnBluetooth.setColorFilter(Color.parseColor("#38BDF8"))
            }
            else -> {
                btnBluetooth.setBackgroundResource(R.drawable.bg_bluetooth_button)
                btnBluetooth.setColorFilter(Color.parseColor("#F8FAFC"))
            }
        }
    }

    private fun showBluetoothDialog() {
        val view = LayoutInflater.from(context).inflate(R.layout.dialog_bluetooth_selector, null)
        statusView = null
        val pttToggle = view.findViewById<TextView>(R.id.btnOptionPtt)
        pttToggleView = pttToggle
        updateDialogToggle()
        setStatus(
            if (isConnected) "Conectado" else "Desconectado",
            if (isConnected) "#38BDF8" else "#94A3B8"
        )

        val alert = AlertDialog.Builder(context).setView(view).create()
        alert.window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        alert.setOnDismissListener {
            if (dialog === alert) {
                dialog = null
                statusView = null
                pttToggleView = null
            }
        }
        dialog = alert
        pttToggle.setOnClickListener {
            when (connectionUiState) {
                ConnectionUiState.CONNECTED -> disconnectAndForget()
                ConnectionUiState.SEARCHING,
                ConnectionUiState.CONNECTING,
                ConnectionUiState.CONFIGURING -> {
                    disconnectAndForget()
                    toast("Conexión con $DISPLAY_NAME cancelada")
                }
                else -> connectPtt()
            }
        }
        alert.show()
        val density = context.resources.displayMetrics.density
        val width = minOf(
            (420 * density).toInt(),
            context.resources.displayMetrics.widthPixels - (48 * density).toInt()
        )
        alert.window?.setLayout(width, android.view.WindowManager.LayoutParams.WRAP_CONTENT)
    }

    private fun updateDialogToggle() = handler.post {
        pttToggleView?.text = when (connectionUiState) {
            ConnectionUiState.SEARCHING -> "$displayName    BUSCANDO..."
            ConnectionUiState.CONNECTING -> "$displayName    CONECTANDO..."
            ConnectionUiState.CONFIGURING -> "$displayName    CONFIGURANDO..."
            ConnectionUiState.CONNECTED -> "$displayName    DESCONECTAR"
            ConnectionUiState.ERROR -> "$displayName    REINTENTAR"
            ConnectionUiState.DISCONNECTED -> "$displayName    CONECTAR"
        }
    }

    private fun setConnectionUiState(state: ConnectionUiState) {
        connectionUiState = state
        updateDialogToggle()
    }

    private fun connectPtt() {
        if (adapter == null) return setStatus("Este equipo no tiene Bluetooth", "#EF4444")
        if (!adapter.isEnabled) {
            setStatus("Activa Bluetooth en la tablet", "#EF4444")
            return toast("Activa Bluetooth y vuelve a intentarlo")
        }
        if (!hasPermissions()) {
            connectAfterPermission = true
            requestPermissions()
            return
        }
        startScan()
    }

    @SuppressLint("MissingPermission")
    private fun startScan() {
        if (scanning) return
        val scanner = adapter?.bluetoothLeScanner
            ?: return setStatus("No se pudo iniciar BLE", "#EF4444")
        gatt?.close()
        gatt = null
        setConnected(false)
        discoveredPtts.clear()
        selectionScheduled = false
        scanning = true
        setConnectionUiState(ConnectionUiState.SEARCHING)
        setStatus("Buscando $DISPLAY_NAME... presiónalo una vez", "#FBBF24")
        scanner.startScan(scanCallback)
        handler.postDelayed({
            if (scanning) {
                stopScan()
                setConnectionUiState(ConnectionUiState.ERROR)
                setStatus("No se encontró. Presiona el PTT y reintenta", "#EF4444")
            }
        }, SCAN_TIMEOUT_MS)
    }

    @SuppressLint("MissingPermission")
    private fun stopScan() {
        if (!scanning || !hasPermissions()) return
        adapter?.bluetoothLeScanner?.stopScan(scanCallback)
        scanning = false
    }

    private val scanCallback = object : ScanCallback() {
        @SuppressLint("MissingPermission")
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            val name = result.device.name ?: result.scanRecord?.deviceName ?: return
            if (!name.startsWith("PTT", true)) return
            discoveredPtts[result.device.address] = result
            if (!selectionScheduled) {
                selectionScheduled = true
                handler.postDelayed({ finishScanAndSelect() }, 1_800L)
            }
        }

        override fun onScanFailed(errorCode: Int) {
            scanning = false
            setConnectionUiState(ConnectionUiState.ERROR)
            setStatus("Error de búsqueda BLE ($errorCode)", "#EF4444")
        }
    }

    @SuppressLint("MissingPermission")
    private fun finishScanAndSelect() {
        if (!scanning) return
        stopScan()
        val results = discoveredPtts.values.sortedByDescending { it.rssi }
        if (results.isEmpty()) {
            setConnectionUiState(ConnectionUiState.ERROR)
            toast("No se encontró ningún PTT")
            return
        }
        val labels = results.map {
            val name = it.device.name ?: it.scanRecord?.deviceName ?: "PTT"
            "$name   ·   ${it.device.address.takeLast(5)}   ·   ${it.rssi} dBm"
        }.toTypedArray()
        AlertDialog.Builder(context)
            .setTitle("Selecciona el PTT de este usuario")
            .setItems(labels) { _, index -> assignAndConnect(results[index]) }
            .setNegativeButton("CANCELAR") { _, _ -> setConnectionUiState(ConnectionUiState.DISCONNECTED) }
            .show()
    }

    @SuppressLint("MissingPermission")
    private fun assignAndConnect(result: ScanResult) {
        setConnectionUiState(ConnectionUiState.CONNECTING)
        val address = result.device.address
        val advertised = result.device.name ?: result.scanRecord?.deviceName ?: "PTT"
        val payload = JSONObject().put("bluetooth_address", address).put("advertised_name", advertised)
        val request = Request.Builder()
            .url("${ApiConfig.BASE_URL}/ptt/assignments")
            .addHeader("Authorization", "Bearer ${AuthManager.getToken(context)}")
            .post(payload.toString().toRequestBody("application/json".toMediaType()))
            .build()
        http.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                setConnectionUiState(ConnectionUiState.ERROR)
                toast("No se pudo registrar el PTT: ${e.message}")
            }

            override fun onResponse(call: Call, response: Response) {
                val json = runCatching { JSONObject(response.body?.string().orEmpty()) }.getOrNull()
                if (!response.isSuccessful || json?.optBoolean("ok") != true) {
                    setConnectionUiState(ConnectionUiState.ERROR)
                    toast(json?.optString("mensaje")?.takeIf { it.isNotBlank() } ?: "No se pudo asignar el PTT")
                    return
                }
                val alias = json.optJSONObject("item")?.optString("alias")?.takeIf { it.isNotBlank() } ?: DISPLAY_NAME
                context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                    .putString(PREF_ADDRESS, address)
                    .putString(PREF_ALIAS, alias)
                    .apply()
                updateDialogToggle()
                handler.post { gatt = result.device.connectGatt(context, false, gattCallback) }
            }
        })
    }

    private val gattCallback = object : BluetoothGattCallback() {
        @SuppressLint("MissingPermission")
        override fun onConnectionStateChange(deviceGatt: BluetoothGatt, status: Int, newState: Int) {
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    gatt = deviceGatt
                    setConnectionUiState(ConnectionUiState.CONFIGURING)
                    setStatus("Conectado. Configurando botón...", "#FBBF24")
                    deviceGatt.discoverServices()
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    deviceGatt.close()
                    if (gatt === deviceGatt) gatt = null
                    setConnected(false)
                    if (savedAddress() != null) handler.postDelayed({ reconnectSavedDevice() }, 1_000L)
                }
            }
            if (status != BluetoothGatt.GATT_SUCCESS) Log.w(TAG, "GATT status=$status state=$newState")
        }

        @SuppressLint("MissingPermission")
        override fun onServicesDiscovered(deviceGatt: BluetoothGatt, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                setConnectionUiState(ConnectionUiState.ERROR)
                setStatus("No se pudieron leer los servicios PTT", "#EF4444")
                return
            }
            val characteristic = deviceGatt.getService(SERVICE_UUID)?.getCharacteristic(BUTTON_UUID)
                ?: deviceGatt.services.flatMap { it.characteristics }.firstOrNull { it.uuid == BUTTON_UUID }
            if (characteristic == null) {
                setConnectionUiState(ConnectionUiState.ERROR)
                setStatus("El dispositivo no expone FFE1", "#EF4444")
                return
            }
            deviceGatt.setCharacteristicNotification(characteristic, true)
            val descriptor = characteristic.getDescriptor(CCCD_UUID)
            if (descriptor == null) {
                setConnectionUiState(ConnectionUiState.ERROR)
                setStatus("El PTT no permite notificaciones", "#EF4444")
                return
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                deviceGatt.writeDescriptor(descriptor, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
            } else {
                @Suppress("DEPRECATION")
                descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                @Suppress("DEPRECATION")
                deviceGatt.writeDescriptor(descriptor)
            }
        }

        override fun onDescriptorWrite(deviceGatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
            if (descriptor.uuid != CCCD_UUID) return
            val ok = status == BluetoothGatt.GATT_SUCCESS
            if (ok) setConnected(true, displayName) else setConnectionUiState(ConnectionUiState.ERROR)
            setStatus(if (ok) "$displayName listo: cada pulsación activa/cancela" else "No se pudo activar el botón PTT", if (ok) "#38BDF8" else "#EF4444")
            if (ok) toast("$displayName conectado y listo")
        }

        @Deprecated("Deprecated in API 33")
        override fun onCharacteristicChanged(deviceGatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            handleValue(characteristic.uuid, characteristic.value)
        }

        override fun onCharacteristicChanged(deviceGatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
            handleValue(characteristic.uuid, value)
        }
    }

    private fun handleValue(uuid: UUID, value: ByteArray?) {
        if (uuid != BUTTON_UUID || value == null || value.isEmpty()) return
        Log.d(TAG, "FFE1=${value.joinToString { "%02X".format(it) }}")
        if ((value[0].toInt() and 0xFF) == 1) handler.post { physicalPress() }
    }

    @SuppressLint("MissingPermission")
    private fun reconnectSavedDevice() {
        if (!hasPermissions() || adapter?.isEnabled != true || gatt != null) return
        val address = savedAddress() ?: return
        runCatching {
            setConnectionUiState(ConnectionUiState.CONNECTING)
            gatt = adapter?.getRemoteDevice(address)?.connectGatt(context, true, gattCallback)
            setStatus("Esperando al $displayName...", "#FBBF24")
        }.onFailure {
            setConnectionUiState(ConnectionUiState.ERROR)
            Log.w(TAG, "No se pudo reconectar", it)
        }
    }

    @SuppressLint("MissingPermission")
    private fun disconnectAndForget() {
        stopScan()
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(PREF_ADDRESS).apply()
        gatt?.disconnect()
        gatt?.close()
        gatt = null
        if (isAlertActive) togglePttAlert(false)
        setConnected(false)
        toast("$displayName desconectado")
    }

    private fun hasPermissions(): Boolean = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        ActivityCompat.checkSelfPermission(activity, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED &&
            ActivityCompat.checkSelfPermission(activity, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
    } else {
        ActivityCompat.checkSelfPermission(activity, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    }

    private fun requestPermissions() = ActivityCompat.requestPermissions(
        activity,
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
            arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        else arrayOf(Manifest.permission.ACCESS_FINE_LOCATION),
        REQUEST_BLUETOOTH_PERMISSIONS
    )

    private fun savedAddress() = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(PREF_ADDRESS, null)
    private fun saveAddress(address: String) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(PREF_ADDRESS, address).apply()
    private fun setStatus(text: String, color: String) {
        handler.post {
            statusView?.text = text
            statusView?.setTextColor(Color.parseColor(color))
        }
    }

    private fun toast(text: String) {
        handler.post { Toast.makeText(context, text, Toast.LENGTH_SHORT).show() }
    }
}
