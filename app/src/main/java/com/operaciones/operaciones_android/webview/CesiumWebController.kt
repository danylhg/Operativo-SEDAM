package com.operaciones.operaciones_android.webview

import android.annotation.SuppressLint
import android.graphics.Color
import android.view.MotionEvent
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient

class CesiumWebController(
    private val webView: WebView,
    private val jsBridge: Any,
    private val opLat: Double,
    private val opLon: Double,
    private val opZoom: Int
) {
    private var isPageReady: Boolean = false
    private var pendingMyPosition: Triple<Double, Double, Boolean>? = null

    @SuppressLint("SetJavaScriptEnabled")
    fun setup() {
        WebView.setWebContentsDebuggingEnabled(true)
        webView.setLayerType(WebView.LAYER_TYPE_HARDWARE, null)
        webView.setBackgroundColor(Color.parseColor("#dbe7f1"))
        webView.setOnTouchListener { view, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN,
                MotionEvent.ACTION_MOVE,
                MotionEvent.ACTION_POINTER_DOWN ->
                    view.parent?.requestDisallowInterceptTouchEvent(true)

                MotionEvent.ACTION_UP,
                MotionEvent.ACTION_CANCEL ->
                    view.parent?.requestDisallowInterceptTouchEvent(false)
            }
            false
        }

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
            allowContentAccess = true
            allowFileAccessFromFileURLs = true
            allowUniversalAccessFromFileURLs = true
            mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            loadWithOverviewMode = true
            useWideViewPort = true
            mediaPlaybackRequiresUserGesture = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            cacheMode = WebSettings.LOAD_DEFAULT
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(msg: ConsoleMessage): Boolean {
                android.util.Log.d(
                    "CesiumJS",
                    "${msg.message()} | line=${msg.lineNumber()} | source=${msg.sourceId()}"
                )
                return true
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                super.onPageStarted(view, url, favicon)
                android.util.Log.d("CesiumWebView", "Cargando mapa: $url")
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                android.util.Log.d("CesiumWebView", "Mapa HTML cargado: $url")
                isPageReady = true
                applyOperationView()
                pendingMyPosition?.let { (lat, lon, showMarker) ->
                    updateMyPosition(lat, lon, showMarker)
                }
                resize()
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                super.onReceivedError(view, request, error)
                android.util.Log.e(
                    "CesiumWebView",
                    "Error WebView url=${request?.url} main=${request?.isForMainFrame} code=${error?.errorCode} desc=${error?.description}"
                )
            }
        }

        webView.addJavascriptInterface(jsBridge, "Android")
        webView.loadUrl("file:///android_asset/map.html")
    }

    fun applyOperationView() {
        if (opLat != 0.0 && opLon != 0.0) {
            setOperationView(opLat, opLon, opZoom)
        }
    }

    fun setOperationView(lat: Double, lon: Double, zoom: Int) {
        webView.postDelayed({
            webView.evaluateJavascript(
                """
                (function() {
                    if (typeof setOperationView === 'function') {
                        setOperationView($lat, $lon, $zoom);
                        return 'OK';
                    }
                    return 'ERROR:setOperationView no existe';
                })();
                """.trimIndent(),
                null
            )
        }, 700)
    }

    fun updateMyPosition(latitude: Double, longitude: Double, showMarker: Boolean = true) {
        pendingMyPosition = Triple(latitude, longitude, showMarker)
        if (!isPageReady) return
        webView.post {
            webView.evaluateJavascript(
                """
                (function() {
                    if (typeof updateMyPosition === 'function') {
                        updateMyPosition($latitude, $longitude, $showMarker);
                        return 'OK';
                    }
                    return 'ERROR:updateMyPosition no existe';
                })();
                """.trimIndent(),
                null
            )
        }
    }

    fun centerOnLocation(latitude: Double, longitude: Double, zoom: Int = 250, follow: Boolean = false) {
        webView.post {
            webView.evaluateJavascript(
                """
                (function() {
                    if (typeof centerOnLocation === 'function') {
                        centerOnLocation($latitude, $longitude, $zoom, $follow);
                        return 'OK';
                    }
                    if (typeof setOperationView === 'function') {
                        setOperationView($latitude, $longitude, $zoom);
                        return 'OK';
                    }
                    return 'ERROR:centerOnLocation no existe';
                })();
                """.trimIndent(),
                null
            )
        }
    }

    fun selectTrackingPersonal(idPersonal: Int) {
        webView.post {
            webView.evaluateJavascript(
                "(function(){ if(typeof selectTrackingPersonal==='function') selectTrackingPersonal($idPersonal); })();",
                null
            )
        }
    }

    fun selectTrackingVehiculo(idVehiculo: Int) {
        webView.post {
            webView.evaluateJavascript(
                "(function(){ if(typeof selectTrackingVehiculo==='function') selectTrackingVehiculo($idVehiculo); })();",
                null
            )
        }
    }

    fun selectTrackingEquipo(idEquipo: Int) {
        webView.post {
            webView.evaluateJavascript(
                "(function(){ if(typeof selectTrackingEquipo==='function') selectTrackingEquipo($idEquipo); })();",
                null
            )
        }
    }

    fun selectTrackingDispositivo(idDispositivo: Int) {
        webView.post {
            webView.evaluateJavascript(
                "(function(){ if(typeof selectTrackingDispositivo==='function') selectTrackingDispositivo($idDispositivo); })();",
                null
            )
        }
    }

    fun followTrackingPersonal(idPersonal: Int, latitude: Double, longitude: Double, zoom: Int = 500) {
        webView.post {
            webView.evaluateJavascript(
                """
                (function(){
                    if (typeof followTrackingPersonal === 'function') {
                        followTrackingPersonal($idPersonal, $latitude, $longitude, $zoom);
                        return 'OK';
                    }
                    if (typeof selectTrackingPersonal === 'function') {
                        selectTrackingPersonal($idPersonal);
                    }
                    if (typeof centerOnLocation === 'function') {
                        centerOnLocation($latitude, $longitude, $zoom, false);
                    }
                    return 'OK';
                })();
                """.trimIndent(),
                null
            )
        }
    }

    fun followTrackingVehiculo(idVehiculo: Int, latitude: Double?, longitude: Double?, zoom: Int = 500) {
        if (latitude == null || longitude == null) {
            selectTrackingVehiculo(idVehiculo)
            return
        }

        webView.post {
            webView.evaluateJavascript(
                """
                (function(){
                    if (typeof followTrackingVehiculo === 'function') {
                        followTrackingVehiculo($idVehiculo, $latitude, $longitude, $zoom);
                        return 'OK';
                    }
                    if (typeof selectTrackingVehiculo === 'function') {
                        selectTrackingVehiculo($idVehiculo);
                    }
                    if (typeof centerOnLocation === 'function') {
                        centerOnLocation($latitude, $longitude, $zoom, false);
                    }
                    return 'OK';
                })();
                """.trimIndent(),
                null
            )
        }
    }

    fun followTrackingEquipo(idEquipo: Int, latitude: Double?, longitude: Double?, zoom: Int = 500) {
        if (latitude == null || longitude == null) {
            selectTrackingEquipo(idEquipo)
            return
        }

        webView.post {
            webView.evaluateJavascript(
                """
                (function(){
                    if (typeof followTrackingEquipo === 'function') {
                        followTrackingEquipo($idEquipo, $latitude, $longitude, $zoom);
                        return 'OK';
                    }
                    if (typeof selectTrackingEquipo === 'function') {
                        selectTrackingEquipo($idEquipo);
                    }
                    if (typeof centerOnLocation === 'function') {
                        centerOnLocation($latitude, $longitude, $zoom, false);
                    }
                    return 'OK';
                })();
                """.trimIndent(),
                null
            )
        }
    }

    fun followTrackingDispositivo(
        idDispositivo: Int,
        latitude: Double?,
        longitude: Double?,
        zoom: Int = 500,
        label: String? = null
    ) {
        if (latitude == null || longitude == null) {
            selectTrackingDispositivo(idDispositivo)
            return
        }

        val labelArg = label?.let { "'${jsString(it)}'" } ?: "null"
        webView.post {
            webView.evaluateJavascript(
                """
                (function(){
                    if (typeof followTrackingDispositivo === 'function') {
                        followTrackingDispositivo($idDispositivo, $latitude, $longitude, $zoom, $labelArg);
                        return 'OK';
                    }
                    if (typeof selectTrackingDispositivo === 'function') {
                        selectTrackingDispositivo($idDispositivo);
                    }
                    if (typeof centerOnLocation === 'function') {
                        centerOnLocation($latitude, $longitude, $zoom, false);
                    }
                    return 'OK';
                })();
                """.trimIndent(),
                null
            )
        }
    }

    private fun jsString(value: String): String =
        value
            .replace("\\", "\\\\")
            .replace("'", "\\'")
            .replace("\n", "\\n")
            .replace("\r", "")

    fun clearTrackingSelection() {
        webView.post {
            webView.evaluateJavascript(
                "(function(){ if(typeof clearTrackingSelection==='function') clearTrackingSelection(); })();",
                null
            )
        }
    }

    fun pulseEmergencyPersonal(idPersonal: Int) {
        webView.post {
            webView.evaluateJavascript(
                "(function(){ if(typeof pulseEmergencyPersonal==='function') pulseEmergencyPersonal($idPersonal); })();",
                null
            )
        }
    }

    fun pulseEmergencyAtLocation(idPersonal: Int, latitude: Double, longitude: Double) {
        webView.post {
            webView.evaluateJavascript(
                "(function(){ if(typeof pulseEmergencyAtLocation==='function') pulseEmergencyAtLocation($idPersonal, $latitude, $longitude); })();",
                null
            )
        }
    }

    fun enablePickStart() {
        webView.post {
            webView.evaluateJavascript(
                """
                (function() {
                    if (typeof enablePickStart === 'function') {
                        enablePickStart();
                        return 'OK';
                    }
                    return 'ERROR:enablePickStart no existe';
                })();
                """.trimIndent(),
                null
            )
        }
    }

    fun enablePickEnd() {
        webView.post {
            webView.evaluateJavascript(
                """
                (function() {
                    if (typeof enablePickEnd === 'function') {
                        enablePickEnd();
                        return 'OK';
                    }
                    return 'ERROR:enablePickEnd no existe';
                })();
                """.trimIndent(),
                null
            )
        }
    }

    fun calculateRoute() {
        webView.post {
            webView.evaluateJavascript(
                """
                (function() {
                    if (typeof calculateRoute === 'function') {
                        calculateRoute();
                        return 'OK';
                    }
                    return 'ERROR:calculateRoute no existe';
                })();
                """.trimIndent(),
                null
            )
        }
    }

    fun setRouteStart(latitude: Double, longitude: Double) {
        webView.post {
            webView.evaluateJavascript(
                """
                (function() {
                    if (typeof setRouteStart === 'function') {
                        setRouteStart($latitude, $longitude);
                        return 'OK';
                    }
                    return 'ERROR:setRouteStart no existe';
                })();
                """.trimIndent(),
                null
            )
        }
    }

    fun setRouteEnd(latitude: Double, longitude: Double) {
        webView.post {
            webView.evaluateJavascript(
                """
                (function() {
                    if (typeof setRouteEnd === 'function') {
                        setRouteEnd($latitude, $longitude);
                        return 'OK';
                    }
                    return 'ERROR:setRouteEnd no existe';
                })();
                """.trimIndent(),
                null
            )
        }
    }

    fun setRouteVehicleId(idVehiculo: Int?) {
        val jsValue = idVehiculo?.takeIf { it > 0 }?.toString() ?: "null"
        webView.post {
            webView.evaluateJavascript(
                """
                (function() {
                    if (typeof setRouteVehicleId === 'function') {
                        setRouteVehicleId($jsValue);
                        return 'OK';
                    }
                    return 'ERROR:setRouteVehicleId no existe';
                })();
                """.trimIndent(),
                null
            )
        }
    }

    fun clearRoute() {
        webView.post {
            webView.evaluateJavascript(
                """
                (function() {
                    if (typeof clearRoute === 'function') {
                        clearRoute();
                        return 'OK';
                    }
                    return 'ERROR:clearRoute no existe';
                })();
                """.trimIndent(),
                null
            )
        }
    }

    fun loadPois(poisJson: String, replace: Boolean = false) {
        webView.post {
            webView.evaluateJavascript(
                """
                (function() {
                    if (typeof loadPois === 'function') {
                        loadPois($poisJson, $replace);
                        return 'OK';
                    }
                    return 'ERROR:loadPois no existe';
                })();
                """.trimIndent(),
                null
            )
        }
    }

    fun loadCoverageCircles(circlesJson: String) {
        webView.post {
            webView.evaluateJavascript(
                """
                (function() {
                    if (typeof loadCoverageCircles === 'function') {
                        loadCoverageCircles($circlesJson);
                        return 'OK';
                    }
                    return 'ERROR:loadCoverageCircles no existe';
                })();
                """.trimIndent(),
                null
            )
        }
    }

    fun loadAreaPolygons(polygonsJson: String) {
        webView.post {
            webView.evaluateJavascript(
                """
                (function() {
                    if (typeof loadAreaPolygons === 'function') {
                        loadAreaPolygons($polygonsJson);
                        return 'OK';
                    }
                    return 'ERROR:loadAreaPolygons no existe';
                })();
                """.trimIndent(),
                null
            )
        }
    }

    fun syncAreas(circlesJson: String, polygonsJson: String) {
        webView.post {
            webView.evaluateJavascript(
                """
                (function() {
                    if (typeof syncAreas === 'function') {
                        syncAreas($circlesJson, $polygonsJson);
                        return 'OK';
                    }
                    if (typeof loadCoverageCircles === 'function') loadCoverageCircles($circlesJson);
                    if (typeof loadAreaPolygons === 'function') loadAreaPolygons($polygonsJson);
                    return 'OK';
                })();
                """.trimIndent(),
                null
            )
        }
    }

    fun loadStructures(structuresJson: String, replace: Boolean = false) {
        webView.post {
            webView.evaluateJavascript(
                """
                (function() {
                    if (typeof loadStructures === 'function') {
                        loadStructures($structuresJson, $replace);
                        return 'OK';
                    }
                    return 'ERROR:loadStructures no existe';
                })();
                """.trimIndent(),
                null
            )
        }
    }

    fun loadOperationZone(zoneJson: String) {
        webView.post {
            webView.evaluateJavascript(
                """
                (function() {
                    if (typeof loadOperationZone === 'function') {
                        loadOperationZone($zoneJson);
                        return 'OK';
                    }
                    return 'ERROR:loadOperationZone no existe';
                })();
                """.trimIndent(),
                null
            )
        }
    }

    fun loadOperationGrid(gridJson: String) {
        webView.post {
            webView.evaluateJavascript(
                """
                (function() {
                    if (typeof loadOperationGrid === 'function') {
                        loadOperationGrid($gridJson);
                        return 'OK';
                    }
                    return 'ERROR:loadOperationGrid no existe';
                })();
                """.trimIndent(),
                null
            )
        }
    }

    fun clearOperationGrid() {
        webView.post {
            webView.evaluateJavascript(
                """
                (function() {
                    if (typeof clearOperationGrid === 'function') {
                        clearOperationGrid();
                        return 'OK';
                    }
                    return 'ERROR:clearOperationGrid no existe';
                })();
                """.trimIndent(),
                null
            )
        }
    }

    fun addPoiToMap(idPoi: Int, lat: Double, lon: Double, nombre: String, tipoPoi: String, color: String, iconoSrc: String? = null, sidc: String? = null, creatorLabel: String = "", editorLabel: String = "") {
        val safeNombre = jsString(nombre)
        val safeTipo = jsString(tipoPoi)
        val safeColor = jsString(color)
        val iconArg = iconoSrc?.let { "'${jsString(it)}'" } ?: "null"
        val sidcArg = sidc?.let { "'${jsString(it)}'" } ?: "null"
        val safeCreator = jsString(creatorLabel)
        val safeEditor = jsString(editorLabel)
        android.util.Log.d(
            "POI_ANDROID",
            "addPoiToMap id=$idPoi tipo=$tipoPoi color=$color icono=${iconoSrc ?: "null"} sidc=${sidc ?: "null"} lat=$lat lon=$lon nombre=$nombre editor=$editorLabel"
        )
        webView.post {
            webView.evaluateJavascript(
                """
                (function() {
                    if (typeof addPoiToMap === 'function') {
                        addPoiToMap($idPoi, $lat, $lon, '$safeNombre', '$safeTipo', '$safeColor', $iconArg, $sidcArg, '$safeCreator', '$safeEditor');
                        return 'OK';
                    }
                    return 'ERROR:addPoiToMap no existe';
                })();
                """.trimIndent(),
                null
            )
        }
    }

    fun addStructureToMap(idMarca: Int, lat: Double, lon: Double, nombre: String, tipoEstructura: String, iconoSrc: String? = null, creatorLabel: String = "") {
        val safeNombre = jsString(nombre)
        val safeTipo = jsString(tipoEstructura)
        val iconArg = iconoSrc?.let { "'${jsString(it)}'" } ?: "null"
        val safeCreator = jsString(creatorLabel)
        webView.post {
            webView.evaluateJavascript(
                """
                (function() {
                    if (typeof addStructureToMap === 'function') {
                        addStructureToMap($idMarca, $lat, $lon, '$safeNombre', '$safeTipo', $iconArg, '$safeCreator');
                        return 'OK';
                    }
                    return 'ERROR:addStructureToMap no existe';
                })();
                """.trimIndent(),
                null
            )
        }
    }

    fun removePoiFromMap(idPoi: Int) {
        webView.post {
            webView.evaluateJavascript(
                """
                (function() {
                    if (typeof removePoiFromMap === 'function') {
                        removePoiFromMap($idPoi);
                        return 'OK';
                    }
                    return 'ERROR:removePoiFromMap no existe';
                })();
                """.trimIndent(),
                null
            )
        }
    }

    fun removeStructureFromMap(idMarca: Int) {
        webView.post {
            webView.evaluateJavascript(
                """
                (function() {
                    if (typeof removeStructureFromMap === 'function') {
                        removeStructureFromMap($idMarca);
                        return 'OK';
                    }
                    return 'ERROR:removeStructureFromMap no existe';
                })();
                """.trimIndent(),
                null
            )
        }
    }

    fun addCoverageCircleToMap(
        idArea: Int,
        centerLat: Double,
        centerLon: Double,
        radiusM: Double,
        nombre: String,
        color: String,
        opacity: Double,
        outlineWidth: Double,
        creatorLabel: String = ""
    ) {
        val safeNombre = jsString(nombre)
        val safeColor = jsString(color)
        val safeCreator = jsString(creatorLabel)
        webView.post {
            webView.evaluateJavascript(
                """
                (function() {
                    if (typeof addCoverageCircleToMap === 'function') {
                        addCoverageCircleToMap($idArea, $centerLat, $centerLon, $radiusM, '$safeNombre', '$safeColor', $opacity, $outlineWidth, '$safeCreator');
                        return 'OK';
                    }
                    return 'ERROR:addCoverageCircleToMap no existe';
                })();
                """.trimIndent(),
                null
            )
        }
    }

    fun addAreaPolygonToMap(
        idArea: Int,
        nombre: String,
        pointsJson: String,
        color: String,
        opacity: Double,
        outlineWidth: Double,
        creatorLabel: String = ""
    ) {
        val safeNombre = jsString(nombre)
        val safeColor = jsString(color)
        val safeCreator = jsString(creatorLabel)
        webView.post {
            webView.evaluateJavascript(
                """
                (function() {
                    if (typeof addAreaPolygonToMap === 'function') {
                        addAreaPolygonToMap($idArea, '$safeNombre', $pointsJson, '$safeColor', $opacity, $outlineWidth, '$safeCreator');
                        return 'OK';
                    }
                    return 'ERROR:addAreaPolygonToMap no existe';
                })();
                """.trimIndent(),
                null
            )
        }
    }

    fun removeCoverageCircleFromMap(idArea: Int) {
        webView.post {
            webView.evaluateJavascript(
                """
                (function() {
                    if (typeof removeCoverageCircleFromMap === 'function') {
                        removeCoverageCircleFromMap($idArea);
                        return 'OK';
                    }
                    return 'ERROR:removeCoverageCircleFromMap no existe';
                })();
                """.trimIndent(),
                null
            )
        }
    }

    fun removeAreaFromMap(idArea: Int) {
        webView.post {
            webView.evaluateJavascript(
                """
                (function() {
                    if (typeof removeAreaFromMap === 'function') {
                        removeAreaFromMap($idArea);
                        return 'OK';
                    }
                    return 'ERROR:removeAreaFromMap no existe';
                })();
                """.trimIndent(),
                null
            )
        }
    }

    fun startPencilMode(color: String? = null) {
        webView.post {
            val js = if (color != null) {
                "(function(){ if(typeof startPencilMode==='function') startPencilMode('$color'); })();"
            } else {
                "(function(){ if(typeof startPencilMode==='function') startPencilMode(); })();"
            }
            webView.evaluateJavascript(js, null)
        }
    }

    fun setPencilColor(color: String) {
        webView.post {
            webView.evaluateJavascript(
                "(function(){ if(typeof setPencilColor==='function') setPencilColor('$color'); })();",
                null
            )
        }
    }

    fun stopPencilMode() {
        webView.post {
            webView.evaluateJavascript(
                "(function(){ if(typeof stopPencilMode==='function') stopPencilMode(); })();",
                null
            )
        }
    }

    fun startEraserMode() {
        webView.post {
            webView.evaluateJavascript(
                "(function(){ if(typeof startEraserMode==='function') startEraserMode(); })();",
                null
            )
        }
    }

    fun stopEraserMode() {
        webView.post {
            webView.evaluateJavascript(
                "(function(){ if(typeof stopEraserMode==='function') stopEraserMode(); })();",
                null
            )
        }
    }

    fun unlockMapNavigation() {
        webView.post {
            webView.evaluateJavascript(
                "(function(){ if(typeof unlockMapNavigation==='function') unlockMapNavigation(); })();",
                null
            )
        }
    }

    fun loadRemoteRoutes(routesJson: String, replace: Boolean = false) {
        webView.post {
            webView.evaluateJavascript(
                "(function(){ if(typeof loadRemoteRoutes==='function') loadRemoteRoutes($routesJson, $replace); })();",
                null
            )
        }
    }

    fun loadTacticalRoutes(routesJson: String, replace: Boolean = false) {
        webView.post {
            webView.evaluateJavascript(
                "(function(){ if(typeof loadTacticalRoutes==='function') loadTacticalRoutes($routesJson, $replace); })();",
                null
            )
        }
    }

    fun removeTacticalRouteFromMap(idRuta: Int) {
        webView.post {
            webView.evaluateJavascript(
                "(function(){ if(typeof removeTacticalRouteFromMap==='function') removeTacticalRouteFromMap($idRuta); })();",
                null
            )
        }
    }

    fun loadDrawings(drawingsJson: String, replace: Boolean = false) {
        webView.post {
            webView.evaluateJavascript(
                "(function(){ if(typeof loadDrawings==='function') loadDrawings($drawingsJson, $replace); })();",
                null
            )
        }
    }

    fun removeDrawingFromMap(idDibujo: Int) {
        webView.post {
            webView.evaluateJavascript(
                "(function(){ if(typeof removeDrawingFromMap==='function') removeDrawingFromMap($idDibujo); })();",
                null
            )
        }
    }

    fun resize() {
        webView.postDelayed({
            webView.evaluateJavascript(
                """
                (function() {
                    if (typeof resizeCesium === 'function') {
                        resizeCesium();
                        return 'OK';
                    }
                    return 'ERROR:resizeCesium no existe';
                })();
                """.trimIndent(),
                null
            )
        }, 150)
    }

    fun evaluate(js: String) {
        webView.post {
            webView.evaluateJavascript(js, null)
        }
    }

    fun setMobileBaseLayer(layer: String) {
        val safeLayer = if (layer == "map") "map" else "satellite"
        evaluate("(function(){ if(typeof setMobileBaseLayer==='function') setMobileBaseLayer('$safeLayer'); })();")
    }

    fun startMobileMapTool(mode: String) {
        val allowed = setOf("distance", "area", "line", "zone", "rectangle", "radius")
        if (mode !in allowed) return
        evaluate("(function(){ if(typeof startMobileMapTool==='function') startMobileMapTool('$mode'); })();")
    }

    fun clearMobileMapTools() {
        evaluate("(function(){ if(typeof clearMobileMapTools==='function') clearMobileMapTools(); })();")
    }

    fun startGeoMsgMode() {
        evaluate("(function(){ if(typeof startGeoMsgMode==='function') startGeoMsgMode(); })();")
    }

    fun addGeoMsgToMap(idPoi: Int, lat: Double, lon: Double, text: String, author: String) {
        val safeText = org.json.JSONObject.quote(text)
        val safeAuthor = org.json.JSONObject.quote(author)
        evaluate("(function(){ if(typeof addGeoMsgToMap==='function') addGeoMsgToMap($idPoi, $lat, $lon, $safeText, $safeAuthor); })();")
    }
}
