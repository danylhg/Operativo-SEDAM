package com.operaciones.operaciones_android.ui.navigation

import android.graphics.Color
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.annotation.DrawableRes
import androidx.core.content.ContextCompat
import com.operaciones.operaciones_android.R

class PanelNavigationController(
    private val panelContent: FrameLayout,
    private val btnNavOperation: LinearLayout,
    private val btnNavChat: LinearLayout,
    private val btnNavPersonal: LinearLayout,
    private val btnNavVehiculos: LinearLayout,
    private val btnNavEquipos: LinearLayout,
    private val btnNavDispositivos: LinearLayout,
    private val userLabel: String,
    private val host: Host
) {

    enum class Panel {
        NONE,
        OPERATION,
        CHAT,
        PERSONAL,
        VEHICULOS,
        EQUIPOS,
        DISPOSITIVOS
    }

    interface Host {
        fun inflateOperationPanel()
        fun inflateChatPanel()
        fun inflateResourcesPanel()
        fun inflatePersonalPanel()
        fun inflateVehiculoPanel()
        fun inflateEquipoPanel()
        fun inflateDispositivoPanel()
        fun requestLogout()
        fun onPanelChanged(panel: Panel)
    }

    var activePanel: Panel = Panel.NONE
        private set

    fun setupNavigation() {
        applyCompactMapNavigation()
        btnNavOperation.setOnClickListener { togglePanel(Panel.OPERATION) }
        btnNavChat.setOnClickListener { togglePanel(Panel.CHAT) }
        btnNavPersonal.setOnClickListener { togglePanel(Panel.PERSONAL) }
        btnNavVehiculos.setOnClickListener { togglePanel(Panel.VEHICULOS) }
        btnNavEquipos.setOnClickListener { togglePanel(Panel.EQUIPOS) }
        btnNavDispositivos.setOnClickListener { host.requestLogout() }
    }

    fun togglePanel(panel: Panel) {
        showPanel(if (activePanel == panel) Panel.NONE else panel)
    }

    fun showPanel(panel: Panel) {
        activePanel = panel
        panelContent.removeAllViews()

        setNavActive(btnNavOperation, panel == Panel.OPERATION)
        setNavActive(btnNavChat, panel == Panel.CHAT)
        setNavActive(btnNavPersonal, panel == Panel.PERSONAL)
        setNavActive(btnNavVehiculos, panel == Panel.VEHICULOS)
        setNavActive(btnNavEquipos, panel == Panel.EQUIPOS)
        setNavActive(btnNavDispositivos, false)

        if (panel == Panel.NONE) {
            panelContent.visibility = View.GONE
            host.onPanelChanged(panel)
            return
        }

        panelContent.visibility = View.VISIBLE
        host.onPanelChanged(panel)

        when (panel) {
            Panel.OPERATION -> host.inflateOperationPanel()
            Panel.CHAT -> host.inflateChatPanel()
            Panel.PERSONAL -> host.inflateResourcesPanel()
            Panel.VEHICULOS -> host.inflateVehiculoPanel()
            Panel.EQUIPOS -> host.inflateEquipoPanel()
            Panel.DISPOSITIVOS -> host.inflateDispositivoPanel()
            Panel.NONE -> {}
        }
    }

    private fun setNavActive(btn: LinearLayout, active: Boolean) {
        val color = if (active) ACTIVE_COLOR else INACTIVE_COLOR
        findIconView(btn)?.setColorFilter(color)
        (btn.getChildAt(1) as? TextView)?.setTextColor(color)
        btn.setBackgroundResource(if (active) R.drawable.bg_nav_item_active else 0)
    }

    private fun applyCompactMapNavigation() {
        styleNavButton(btnNavOperation, R.drawable.ic_nav_operation, "Operación")
        styleNavButton(btnNavChat, R.drawable.ic_nav_chat, "Mensajes")
        styleNavButton(btnNavPersonal, R.drawable.ic_nav_resources, "Recursos")
        btnNavDispositivos.visibility = View.GONE

        btnNavVehiculos.visibility = View.GONE
        btnNavEquipos.visibility = View.GONE
    }

    private fun styleNavButton(btn: LinearLayout, @DrawableRes iconRes: Int, label: String) {
        ensureIconView(btn).apply {
            setImageDrawable(ContextCompat.getDrawable(btn.context, iconRes))
            setColorFilter(INACTIVE_COLOR)
            scaleType = ImageView.ScaleType.CENTER_INSIDE

            if (parent is FrameLayout) {
                layoutParams = FrameLayout.LayoutParams(dp(22), dp(22), Gravity.BOTTOM or Gravity.START)
            } else {
                layoutParams = LinearLayout.LayoutParams(dp(22), dp(27))
            }
        }

        (btn.getChildAt(1) as? TextView)?.apply {
            text = label
            textSize = 10f
            setTextColor(INACTIVE_COLOR)
            gravity = Gravity.CENTER
            includeFontPadding = false
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = dp(2)
                marginStart = dp(4)
                marginEnd = dp(4)
            }
        }
    }

    private fun ensureIconView(btn: LinearLayout): ImageView {
        findIconView(btn)?.let { return it }

        val iconView = ImageView(btn.context).apply {
            layoutParams = LinearLayout.LayoutParams(dp(20), dp(20))
            scaleType = ImageView.ScaleType.CENTER_INSIDE
        }

        btn.removeViewAt(0)
        btn.addView(iconView, 0)
        return iconView
    }

    private fun findIconView(btn: LinearLayout): ImageView? {
        val firstChild = btn.getChildAt(0)
        if (firstChild is ImageView) return firstChild
        return firstChild?.findViewById(R.id.iconNavChat)
    }

    private fun dp(value: Int): Int {
        return (value * panelContent.resources.displayMetrics.density).toInt()
    }

    private companion object {
        val ACTIVE_COLOR: Int = Color.parseColor("#62A8FF")
        val INACTIVE_COLOR: Int = Color.parseColor("#7F93AE")
    }
}
