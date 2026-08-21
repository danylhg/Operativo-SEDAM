package com.operaciones.operaciones_android.wear.call

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import com.operaciones.operaciones_android.wear.auth.WearSession
import com.operaciones.operaciones_android.wear.emergency.WearEmergencyService

class WearCallBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (!WearSession.isLoggedIn(context)) return
        val serviceIntent = Intent(context, WearEmergencyService::class.java)
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent)
            } else {
                context.startService(serviceIntent)
            }
        }.onFailure {
            Log.e(TAG, "No se pudo restaurar el receptor de llamadas", it)
        }
    }

    private companion object {
        const val TAG = "WearCallBootReceiver"
    }
}
