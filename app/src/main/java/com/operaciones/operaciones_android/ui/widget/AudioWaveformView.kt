package com.operaciones.operaciones_android.ui.widget

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View
import kotlin.math.roundToInt

class AudioWaveformView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : View(context, attrs) {

    private val levels = intArrayOf(8, 14, 21, 11, 18, 25, 13, 20, 9, 23, 16, 27, 12, 19, 24, 10, 16, 22, 13, 26, 18, 11, 21, 15)
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        strokeCap = Paint.Cap.ROUND
    }
    private val idleColor = Color.parseColor("#66858D")
    private val playedColor = Color.parseColor("#59C7D8")

    var progress: Float = 0f
        set(value) {
            field = value.coerceIn(0f, 1f)
            invalidate()
        }

    var onSeekRequested: ((Float) -> Unit)? = null

    init {
        isClickable = true
        isFocusable = true
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (width <= 0 || height <= 0) return
        val spacing = width.toFloat() / levels.size
        paint.strokeWidth = (spacing * 0.42f).coerceAtLeast(2f)
        val centerY = height / 2f
        val playedBars = (levels.size * progress).roundToInt()

        levels.forEachIndexed { index, level ->
            val barHeight = (level / 28f) * (height * 0.78f)
            val x = spacing * index + spacing / 2f
            paint.color = if (index < playedBars) playedColor else idleColor
            canvas.drawLine(x, centerY - barHeight / 2f, x, centerY + barHeight / 2f, paint)
        }
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (event.action == MotionEvent.ACTION_DOWN || event.action == MotionEvent.ACTION_MOVE) {
            progress = (event.x / width.coerceAtLeast(1)).coerceIn(0f, 1f)
            onSeekRequested?.invoke(progress)
            return true
        }
        if (event.action == MotionEvent.ACTION_UP) {
            performClick()
            return true
        }
        return super.onTouchEvent(event)
    }

    override fun performClick(): Boolean {
        super.performClick()
        return true
    }
}
