package com.operaciones.operaciones_android.wear.ui

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import com.operaciones.operaciones_android.wear.R
import com.operaciones.operaciones_android.wear.auth.WearSession
import com.operaciones.operaciones_android.wear.data.WearOperationStatus
import com.operaciones.operaciones_android.wear.network.WearApiClient

class WearOperationStatusActivity : Activity() {
    private val api = WearApiClient()
    private var status = WearOperationStatus.CERRADA

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setTurnScreenOn(true)
        setShowWhenLocked(true)
        @Suppress("DEPRECATION")
        window.addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
        )
        status = WearOperationStatus.from(intent.getStringExtra(EXTRA_STATUS).orEmpty())
        render()
    }

    private fun render() {
        val title = when (status) {
            WearOperationStatus.CANCELADA -> "Operación cancelada"
            WearOperationStatus.PLANIFICADA -> "Operación no activa"
            else -> "Operación finalizada"
        }
        val message = when (status) {
            WearOperationStatus.CANCELADA -> "Tu operación asignada fue cancelada."
            WearOperationStatus.PLANIFICADA -> "Tu operación todavía no está activa."
            else -> "Tu operación asignada ya fue cerrada."
        }
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(26), dp(28), dp(26), dp(22))
            setBackgroundColor(Color.parseColor("#081113"))
            addView(TextView(this@WearOperationStatusActivity).apply {
                text = "✓"
                gravity = Gravity.CENTER
                textSize = 26f
                setTextColor(Color.parseColor("#70B4BD"))
                background = circle("#17343A")
            }, LinearLayout.LayoutParams(dp(54), dp(54)))
            addView(TextView(this@WearOperationStatusActivity).apply {
                text = title
                gravity = Gravity.CENTER
                textSize = 17f
                setTextColor(Color.parseColor("#F1F5F2"))
                setTypeface(typeface, Typeface.BOLD)
            }, matchWrap(top = 12))
            addView(TextView(this@WearOperationStatusActivity).apply {
                text = message
                gravity = Gravity.CENTER
                textSize = 11f
                setTextColor(Color.parseColor("#A5B7B3"))
            }, matchWrap(top = 5))
        })
    }

    private fun checkOperation() {
        val user = WearSession.user(this) ?: return logout()
        api.fetchAssignedOperation(
            userId = user.id,
            token = WearSession.token(this),
            onSuccess = { operation -> runOnUiThread {
                if (operation?.status == WearOperationStatus.ACTIVA) {
                    WearSession.saveOperation(this, operation)
                    startActivity(Intent(this, WearMainActivity::class.java).apply {
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
                    })
                    finish()
                } else {
                    status = operation?.status ?: WearOperationStatus.CERRADA
                    render()
                    Toast.makeText(this, "Estado actualizado", Toast.LENGTH_SHORT).show()
                }
            } },
            onError = { message -> runOnUiThread {
                Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
            } }
        )
    }

    private fun logout() {
        WearSession.clear(this)
        startActivity(Intent(this, WearMainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        })
        finish()
    }

    private fun actionButton(label: String, color: String) = Button(this).apply {
        text = label
        textSize = 9f
        setTextColor(Color.WHITE)
        isAllCaps = false
        backgroundTintList = android.content.res.ColorStateList.valueOf(Color.parseColor(color))
        setOnClickListener { }
        layoutParams = matchWrap(top = 8, height = 34)
    }

    private fun actionButton(label: String, color: String, action: () -> Unit): Button =
        actionButton(label, color).apply { setOnClickListener { action() } }

    private fun matchWrap(top: Int = 0, height: Int = ViewGroup.LayoutParams.WRAP_CONTENT) =
        LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, height).apply {
            topMargin = dp(top)
        }

    private fun circle(fill: String) = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(Color.parseColor(fill))
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        private const val EXTRA_STATUS = "operation_status"
        private const val CHANNEL_ID = "sedam_operation_status"
        private const val NOTIFICATION_ID = 8052

        fun show(context: Context, status: WearOperationStatus) {
            val intent = Intent(context, WearOperationStatusActivity::class.java).apply {
                putExtra(EXTRA_STATUS, status.name)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            }
            val pending = PendingIntent.getActivity(
                context,
                52,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val manager = context.getSystemService(NotificationManager::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                manager.createNotificationChannel(NotificationChannel(
                    CHANNEL_ID,
                    "Estado de operación",
                    NotificationManager.IMPORTANCE_HIGH
                ).apply { lockscreenVisibility = Notification.VISIBILITY_PUBLIC })
            }
            @Suppress("DEPRECATION")
            context.getSystemService(PowerManager::class.java).newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
                "SEDAM:OperationClosed"
            ).apply {
                setReferenceCounted(false)
                acquire(10_000L)
            }
            manager.notify(NOTIFICATION_ID, Notification.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_watch_notification)
                .setContentTitle(if (status == WearOperationStatus.CANCELADA) "Operación cancelada" else "Operación finalizada")
                .setContentText("Tu operación asignada ya no está activa")
                .setCategory(Notification.CATEGORY_STATUS)
                .setPriority(Notification.PRIORITY_HIGH)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setContentIntent(pending)
                .setFullScreenIntent(pending, true)
                .build())
        }
    }
}
