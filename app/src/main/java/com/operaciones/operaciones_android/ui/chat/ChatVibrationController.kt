package com.operaciones.operaciones_android.ui.chat

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import com.operaciones.operaciones_android.model.ChatMessage
import com.operaciones.operaciones_android.model.MessageType

class ChatVibrationController(context: Context) {
    private val appContext = context.applicationContext

    fun vibrateForMessage(message: ChatMessage) {
        if (message.isMine || message.type == MessageType.SYSTEM) return

        val vibrator = getVibrator() ?: return
        if (!vibrator.hasVibrator()) return

        val cue = STRONG_MESSAGE_CUE
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createWaveform(cue.timings, cue.amplitudes, -1))
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(cue.timings, -1)
        }
    }

    @Suppress("DEPRECATION")
    private fun getVibrator(): Vibrator? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            appContext.getSystemService(VibratorManager::class.java)?.defaultVibrator
        } else {
            appContext.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }

    private data class VibrationCue(
        val timings: LongArray,
        val amplitudes: IntArray
    )

    private companion object {
        val STRONG_MESSAGE_CUE = VibrationCue(
            timings = longArrayOf(0L, 150L, 70L, 150L),
            amplitudes = intArrayOf(0, 255, 0, 255)
        )
    }
}
