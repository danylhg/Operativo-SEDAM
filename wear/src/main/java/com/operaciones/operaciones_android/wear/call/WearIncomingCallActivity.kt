package com.operaciones.operaciones_android.wear.call

import android.app.Activity
import android.app.NotificationManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.content.Intent
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView
import com.google.android.gms.wearable.Wearable
import com.operaciones.operaciones_android.wear.bridge.WearPhoneListenerService
import com.operaciones.operaciones_android.wear.R
import com.operaciones.operaciones_android.wear.emergency.WearEmergencyService
import org.json.JSONObject

class WearIncomingCallActivity : Activity() {
    private var callId = ""
    private var caller = "Contacto"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setTurnScreenOn(true)
        setShowWhenLocked(true)
        @Suppress("DEPRECATION")
        window.addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
        )
        applyCallIntent(intent)
        activeInstance = this
        renderIncoming()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        applyCallIntent(intent)
        renderIncoming()
    }

    private fun applyCallIntent(intent: Intent) {
        callId = intent.getStringExtra("call_id").orEmpty()
        caller = intent.getStringExtra("caller_name").orEmpty().ifBlank { "Contacto" }
    }

    private fun renderIncoming() {
        setContentView(callContent(
            status = null,
            leftLabel = "Rechazar",
            leftColor = "#A92D3C",
            leftIcon = R.drawable.ic_call_reject,
            leftAction = { sendAction("reject", close = true) },
            rightLabel = "Aceptar",
            rightColor = "#18725F",
            rightIcon = R.drawable.ic_call_accept,
            rightAction = {
                sendAction("accept", close = false)
                renderActiveCall()
            }
        ))
    }

    private fun renderActiveCall() {
        setContentView(callContent(
            status = "Llamada en curso",
            leftLabel = null,
            leftColor = "#1B344E",
            leftIcon = R.drawable.ic_call_reject,
            leftAction = {},
            rightLabel = "Finalizar",
            rightColor = "#A92D3C",
            rightIcon = R.drawable.ic_call_reject,
            rightAction = { sendAction("end", close = true) }
        ))
    }

    private fun callContent(
        status: String?,
        leftLabel: String?,
        leftColor: String,
        leftIcon: Int,
        leftAction: () -> Unit,
        rightLabel: String,
        rightColor: String,
        rightIcon: Int,
        rightAction: () -> Unit
    ): LinearLayout {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(18), dp(18), dp(18), dp(14))
            setBackgroundColor(Color.parseColor("#07111F"))
        }
        root.addView(TextView(this).apply {
            text = initials(caller)
            gravity = Gravity.CENTER
            textSize = 22f
            setTextColor(Color.WHITE)
            setTypeface(typeface, Typeface.BOLD)
            background = circle("#1E4D78", "#69B4FF")
            layoutParams = LinearLayout.LayoutParams(dp(62), dp(62))
        })
        root.addView(TextView(this).apply {
            text = caller
            gravity = Gravity.CENTER
            textSize = 17f
            maxLines = 2
            setTextColor(Color.parseColor("#F4F8FF"))
            setTypeface(typeface, Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(10) }
        })
        if (status != null) {
            root.addView(TextView(this).apply {
                text = status
                gravity = Gravity.CENTER
                textSize = 12f
                setTextColor(Color.parseColor("#9DB2CC"))
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                ).apply { topMargin = dp(3) }
            })
        }
        val actions = LinearLayout(this).apply {
            gravity = Gravity.CENTER
            orientation = LinearLayout.HORIZONTAL
        }
        if (leftLabel != null) {
            actions.addView(actionButton(leftLabel, leftColor, leftIcon, false, leftAction))
        }
        val rightButton = actionButton(rightLabel, rightColor, rightIcon, false, rightAction)
        actions.addView(rightButton)
        root.addView(actions, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            dp(52)
        ).apply { topMargin = if (status == null) dp(18) else dp(14) })
        return root
    }

    private fun actionButton(
        label: String,
        color: String,
        icon: Int,
        showLabel: Boolean,
        action: () -> Unit
    ) =
        LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            addView(ImageButton(this@WearIncomingCallActivity).apply {
                setImageResource(icon)
                setColorFilter(Color.WHITE)
                setPadding(dp(14), dp(14), dp(14), dp(14))
                contentDescription = label
                background = circle(color, color)
                setOnClickListener { action() }
            }, LinearLayout.LayoutParams(dp(48), dp(48)))
            if (showLabel) {
                addView(TextView(this@WearIncomingCallActivity).apply {
                    text = label
                    textSize = 10f
                    gravity = Gravity.CENTER
                    setTextColor(Color.parseColor("#D9E5F2"))
                }, LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT
                ).apply { topMargin = dp(3) })
            }
            layoutParams = LinearLayout.LayoutParams(0, if (showLabel) dp(68) else dp(52), 1f).apply {
                marginStart = dp(5)
                marginEnd = dp(5)
            }
        }

    private fun sendAction(action: String, close: Boolean) {
        val serviceIntent = Intent(this, WearEmergencyService::class.java).apply {
            this.action = WearEmergencyService.ACTION_VOICE_CALL
            putExtra(WearEmergencyService.EXTRA_CALL_ID, callId)
            putExtra(WearEmergencyService.EXTRA_CALL_ACTION, action)
        }
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent)
        } else {
            startService(serviceIntent)
        }
        val bytes = JSONObject()
            .put("call_id", callId)
            .put("action", action)
            .toString()
            .toByteArray(Charsets.UTF_8)
        Wearable.getNodeClient(this).connectedNodes.addOnSuccessListener { nodes ->
            nodes.forEach { node ->
                Wearable.getMessageClient(this).sendMessage(
                    node.id,
                    WearPhoneListenerService.PATH_VOICE_CALL_ACTION,
                    bytes
                )
            }
        }
        getSystemService(NotificationManager::class.java).cancel(8041)
        if (close) finish()
    }

    private fun initials(name: String): String = name.trim().split(Regex("\\s+"))
        .filter { it.isNotBlank() }.take(2).joinToString("") { it.take(1).uppercase() }

    private fun circle(fill: String, stroke: String) = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(Color.parseColor(fill))
        setStroke(dp(2), Color.parseColor(stroke))
    }

    private fun rounded(fill: String) = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        cornerRadius = dp(12).toFloat()
        setColor(Color.parseColor(fill))
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    override fun onDestroy() {
        if (activeInstance === this) activeInstance = null
        super.onDestroy()
    }

    companion object {
        @Volatile
        var actionHandler: ((String, String) -> Unit)? = null
        @Volatile
        private var activeInstance: WearIncomingCallActivity? = null

        fun finishCall(callId: String) {
            val activity = activeInstance?.takeIf { it.callId == callId } ?: return
            activity.runOnUiThread { activity.finish() }
        }
    }
}
