package com.operaciones.operaciones_android.ui.chat

import android.graphics.Color
import android.view.View
import android.view.ViewGroup
import android.view.animation.AlphaAnimation
import android.view.animation.Animation
import androidx.appcompat.app.AppCompatActivity

class EmergencyVisualAlertController(
    private val activity: AppCompatActivity
) {
    private var flashOverlay: View? = null

    fun flashScreen() {
        activity.runOnUiThread {
            removeFlashOverlay()

            val overlay = View(activity).apply {
                setBackgroundColor(FLASH_RED)
                alpha = 0f
                isClickable = false
                isFocusable = false
            }
            flashOverlay = overlay

            activity.addContentView(
                overlay,
                ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
            )

            overlay.startAnimation(
                AlphaAnimation(0f, 0.72f).apply {
                    duration = 120L
                    repeatMode = Animation.REVERSE
                    repeatCount = 7
                    setAnimationListener(object : Animation.AnimationListener {
                        override fun onAnimationStart(animation: Animation?) = Unit
                        override fun onAnimationRepeat(animation: Animation?) = Unit
                        override fun onAnimationEnd(animation: Animation?) {
                            removeFlashOverlay()
                        }
                    })
                }
            )
        }
    }

    private fun removeFlashOverlay() {
        val overlay = flashOverlay ?: return
        flashOverlay = null
        overlay.clearAnimation()
        (overlay.parent as? ViewGroup)?.removeView(overlay)
    }

    private companion object {
        val FLASH_RED: Int = Color.argb(155, 255, 0, 0)
    }
}
