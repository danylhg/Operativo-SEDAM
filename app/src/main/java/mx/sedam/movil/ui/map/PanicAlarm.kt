package mx.sedam.movil.ui.map

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.isActive
import kotlinx.coroutines.delay

/**
 * Alarma de pánico: sonido (sirena vía ToneGenerator) + vibración. Mientras
 * `active` sea true emite un patrón repetido; se detiene y libera al desactivarse
 * o al salir de la pantalla. No requiere archivos de audio.
 */
@Composable
fun PanicAlarm(active: Boolean) {
    val context = LocalContext.current
    val tone = remember { ToneGenerator(AudioManager.STREAM_ALARM, 100) }
    val vibrator = remember { getVibrator(context) }

    DisposableEffect(Unit) {
        onDispose {
            runCatching { tone.release() }
            runCatching { vibrator?.cancel() }
        }
    }

    LaunchedEffect(active) {
        if (!active) {
            runCatching { tone.stopTone() }
            runCatching { vibrator?.cancel() }
            return@LaunchedEffect
        }
        // Vibración: patrón repetido (espera-vibra-pausa) hasta cancelar. Se marca
        // como USAGE_ALARM para que NO se suprima en modo silencio / No molestar.
        runCatching {
            val pattern = longArrayOf(0, 600, 300, 600, 900) // ms
            val attrs = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator?.vibrate(VibrationEffect.createWaveform(pattern, 0), attrs) // 0 = repetir
            } else {
                @Suppress("DEPRECATION") vibrator?.vibrate(pattern, 0, attrs)
            }
        }.onFailure {
            // Fallback sin attrs por si el dispositivo rechaza esa sobrecarga.
            runCatching {
                val pattern = longArrayOf(0, 600, 300, 600, 900)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator?.vibrate(VibrationEffect.createWaveform(pattern, 0))
                } else {
                    @Suppress("DEPRECATION") vibrator?.vibrate(pattern, 0)
                }
            }
        }
        // Sonido: dos pitidos + pausa en bucle mientras haya pánico.
        while (isActive) {
            runCatching { tone.startTone(ToneGenerator.TONE_CDMA_EMERGENCY_RINGBACK, 800) }
            delay(1000)
            runCatching { tone.startTone(ToneGenerator.TONE_CDMA_HIGH_L, 400) }
            delay(1400)
        }
    }
}

/** Compartido con el ping de chat (ChatScreen.kt) para no duplicar el branching por SDK. */
fun getVibrator(context: Context): Vibrator? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
    } else {
        @Suppress("DEPRECATION") context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
    }
