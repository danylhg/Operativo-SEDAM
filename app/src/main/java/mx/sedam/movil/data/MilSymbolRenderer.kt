package mx.sedam.movil.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.util.LruCache
import android.util.SparseArray
import armyc2.c2sd.renderer.MilStdIconRenderer
import armyc2.c2sd.renderer.utilities.MilStdAttributes
import armyc2.c2sd.renderer.utilities.ModifiersUnits
import armyc2.c2sd.renderer.utilities.RendererSettings
import kotlin.math.roundToInt

/** Símbolo renderizado + su ancla (centro del frame, no del bitmap). */
data class SymbolIcon(val bitmap: Bitmap, val anchorU: Float, val anchorV: Float)

/**
 * Renderiza símbolos MIL-STD-2525C desde un SIDC con el renderer oficial armyc2
 * (mil-sym-android-renderer 0.2.1, paquete armyc2.c2sd). El rumbo se dibuja con el
 * indicador NATIVO de "dirección de movimiento" (modifier Q), igual que milsymbol
 * en el web-system. Cachea por SIDC (+ rumbo) para no re-renderizar.
 */
object MilSymbolRenderer {

    @Volatile
    private var inited = false
    private val cache = LruCache<String, Bitmap>(128)
    private val iconCache = LruCache<String, SymbolIcon>(256)

    fun init(context: Context) {
        if (inited) return
        synchronized(this) {
            if (!inited) {
                MilStdIconRenderer.getInstance()
                    .init(context.applicationContext, context.cacheDir.absolutePath)
                RendererSettings.getInstance().symbologyStandard = RendererSettings.Symbology_2525C
                inited = true
            }
        }
    }

    /** Símbolo simple (sin dirección), para la lista del cajón. */
    fun bitmapFor(sidc: String, sizePx: Int = 96): Bitmap? {
        if (!inited) return null
        val code = normalizeSidc(sidc)
        val key = "$code@$sizePx"
        cache.get(key)?.let { return it }
        val attributes = SparseArray<String>().apply {
            put(MilStdAttributes.PixelSize, sizePx.toString())
            put(MilStdAttributes.KeepUnitRatio, "true")
        }
        return runCatching {
            MilStdIconRenderer.getInstance().RenderIcon(code, SparseArray(), attributes)?.image
        }.getOrNull()?.also { cache.put(key, it) }
    }

    /**
     * Símbolo con la dirección de movimiento (indicador MIL-STD estándar, como el
     * web). Devuelve el ancla real (centro del frame) porque el indicador desplaza
     * los bordes del bitmap. Cacheado por SIDC + rumbo redondeado a 5°.
     */
    fun iconFor(sidc: String, course: Float, panic: Boolean = false, sizePx: Int = 96): SymbolIcon? {
        if (!inited) return null
        val code = normalizeSidc(sidc)
        val deg = ((course % 360f) + 360f) % 360f
        val bucket = ((deg / 5f).roundToInt() % 72) * 5
        val key = "$code@$sizePx@$bucket@$panic"
        iconCache.get(key)?.let { return it }

        val modifiers = SparseArray<String>().apply {
            put(ModifiersUnits.Q_DIRECTION_OF_MOVEMENT, bucket.toString())
        }
        val attributes = SparseArray<String>().apply {
            put(MilStdAttributes.PixelSize, sizePx.toString())
            put(MilStdAttributes.KeepUnitRatio, "true")
        }
        return runCatching {
            val raw = MilStdIconRenderer.getInstance().RenderIcon(code, modifiers, attributes)
                ?: return@runCatching null
            // El bitmap crudo puede quedar NO cuadrado/asimétrico (el indicador de
            // dirección recorta los bordes de forma distinta según el rumbo), y su
            // centerPoint puede no corresponder linealmente al ancho/alto del bitmap
            // devuelto. getSquareImageInfo() centra correctamente el punto de anclaje
            // en un lienzo cuadrado.
            val ii = raw.squareImageInfo ?: raw
            val bmp = ii.image ?: return@runCatching null
            val cp = ii.centerPoint
            if (panic) withPanicHalo(bmp, cp.x, cp.y, sizePx)
            else SymbolIcon(bmp, cp.x.toFloat() / bmp.width, cp.y.toFloat() / bmp.height)
        }.getOrNull()?.also { iconCache.put(key, it) }
    }

    /** Halo rojo alrededor del frame (unidad en pánico); recalcula el ancla. */
    private fun withPanicHalo(symbol: Bitmap, cx: Int, cy: Int, sizePx: Int): SymbolIcon {
        val pad = sizePx / 2
        val out = Bitmap.createBitmap(symbol.width + pad * 2, symbol.height + pad * 2, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        val fx = (cx + pad).toFloat()
        val fy = (cy + pad).toFloat()
        val r = sizePx * 0.55f
        canvas.drawCircle(fx, fy, r, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x55E5636B })
        canvas.drawCircle(fx, fy, r, Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = 0xFFE5636B.toInt(); style = Paint.Style.STROKE; strokeWidth = 5f
        })
        canvas.drawBitmap(symbol, pad.toFloat(), pad.toFloat(), null)
        return SymbolIcon(out, fx / out.width, fy / out.height)
    }

    /**
     * Normaliza a los 15 chars del 2525C. Los datos SEDAM traen SIDC de 15 y de
     * 18 (dashes extra, p.ej. "SFGPUCIN-------MXN"): primeros 8 + relleno + país/OB.
     */
    private fun normalizeSidc(s: String): String = when {
        s.length == 15 -> s
        s.length > 15 -> s.take(8) + "----" + s.takeLast(3)
        else -> s.padEnd(15, '-')
    }
}
