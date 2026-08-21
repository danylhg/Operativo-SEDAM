package com.operaciones.operaciones_android.ui.chat

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.operaciones.operaciones_android.R
import com.operaciones.operaciones_android.model.ChatMessage
import com.operaciones.operaciones_android.model.MessageType
import com.operaciones.operaciones_android.ui.MainActivity
import java.util.concurrent.atomic.AtomicInteger

class ChatNotificationController(context: Context) {
    private val appContext = context.applicationContext
    private val notificationManager =
        appContext.getSystemService(NotificationManager::class.java)
    private val fallbackId = AtomicInteger(FALLBACK_NOTIFICATION_ID)

    init {
        createChannels()
    }

    fun showNewMessage(message: ChatMessage, operationName: String) {
        if (message.isMine || message.type == MessageType.SYSTEM) return
        if (!canPostNotifications()) return

        val isEmergency = message.type == MessageType.ALERT
        val channelId = if (isEmergency) EMERGENCY_CHANNEL_ID else CHAT_CHANNEL_ID
        val title = if (isEmergency) {
            "EMERGENCIA - ${message.user}"
        } else {
            "Nuevo mensaje - ${message.user}"
        }
        val content = messagePreview(message)
        val color = if (isEmergency) EMERGENCY_RED else CHAT_BLUE

        val notification = NotificationCompat.Builder(appContext, channelId)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(content)
            .setSubText(operationName.takeIf { it.isNotBlank() })
            .setStyle(NotificationCompat.BigTextStyle().bigText(content))
            .setAutoCancel(true)
            .setContentIntent(openAppIntent())
            .setCategory(if (isEmergency) NotificationCompat.CATEGORY_ALARM else NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(if (isEmergency) NotificationCompat.PRIORITY_MAX else NotificationCompat.PRIORITY_HIGH)
            .setColor(color)
            .setColorized(isEmergency)
            .setLights(color, 400, 900)
            .build()

        notificationManager.notify(notificationIdFor(message), notification)
    }

    fun cancelMessage(message: ChatMessage) {
        notificationManager.cancel(notificationIdFor(message))
    }

    fun cancelMessages(messages: Iterable<ChatMessage>) {
        messages.forEach { cancelMessage(it) }
    }

    private fun createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

        val chatChannel = NotificationChannel(
            CHAT_CHANNEL_ID,
            "Mensajes SEDAM",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Avisos de mensajes nuevos del chat operativo"
            enableLights(true)
            lightColor = CHAT_BLUE
        }

        val emergencyChannel = NotificationChannel(
            EMERGENCY_CHANNEL_ID,
            "Emergencias SEDAM",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Alertas urgentes y mensajes de emergencia"
            enableLights(true)
            lightColor = EMERGENCY_RED
            vibrationPattern = longArrayOf(0L, 150L, 70L, 150L)
            enableVibration(true)
        }

        notificationManager.createNotificationChannels(listOf(chatChannel, emergencyChannel))
    }

    private fun canPostNotifications(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(appContext, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED

    private fun openAppIntent(): PendingIntent {
        val intent = Intent(appContext, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        return PendingIntent.getActivity(
            appContext,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun messagePreview(message: ChatMessage): String {
        val text = message.text.trim()
        if (text.isNotBlank()) return text

        return when (message.attachmentKind.orEmpty().uppercase()) {
            "IMAGE" -> "Envio una imagen"
            "VIDEO" -> "Envio un video"
            "AUDIO" -> "Envio un audio"
            else -> "Envio un adjunto"
        }
    }

    private fun notificationIdFor(message: ChatMessage): Int =
        message.id?.let { CHAT_NOTIFICATION_ID_BASE + it }
            ?: fallbackIdsByKey.getOrPut(notificationKeyFor(message)) {
                fallbackId.getAndIncrement()
            }

    private fun notificationKeyFor(message: ChatMessage): String =
        listOf(
            message.idUsuario,
            message.idPersonal,
            message.user,
            message.text,
            message.type.name,
            message.attachmentUrl,
            message.attachmentName
        ).joinToString("|")

    private companion object {
        private const val CHAT_CHANNEL_ID = "sedam_chat_messages"
        private const val EMERGENCY_CHANNEL_ID = "sedam_chat_emergencies"
        private const val CHAT_NOTIFICATION_ID_BASE = 20_000
        private const val FALLBACK_NOTIFICATION_ID = 90_000
        private val CHAT_BLUE = Color.rgb(37, 99, 235)
        private val EMERGENCY_RED = Color.rgb(220, 38, 38)
    }

    private val fallbackIdsByKey = mutableMapOf<String, Int>()
}
