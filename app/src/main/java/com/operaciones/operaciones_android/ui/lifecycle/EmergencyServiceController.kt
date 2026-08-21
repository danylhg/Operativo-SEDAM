package com.operaciones.operaciones_android.ui.lifecycle

import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.operaciones.operaciones_android.emergency.EmergencyMonitorService
import com.operaciones.operaciones_android.model.Operation
import com.operaciones.operaciones_android.model.User

class EmergencyServiceController(
    private val activity: AppCompatActivity,
    private val host: Host
) {
    interface Host {
        fun getEmergencyOperation(): Operation
        fun getEmergencyUser(): User
        fun getEmergencyToken(): String
    }

    private var serviceStarted = false

    fun hasLocationPermission(): Boolean {
        val fineOk = ContextCompat.checkSelfPermission(
            activity,
            android.Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        val coarseOk = ContextCompat.checkSelfPermission(
            activity,
            android.Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        return fineOk || coarseOk
    }

    fun start() {
        val operation = host.getEmergencyOperation()
        if (operation.id <= 0 || serviceStarted || !hasLocationPermission()) return

        val intent = buildServiceIntent(operation, host.getEmergencyUser(), host.getEmergencyToken())
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            activity.startForegroundService(intent)
        } else {
            activity.startService(intent)
        }
        serviceStarted = true
        Log.d("EMERGENCY", "EmergencyMonitorService iniciado para op=${operation.id}")
    }

    fun stop() {
        activity.stopService(Intent(activity, EmergencyMonitorService::class.java))
        serviceStarted = false
        Log.d("EMERGENCY", "EmergencyMonitorService detenido")
    }

    private fun buildServiceIntent(operation: Operation, user: User, token: String): Intent =
        Intent(activity, EmergencyMonitorService::class.java).apply {
            putExtra(EmergencyMonitorService.EXTRA_OPERATION_ID, operation.id)
            putExtra(EmergencyMonitorService.EXTRA_TOKEN, token)
            putExtra(EmergencyMonitorService.EXTRA_UNIT_CODE, operation.codigo)
            putExtra(EmergencyMonitorService.EXTRA_USER_NAME, user.nombreCompleto)
        }
}
