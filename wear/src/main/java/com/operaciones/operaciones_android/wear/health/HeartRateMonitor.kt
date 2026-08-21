package com.operaciones.operaciones_android.wear.health

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.health.services.client.HealthServices
import androidx.health.services.client.MeasureCallback
import androidx.health.services.client.MeasureClient
import androidx.health.services.client.data.Availability
import androidx.health.services.client.data.DataPointContainer
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.DeltaDataType

class HeartRateMonitor(
    private val context: Context,
    private val onHeartRate: (Double) -> Unit,
    private val onStatus: (String) -> Unit
) {
    companion object {
        private const val TAG = "WearHeartRate"
        const val READ_HEART_RATE_PERMISSION = "android.permission.health.READ_HEART_RATE"
    }

    private val measureClient: MeasureClient =
        HealthServices.getClient(context).measureClient

    private val callback = object : MeasureCallback {
        override fun onAvailabilityChanged(
            dataType: DeltaDataType<*, *>,
            availability: Availability
        ) {
            onStatus(availability.toString())
        }

        override fun onDataReceived(data: DataPointContainer) {
            val latest = data.getData(DataType.HEART_RATE_BPM).lastOrNull()?.value ?: return
            onHeartRate(latest)
        }
    }

    private var running = false

    fun start() {
        if (running) return
        if (!hasHeartRatePermission()) {
            onStatus("Sin permiso de pulso")
            return
        }
        try {
            measureClient.registerMeasureCallback(DataType.HEART_RATE_BPM, callback)
            running = true
            onStatus("Midiendo")
        } catch (e: Exception) {
            Log.e(TAG, "No se pudo iniciar Health Services", e)
            onStatus("Pulso no disponible")
        }
    }

    fun stop() {
        if (!running) return
        runCatching {
            measureClient.unregisterMeasureCallbackAsync(DataType.HEART_RATE_BPM, callback)
        }
        running = false
    }

    private fun hasHeartRatePermission(): Boolean {
        val permission = if (Build.VERSION.SDK_INT >= 36) {
            READ_HEART_RATE_PERMISSION
        } else {
            android.Manifest.permission.BODY_SENSORS
        }
        return ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
    }
}
