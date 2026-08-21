package com.operaciones.operaciones_android.wear.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import com.caverock.androidsvg.SVG

class MilitarySymbolRenderer(private val context: Context) {
    private val bitmaps = mutableMapOf<String, Bitmap?>()

    fun bitmap(sidc: String): Bitmap? =
        bitmaps.getOrPut(sidc) {
            runCatching {
                val filename = sidc.lowercase().replace('-', '_') + ".svg"
                val svg = SVG.getFromAsset(context.assets, "mil_symbols/$filename")
                val picture = svg.renderToPicture()
                val width = picture.width.coerceAtLeast(1)
                val height = picture.height.coerceAtLeast(1)
                Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).also { bitmap ->
                    Canvas(bitmap).drawPicture(picture)
                }
            }.getOrNull()
        }

    fun destroy() {
        bitmaps.values.filterNotNull().forEach(Bitmap::recycle)
        bitmaps.clear()
    }
}
