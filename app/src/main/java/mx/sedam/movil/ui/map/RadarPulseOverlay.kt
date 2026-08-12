package mx.sedam.movil.ui.map

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Point
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.MapView
import org.osmdroid.views.Projection
import org.osmdroid.views.overlay.Overlay

/**
 * Ondas de radar animadas (expansivas) sobre las unidades en pánico, con el mismo
 * look que la pantalla de "enlace establecido": varios anillos que crecen y se
 * desvanecen. Ancladas geográficamente: siguen a la unidad durante paneo/zoom.
 *
 * Se auto-invalida (~30 fps) mientras haya puntos; al quedar vacío deja de pedir
 * redibujos y no consume recursos.
 */
class RadarPulseOverlay(private val mapView: MapView) : Overlay() {

    /** Posiciones (lat/lng) de las unidades en pánico a resaltar. */
    @Volatile
    var points: List<GeoPoint> = emptyList()

    private val periodMs = 1600L
    private val rings = 3
    private val maxRadiusPx = 140f
    private val minRadiusPx = 20f
    private val startTime = System.currentTimeMillis()
    private val pt = Point()

    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 7f
    }
    // Núcleo sólido al centro: visible de inmediato, incluso antes de que los
    // anillos hayan crecido o si el mapa está muy alejado.
    private val core = Paint(Paint.ANTI_ALIAS_FLAG)

    override fun draw(canvas: Canvas, projection: Projection) {
        val list = points

        if (list.isEmpty()) return

        val t = ((System.currentTimeMillis() - startTime) % periodMs) / periodMs.toFloat()
        // Núcleo con su propio pulso de tamaño/opacidad, independiente de los anillos.
        val coreT = if (t < 0.5f) t * 2f else (1f - t) * 2f // sube y baja dentro del período
        val coreRadius = minRadiusPx * (0.7f + 0.3f * coreT)
        val coreAlpha = (200 + 55 * coreT).toInt()

        list.forEach { gp ->
            projection.toPixels(gp, pt)
            val cx = pt.x.toFloat()
            val cy = pt.y.toFloat()
            core.color = 0xE5636B or (coreAlpha shl 24)
            canvas.drawCircle(cx, cy, coreRadius, core)
            for (k in 0 until rings) {
                val phase = (t + k.toFloat() / rings) % 1f
                val radius = minRadiusPx + (maxRadiusPx - minRadiusPx) * phase
                val fade = 1f - phase // se desvanece al expandirse
                // Anillo + relleno tenue (rojo alerta #E5636B).
                stroke.color = 0xE5636B or ((fade * 255).toInt() shl 24)
                fill.color = 0xE5636B or ((fade * 90).toInt() shl 24)
                canvas.drawCircle(cx, cy, radius, fill)
                canvas.drawCircle(cx, cy, radius, stroke)
            }
        }
        mapView.postInvalidateDelayed(33) // ~30 fps mientras haya pánico
    }
}
