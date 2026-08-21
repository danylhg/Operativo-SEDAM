package com.operaciones.operaciones_android.wear.bridge

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import android.util.Log
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import org.json.JSONObject
import com.operaciones.operaciones_android.wear.R
import com.operaciones.operaciones_android.wear.auth.WearSession
import com.operaciones.operaciones_android.wear.call.WearIncomingCallActivity

class WearPhoneListenerService : WearableListenerService() {
    override fun onMessageReceived(messageEvent: MessageEvent) {
        if (messageEvent.path == PATH_VOICE_CALL) {
            showVoiceCall(this, JSONObject(String(messageEvent.data, Charsets.UTF_8)))
            return
        }
        if (messageEvent.path != WearPhoneSessionSync.PATH_SESSION_SYNC) {
            super.onMessageReceived(messageEvent)
            return
        }

        runCatching {
            val payload = JSONObject(String(messageEvent.data, Charsets.UTF_8))
            WearPhoneSessionSync.apply(this, payload)
        }.onFailure {
            Log.e("WearPhoneListener", "No se pudo aplicar sesion del telefono", it)
        }
    }

    companion object {
        const val PATH_VOICE_CALL = "/sedam/voice-call"
        const val PATH_VOICE_CALL_ACTION = "/sedam/voice-call/action"
        private const val CALL_CHANNEL = "sedam_voice_calls"
        private const val CALL_NOTIFICATION_ID = 8041

        fun showVoiceCall(context: android.content.Context, payload: JSONObject) {
        val user = WearSession.user(context) ?: return
        val targetId = payload.optInt("to_personal_id", user.id)
        if (targetId != user.id) return
        val event = payload.optString("event")
        val manager = context.getSystemService(NotificationManager::class.java)
        if (event != "voice_call_invite") {
            manager.cancel(CALL_NOTIFICATION_ID)
            WearIncomingCallActivity.finishCall(payload.optString("call_id"))
            return
        }

        val powerManager = context.getSystemService(PowerManager::class.java)
        @Suppress("DEPRECATION")
        powerManager.newWakeLock(
            PowerManager.SCREEN_BRIGHT_WAKE_LOCK or
                PowerManager.ACQUIRE_CAUSES_WAKEUP or
                PowerManager.ON_AFTER_RELEASE,
            "SEDAM:IncomingCallScreen"
        ).apply {
            setReferenceCounted(false)
            acquire(15_000L)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(
                    CALL_CHANNEL,
                    "Llamadas SEDAM",
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = "Llamadas de voz entrantes"
                    enableVibration(true)
                    vibrationPattern = longArrayOf(0, 500, 250, 500, 250, 700)
                    lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                }
            )
        }
        val intent = Intent(context, WearIncomingCallActivity::class.java).apply {
            putExtra("call_id", payload.optString("call_id"))
            putExtra("caller_name", payload.optString("caller_name", "Contacto"))
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
            )
        }
        val pending = PendingIntent.getActivity(
            context,
            41,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = Notification.Builder(context, CALL_CHANNEL)
            .setSmallIcon(R.drawable.ic_watch_notification)
            .setContentTitle("Llamada de ${payload.optString("caller_name", "Contacto")}")
            .setContentText("Toca para responder")
            .setCategory(Notification.CATEGORY_CALL)
            .setPriority(Notification.PRIORITY_MAX)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setContentIntent(pending)
            .setFullScreenIntent(pending, true)
            .build()
        manager.notify(CALL_NOTIFICATION_ID, notification)
        }
    }
}
