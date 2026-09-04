package com.operaciones.operaciones_android.map

import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.AdapterView
import android.widget.EditText
import android.widget.ArrayAdapter
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.Spinner
import android.widget.TextView
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.text.InputType
import android.text.Editable
import android.text.TextWatcher
import androidx.appcompat.app.AlertDialog
import com.operaciones.operaciones_android.model.ChatMessage
import com.operaciones.operaciones_android.model.User
import com.operaciones.operaciones_android.webview.CesiumWebController
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MapActionController(
    private val host: Host,
    private val cesiumWebController: CesiumWebController
) {
    data class MilitarySymbolChoice(
        val identityLabel: String,
        val dimensionLabel: String,
        val unitLabel: String,
        val sidc: String
    )


    private fun buildMilUniqueName(baseName: String): String {
        val normalizedBase = baseName.trim().ifBlank { "Simbolo MIL" }
        val stamp = SimpleDateFormat("yyyyMMddHHmmssSSS", Locale.US).format(Date())
        return "$normalizedBase $stamp"
    }

    companion object {
        private const val COLOR_MIL_DEFAULT = "#FF4500"

        val COLORES_POI = listOf(
            "Amarillo" to "#FFD700",
            "Rojo" to "#FF4500",
            "Azul" to "#00BFFF",
            "Verde" to "#00FF88",
            "Naranja" to "#FF8C00",
            "Blanco" to "#FFFFFF",
            "Morado" to "#9400D3",
            "Rosa" to "#FF69B4"
        )

        val TIPOS_POI = listOf(
            "PDI" to "Punto de Interes",
            "MIL" to "Simbolo Militar"
        )

        val MIL_IDENTITIES = listOf(
            "Amigo (Friend)" to "F",
            "Hostil" to "H",
            "Neutral" to "N",
            "Desconocido" to "U"
        )

        val MIL_DIMENSIONS = listOf(
            "Tierra" to "G",
            "Aire" to "A",
            "Mar" to "S",
            "Subsuperficie" to "U"
        )

        val SIMBOLOS_MIL_TIERRA = listOf(
            "Infanteria" to "UCI---",
            "Unidad Blindada" to "UCD---",
            "Artilleria de Campo" to "UCA---",
            "Reconocimiento" to "UCR---",
            "Ingenieros" to "UCJ---",
            "Medica" to "UCM---",
            "Comunicaciones" to "UCM---",
            "Punto de Control" to "IP----",
            "Base / Cuartel" to "IB----",
            "Radar" to "IR----"
        )

        val SIMBOLOS_MIL_AIRE = listOf(
            "Ala fija" to "MFF---",
            "Helicoptero" to "MH----",
            "Dron / UAV" to "MFQ---",
            "Reconocimiento aereo" to "MFR---"
        )

        val SIMBOLOS_MIL_MAR = listOf(
            "Combatiente" to "C-----",
            "Buque de linea" to "CL----",
            "Portaaviones" to "CLCV--",
            "Destructor" to "CLDD--",
            "Fragata / Corbeta" to "CLFF--"
        )

        val SIMBOLOS_MIL_SUBSUPERFICIE = listOf(
            "Submarino" to "S-----",
            "Submarino convencional" to "SC----",
            "UUV / Vehiculo submarino no tripulado" to "SU----",
            "Arma submarina" to "W-----"
        )
    }

    private fun getMilSymbolsForDimension(dimension: String): List<Pair<String, String>> =
        when (dimension) {
            "A" -> SIMBOLOS_MIL_AIRE
            "S" -> SIMBOLOS_MIL_MAR
            "U" -> SIMBOLOS_MIL_SUBSUPERFICIE
            else -> SIMBOLOS_MIL_TIERRA
        }

    private fun buildMilSidc(identity: String, dimension: String, icon: String): String {
        val safeIcon = icon.padEnd(6, '-').take(6)
        return "S${identity}${dimension}P${safeIcon}-----"
    }

    interface Host {
        fun getContext(): android.content.Context
        fun addMessage(msg: ChatMessage)
        fun openChatPanel()
        fun isChatPanelActive(): Boolean
        fun savePoi(
            lat: Double,
            lon: Double,
            nombre: String,
            tipoPoi: String,
            color: String,
            iconoSrc: String? = null
        )
        fun updatePoi(
            poiId: Int,
            nombre: String,
            tipoPoi: String,
            color: String,
            iconoSrc: String? = null
        )
        fun clearRouteOnBackend()
    }

    fun showMapActionDialog(
        currentUser: User,
        lat: Double,
        lon: Double
    ) {
        val context = host.getContext()
        val density = context.resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()
        fun bg(fill: String, stroke: String, radius: Int = 10) = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dp(radius).toFloat()
            setColor(Color.parseColor(fill))
            setStroke(dp(1), Color.parseColor(stroke))
        }
        fun action(title: String, subtitle: String, icon: String): LinearLayout =
            LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(12), dp(8), dp(12), dp(8))
                background = bg("#071B31", "#2A4766", 9)
                isClickable = true
                isFocusable = true
                addView(TextView(context).apply {
                    text = icon
                    textSize = 22f
                    gravity = Gravity.CENTER
                    setTextColor(Color.parseColor("#E4B943"))
                }, LinearLayout.LayoutParams(dp(28), dp(44)))
                addView(LinearLayout(context).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(dp(8), 0, 0, 0)
                    addView(TextView(context).apply {
                        text = title
                        textSize = 13f
                        typeface = Typeface.DEFAULT_BOLD
                        setTextColor(Color.parseColor("#F1F6FC"))
                    })
                    addView(TextView(context).apply {
                        text = subtitle
                        textSize = 10f
                        setTextColor(Color.parseColor("#849AB4"))
                    })
                }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            }

        val content = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(12), dp(14), dp(14))
            background = bg("#F2071B30", "#31506F", 14)
        }
        content.addView(TextView(context).apply {
            text = "CREAR EN ESTE PUNTO"
            textSize = 11f
            letterSpacing = .12f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#E4C456"))
        })
        content.addView(TextView(context).apply {
            text = String.format(Locale.US, "%.5f, %.5f", lat, lon)
            textSize = 10f
            setTextColor(Color.parseColor("#8EA3BA"))
            setPadding(0, dp(5), 0, dp(10))
        })
        val waypoint = action("Waypoint", "Punto táctico de referencia", "●")
        val target = action("Blanco", "Objetivo / contacto", "⚑").apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(6) }
        }
        content.addView(waypoint)
        content.addView(target)
        val dialog = AlertDialog.Builder(context).setView(content).create()
        waypoint.setOnClickListener { dialog.dismiss(); showPointForm(false, lat, lon) }
        target.setOnClickListener { dialog.dismiss(); showPointForm(true, lat, lon) }
        dialog.setOnShowListener {
            dialog.window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            dialog.window?.setDimAmount(.32f)
            dialog.window?.setLayout(dp(374), ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        dialog.show()
    }

    private fun showPointForm(isTarget: Boolean, lat: Double, lon: Double) {
        val context = host.getContext()
        val density = context.resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()
        fun bg(fill: String, stroke: String, radius: Int = 7) = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dp(radius).toFloat()
            setColor(Color.parseColor(fill))
            setStroke(dp(1), Color.parseColor(stroke))
        }
        fun label(value: String) = TextView(context).apply {
            text = value
            textSize = 9f
            letterSpacing = .12f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#9BB0C7"))
            setPadding(0, dp(10), 0, dp(5))
        }
        fun choice(textValue: String) = TextView(context).apply {
            text = textValue
            textSize = 10f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setTextColor(Color.parseColor("#AFC4DB"))
            background = bg("#071B31", "#42617F")
            isClickable = true
        }
        val root = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(12), dp(14), dp(12))
            background = bg("#F2071B30", "#31506F", 13)
        }
        root.addView(TextView(context).apply {
            text = if (isTarget) "Nuevo Blanco" else "Nuevo Waypoint"
            textSize = 14f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            setPadding(0, 0, 0, dp(12))
        })
        val previewName = TextView(context).apply {
            text = "Sin nombre"
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#F7FAFF"))
            maxLines = 1
        }
        val previewSidc = TextView(context).apply {
            textSize = 9f
            setTextColor(Color.parseColor("#7890AB"))
            maxLines = 1
        }
        val preview = WebView(context).apply {
            setBackgroundColor(Color.TRANSPARENT)
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
            settings.javaScriptEnabled = true
            webViewClient = WebViewClient()
            loadDataWithBaseURL(
                "file:///android_asset/",
                """
                <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
                <script src="milsymbol.min.js"></script><style>html,body,#symbol{width:100%;height:100%;margin:0;background:transparent;overflow:hidden}#symbol{display:flex;align-items:center;justify-content:center}svg{max-width:58px;max-height:58px}</style>
                </head><body><div id="symbol"></div><script>
                function render(sidc){var e=document.getElementById('symbol');try{var colors={F:'#F7FAFF',H:'#FF3347',N:'#00F53D',U:'#FFF000'};var waypoint=sidc.charAt(0)==='G';var options=waypoint?{size:46,monoColor:colors[sidc.charAt(1)]||'#FFF000',fill:false}:{size:46,colorMode:'Light',fill:true};var s=new ms.Symbol(sidc,options);e.innerHTML=s.asSVG()||'';}catch(x){e.innerHTML='';}}
                </script></body></html>
                """.trimIndent(),
                "text/html",
                "UTF-8",
                null
            )
        }
        root.addView(LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(8), dp(6), dp(10), dp(6))
            background = bg("#091D38", "#173452")
            addView(preview, LinearLayout.LayoutParams(dp(62), dp(62)))
            addView(LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(8), 0, 0, 0)
                addView(TextView(context).apply {
                    text = "Vista previa MIL-STD-2525C"
                    textSize = 9f
                    setTextColor(Color.parseColor("#849AB4"))
                })
                addView(previewName)
                addView(previewSidc)
            }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(76)))
        val name = EditText(context).apply {
            hint = "Nombre"
            setHintTextColor(Color.parseColor("#849AB4"))
            setTextColor(Color.WHITE)
            textSize = 13f
            setSingleLine(true)
            setPadding(dp(10), 0, dp(10), 0)
            background = bg("#182C43", "#3C5874")
        }
        root.addView(name, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(42)).apply { topMargin = dp(12) })

        val identities = listOf("Amigo", "Hostil", "Neutral", "Desconocido")
        val options = if (isTarget) listOf("Superficie", "Tierra", "Aire", "Submarino") else listOf("Referencia", "Ruta", "Acción")
        root.addView(label("IDENTIDAD"))
        val identityRow = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
        var identity = if (isTarget) "Desconocido" else "Amigo"
        var selectedOption = if (isTarget) "Tierra" else "Referencia"
        fun currentSidc(): String {
            val affiliation = when (identity) { "Amigo" -> "F"; "Hostil" -> "H"; "Neutral" -> "N"; else -> "U" }
            if (!isTarget) {
                val waypointCode = when (selectedOption) {
                    "Ruta" -> "GPOW"
                    "Acción" -> "GPPW"
                    else -> "GPRW"
                }
                return "G${affiliation}GP${waypointCode}---X"
            }
            val dimension = when (selectedOption) { "Aire" -> "A"; "Submarino" -> "U"; "Superficie" -> "S"; else -> "G" }
            return "S${affiliation}${dimension}P-----------"
        }
        fun updatePreview() {
            val sidc = currentSidc()
            previewSidc.text = sidc
            preview.evaluateJavascript("render('$sidc')", null)
        }
        val identityViews = mutableListOf<TextView>()
        identities.forEach { value ->
            val view = choice(value)
            identityViews += view
            identityRow.addView(view, LinearLayout.LayoutParams(0, dp(32), 1f).apply { if (identityViews.size > 1) marginStart = dp(4) })
            view.setOnClickListener {
                identity = value
                identityViews.forEach {
                    it.background = bg("#071B31", "#42617F")
                    it.setTextColor(Color.parseColor("#D7E5F3"))
                }
                view.background = bg("#D9B041", "#E4C456")
                view.setTextColor(Color.parseColor("#17263A"))
                updatePreview()
            }
        }
        root.addView(identityRow)
        identityViews[if (isTarget) 3 else 0].performClick()

        root.addView(label(if (isTarget) "PLATAFORMA" else "TIPO"))
        val optionRow = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
        val optionViews = mutableListOf<TextView>()
        options.forEach { value ->
            val view = choice(value)
            optionViews += view
            optionRow.addView(view, LinearLayout.LayoutParams(0, dp(32), 1f).apply { if (optionViews.size > 1) marginStart = dp(4) })
            view.setOnClickListener {
                selectedOption = value
                optionViews.forEach {
                    it.background = bg("#071B31", "#42617F")
                    it.setTextColor(Color.parseColor("#D7E5F3"))
                }
                view.background = bg("#D9B041", "#E4C456")
                view.setTextColor(Color.parseColor("#17263A"))
                updatePreview()
            }
        }
        root.addView(optionRow)
        optionViews[if (isTarget) 1 else 0].performClick()

        if (isTarget) {
            val metrics = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
            listOf("Rumbo (°)", "Vel. (km/h)").forEachIndexed { index, hintValue ->
                metrics.addView(EditText(context).apply {
                    hint = hintValue
                    inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
                    setHintTextColor(Color.parseColor("#849AB4"))
                    setTextColor(Color.WHITE)
                    textSize = 12f
                    setPadding(dp(10), 0, dp(10), 0)
                    background = bg("#182C43", "#3C5874")
                }, LinearLayout.LayoutParams(0, dp(42), 1f).apply { topMargin = dp(12); if (index > 0) marginStart = dp(6) })
            }
            root.addView(metrics)
        }
        root.addView(TextView(context).apply {
            text = String.format(Locale.US, "%.5f, %.5f", lat, lon)
            textSize = 9f
            setTextColor(Color.parseColor("#849AB4"))
            setPadding(0, dp(9), 0, dp(6))
        })
        val actions = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.END }
        val cancel = choice("CANCELAR").apply { background = ColorDrawable(Color.TRANSPARENT); setTextColor(Color.parseColor("#AFC4DB")) }
        val create = choice("CREAR").apply { background = bg("#29415C", "#35506B"); setTextColor(Color.parseColor("#90A4BA")) }
        create.isEnabled = false
        create.alpha = .55f
        name.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                previewName.text = s?.toString()?.trim()?.ifBlank { "Sin nombre" } ?: "Sin nombre"
                val enabled = !s.isNullOrBlank()
                create.isEnabled = enabled
                create.alpha = if (enabled) 1f else .55f
                create.background = if (enabled) bg("#D9B041", "#E4C456") else bg("#29415C", "#35506B")
                create.setTextColor(Color.parseColor(if (enabled) "#17263A" else "#90A4BA"))
            }
            override fun afterTextChanged(s: Editable?) = Unit
        })
        actions.addView(cancel, LinearLayout.LayoutParams(dp(86), dp(38)))
        actions.addView(create, LinearLayout.LayoutParams(dp(72), dp(38)).apply { marginStart = dp(5) })
        root.addView(actions)
        val dialog = AlertDialog.Builder(context).setView(root).create()
        cancel.setOnClickListener { dialog.dismiss() }
        create.setOnClickListener {
            val pointName = name.text.toString().trim()
            if (pointName.isBlank()) { name.error = "Escribe un nombre"; return@setOnClickListener }
            val color = when (identity) { "Amigo" -> "#39A8FF"; "Hostil" -> "#FF4D5E"; "Neutral" -> "#54D18B"; else -> "#E4B943" }
            val sidc = currentSidc()
            host.savePoi(lat, lon, pointName, if (isTarget) "MIL" else "PDI", color, sidc)
            dialog.dismiss()
        }
        dialog.setOnShowListener {
            dialog.window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            dialog.window?.setDimAmount(.32f)
            dialog.window?.setLayout(dp(374), ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        dialog.show()
        preview.postDelayed({ updatePreview() }, 250)
    }

    fun showEditPointForm(poiId: Int, isTarget: Boolean, lat: Double, lon: Double, currentName: String, currentIdentity: String, currentOption: String) {
        val context = host.getContext()
        val density = context.resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()
        fun bg(fill: String, stroke: String, radius: Int = 7) = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dp(radius).toFloat()
            setColor(Color.parseColor(fill))
            setStroke(dp(1), Color.parseColor(stroke))
        }
        fun label(value: String) = TextView(context).apply {
            text = value
            textSize = 9f
            letterSpacing = .12f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#9BB0C7"))
            setPadding(0, dp(10), 0, dp(5))
        }
        fun choice(textValue: String) = TextView(context).apply {
            text = textValue
            textSize = 10f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setTextColor(Color.parseColor("#AFC4DB"))
            background = bg("#071B31", "#42617F")
            isClickable = true
        }
        val root = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(12), dp(14), dp(12))
            background = bg("#F2071B30", "#31506F", 13)
        }
        root.addView(TextView(context).apply {
            text = if (isTarget) "Editar Blanco" else "Editar Waypoint"
            textSize = 14f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.WHITE)
            setPadding(0, 0, 0, dp(12))
        })
        val previewName = TextView(context).apply {
            text = currentName.ifBlank { "Sin nombre" }
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(Color.parseColor("#F7FAFF"))
            maxLines = 1
        }
        val previewSidc = TextView(context).apply {
            textSize = 9f
            setTextColor(Color.parseColor("#7890AB"))
            maxLines = 1
        }
        val preview = android.webkit.WebView(context).apply {
            setBackgroundColor(Color.TRANSPARENT)
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
            settings.javaScriptEnabled = true
            webViewClient = android.webkit.WebViewClient()
            loadDataWithBaseURL(
                "file:///android_asset/",
                """
                <!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
                <script src="milsymbol.min.js"></script><style>html,body,#symbol{width:100%;height:100%;margin:0;background:transparent;overflow:hidden}#symbol{display:flex;align-items:center;justify-content:center}svg{max-width:58px;max-height:58px}</style>
                </head><body><div id="symbol"></div><script>
                function render(sidc){var e=document.getElementById('symbol');try{var colors={F:'#F7FAFF',H:'#FF3347',N:'#00F53D',U:'#FFF000'};var waypoint=sidc.charAt(0)==='G';var options=waypoint?{size:46,monoColor:colors[sidc.charAt(1)]||'#FFF000',fill:false}:{size:46,colorMode:'Light',fill:true};var s=new ms.Symbol(sidc,options);e.innerHTML=s.asSVG()||'';}catch(x){e.innerHTML='';}}
                </script></body></html>
                """.trimIndent(),
                "text/html",
                "UTF-8",
                null
            )
        }
        root.addView(LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(8), dp(6), dp(10), dp(6))
            background = bg("#091D38", "#173452")
            addView(preview, LinearLayout.LayoutParams(dp(62), dp(62)))
            addView(LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(8), 0, 0, 0)
                addView(TextView(context).apply {
                    text = "Vista previa MIL-STD-2525C"
                    textSize = 9f
                    setTextColor(Color.parseColor("#849AB4"))
                })
                addView(previewName)
                addView(previewSidc)
            }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(76)))
        val name = EditText(context).apply {
            setText(currentName)
            hint = "Nombre"
            setHintTextColor(Color.parseColor("#849AB4"))
            setTextColor(Color.WHITE)
            textSize = 13f
            setSingleLine(true)
            setPadding(dp(10), 0, dp(10), 0)
            background = bg("#182C43", "#3C5874")
        }
        root.addView(name, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(42)).apply { topMargin = dp(12) })

        val identities = listOf("Amigo", "Hostil", "Neutral", "Desconocido")
        val options = if (isTarget) listOf("Superficie", "Tierra", "Aire", "Submarino") else listOf("Referencia", "Ruta", "Acción")
        root.addView(label("IDENTIDAD"))
        val identityRow = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
        var identity = currentIdentity.ifBlank { if (isTarget) "Desconocido" else "Amigo" }
        var selectedOption = currentOption.ifBlank { if (isTarget) "Tierra" else "Referencia" }
        fun currentSidc(): String {
            val affiliation = when (identity) { "Amigo" -> "F"; "Hostil" -> "H"; "Neutral" -> "N"; else -> "U" }
            if (!isTarget) {
                val waypointCode = when (selectedOption) {
                    "Ruta" -> "GPOW"
                    "Acción" -> "GPPW"
                    else -> "GPRW"
                }
                return "G${affiliation}GP${waypointCode}---X"
            }
            val dimension = when (selectedOption) { "Aire" -> "A"; "Submarino" -> "U"; "Superficie" -> "S"; else -> "G" }
            return "S${affiliation}${dimension}P-----------"
        }
        fun updatePreview() {
            val sidc = currentSidc()
            previewSidc.text = sidc
            preview.evaluateJavascript("render('$sidc')", null)
        }
        val identityViews = mutableListOf<TextView>()
        identities.forEach { value ->
            val view = choice(value)
            identityViews += view
            identityRow.addView(view, LinearLayout.LayoutParams(0, dp(32), 1f).apply { if (identityViews.size > 1) marginStart = dp(4) })
            view.setOnClickListener {
                identity = value
                identityViews.forEach {
                    it.background = bg("#071B31", "#42617F")
                    it.setTextColor(Color.parseColor("#D7E5F3"))
                }
                view.background = bg("#D9B041", "#E4C456")
                view.setTextColor(Color.parseColor("#17263A"))
                updatePreview()
            }
        }
        root.addView(identityRow)
        identityViews.firstOrNull { it.text.toString().equals(identity, ignoreCase = true) }?.performClick()
            ?: identityViews[if (isTarget) 3 else 0].performClick()

        root.addView(label(if (isTarget) "PLATAFORMA" else "TIPO"))
        val optionRow = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
        val optionViews = mutableListOf<TextView>()
        options.forEach { value ->
            val view = choice(value)
            optionViews += view
            optionRow.addView(view, LinearLayout.LayoutParams(0, dp(32), 1f).apply { if (optionViews.size > 1) marginStart = dp(4) })
            view.setOnClickListener {
                selectedOption = value
                optionViews.forEach {
                    it.background = bg("#071B31", "#42617F")
                    it.setTextColor(Color.parseColor("#D7E5F3"))
                }
                view.background = bg("#D9B041", "#E4C456")
                view.setTextColor(Color.parseColor("#17263A"))
                updatePreview()
            }
        }
        root.addView(optionRow)
        optionViews.firstOrNull { it.text.toString().equals(selectedOption, ignoreCase = true) }?.performClick()
            ?: optionViews[if (isTarget) 1 else 0].performClick()

        if (isTarget) {
            val metrics = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
            listOf("Rumbo (°)", "Vel. (km/h)").forEachIndexed { index, hintValue ->
                metrics.addView(EditText(context).apply {
                    hint = hintValue
                    inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL
                    setHintTextColor(Color.parseColor("#849AB4"))
                    setTextColor(Color.WHITE)
                    textSize = 12f
                    setPadding(dp(10), 0, dp(10), 0)
                    background = bg("#182C43", "#3C5874")
                }, LinearLayout.LayoutParams(0, dp(42), 1f).apply { topMargin = dp(12); if (index > 0) marginStart = dp(6) })
            }
            root.addView(metrics)
        }
        root.addView(TextView(context).apply {
            text = String.format(Locale.US, "%.5f, %.5f", lat, lon)
            textSize = 9f
            setTextColor(Color.parseColor("#849AB4"))
            setPadding(0, dp(9), 0, dp(6))
        })
        val actions = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.END }
        val cancel = choice("CANCELAR").apply { background = ColorDrawable(Color.TRANSPARENT); setTextColor(Color.parseColor("#AFC4DB")) }
        val create = choice("GUARDAR").apply { background = bg("#D9B041", "#E4C456"); setTextColor(Color.parseColor("#17263A")) }
        name.addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                previewName.text = s?.toString()?.trim()?.ifBlank { "Sin nombre" } ?: "Sin nombre"
                val enabled = !s.isNullOrBlank()
                create.isEnabled = enabled
                create.alpha = if (enabled) 1f else .55f
                create.background = if (enabled) bg("#D9B041", "#E4C456") else bg("#29415C", "#35506B")
                create.setTextColor(Color.parseColor(if (enabled) "#17263A" else "#90A4BA"))
            }
            override fun afterTextChanged(s: android.text.Editable?) = Unit
        })
        actions.addView(cancel, LinearLayout.LayoutParams(dp(86), dp(38)))
        actions.addView(create, LinearLayout.LayoutParams(dp(82), dp(38)).apply { marginStart = dp(5) })
        root.addView(actions)
        val dialog = AlertDialog.Builder(context).setView(root).create()
        cancel.setOnClickListener { dialog.dismiss() }
        create.setOnClickListener {
            val pointName = name.text.toString().trim()
            if (pointName.isBlank()) { name.error = "Escribe un nombre"; return@setOnClickListener }
            val color = when (identity) { "Amigo" -> "#39A8FF"; "Hostil" -> "#FF4D5E"; "Neutral" -> "#54D18B"; else -> "#E4B943" }
            val sidc = currentSidc()
            host.updatePoi(poiId, pointName, if (isTarget) "MIL" else "PDI", color, sidc)
            dialog.dismiss()
        }
        dialog.setOnShowListener {
            dialog.window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            dialog.window?.setDimAmount(.32f)
            dialog.window?.setLayout(dp(374), ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        dialog.show()
        preview.postDelayed({ updatePreview() }, 250)
    }

    fun showMilitarySymbolPicker(onSelected: (MilitarySymbolChoice) -> Unit) {
        val context = host.getContext()
        val density = context.resources.displayMetrics.density
        fun dp(value: Int): Int = (value * density).toInt()
        fun roundedBg(color: String, strokeColor: String, radius: Int, strokeWidth: Int = 1): GradientDrawable =
            GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = dp(radius).toFloat()
                setColor(Color.parseColor(color))
                setStroke(dp(strokeWidth), Color.parseColor(strokeColor))
            }

        fun label(text: String): TextView =
            TextView(context).apply {
                this.text = text
                setTextColor(Color.parseColor("#DDEEFF"))
                textSize = 10f
                typeface = Typeface.DEFAULT_BOLD
                includeFontPadding = false
                setPadding(0, 0, 0, dp(4))
            }

        fun spinnerAdapter(items: List<String>): ArrayAdapter<String> =
            object : ArrayAdapter<String>(context, android.R.layout.simple_spinner_item, items.toMutableList()) {
                    override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
                        return (super.getView(position, convertView, parent) as TextView).apply {
                            setTextColor(Color.parseColor("#F8FAFC"))
                            textSize = 13f
                            typeface = Typeface.DEFAULT_BOLD
                            setPadding(dp(12), 0, dp(10), 0)
                        }
                    }

                    override fun getDropDownView(position: Int, convertView: View?, parent: ViewGroup): View {
                        return (super.getDropDownView(position, convertView, parent) as TextView).apply {
                            setTextColor(Color.parseColor("#F8FAFC"))
                            setBackgroundColor(Color.parseColor("#111827"))
                            textSize = 13f
                            setPadding(dp(12), dp(10), dp(12), dp(10))
                        }
                    }
                }

        fun spinner(items: List<String>): Spinner =
            Spinner(context).apply {
                adapter = spinnerAdapter(items)
                background = roundedBg("#2630445E", "#4F8BFF", 10)
                setPadding(0, 0, 0, 0)
            }

        fun jsString(value: String): String =
            value
                .replace("\\", "\\\\")
                .replace("'", "\\'")
                .replace("\n", "\\n")
                .replace("\r", "\\r")

        val layout = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(16), dp(18), dp(14))
            background = roundedBg("#F20B1220", "#4F8BFF", 18)
        }

        val topRow = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
        }
        val identityCol = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginEnd = dp(8)
            }
        }
        val dimensionCol = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }

        val identitySpinner = spinner(MIL_IDENTITIES.map { it.first })
        val dimensionSpinner = spinner(MIL_DIMENSIONS.map { it.first })
        identityCol.addView(label("IDENTIDAD"))
        identityCol.addView(identitySpinner, LinearLayout.LayoutParams.MATCH_PARENT, dp(40))
        dimensionCol.addView(label("DIMENSION"))
        dimensionCol.addView(dimensionSpinner, LinearLayout.LayoutParams.MATCH_PARENT, dp(40))
        topRow.addView(identityCol)
        topRow.addView(dimensionCol)
        layout.addView(topRow)

        var currentUnitOptions = getMilSymbolsForDimension(MIL_DIMENSIONS[dimensionSpinner.selectedItemPosition].second)
        val unitAdapter = spinnerAdapter(currentUnitOptions.map { it.first })
        val unitSpinner = Spinner(context).apply {
            adapter = unitAdapter
            background = roundedBg("#2630445E", "#4F8BFF", 10)
            setPadding(0, 0, 0, 0)
        }
        layout.addView(label("TIPO DE UNIDAD / FUNCION").apply { setPadding(0, dp(10), 0, dp(4)) })
        layout.addView(unitSpinner, LinearLayout.LayoutParams.MATCH_PARENT, dp(40))

        fun currentSidc(): String {
            val identity = MIL_IDENTITIES[identitySpinner.selectedItemPosition]
            val dimension = MIL_DIMENSIONS[dimensionSpinner.selectedItemPosition]
            val unit = currentUnitOptions[unitSpinner.selectedItemPosition.coerceIn(currentUnitOptions.indices)]
            return buildMilSidc(identity.second, dimension.second, unit.second)
        }

        val previewWrap = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(0, dp(8), 0, dp(8))
            background = roundedBg("#2630445E", "#4F8BFF", 10)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(104)
            ).apply {
                topMargin = dp(12)
            }
        }
        val preview = WebView(context).apply {
            setBackgroundColor(Color.TRANSPARENT)
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
            settings.javaScriptEnabled = true
            webViewClient = WebViewClient()
            layoutParams = LinearLayout.LayoutParams(dp(116), dp(82))
            loadDataWithBaseURL(
                "file:///android_asset/",
                """
                <!doctype html>
                <html>
                  <head>
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <script src="milsymbol.min.js"></script>
                    <style>
                      html, body {
                        width: 100%;
                        height: 100%;
                        margin: 0;
                        background: transparent;
                        overflow: hidden;
                      }
                      body {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                      }
                      #symbol {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        width: 100%;
                        height: 100%;
                      }
                      #symbol svg {
                        max-width: 108px;
                        max-height: 78px;
                      }
                    </style>
                  </head>
                  <body>
                    <div id="symbol"></div>
                    <script>
                      function renderMilSymbol(sidc) {
                        var target = document.getElementById('symbol');
                        try {
                          if (!sidc || typeof ms === 'undefined' || typeof ms.Symbol !== 'function') {
                            target.innerHTML = '';
                            return;
                          }
                          var symbol = new ms.Symbol(sidc, { size: 500, colorMode: 'Light' });
                          if (typeof symbol.isValid === 'function' && symbol.isValid() === false) {
                            target.innerHTML = '';
                            return;
                          }
                          if (typeof symbol.asSVG !== 'function') {
                            target.innerHTML = '';
                            return;
                          }
                          var svg = symbol.asSVG();
                          target.innerHTML = svg || '';
                        } catch (e) {
                          target.innerHTML = '';
                        }
                      }
                    </script>
                  </body>
                </html>
                """.trimIndent(),
                "text/html",
                "UTF-8",
                null
            )
        }

        fun updatePreview() {
            preview.evaluateJavascript("renderMilSymbol('${jsString(currentSidc())}')", null)
        }

        val refreshPreviewListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                updatePreview()
            }

            override fun onNothingSelected(parent: AdapterView<*>?) = Unit
        }
        val dimensionListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                val dimension = MIL_DIMENSIONS[position].second
                currentUnitOptions = getMilSymbolsForDimension(dimension)
                unitAdapter.clear()
                unitAdapter.addAll(currentUnitOptions.map { it.first })
                unitAdapter.notifyDataSetChanged()
                if (unitSpinner.selectedItemPosition !in currentUnitOptions.indices) {
                    unitSpinner.setSelection(0, false)
                }
                updatePreview()
            }

            override fun onNothingSelected(parent: AdapterView<*>?) = Unit
        }
        identitySpinner.onItemSelectedListener = refreshPreviewListener
        dimensionSpinner.onItemSelectedListener = dimensionListener
        unitSpinner.onItemSelectedListener = refreshPreviewListener
        previewWrap.addView(preview)
        layout.addView(previewWrap)

        val actions = LinearLayout(context).apply {
            gravity = Gravity.END
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(10), 0, 0)
        }
        val cancel = TextView(context).apply {
            text = "CANCELAR"
            setTextColor(Color.parseColor("#BFE1FF"))
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            background = roundedBg("#00FFFFFF", "#4F8BFF", 9)
            setPadding(dp(12), dp(7), dp(12), dp(7))
        }
        val ready = TextView(context).apply {
            text = "COLOCAR EN EL MAPA"
            setTextColor(Color.parseColor("#F8FAFC"))
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            background = roundedBg("#D81E3A5F", "#4F8BFF", 9)
            setPadding(dp(14), dp(7), dp(14), dp(7))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                marginStart = dp(8)
            }
        }
        actions.addView(cancel)
        actions.addView(ready)
        layout.addView(actions)

        val dialog = AlertDialog.Builder(context)
            .setView(layout)
            .create()

        cancel.setOnClickListener { dialog.dismiss() }
        ready.setOnClickListener {
            val identity = MIL_IDENTITIES[identitySpinner.selectedItemPosition]
            val dimension = MIL_DIMENSIONS[dimensionSpinner.selectedItemPosition]
            val unit = currentUnitOptions[unitSpinner.selectedItemPosition.coerceIn(currentUnitOptions.indices)]
            onSelected(
                MilitarySymbolChoice(
                    identityLabel = identity.first,
                    dimensionLabel = dimension.first,
                    unitLabel = unit.first,
                    sidc = buildMilSidc(identity.second, dimension.second, unit.second)
                )
            )
            dialog.dismiss()
        }

        dialog.setOnShowListener {
            dialog.window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            dialog.window?.setDimAmount(0.35f)
            dialog.window?.setLayout(dp(356), android.view.ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        dialog.show()
        preview.postDelayed({ updatePreview() }, 300)
    }

    fun showPoiConfigurationDialog(
        defaultName: String = "PDI",
        onSelected: (nombre: String, color: String) -> Unit
    ) {
        val context = host.getContext()
        val density = context.resources.displayMetrics.density
        fun dp(value: Int): Int = (value * density).toInt()
        fun roundedBg(color: String, strokeColor: String, radius: Int, strokeWidth: Int = 1): GradientDrawable =
            GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = dp(radius).toFloat()
                setColor(Color.parseColor(color))
                setStroke(dp(strokeWidth), Color.parseColor(strokeColor))
            }

        fun sectionLabel(text: String): TextView =
            TextView(context).apply {
                this.text = text
                setTextColor(Color.parseColor("#DDEEFF"))
                textSize = 10f
                typeface = Typeface.DEFAULT_BOLD
                includeFontPadding = false
                setPadding(0, dp(8), 0, dp(4))
            }

        fun spinnerAdapter(items: List<String>): ArrayAdapter<String> =
            object : ArrayAdapter<String>(context, android.R.layout.simple_spinner_item, items.toMutableList()) {
                override fun getView(position: Int, convertView: View?, parent: ViewGroup): View {
                    return (super.getView(position, convertView, parent) as TextView).apply {
                        setTextColor(Color.parseColor("#F8FAFC"))
                        textSize = 13f
                        typeface = Typeface.DEFAULT_BOLD
                        setPadding(dp(12), 0, dp(10), 0)
                    }
                }

                override fun getDropDownView(position: Int, convertView: View?, parent: ViewGroup): View {
                    return (super.getDropDownView(position, convertView, parent) as TextView).apply {
                        setTextColor(Color.parseColor("#F8FAFC"))
                        setBackgroundColor(Color.parseColor("#111827"))
                        textSize = 13f
                        setPadding(dp(12), dp(10), dp(12), dp(10))
                    }
                }
            }

        fun spinner(items: List<String>): Spinner =
            Spinner(context).apply {
                adapter = spinnerAdapter(items)
                background = roundedBg("#2630445E", "#4F8BFF", 10)
                setPadding(0, 0, 0, 0)
            }

        val layout = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(16), dp(18), dp(14))
            background = roundedBg("#F20B1220", "#4F8BFF", 18)
        }

        val title = TextView(context).apply {
            text = "Nuevo punto de interes"
            setTextColor(Color.WHITE)
            textSize = 18f
            typeface = Typeface.DEFAULT_BOLD
            setPadding(0, 0, 0, dp(3))
        }
        layout.addView(title)

        val labelNombre = sectionLabel("NOMBRE")
        val inputNombre = EditText(context).apply {
            setText(defaultName)
            setTextColor(Color.WHITE)
            setHintTextColor(Color.parseColor("#8FB6C7"))
            textSize = 14f
            typeface = Typeface.DEFAULT_BOLD
            setSingleLine(true)
            background = roundedBg("#2630445E", "#4F8BFF", 10)
            setPadding(dp(12), 0, dp(12), 0)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(44)
            )
        }
        layout.addView(labelNombre)
        layout.addView(inputNombre)

        val labelColor = sectionLabel("COLOR")
        layout.addView(labelColor)

        val colorSpinner = spinner(COLORES_POI.map { it.first })
        layout.addView(colorSpinner, LinearLayout.LayoutParams.MATCH_PARENT, dp(44))

        val actions = LinearLayout(context).apply {
            gravity = Gravity.END
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(8), 0, 0)
        }
        val cancel = TextView(context).apply {
            text = "CANCELAR"
            setTextColor(Color.parseColor("#BFE1FF"))
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setPadding(dp(12), dp(8), dp(12), dp(8))
        }
        val add = TextView(context).apply {
            text = "SIGUIENTE"
            setTextColor(Color.WHITE)
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            background = roundedBg("#D81E3A5F", "#4F8BFF", 9)
            setPadding(dp(12), dp(8), dp(12), dp(8))
        }
        actions.addView(cancel)
        actions.addView(add)
        layout.addView(actions)

        val dialog = AlertDialog.Builder(context)
            .setView(layout)
            .create()

        cancel.setOnClickListener { dialog.dismiss() }
        add.setOnClickListener {
            val nombre = inputNombre.text.toString().trim().ifBlank { "PDI" }
            val colorIdx = colorSpinner.selectedItemPosition.coerceIn(COLORES_POI.indices)
            onSelected(nombre, COLORES_POI[colorIdx].second)
            dialog.dismiss()
        }

        dialog.setOnShowListener {
            dialog.window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            dialog.window?.setDimAmount(0.35f)
            dialog.window?.setLayout(dp(390), android.view.ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        dialog.show()
    }
}
