package mx.sedam.movil.ui.map

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.drawable.BitmapDrawable
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.view.WindowManager
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.CloudQueue
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.Satellite
import androidx.compose.material.icons.filled.Storage
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import mx.sedam.movil.R
import mx.sedam.movil.data.ChatMessage
import mx.sedam.movil.data.MilSymbolRenderer
import mx.sedam.movil.data.SedamUnits
import mx.sedam.movil.data.SessionRepository
import mx.sedam.movil.ui.theme.DangerRed
import mx.sedam.movil.ui.theme.FieldFill
import mx.sedam.movil.ui.theme.FieldLine
import mx.sedam.movil.ui.theme.Gold
import mx.sedam.movil.ui.theme.GoldBright
import mx.sedam.movil.ui.theme.HudCorners
import mx.sedam.movil.ui.theme.Navy
import mx.sedam.movil.ui.theme.NavyDeep
import mx.sedam.movil.ui.theme.OffWhite
import mx.sedam.movil.ui.theme.OnlineGreen
import mx.sedam.movil.ui.theme.SteelText
import mx.sedam.movil.ui.theme.White
import org.osmdroid.config.Configuration
import org.osmdroid.events.MapEventsReceiver
import org.osmdroid.tileprovider.cachemanager.CacheManager
import org.osmdroid.tileprovider.modules.SqlTileWriter
import org.osmdroid.tileprovider.tilesource.OnlineTileSourceBase
import org.osmdroid.tileprovider.tilesource.TileSourcePolicy
import org.osmdroid.tileprovider.tilesource.XYTileSource
import org.osmdroid.util.BoundingBox
import org.osmdroid.util.GeoPoint
import org.osmdroid.util.MapTileIndex
import org.osmdroid.views.CustomZoomButtonsController
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.MapEventsOverlay
import org.osmdroid.views.overlay.Marker
import org.osmdroid.views.overlay.mylocation.GpsMyLocationProvider
import org.osmdroid.views.overlay.mylocation.MyLocationNewOverlay
import java.io.File
import java.util.Locale
import kotlin.math.roundToInt
import org.osmdroid.events.MapListener
import org.osmdroid.events.ZoomEvent
import org.osmdroid.events.ScrollEvent

private val INITIAL_CENTER = GeoPoint(19.4326, -99.1332)
private const val INITIAL_ZOOM = 5.5
private const val FOLLOW_ZOOM = 16.0

private const val ALIAS_PREFS = "sedam_alias"

/** Alias guardado localmente para esta unidad (equivalente a localStorage del web). */
private fun loadSavedAlias(context: Context, id: String): String? =
    context.getSharedPreferences(ALIAS_PREFS, Context.MODE_PRIVATE).getString(id, null)
        ?.takeIf { it.isNotBlank() }

private fun saveAliasLocally(context: Context, id: String, alias: String) {
    context.getSharedPreferences(ALIAS_PREFS, Context.MODE_PRIVATE).edit().putString(id, alias)
        .apply()
}

/** Punto azul "estás aquí" para el marcador de posición propia (estilo web-system). */
private fun buildMyLocationDot(): Bitmap {
    val size = 44
    val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bmp)
    val c = size / 2f
    val blue = Color.parseColor("#3B82F6")
    canvas.drawCircle(
        c,
        c,
        size * 0.46f,
        Paint(Paint.ANTI_ALIAS_FLAG).apply { color = blue; alpha = 55 })
    canvas.drawCircle(
        c,
        c,
        size * 0.30f,
        Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE })
    canvas.drawCircle(c, c, size * 0.22f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = blue })
    return bmp
}

// Fuente de tiles OSM con política que PERMITE descarga de áreas (bulk). El
// TileSourceFactory.MAPNIK por defecto tiene FLAG_NO_BULK y osmdroid lanza
// excepción al descargar → cerraba la app. Aquí omitimos ese flag, igual que el
// web-system asume al bajar tiles con fetch individual.
// NOTA: para producción offline real, cambiar estas baseUrls por el tile server
// propio de SEDAM (nginx) — la lógica de descarga queda idéntica.
private val SEDAM_TILE_SOURCE = XYTileSource(
    "SEDAM-OSM",
    0, 19, 256, ".png",
    arrayOf(
        "https://a.tile.openstreetmap.org/",
        "https://b.tile.openstreetmap.org/",
        "https://c.tile.openstreetmap.org/",
    ),
    "© OpenStreetMap contributors",
    TileSourcePolicy(
        2, // máx. descargas concurrentes
        TileSourcePolicy.FLAG_USER_AGENT_MEANINGFUL or TileSourcePolicy.FLAG_USER_AGENT_NORMALIZED,
        // (sin FLAG_NO_BULK → se permite descargar áreas)
    ),
)

/**
 * Capa híbrida (satélite + nombres de calles/lugares en un solo tile) — mismo
 * endpoint que usa el web-system (MapView.jsx, capa "sat" con `lyrs=y`), por
 * consistencia entre clientes. Es el endpoint NO oficial de tiles de Google
 * (no la API con licencia): sin SLA y fuera de sus Términos de Servicio para
 * uso fuera de productos Google, pero es lo que ya corre en producción en el
 * cliente web. La URL es por query string, no por path, así que no encaja en
 * el formato de XYTileSource y hay que construirla a mano.
 */
private class GoogleHybridTileSource : OnlineTileSourceBase(
    "SEDAM-SAT-GOOGLE",
    0, 21, 256, "",
    arrayOf(
        "https://mt0.google.com/vt/lyrs=y&x=",
        "https://mt1.google.com/vt/lyrs=y&x=",
        "https://mt2.google.com/vt/lyrs=y&x=",
        "https://mt3.google.com/vt/lyrs=y&x=",
    ),
    "© Google Maps",
    TileSourcePolicy(
        2,
        TileSourcePolicy.FLAG_USER_AGENT_MEANINGFUL or TileSourcePolicy.FLAG_USER_AGENT_NORMALIZED,
    ),
) {
    override fun getTileURLString(pMapTileIndex: Long): String {
        val z = MapTileIndex.getZoom(pMapTileIndex)
        val x = MapTileIndex.getX(pMapTileIndex)
        val y = MapTileIndex.getY(pMapTileIndex)
        return "$baseUrl$x&y=$y&z=$z"
    }
}

private val SEDAM_SATELLITE_SOURCE = GoogleHybridTileSource()

/**
 * Mapa táctico con osmdroid. Los controles viven en un cajón lateral (☰) para
 * mantener el mapa limpio; sobre el mapa solo quedan la barra superior, el badge
 * "en línea" y el botón de centrar en la unidad.
 *
 * Tiles: se descargan con internet y se cachean en SQLite (cache.db); sin conexión
 * se sirven desde ahí. Posición propia por GPS del sistema (sin Google Play).
 */
@Composable
fun MapScreen(onLogout: () -> Unit) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val scope = rememberCoroutineScope()

    remember {
        Configuration.getInstance().apply {
            userAgentValue = context.packageName
            val base = File(context.filesDir, "osmdroid")
            osmdroidBasePath = base
            osmdroidTileCache = File(base, "tiles")
            // Tope del cache de tiles offline: 20 GB (deja de borrar al bajar a 19).
            tileFileSystemCacheMaxBytes = 20L * 1024 * 1024 * 1024
            tileFileSystemCacheTrimBytes = 19L * 1024 * 1024 * 1024
            // Tiles no expiran (5 años): una tile ya descargada NO se vuelve a
            // descargar — ni navegando ni con "Descargar área".
            expirationOverrideDuration = 1000L * 60 * 60 * 24 * 365 * 5
        }
        MilSymbolRenderer.init(context) // símbolos MIL-STD-2525
    }

    var hasLocation by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
                    PackageManager.PERMISSION_GRANTED
        )
    }
    var locationOverlay by remember { mutableStateOf<MyLocationNewOverlay?>(null) }
    var offline by remember { mutableStateOf(false) }
    // Mapa híbrido (Google) por default; el usuario puede volver a calles OSM.
    var satellite by remember { mutableStateOf(true) }

    // Estado del diálogo de descarga de área
    var dlDialog by remember { mutableStateOf(false) }
    var dlBbox by remember { mutableStateOf<BoundingBox?>(null) }
    var dlBaseZoom by remember { mutableStateOf(0) }
    var dlDetail by remember { mutableStateOf(3) }
    var dlRunning by remember { mutableStateOf(false) }
    var dlDone by remember { mutableStateOf(0) }
    var dlTotal by remember { mutableStateOf(0) }
    var dlTask by remember { mutableStateOf<CacheManager.CacheManagerTask?>(null) }

    var cacheBytes by remember { mutableStateOf(0L) }
    var confirmClear by remember { mutableStateOf(false) }
    var panicActive by remember { mutableStateOf(false) }
    var confirmPanic by remember { mutableStateOf(false) }
    // Creación de objetos por long-press: punto elegido y diálogo abierto.
    var createAt by remember { mutableStateOf<GeoPoint?>(null) }
    var waypointAt by remember { mutableStateOf<GeoPoint?>(null) }
    var targetAt by remember { mutableStateOf<GeoPoint?>(null) }
    // Edición de objetos propios (se abre el mismo diálogo prellenado).
    var editWaypointKey by remember { mutableStateOf<String?>(null) }
    var editTargetKey by remember { mutableStateOf<String?>(null) }
    // Confirmación antes de eliminar un waypoint/blanco propio.
    var confirmDeleteWaypointKey by remember { mutableStateOf<String?>(null) }
    var confirmDeleteTargetKey by remember { mutableStateOf<String?>(null) }
    // Edición del alias propio.
    var showAliasDialog by remember { mutableStateOf(false) }
    var aliasInput by remember { mutableStateOf("") }

    val mapView = remember {
        MapView(context).apply {
            // Capa por defecto: híbrido (satélite); el switch del drawer permite volver a OSM.
            setTileSource(if (satellite) SEDAM_SATELLITE_SOURCE else SEDAM_TILE_SOURCE)
            setMultiTouchControls(true)
            setUseDataConnection(true)
            zoomController.setVisibility(CustomZoomButtonsController.Visibility.NEVER)
            controller.setZoom(INITIAL_ZOOM)
            controller.setCenter(INITIAL_CENTER)

            // 🆕 Agregar esto:
            addMapListener(object : MapListener {
                override fun onScroll(event: ScrollEvent?): Boolean = false
                override fun onZoom(event: ZoomEvent?): Boolean {
                    invalidate()  // Fuerza redibujado para sincronizar
                    return false
                }
            })
        }
    }


    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted -> hasLocation = granted }

    LaunchedEffect(Unit) {
        if (!hasLocation) permissionLauncher.launch(Manifest.permission.ACCESS_FINE_LOCATION)
    }

    LaunchedEffect(hasLocation) {
        if (hasLocation && locationOverlay == null) {
            val overlay = MyLocationNewOverlay(GpsMyLocationProvider(context), mapView).apply {
                // Marcador propio = punto azul "estás aquí" (igual que el web-system).
                val dot = buildMyLocationDot()
                setPersonIcon(dot)
                setDirectionIcon(dot)
                setPersonAnchor(0.5f, 0.5f)
                setDirectionAnchor(0.5f, 0.5f)
                enableMyLocation()
                enableFollowLocation()
                runOnFirstFix {
                    mapView.post {
                        myLocation?.let {
                            mapView.controller.animateTo(it)
                            mapView.controller.setZoom(FOLLOW_ZOOM)
                        }
                    }
                }
            }
            mapView.overlays.add(overlay)
            locationOverlay = overlay
        }
    }

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> mapView.onResume()
                Lifecycle.Event.ON_PAUSE -> mapView.onPause()
                else -> {}
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            mapView.onDetach()
        }
    }

    // Mantener la pantalla encendida mientras el mapa esté visible (uso en campo).
    val activity = context as? Activity
    DisposableEffect(Unit) {
        activity?.window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        onDispose { activity?.window?.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
    }

    val myId by SessionRepository.myId.collectAsStateWithLifecycle()

    // Rumbo de MARCHA (GPS, sólo con movimiento) + velocidad. GPS crudo cada 1 s.
    var ownSpeed by remember { mutableStateOf(0f) }
    var ownGpsCourse by remember { mutableStateOf(0f) }
    DisposableEffect(hasLocation) {
        if (!hasLocation) return@DisposableEffect onDispose { }
        val lm = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        var prev: Location? = null
        val listener = object : LocationListener {
            override fun onLocationChanged(loc: Location) {
                var spd = if (loc.hasSpeed()) loc.speed else 0f
                var crs: Float? = if (loc.hasBearing()) loc.bearing else null
                prev?.let { p ->
                    val dt = (loc.time - p.time) / 1000f
                    val dist = p.distanceTo(loc)
                    if (dt > 0f && dist > 1f) {
                        if (spd == 0f) spd = dist / dt
                        if (crs == null) crs = p.bearingTo(loc)
                    }
                }
                prev = loc
                ownSpeed = spd
                crs?.let { ownGpsCourse = ((it % 360f) + 360f) % 360f }
            }

            override fun onStatusChanged(
                provider: String?,
                status: Int,
                extras: android.os.Bundle?
            ) {
            }

            override fun onProviderEnabled(provider: String) {}
            override fun onProviderDisabled(provider: String) {}
        }
        try {
            lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, listener)
        } catch (_: SecurityException) {
        }
        onDispose { lm.removeUpdates(listener) }
    }

    // Rumbo de la BRÚJULA (magnetómetro + acelerómetro): funciona adentro y quieto,
    // igual que el rumbo que veías en el web-system aunque no hubiera GPS.
    var ownCompass by remember { mutableStateOf(0f) }
    DisposableEffect(Unit) {
        val sm = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
        val sensor = sm.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
        val rot = FloatArray(9)
        val orient = FloatArray(3)
        val listener = object : SensorEventListener {
            override fun onSensorChanged(e: SensorEvent) {
                SensorManager.getRotationMatrixFromVector(rot, e.values)
                SensorManager.getOrientation(rot, orient)
                val az = Math.toDegrees(orient[0].toDouble()).toFloat()
                ownCompass = ((az % 360f) + 360f) % 360f
            }

            override fun onAccuracyChanged(s: Sensor?, a: Int) {}
        }
        if (sensor != null) sm.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_UI)
        onDispose { sm.unregisterListener(listener) }
    }

    // Transmite cada 3 s: en movimiento usa el rumbo de marcha (GPS); quieto/adentro,
    // el de la brújula. La velocidad siempre del GPS (0 si no te mueves, es correcto).
    LaunchedEffect(Unit) {
        while (true) {
            delay(3000)
            locationOverlay?.lastFix?.let { fix ->
                val course = if (ownSpeed > 0.5f) ownGpsCourse else ownCompass
                SessionRepository.sendOwnPos(
                    fix.latitude,
                    fix.longitude,
                    course,
                    ownSpeed,
                    fix.altitude
                )
            }
        }
    }

    // Quita del mapa las unidades que dejaron de reportar (por si se pierde el SESSION_OUT).
    LaunchedEffect(Unit) {
        while (true) {
            delay(5000)
            SessionRepository.pruneStale()
        }
    }

    // ── Declaraciones compartidas (deben ir antes de los LaunchedEffect que las usan) ──
    val units by SessionRepository.units.collectAsStateWithLifecycle()
    val aliases by SessionRepository.aliases.collectAsStateWithLifecycle()
    val panics by SessionRepository.panics.collectAsStateWithLifecycle()
    val waypoints by SessionRepository.waypoints.collectAsStateWithLifecycle()
    val targets by SessionRepository.targets.collectAsStateWithLifecycle()
    val generalChat by SessionRepository.generalChat.collectAsStateWithLifecycle()
    val unreadGeneral by SessionRepository.unreadGeneral.collectAsStateWithLifecycle()
    val privateChats by SessionRepository.privateChats.collectAsStateWithLifecycle()
    val unreadPrivate by SessionRepository.unreadPrivate.collectAsStateWithLifecycle()
    // null = chat cerrado; "0" = general; otro = privado con esa unidad. Vive acá
    // (no dentro de ChatOverlay) para saber qué hilo se está viendo AHORA MISMO y
    // así silenciar el ping/banner de un mensaje que llega de ese mismo hilo.
    var chatThread by remember { mutableStateOf<String?>(null) }
    var chatToast by remember { mutableStateOf<ChatMessage?>(null) }

    // Ping + banner por cada mensaje entrante que NO sea del hilo que ya se está viendo.
    LaunchedEffect(Unit) {
        SessionRepository.incomingChat.collect { msg ->
            val msgThread = if (msg.toId == GENERAL_CHAT_ID) GENERAL_CHAT_ID else msg.fromId
            if (chatThread == msgThread) return@collect
            chatToast = msg
            scope.launch { playChatPing(context) }
        }
    }
    // Alarma sonora mientras alguna OTRA unidad esté en pánico.
    PanicAlarm(active = panics.isNotEmpty())
    fun nameOf(id: String): String = aliases[id] ?: SedamUnits.name(id) ?: "Unidad $id"
    val myName = myId?.let { nameOf(it) }

    // Al conectar (o reconectar), reenvía el alias guardado para esta unidad —
    // el server no lo recuerda entre sesiones, cada cliente debe reafirmarlo.
    LaunchedEffect(myId) {
        val id = myId ?: return@LaunchedEffect
        loadSavedAlias(context, id)?.let { SessionRepository.sendAlias(it) }
    }
    val unitMarkers = remember { mutableMapOf<String, Marker>() }
    val iconKey = remember { mutableMapOf<String, String>() }
    val wpMarkers = remember { mutableMapOf<String, Marker>() }
    val tgtMarkers = remember { mutableMapOf<String, Marker>() }
    val wpIconSidc =
        remember { mutableMapOf<String, String>() } // último SIDC pintado, para refrescar el ícono si se edita
    val tgtIconSidc = remember { mutableMapOf<String, String>() }
    val unitInfoWindow = remember { UnitInfoWindow(mapView) }
    val objectInfoWindow = remember { ObjectInfoWindow(mapView) }
    // Overlay de ondas de radar para pánico (se agrega al fondo, bajo los marcadores).
    val radarOverlay = remember {
        RadarPulseOverlay(mapView).also { mapView.overlays.add(0, it) }
    }
    // Long-press en el mapa → menú de creación de objetos.
    remember {
        val receiver = object : MapEventsReceiver {
            override fun singleTapConfirmedHelper(p: GeoPoint?) = false
            override fun longPressHelper(p: GeoPoint?): Boolean {
                if (p != null) createAt = p
                return true
            }
        }
        MapEventsOverlay(receiver).also { mapView.overlays.add(0, it) }
    }

    // Dead reckoning: cada 2s, los blancos propios transmitiendo avanzan según
    // rumbo/velocidad y se reemiten (igual que el web-system).
    LaunchedEffect(Unit) {
        while (true) {
            delay(2000)
            SessionRepository.tickTargets()
        }
    }

    // ── Waypoints y blancos: pintar en el mapa por SIDC (mismo ícono que en el
    //    diálogo de creación/edición) + tooltip con el mismo estilo que las unidades ──
    LaunchedEffect(waypoints, myId) {
        (wpMarkers.keys - waypoints.keys).forEach { k ->
            wpMarkers.remove(k)?.let { m ->
                // Si su tooltip está abierto, cerrarlo — si no, queda flotando en
                // el mapa aunque el marcador ya se haya quitado.
                if (objectInfoWindow.openMarker === m) objectInfoWindow.close()
                mapView.overlays.remove(m)
            }
            wpIconSidc.remove(k)
        }
        waypoints.forEach { (k, w) ->
            val m = wpMarkers.getOrPut(k) {
                Marker(mapView).apply {
                    setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_BOTTOM)
                    setInfoWindow(objectInfoWindow)
                    mapView.overlays.add(this)
                }
            }
            m.position = GeoPoint(w.lat, w.lng)
            // Ícono: el MISMO renderer/SIDC que se ve en el diálogo. Se re-pinta si
            // el SIDC cambió (editar identidad/tipo) — antes se quedaba pegado.
            if (wpIconSidc[k] != w.sidc) {
                MilSymbolRenderer.bitmapFor(w.sidc, 80)
                    ?.let { m.icon = BitmapDrawable(context.resources, it) }
                wpIconSidc[k] = w.sidc
            }
            val mine = w.ownerId == myId
            m.relatedObject = ObjectTip(
                name = w.name,
                subtitle = if (mine) (if (w.sharing) "Compartiendo" else "Privado") else "Waypoint · ${
                    nameOf(
                        w.ownerId
                    )
                }",
                detail = "",
                course = null,
                lat = w.lat,
                lng = w.lng,
            )
            // Si su tooltip está abierto ahora mismo, reabrirlo: refresca los datos
            // Y reposiciona el globo en la nueva ubicación (si no, se queda "colgado"
            // en el punto donde estaba cuando se abrió).
            if (objectInfoWindow.openMarker === m) m.showInfoWindow()
        }
        mapView.invalidate()
    }
    LaunchedEffect(targets, myId) {
        (tgtMarkers.keys - targets.keys).forEach { k ->
            tgtMarkers.remove(k)?.let { m ->
                if (objectInfoWindow.openMarker === m) objectInfoWindow.close()
                mapView.overlays.remove(m)
            }
            tgtIconSidc.remove(k)
        }
        targets.forEach { (k, t) ->
            val m = tgtMarkers.getOrPut(k) {
                Marker(mapView).apply {
                    setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_CENTER)
                    setInfoWindow(objectInfoWindow)
                    mapView.overlays.add(this)
                }
            }
            m.position = GeoPoint(t.lat, t.lng)
            val mine = t.unitId == myId
            val course = ((t.heading % 360f) + 360f) % 360f
            // Ícono = símbolo con la flecha de dirección de movimiento NATIVA del
            // propio símbolo MIL-STD (igual mecanismo que las unidades), no un
            // símbolo estático. Bucket de 5° para no re-renderizar de más.
            val bucket = ((course / 5f).roundToInt() % 72) * 5
            val ikey = "${t.sidc}@$bucket"
            if (tgtIconSidc[k] != ikey) {
                MilSymbolRenderer.iconFor(t.sidc, t.heading, sizePx = 88)?.let { ic ->
                    m.icon = BitmapDrawable(context.resources, ic.bitmap)
                    m.setAnchor(ic.anchorU, ic.anchorV)
                    tgtIconSidc[k] = ikey
                }
            }
            m.relatedObject = ObjectTip(
                name = t.name,
                subtitle = if (mine) (if (t.transmitting) "Transmitiendo" else "Privado") else "Blanco · ${
                    nameOf(
                        t.unitId
                    )
                }",
                detail = targetDetailText(course, t.speed),
                course = course,
                lat = t.lat,
                lng = t.lng,
            )
            // Reabrir (no solo refrescar datos): el blanco puede haberse movido
            // (dead reckoning), y el tooltip debe seguirlo, no quedarse atrás.
            if (objectInfoWindow.openMarker === m) m.showInfoWindow()
        }
        mapView.invalidate()
    }

    val unitList = remember(units, aliases, panics) {
        units.values.sortedBy { it.id.toIntOrNull() ?: Int.MAX_VALUE }.map { pos ->
            val def = SedamUnits.get(pos.id)
            UnitListItem(
                id = pos.id,
                name = nameOf(pos.id),
                course = ((pos.course % 360f) + 360f) % 360f,
                speedKmh = pos.speed * 3.6f,
                icon = MilSymbolRenderer.bitmapFor(def?.sidc ?: "SUGP-----------", 64)
                    ?.asImageBitmap(),
                panic = pos.id in panics,
            )
        }
    }
    val wpList = remember(waypoints, myId) {
        waypoints.values.sortedBy { it.name }.map {
            ObjectListItem(
                key = it.key, name = it.name,
                subtitle = if (it.ownerId == myId) (if (it.sharing) "Compartiendo" else "Privado") else "WP · ${
                    nameOf(
                        it.ownerId
                    )
                }",
                icon = MilSymbolRenderer.bitmapFor(it.sidc, 64)?.asImageBitmap(),
                mine = it.ownerId == myId,
                sidc = it.sidc,
                active = it.sharing,
            )
        }
    }
    val tgtList = remember(targets, myId) {
        targets.values.sortedBy { it.name }.map {
            ObjectListItem(
                key = it.key, name = it.name,
                subtitle = if (it.unitId == myId) (if (it.transmitting) "Transmitiendo" else "Privado") else "Blanco · ${
                    nameOf(
                        it.unitId
                    )
                }",
                icon = MilSymbolRenderer.bitmapFor(it.sidc, 64)?.asImageBitmap(),
                mine = it.unitId == myId,
                sidc = it.sidc,
                active = it.transmitting,
                course = ((it.heading % 360f) + 360f) % 360f,
                speedKmh = it.speed,
            )
        }
    }

    LaunchedEffect(units, aliases, panics) {
        // Ondas de radar sobre las unidades en pánico (con su posición actual).
        radarOverlay.points = panics.mapNotNull { pid ->
            units[pid]?.let { GeoPoint(it.lat, it.lng) }
        }
        mapView.invalidate()

        // Quitar unidades que dejaron de reportar.
        (unitMarkers.keys - units.keys).forEach { id ->
            unitMarkers.remove(id)?.let { m ->
                if (unitInfoWindow.openMarker === m) unitInfoWindow.close()
                mapView.overlays.remove(m)
            }
            iconKey.remove(id)
        }
        // Agregar/actualizar.
        units.forEach { (id, pos) ->
            val def = SedamUnits.get(id)
            val marker = unitMarkers.getOrPut(id) {
                Marker(mapView).apply {
                    setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_CENTER)
                    setInfoWindow(unitInfoWindow)
                    mapView.overlays.add(this)
                }
            }
            marker.position = GeoPoint(pos.lat, pos.lng)
            marker.title = nameOf(id)
            marker.relatedObject = UnitTip(
                name = nameOf(id),
                subtitle = def?.let {
                    listOf(it.numeral, it.description).filter(String::isNotBlank)
                        .joinToString(" · ")
                } ?: "",
                course = ((pos.course % 360f) + 360f) % 360f,
                speedKmh = pos.speed * 3.6f,
                lat = pos.lat,
                lng = pos.lng,
            )
            // Ícono = símbolo con dirección de movimiento nativa; se rehace solo si cambió el rumbo.
            // El pánico se muestra con las ondas de radar (RadarPulseOverlay), no en el símbolo.
            val sidc = def?.sidc ?: "SUGP-----------" // desconocido terrestre
            val deg = ((pos.course % 360f) + 360f) % 360f
            val bucket = ((deg / 5f).roundToInt() % 72) * 5
            val ikey = "$bucket"
            if (iconKey[id] != ikey) {
                MilSymbolRenderer.iconFor(sidc, pos.course)?.let { ic ->
                    marker.icon = BitmapDrawable(context.resources, ic.bitmap)
                    marker.setAnchor(ic.anchorU, ic.anchorV)
                    iconKey[id] = ikey
                }
            }
            // Si su tooltip está abierto ahora mismo, reabrirlo: refresca rumbo/
            // velocidad Y reposiciona el globo si la unidad se movió (si no, se
            // queda "colgado" en el punto donde estaba al abrirlo).
            if (unitInfoWindow.openMarker === marker) marker.showInfoWindow()
        }
        mapView.invalidate()
    }

    fun startDownload(zMin: Int, zMax: Int) {
        val bb = dlBbox ?: return
        try {
            val cm = CacheManager(mapView)
            dlDone = 0
            dlTotal = cm.possibleTilesInArea(bb, zMin, zMax)
            dlRunning = true
            // ...NoUI: NO usa el ProgressDialog genérico de osmdroid; el progreso
            // se pinta solo en nuestro diálogo estilizado (DownloadAreaDialog).
            dlTask = cm.downloadAreaAsyncNoUI(
                context, bb, zMin, zMax,
                object : CacheManager.CacheManagerCallback {
                    override fun downloadStarted() {}
                    override fun setPossibleTilesInArea(total: Int) {
                        dlTotal = total
                    }

                    override fun updateProgress(
                        progress: Int,
                        currentZoomLevel: Int,
                        zoomMin: Int,
                        zoomMax: Int
                    ) {
                        dlDone = progress
                    }

                    override fun onTaskComplete() {
                        dlRunning = false
                        dlDialog = false
                        Toast.makeText(
                            context,
                            "Área guardada para uso offline ✓",
                            Toast.LENGTH_SHORT
                        ).show()
                    }

                    override fun onTaskFailed(errors: Int) {
                        dlRunning = false
                        dlDialog = false
                        Toast.makeText(context, "Descarga con $errors errores", Toast.LENGTH_LONG)
                            .show()
                    }
                },
            )
        } catch (t: Throwable) {
            dlRunning = false
            Toast.makeText(
                context,
                "No se pudo descargar: ${t.message ?: t.javaClass.simpleName}",
                Toast.LENGTH_LONG
            ).show()
        }
    }

    fun cancelDownload() {
        dlTask?.cancel(true)
        dlTask = null
        dlRunning = false
        dlDialog = false
    }

    fun clearTileCache() {
        try {
            SqlTileWriter().purgeCache()
            mapView.tileProvider.clearTileCache()
            mapView.invalidate()
            cacheBytes = 0L
            Toast.makeText(context, "Mapas offline eliminados", Toast.LENGTH_SHORT).show()
        } catch (t: Throwable) {
            Toast.makeText(
                context,
                "No se pudo vaciar: ${t.message ?: t.javaClass.simpleName}",
                Toast.LENGTH_LONG
            ).show()
        }
    }

    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val rightDrawerState = rememberDrawerState(DrawerValue.Closed)

    // Actualiza el tamaño del cache cada vez que se abre el cajón.
    LaunchedEffect(drawerState.isOpen) {
        if (drawerState.isOpen) {
            cacheBytes = File(Configuration.getInstance().osmdroidTileCache, "cache.db").length()
        }
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        // Solo se abre con el botón ☰ (evita chocar con el paneo del mapa); se
        // cierra con gesto o tocando fuera.
        gesturesEnabled = drawerState.isOpen,
        drawerContent = {
            MapDrawer(
                offline = offline,
                onToggleOffline = {
                    offline = !offline
                    mapView.setUseDataConnection(!offline)
                },
                satellite = satellite,
                onToggleSatellite = {
                    satellite = !satellite
                    mapView.setTileSource(if (satellite) SEDAM_SATELLITE_SOURCE else SEDAM_TILE_SOURCE)
                    mapView.invalidate()
                },
                onDownload = {
                    scope.launch { drawerState.close() }
                    dlBbox = mapView.boundingBox
                    dlBaseZoom = mapView.zoomLevelDouble.toInt()
                    dlDetail = 3
                    dlRunning = false
                    dlDone = 0
                    dlTotal = 0
                    dlDialog = true
                },
                onLogout = {
                    scope.launch { drawerState.close() }
                    onLogout()
                },
                cacheUsedBytes = cacheBytes,
                cacheMaxBytes = 20L * 1024 * 1024 * 1024,
                onClearCache = { confirmClear = true },
                unitName = myName,
                onEditAlias = {
                    aliasInput = aliases[myId] ?: ""
                    showAliasDialog = true
                },
            )
        },
    ) {
        // Panel DERECHO (unidades): el mismo ModalNavigationDrawer volteado a RTL
        // para que abra por la derecha; el contenido se vuelve a poner LTR.
        CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
            ModalNavigationDrawer(
                drawerState = rightDrawerState,
                gesturesEnabled = rightDrawerState.isOpen,
                drawerContent = {
                    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
                        UnitsDrawer(
                            unitList = unitList,
                            waypointList = wpList,
                            targetList = tgtList,
                            unreadPrivate = unreadPrivate,
                            onUnitClick = { uid ->
                                scope.launch { rightDrawerState.close() }
                                units[uid]?.let { p ->
                                    mapView.controller.animateTo(GeoPoint(p.lat, p.lng))
                                    mapView.controller.setZoom(FOLLOW_ZOOM)
                                }
                            },
                            onUnitChat = { uid ->
                                scope.launch { rightDrawerState.close() }
                                chatThread = uid
                            },
                            onWaypointClick = { key ->
                                scope.launch { rightDrawerState.close() }
                                waypoints[key]?.let {
                                    mapView.controller.animateTo(
                                        GeoPoint(
                                            it.lat,
                                            it.lng
                                        )
                                    ); mapView.controller.setZoom(FOLLOW_ZOOM)
                                }
                            },
                            onWaypointToggleShare = { key ->
                                val w = waypoints[key]
                                if (w?.sharing == true) SessionRepository.stopShareWaypoint(key) else SessionRepository.shareWaypoint(
                                    key
                                )
                            },
                            onWaypointEdit = { key -> editWaypointKey = key },
                            onWaypointDelete = { key -> confirmDeleteWaypointKey = key },
                            onTargetClick = { key ->
                                scope.launch { rightDrawerState.close() }
                                targets[key]?.let {
                                    mapView.controller.animateTo(
                                        GeoPoint(
                                            it.lat,
                                            it.lng
                                        )
                                    ); mapView.controller.setZoom(FOLLOW_ZOOM)
                                }
                            },
                            onTargetToggleShare = { key ->
                                val t = targets[key]
                                if (t?.transmitting == true) SessionRepository.stopTransmitTarget(
                                    key
                                ) else SessionRepository.startTransmitTarget(key)
                            },
                            onTargetEdit = { key -> editTargetKey = key },
                            onTargetDelete = { key -> confirmDeleteTargetKey = key },
                        )
                    }
                },
            ) {
                CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
                    Box(modifier = Modifier
                        .fillMaxSize()
                        .background(Navy)) {
                        AndroidView(factory = { mapView }, modifier = Modifier.fillMaxSize())

                        Box(modifier = Modifier
                            .fillMaxSize()
                            .safeDrawingPadding()) {
                            TopBar(
                                modifier = Modifier.align(Alignment.TopCenter),
                                onMenu = { scope.launch { drawerState.open() } },
                                onUnits = { scope.launch { rightDrawerState.open() } },
                                unitName = myName,
                                unitCount = unitList.size,
                                onChat = { chatThread = GENERAL_CHAT_ID },
                                unreadChat = unreadGeneral + unreadPrivate.values.sum(),
                            )

                            Column(
                                modifier = Modifier
                                    .align(Alignment.BottomEnd)
                                    .padding(24.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                ZoomButton(
                                    icon = Icons.Default.Add,
                                    contentDescription = "Zoom in",
                                    onClick = { mapView.controller.zoomIn() },
                                )

                                ZoomButton(
                                    icon = Icons.Default.Remove,
                                    contentDescription = "Zoom out",
                                    onClick = { mapView.controller.zoomOut() },
                                )

                                LocateButton(
                                    onClick = {
                                        val overlay = locationOverlay
                                        if (overlay != null) {
                                            overlay.enableFollowLocation()
                                            overlay.myLocation?.let {
                                                mapView.controller.animateTo(it)
                                                mapView.controller.setZoom(FOLLOW_ZOOM)
                                            }
                                        } else {
                                            permissionLauncher.launch(Manifest.permission.ACCESS_FINE_LOCATION)
                                        }
                                    },
                                )
                            }

                            // Botón de PÁNICO — lado opuesto al GPS (abajo-izquierda).
                            PanicButton(
                                active = panicActive,
                                modifier = Modifier
                                    .align(Alignment.BottomStart)
                                    .padding(24.dp),
                                onClick = { confirmPanic = true },
                            )

                            Column(
                                modifier = Modifier
                                    .align(Alignment.TopCenter)
                                    .padding(top = 66.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                if (panicActive) PanicBanner(text = "PÁNICO ACTIVO")
                                if (panics.isNotEmpty()) {
                                    PanicBanner(
                                        text = "⚠ EN PÁNICO: ${panics.joinToString(", ") { nameOf(it) }}",
                                        onClick = {
                                            panics.firstOrNull()?.let { pid ->
                                                units[pid]?.let { p ->
                                                    mapView.controller.animateTo(
                                                        GeoPoint(
                                                            p.lat,
                                                            p.lng
                                                        )
                                                    )
                                                    mapView.controller.setZoom(FOLLOW_ZOOM)
                                                }
                                            }
                                        },
                                    )
                                }
                            }

                            HudCorners()
                        }
                    }
                }
            }
        }
    }

    if (chatThread != null && myId != null) {
        ChatOverlay(
            myId = myId!!,
            thread = chatThread,
            onThreadChange = { chatThread = it },
            generalMessages = generalChat,
            privateThreads = privateChats,
            unreadGeneral = unreadGeneral,
            unreadPrivate = unreadPrivate,
            onlineUnits = unitList.map { it.id to it.name },
            nameOf = { nameOf(it) },
            onSendGeneral = { SessionRepository.sendChatGeneral(it) },
            onSendPrivate = { to, text -> SessionRepository.sendChatPrivate(to, text) },
            onMarkGeneralRead = { SessionRepository.markGeneralChatRead() },
            onMarkPrivateRead = { SessionRepository.markPrivateChatRead(it) },
            onDismiss = { chatThread = null },
        )
    }

    chatToast?.let { msg ->
        Box(
            Modifier
                .fillMaxSize()
                .safeDrawingPadding()
                .padding(top = 64.dp),
            contentAlignment = Alignment.TopCenter
        ) {
            ChatToast(
                message = msg,
                title = if (msg.toId == GENERAL_CHAT_ID) "Chat general · ${nameOf(msg.fromId)}" else nameOf(
                    msg.fromId
                ),
                onClick = {
                    chatThread = if (msg.toId == GENERAL_CHAT_ID) GENERAL_CHAT_ID else msg.fromId
                },
                onDismiss = { chatToast = null },
            )
        }
    }

    if (dlDialog) {
        DownloadAreaDialog(
            baseZoom = dlBaseZoom,
            maxZoom = mapView.tileProvider.tileSource.maximumZoomLevel,
            detail = dlDetail,
            onDetailChange = { dlDetail = it },
            estimate = { zMin, zMax ->
                dlBbox?.let { bb ->
                    runCatching {
                        CacheManager(mapView).possibleTilesInArea(
                            bb,
                            zMin,
                            zMax
                        )
                    }.getOrDefault(0)
                } ?: 0
            },
            running = dlRunning,
            done = dlDone,
            total = dlTotal,
            onStart = { zMin, zMax -> startDownload(zMin, zMax) },
            onCancelRunning = { cancelDownload() },
            onDismiss = { if (!dlRunning) dlDialog = false },
        )
    }

    if (confirmClear) {
        AlertDialog(
            onDismissRequest = { confirmClear = false },
            containerColor = NavyDeep,
            titleContentColor = White,
            textContentColor = SteelText,
            title = { Text("¿Vaciar mapas offline?", fontWeight = FontWeight.Bold) },
            text = { Text("Se eliminarán todos los tiles guardados. Podrás volver a descargarlos cuando tengas internet.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmClear = false
                    scope.launch { drawerState.close() }
                    clearTileCache()
                }) {
                    Text(
                        "VACIAR",
                        color = DangerRed,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 1.sp
                    )
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmClear = false }) {
                    Text("CANCELAR", color = SteelText, letterSpacing = 1.sp)
                }
            },
        )
    }

    confirmDeleteWaypointKey?.let { key ->
        val name = waypoints[key]?.name ?: ""
        AlertDialog(
            onDismissRequest = { confirmDeleteWaypointKey = null },
            containerColor = NavyDeep,
            titleContentColor = White,
            textContentColor = SteelText,
            title = { Text("¿Eliminar waypoint?", fontWeight = FontWeight.Bold) },
            text = { Text("Se eliminará \"$name\". Si lo estabas compartiendo, también desaparecerá para los demás.") },
            confirmButton = {
                TextButton(onClick = {
                    SessionRepository.removeWaypoint(key)
                    confirmDeleteWaypointKey = null
                }) {
                    Text(
                        "ELIMINAR",
                        color = DangerRed,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 1.sp
                    )
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmDeleteWaypointKey = null }) {
                    Text("CANCELAR", color = SteelText, letterSpacing = 1.sp)
                }
            },
        )
    }

    confirmDeleteTargetKey?.let { key ->
        val name = targets[key]?.name ?: ""
        AlertDialog(
            onDismissRequest = { confirmDeleteTargetKey = null },
            containerColor = NavyDeep,
            titleContentColor = White,
            textContentColor = SteelText,
            title = { Text("¿Eliminar blanco?", fontWeight = FontWeight.Bold) },
            text = { Text("Se eliminará \"$name\". Si lo estabas transmitiendo, también desaparecerá para los demás.") },
            confirmButton = {
                TextButton(onClick = {
                    SessionRepository.removeTarget(key)
                    confirmDeleteTargetKey = null
                }) {
                    Text(
                        "ELIMINAR",
                        color = DangerRed,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 1.sp
                    )
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmDeleteTargetKey = null }) {
                    Text("CANCELAR", color = SteelText, letterSpacing = 1.sp)
                }
            },
        )
    }

    if (showAliasDialog) {
        AlertDialog(
            onDismissRequest = { showAliasDialog = false },
            containerColor = NavyDeep,
            titleContentColor = White,
            textContentColor = SteelText,
            title = { Text("Mi alias", fontWeight = FontWeight.Bold) },
            text = {
                Column {
                    Text(
                        "Así te verán las demás unidades en el mapa, en vez de tu número.",
                        fontSize = 12.sp,
                        modifier = Modifier.padding(bottom = 10.dp),
                    )
                    OutlinedTextField(
                        value = aliasInput,
                        onValueChange = { aliasInput = it },
                        label = { Text("Alias") },
                        singleLine = true,
                        shape = RoundedCornerShape(8.dp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = White,
                            unfocusedTextColor = OffWhite,
                            focusedContainerColor = FieldFill,
                            unfocusedContainerColor = FieldFill,
                            cursorColor = Gold,
                            focusedBorderColor = Gold,
                            unfocusedBorderColor = FieldLine,
                            focusedLabelColor = GoldBright,
                            unfocusedLabelColor = SteelText,
                        ),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
            confirmButton = {
                TextButton(
                    enabled = aliasInput.isNotBlank(),
                    onClick = {
                        val alias = aliasInput.trim()
                        myId?.let { id -> saveAliasLocally(context, id, alias) }
                        SessionRepository.sendAlias(alias)
                        showAliasDialog = false
                    },
                ) {
                    Text(
                        "GUARDAR",
                        color = Gold,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 1.sp
                    )
                }
            },
            dismissButton = {
                TextButton(onClick = { showAliasDialog = false }) {
                    Text("CANCELAR", color = SteelText, letterSpacing = 1.sp)
                }
            },
        )
    }

    if (confirmPanic) {
        val activating = !panicActive
        AlertDialog(
            onDismissRequest = { confirmPanic = false },
            containerColor = NavyDeep,
            titleContentColor = White,
            textContentColor = SteelText,
            title = {
                Text(
                    if (activating) "¿ACTIVAR PÁNICO?" else "¿Desactivar pánico?",
                    fontWeight = FontWeight.Bold
                )
            },
            text = {
                Text(
                    if (activating) "Se enviará una alerta de emergencia con tu posición al centro de mando."
                    else "Se cancelará la alerta de pánico.",
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmPanic = false
                    panicActive = activating
                    SessionRepository.sendPanic(activating)
                }) {
                    Text(
                        if (activating) "ACTIVAR" else "DESACTIVAR",
                        color = DangerRed,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 1.sp,
                    )
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmPanic = false }) {
                    Text("CANCELAR", color = SteelText, letterSpacing = 1.sp)
                }
            },
        )
    }

    // Menú y diálogos de creación (waypoint / blanco) por long-press.
    createAt?.let { p ->
        CreateObjectMenu(
            lat = p.latitude, lng = p.longitude,
            onWaypoint = { waypointAt = p; createAt = null },
            onTarget = { targetAt = p; createAt = null },
            onDismiss = { createAt = null },
        )
    }
    waypointAt?.let { p ->
        WaypointDialog(
            lat = p.latitude, lng = p.longitude,
            onSave = { sidc, name ->
                SessionRepository.createWaypoint(sidc, name, p.latitude, p.longitude)
                waypointAt = null
            },
            onDismiss = { waypointAt = null },
        )
    }
    targetAt?.let { p ->
        TargetDialog(
            lat = p.latitude, lng = p.longitude,
            onSave = { sidc, name, heading, speed ->
                SessionRepository.createTarget(sidc, name, p.latitude, p.longitude, heading, speed)
                targetAt = null
            },
            onDismiss = { targetAt = null },
        )
    }

    // Edición de un waypoint / blanco propio (mismo diálogo, prellenado).
    editWaypointKey?.let { key ->
        waypoints[key]?.let { w ->
            WaypointDialog(
                lat = w.lat, lng = w.lng,
                initialName = w.name, initialSidc = w.sidc,
                onSave = { sidc, name ->
                    SessionRepository.updateWaypoint(key, sidc, name)
                    editWaypointKey = null
                },
                onDismiss = { editWaypointKey = null },
            )
        }
    }
    editTargetKey?.let { key ->
        targets[key]?.let { t ->
            TargetDialog(
                lat = t.lat, lng = t.lng,
                initialName = t.name, initialSidc = t.sidc,
                initialHeading = t.heading, initialSpeed = t.speed,
                onSave = { sidc, name, heading, speed ->
                    SessionRepository.updateTarget(key, sidc, name, heading, speed)
                    editTargetKey = null
                },
                onDismiss = { editTargetKey = null },
            )
        }
    }
}

// ── Barra superior ────────────────────────────────────────────────────────────

@Composable
private fun TopBar(
    modifier: Modifier = Modifier,
    onMenu: () -> Unit,
    onUnits: () -> Unit,
    onChat: () -> Unit = {},
    unitName: String? = null,
    unitCount: Int = 0,
    unreadChat: Int = 0,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .background(
                Brush.verticalGradient(
                    listOf(
                        Navy.copy(alpha = 0.92f),
                        Navy.copy(alpha = 0f)
                    )
                )
            )
            .padding(horizontal = 6.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onMenu) {
            Icon(
                Icons.Filled.Menu,
                contentDescription = "Menú",
                tint = White,
                modifier = Modifier.size(26.dp)
            )
        }
        Column(Modifier.weight(1f)) {
            Text(
                "MAPA TÁCTICO",
                color = White,
                fontWeight = FontWeight.Bold,
                letterSpacing = 2.sp,
                fontSize = 14.sp
            )
            Text(
                unitName ?: "SEDAM MÓVIL",
                color = if (unitName != null) GoldBright else SteelText,
                fontSize = 10.sp,
                letterSpacing = 2.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        OnlineBadge()
        Spacer(Modifier.width(6.dp))
        // Botón CHAT → abre bandeja de mensajes (general + privados). El contador de
        // no-leídos va AL LADO del ícono (mismo patrón que el botón UNIDADES de abajo),
        // no encima — una insignia superpuesta terminaba tapando el ícono.
        Row(
            modifier = Modifier
                .clip(RoundedCornerShape(8.dp))
                .clickable(onClick = onChat)
                .padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Icon(
                Icons.AutoMirrored.Filled.Chat,
                contentDescription = "Chat",
                tint = if (unreadChat > 0) DangerRed else Gold,
                modifier = Modifier.size(22.dp),
            )
            if (unreadChat > 0) {
                Text(
                    if (unreadChat > 9) "9+" else "$unreadChat",
                    color = DangerRed,
                    fontWeight = FontWeight.Bold,
                    fontSize = 13.sp,
                )
            }
        }
        Spacer(Modifier.width(2.dp))
        // Botón UNIDADES → abre el panel derecho (con contador).
        Row(
            modifier = Modifier
                .clip(RoundedCornerShape(8.dp))
                .clickable(onClick = onUnits)
                .padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Icon(
                Icons.Filled.Groups,
                contentDescription = "Unidades",
                tint = Gold,
                modifier = Modifier.size(22.dp)
            )
            Text("$unitCount", color = GoldBright, fontWeight = FontWeight.Bold, fontSize = 13.sp)
        }
    }
}

@Composable
private fun OnlineBadge() {
    val t = rememberInfiniteTransition(label = "online")
    val a by t.animateFloat(
        initialValue = 0.4f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(900), RepeatMode.Reverse),
        label = "blink",
    )
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        Canvas(modifier = Modifier.size(9.dp)) { drawCircle(OnlineGreen.copy(alpha = a)) }
        Text(
            "EN LÍNEA",
            color = OnlineGreen,
            fontSize = 10.sp,
            letterSpacing = 1.5.sp,
            fontWeight = FontWeight.SemiBold
        )
    }
}

// ── Cajón lateral ─────────────────────────────────────────────────────────────

@Composable
private fun MapDrawer(
    offline: Boolean,
    onToggleOffline: () -> Unit,
    satellite: Boolean,
    onToggleSatellite: () -> Unit,
    onDownload: () -> Unit,
    onLogout: () -> Unit,
    cacheUsedBytes: Long,
    cacheMaxBytes: Long,
    onClearCache: () -> Unit,
    unitName: String? = null,
    onEditAlias: () -> Unit = {},
) {
    ModalDrawerSheet(
        drawerContainerColor = NavyDeep,
        drawerContentColor = OffWhite,
        modifier = Modifier.widthIn(max = 320.dp),
    ) {
        Column(modifier = Modifier
            .fillMaxSize()
            .safeDrawingPadding()
            .padding(16.dp)) {
            // Encabezado con emblema
            Row(verticalAlignment = Alignment.CenterVertically) {
                Image(
                    painter = painterResource(R.drawable.logo_sedam),
                    contentDescription = "SEDAM",
                    modifier = Modifier.size(52.dp),
                )
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        "SEDAM MÓVIL",
                        color = White,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 1.sp,
                        fontSize = 16.sp
                    )
                    Text(
                        unitName ?: "Panel de control",
                        color = if (unitName != null) GoldBright else SteelText,
                        fontSize = 11.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                if (unitName != null) {
                    Icon(
                        Icons.Filled.Edit,
                        contentDescription = "Editar alias",
                        tint = Gold,
                        modifier = Modifier
                            .size(20.dp)
                            .clip(CircleShape)
                            .clickable(onClick = onEditAlias)
                            .padding(2.dp),
                    )
                }
            }

            Spacer(Modifier.height(18.dp))
            HorizontalDivider(color = Gold.copy(alpha = 0.3f))
            Spacer(Modifier.height(10.dp))

            DrawerSectionLabel("MAPA")
            DrawerSwitchItem(
                icon = if (offline) Icons.Filled.CloudOff else Icons.Filled.CloudQueue,
                title = if (offline) "Modo offline" else "Modo online",
                subtitle = if (offline) "Solo mapas guardados" else "Descarga y cachea tiles",
                checked = offline,
                onToggle = onToggleOffline,
            )
            DrawerSwitchItem(
                icon = Icons.Filled.Satellite,
                title = "Capa satelital",
                subtitle = if (satellite) "Híbrido (satélite + nombres)" else "Vista de calles OSM",
                checked = satellite,
                onToggle = onToggleSatellite,
            )
            DrawerItem(
                icon = Icons.Filled.Download,
                title = "Descargar área",
                subtitle = "Guarda la zona visible",
                onClick = onDownload
            )

            Spacer(Modifier.height(12.dp))
            HorizontalDivider(color = Gold.copy(alpha = 0.15f))
            Spacer(Modifier.height(10.dp))
            DrawerSectionLabel("ALMACENAMIENTO OFFLINE")
            DrawerStorageItem(cacheUsedBytes, cacheMaxBytes)
            DrawerItem(
                icon = Icons.Filled.DeleteSweep,
                title = "Vaciar mapas offline",
                subtitle = "Libera espacio",
                onClick = onClearCache
            )

            Spacer(Modifier.weight(1f))
            HorizontalDivider(color = Gold.copy(alpha = 0.2f))
            Spacer(Modifier.height(6.dp))
            DrawerItem(
                icon = Icons.Filled.Logout,
                title = "Cerrar sesión",
                danger = true,
                onClick = onLogout
            )
        }
    }
}

/** Ítem genérico de waypoint/blanco para el panel derecho. */
data class ObjectListItem(
    val key: String,
    val name: String,
    val subtitle: String,
    val icon: ImageBitmap?,
    val mine: Boolean,
    val sidc: String,
    val active: Boolean, // sharing (waypoint) / transmitting (blanco) — solo aplica a "mine"
    val course: Float? = null,   // solo blancos: rumbo (grados)
    val speedKmh: Float? = null, // solo blancos: velocidad (km/h)
)

/** Panel DERECHO con pestañas: UNIDADES / WAYPOINTS / BLANCOS. */
@Composable
private fun UnitsDrawer(
    unitList: List<UnitListItem>,
    waypointList: List<ObjectListItem>,
    targetList: List<ObjectListItem>,
    unreadPrivate: Map<String, Int> = emptyMap(),
    onUnitClick: (String) -> Unit,
    onUnitChat: (String) -> Unit = {},
    onWaypointClick: (String) -> Unit,
    onWaypointToggleShare: (String) -> Unit,
    onWaypointEdit: (String) -> Unit,
    onWaypointDelete: (String) -> Unit,
    onTargetClick: (String) -> Unit,
    onTargetToggleShare: (String) -> Unit,
    onTargetEdit: (String) -> Unit,
    onTargetDelete: (String) -> Unit,
) {
    var tab by remember { mutableStateOf(0) }
    ModalDrawerSheet(
        drawerContainerColor = NavyDeep,
        drawerContentColor = OffWhite,
        modifier = Modifier.widthIn(max = 340.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .safeDrawingPadding()
                .padding(horizontal = 12.dp, vertical = 16.dp)
        ) {
            // Pestañas
            Row(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                DrawerTab("UNIDADES", unitList.size, tab == 0, Modifier.weight(1f)) { tab = 0 }
                DrawerTab("WAYPOINTS", waypointList.size, tab == 1, Modifier.weight(1f)) { tab = 1 }
                DrawerTab("BLANCOS", targetList.size, tab == 2, Modifier.weight(1f)) { tab = 2 }
            }
            Spacer(Modifier.height(10.dp))
            HorizontalDivider(color = Gold.copy(alpha = 0.25f))
            Spacer(Modifier.height(4.dp))

            when (tab) {
                0 -> ListOrEmpty(unitList.isEmpty(), "Sin unidades conectadas") {
                    LazyColumn(Modifier.fillMaxSize()) {
                        itemsIndexed(unitList, key = { _, u -> u.id }) { i, u ->
                            if (i > 0) DrawerRowDivider()
                            UnitRow(
                                u = u,
                                unreadChat = unreadPrivate[u.id] ?: 0,
                                onClick = { onUnitClick(u.id) },
                                onChat = { onUnitChat(u.id) },
                            )
                        }
                    }
                }

                1 -> ListOrEmpty(waypointList.isEmpty(), "Sin waypoints") {
                    LazyColumn(Modifier.fillMaxSize()) {
                        itemsIndexed(waypointList, key = { _, o -> o.key }) { i, o ->
                            if (i > 0) DrawerRowDivider()
                            ObjectRow(
                                o,
                                shareLabel = "Compartir",
                                activeLabel = "Compartiendo",
                                onClick = { onWaypointClick(o.key) },
                                onToggleShare = { onWaypointToggleShare(o.key) },
                                onEdit = { onWaypointEdit(o.key) },
                                onDelete = { onWaypointDelete(o.key) },
                            )
                        }
                    }
                }

                else -> ListOrEmpty(targetList.isEmpty(), "Sin blancos") {
                    LazyColumn(Modifier.fillMaxSize()) {
                        itemsIndexed(targetList, key = { _, o -> o.key }) { i, o ->
                            if (i > 0) DrawerRowDivider()
                            ObjectRow(
                                o,
                                shareLabel = "Transmitir",
                                activeLabel = "Transmitiendo",
                                onClick = { onTargetClick(o.key) },
                                onToggleShare = { onTargetToggleShare(o.key) },
                                onEdit = { onTargetEdit(o.key) },
                                onDelete = { onTargetDelete(o.key) },
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ListOrEmpty(empty: Boolean, emptyText: String, content: @Composable () -> Unit) {
    Box(Modifier.fillMaxSize()) {
        if (empty) {
            Text(
                emptyText,
                color = SteelText.copy(alpha = 0.6f),
                fontSize = 12.sp,
                modifier = Modifier.padding(12.dp)
            )
        } else content()
    }
}

@Composable
fun DrawerRowDivider() =
    HorizontalDivider(color = Gold.copy(alpha = 0.08f), modifier = Modifier.padding(start = 52.dp))

@Composable
private fun DrawerTab(
    label: String,
    count: Int,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(8.dp))
            .background(if (selected) Gold.copy(alpha = 0.18f) else Navy.copy(alpha = 0.4f))
            .clickable(onClick = onClick)
            .padding(vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            label,
            color = if (selected) GoldBright else SteelText,
            fontSize = 10.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.sp
        )
        Text(
            "$count",
            color = if (selected) White else SteelText.copy(alpha = 0.6f),
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold
        )
    }
}

@Composable
private fun ObjectRow(
    o: ObjectListItem,
    shareLabel: String,
    activeLabel: String,
    onClick: () -> Unit,
    onToggleShare: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            modifier = Modifier
                .size(40.dp)
                .clip(CircleShape)
                .background(Navy.copy(alpha = 0.55f))
                .border(
                    if (o.active) 1.5.dp else 1.dp,
                    if (o.active) OnlineGreen else Gold.copy(alpha = 0.25f),
                    CircleShape
                ),
            contentAlignment = Alignment.Center,
        ) {
            if (o.icon != null) Image(
                bitmap = o.icon,
                contentDescription = null,
                modifier = Modifier.size(30.dp)
            )
        }
        Column(Modifier.weight(1f)) {
            Text(
                o.name,
                color = White,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                if (o.mine && o.active) {
                    Canvas(Modifier.size(6.dp)) { drawCircle(OnlineGreen) }
                }
                Text(
                    if (o.mine && o.active) activeLabel else o.subtitle,
                    color = if (o.mine && o.active) OnlineGreen else SteelText.copy(alpha = 0.7f),
                    fontSize = 10.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
            // Rumbo/velocidad (solo blancos, igual estilo que las unidades).
            if (o.course != null) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(5.dp)
                ) {
                    Icon(
                        painter = painterResource(R.drawable.ic_course_arrow),
                        contentDescription = null,
                        tint = GoldBright,
                        modifier = Modifier
                            .size(11.dp)
                            .rotate(o.course),
                    )
                    Text(
                        "${o.course.roundToInt()}°  ·  ${
                            String.format(
                                Locale.US,
                                "%.1f",
                                o.speedKmh ?: 0f
                            )
                        } km/h",
                        color = SteelText.copy(alpha = 0.75f),
                        fontSize = 10.sp,
                    )
                }
            }
        }
        // Solo el dueño puede compartir/transmitir, editar o eliminar.
        if (o.mine) {
            Icon(
                if (o.active) Icons.Filled.CloudQueue else Icons.Filled.CloudOff,
                contentDescription = shareLabel,
                tint = if (o.active) OnlineGreen else SteelText,
                modifier = Modifier
                    .size(20.dp)
                    .clip(CircleShape)
                    .clickable(onClick = onToggleShare)
                    .padding(1.dp),
            )
            Icon(
                Icons.Filled.Edit,
                contentDescription = "Editar",
                tint = Gold,
                modifier = Modifier
                    .size(19.dp)
                    .clip(CircleShape)
                    .clickable(onClick = onEdit)
                    .padding(1.dp),
            )
            Icon(
                Icons.Filled.Close,
                contentDescription = "Eliminar",
                tint = DangerRed.copy(alpha = 0.8f),
                modifier = Modifier
                    .size(20.dp)
                    .clip(CircleShape)
                    .clickable(onClick = onDelete)
                    .padding(2.dp),
            )
        }
    }
}


/** Ítem de la lista de unidades conectadas del cajón. */
data class UnitListItem(
    val id: String,
    val name: String,
    val course: Float,
    val speedKmh: Float,
    val icon: ImageBitmap?,
    val panic: Boolean = false,
)

@Composable
private fun UnitRow(
    u: UnitListItem,
    unreadChat: Int = 0,
    onClick: () -> Unit,
    onChat: () -> Unit = {}
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            modifier = Modifier
                .size(40.dp)
                .clip(CircleShape)
                .background(Navy.copy(alpha = 0.55f))
                .border(
                    if (u.panic) 1.5.dp else 1.dp,
                    if (u.panic) DangerRed else Gold.copy(alpha = 0.25f),
                    CircleShape
                ),
            contentAlignment = Alignment.Center,
        ) {
            if (u.icon != null) {
                Image(bitmap = u.icon, contentDescription = null, modifier = Modifier.size(30.dp))
            }
        }
        Column(Modifier.weight(1f)) {
            Text(
                u.name,
                color = if (u.panic) DangerRed else White,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(2.dp))
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(5.dp)
            ) {
                Icon(
                    painter = painterResource(R.drawable.ic_course_arrow),
                    contentDescription = null,
                    tint = GoldBright,
                    modifier = Modifier
                        .size(11.dp)
                        .rotate(u.course),
                )
                Text(
                    "${u.course.roundToInt()}°  ·  ${
                        String.format(
                            Locale.US,
                            "%.1f",
                            u.speedKmh
                        )
                    } km/h",
                    color = SteelText.copy(alpha = 0.75f),
                    fontSize = 10.sp,
                )
            }
        }
        Box(
            modifier = Modifier
                .clip(CircleShape)
                .clickable(onClick = onChat)
                .padding(6.dp),
            contentAlignment = Alignment.Center,
        ) {
            // Poco espacio en esta fila para otra insignia superpuesta: el propio ícono
            // cambia a rojo (y un poco más grande) cuando hay mensajes sin leer.
            Icon(
                Icons.AutoMirrored.Filled.Chat,
                contentDescription = if (unreadChat > 0) "Chat con ${u.name} ($unreadChat sin leer)" else "Chat con ${u.name}",
                tint = if (unreadChat > 0) DangerRed else Gold,
                modifier = Modifier.size(if (unreadChat > 0) 21.dp else 19.dp),
            )
        }
    }
}

@Composable
fun DrawerSectionLabel(text: String) {
    Text(
        text,
        color = SteelText,
        fontSize = 10.sp,
        letterSpacing = 2.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp),
    )
}

@Composable
private fun DrawerItem(
    icon: ImageVector,
    title: String,
    subtitle: String? = null,
    enabled: Boolean = true,
    danger: Boolean = false,
    onClick: () -> Unit,
) {
    val tint = when {
        !enabled -> SteelText.copy(alpha = 0.45f)
        danger -> DangerRed
        else -> Gold
    }
    val titleColor = when {
        !enabled -> SteelText.copy(alpha = 0.45f)
        danger -> DangerRed
        else -> OffWhite
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(22.dp))
        Column(Modifier.weight(1f)) {
            Text(title, color = titleColor, fontSize = 15.sp, fontWeight = FontWeight.Medium)
            if (subtitle != null) Text(
                subtitle,
                color = SteelText.copy(alpha = 0.65f),
                fontSize = 11.sp
            )
        }
    }
}

@Composable
private fun DrawerStorageItem(usedBytes: Long, maxBytes: Long) {
    val usedGb = usedBytes / 1024.0 / 1024.0 / 1024.0
    val maxGb = maxBytes / 1024.0 / 1024.0 / 1024.0
    val frac = if (maxBytes > 0) (usedBytes.toFloat() / maxBytes).coerceIn(0f, 1f) else 0f
    Column(modifier = Modifier
        .fillMaxWidth()
        .padding(horizontal = 12.dp, vertical = 10.dp)) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Icon(
                Icons.Filled.Storage,
                contentDescription = null,
                tint = Gold,
                modifier = Modifier.size(22.dp)
            )
            Column(Modifier.weight(1f)) {
                Text(
                    "Almacenamiento",
                    color = OffWhite,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Medium
                )
                Text(
                    "%.2f GB de %.0f GB usados".format(usedGb, maxGb),
                    color = SteelText.copy(alpha = 0.65f),
                    fontSize = 11.sp,
                )
            }
        }
        Spacer(Modifier.height(8.dp))
        LinearProgressIndicator(
            progress = { frac },
            color = Gold,
            trackColor = FieldLine,
            modifier = Modifier
                .fillMaxWidth()
                .height(4.dp),
        )
    }
}

@Composable
private fun DrawerSwitchItem(
    icon: ImageVector,
    title: String,
    subtitle: String,
    checked: Boolean,
    onToggle: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .clickable(onClick = onToggle)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Icon(icon, contentDescription = null, tint = Gold, modifier = Modifier.size(22.dp))
        Column(Modifier.weight(1f)) {
            Text(title, color = OffWhite, fontSize = 15.sp, fontWeight = FontWeight.Medium)
            Text(subtitle, color = SteelText.copy(alpha = 0.65f), fontSize = 11.sp)
        }
        Switch(
            checked = checked,
            onCheckedChange = { onToggle() },
            colors = SwitchDefaults.colors(
                checkedThumbColor = Navy,
                checkedTrackColor = Gold,
                checkedBorderColor = Gold,
                uncheckedThumbColor = SteelText,
                uncheckedTrackColor = Navy.copy(alpha = 0.5f),
                uncheckedBorderColor = SteelText.copy(alpha = 0.4f),
            ),
        )
    }
}

// ── Botón flotante: centrar en la unidad ──────────────────────────────────────

@Composable
private fun PanicButton(active: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val t = rememberInfiniteTransition(label = "panic")
    val pulse by t.animateFloat(
        0.55f,
        1f,
        infiniteRepeatable(tween(650), RepeatMode.Reverse),
        label = "p"
    )
    Box(
        modifier = modifier
            .size(56.dp)
            .clip(CircleShape)
            .background(DangerRed.copy(alpha = if (active) pulse else 0.92f))
            .border(2.dp, White.copy(alpha = 0.85f), CircleShape)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            Icons.Filled.Warning,
            contentDescription = "Pánico",
            tint = White,
            modifier = Modifier.size(28.dp)
        )
    }
}

@Composable
private fun PanicBanner(
    text: String,
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null
) {
    val t = rememberInfiniteTransition(label = "panicBanner")
    val a by t.animateFloat(
        0.5f,
        1f,
        infiniteRepeatable(tween(600), RepeatMode.Reverse),
        label = "a"
    )
    Row(
        modifier = modifier
            .widthIn(max = 340.dp)
            .clip(RoundedCornerShape(999.dp))
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .background(DangerRed.copy(alpha = a))
            .padding(horizontal = 16.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(
            Icons.Filled.Warning,
            contentDescription = null,
            tint = White,
            modifier = Modifier.size(16.dp)
        )
        Text(
            text,
            color = White,
            fontWeight = FontWeight.Bold,
            letterSpacing = 1.sp,
            fontSize = 12.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun ZoomButton(
    modifier: Modifier = Modifier,
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit
) {
    Box(
        modifier = modifier
            .size(52.dp)
            .clip(CircleShape)
            .background(Navy.copy(alpha = 0.85f))
            .border(1.5.dp, Gold, CircleShape)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = contentDescription,
            tint = Gold,
            modifier = Modifier.size(28.dp),
        )
    }
}

@Composable
private fun LocateButton(modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier = modifier
            .size(52.dp)
            .clip(CircleShape)
            .background(Navy.copy(alpha = 0.85f))
            .border(1.5.dp, Gold, CircleShape)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Canvas(modifier = Modifier.size(24.dp)) {
            val r = size.minDimension / 2f
            drawCircle(Gold, radius = r * 0.62f, style = Stroke(1.5.dp.toPx()))
            drawCircle(Gold, radius = r * 0.12f)
            drawLine(
                Gold,
                Offset(size.width / 2, 0f),
                Offset(size.width / 2, size.height * 0.22f),
                1.5.dp.toPx()
            )
            drawLine(
                Gold,
                Offset(size.width / 2, size.height * 0.78f),
                Offset(size.width / 2, size.height),
                1.5.dp.toPx()
            )
            drawLine(
                Gold,
                Offset(0f, size.height / 2),
                Offset(size.width * 0.22f, size.height / 2),
                1.5.dp.toPx()
            )
            drawLine(
                Gold,
                Offset(size.width * 0.78f, size.height / 2),
                Offset(size.width, size.height / 2),
                1.5.dp.toPx()
            )
        }
    }
}

// ── Diálogo de descarga de área ───────────────────────────────────────────────

/**
 * Diálogo con identidad SEDAM: elige nivel de detalle (zoom), muestra estimación
 * en vivo (tiles + MB) y, al descargar, barra de progreso con botón cancelar.
 */
@Composable
private fun DownloadAreaDialog(
    baseZoom: Int,
    maxZoom: Int,
    detail: Int,
    onDetailChange: (Int) -> Unit,
    estimate: (Int, Int) -> Int,
    running: Boolean,
    done: Int,
    total: Int,
    onStart: (Int, Int) -> Unit,
    onCancelRunning: () -> Unit,
    onDismiss: () -> Unit,
) {
    val zMin = baseZoom.coerceIn(3, maxZoom)
    val zMax = (baseZoom + detail).coerceIn(zMin, maxZoom)
    val count = if (running) total else estimate(zMin, zMax)
    val sizeMb = count * 20 / 1024
    val tooBig = count > 8000

    Dialog(onDismissRequest = { if (!running) onDismiss() }) {
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = NavyDeep,
            border = BorderStroke(1.dp, Gold.copy(alpha = 0.3f)),
        ) {
            Column(modifier = Modifier.padding(22.dp)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Icon(
                        Icons.Filled.Download,
                        contentDescription = null,
                        tint = Gold,
                        modifier = Modifier.size(24.dp)
                    )
                    Text(
                        "Descargar mapa de la zona",
                        color = White,
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp
                    )
                }
                Spacer(Modifier.height(16.dp))

                if (!running) {
                    Text(
                        "NIVEL DE DETALLE",
                        color = SteelText,
                        fontSize = 10.sp,
                        letterSpacing = 2.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                    Spacer(Modifier.height(8.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        DetailChip(
                            "General",
                            detail == 1,
                            Modifier.weight(1f)
                        ) { onDetailChange(1) }
                        DetailChip(
                            "Detallado",
                            detail == 3,
                            Modifier.weight(1f)
                        ) { onDetailChange(3) }
                        DetailChip("Máximo", detail == 5, Modifier.weight(1f)) { onDetailChange(5) }
                    }
                    Spacer(Modifier.height(16.dp))
                    Text("Zoom $zMin – $zMax", color = SteelText, fontSize = 12.sp)
                    Text(
                        "≈ ${"%,d".format(count)} tiles · ~$sizeMb MB",
                        color = GoldBright,
                        fontWeight = FontWeight.Bold,
                        fontSize = 15.sp,
                    )
                    if (tooBig) {
                        Spacer(Modifier.height(6.dp))
                        Text(
                            "Zona muy grande. Baja el detalle o acerca el mapa.",
                            color = DangerRed,
                            fontSize = 11.sp
                        )
                    }
                    Spacer(Modifier.height(18.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.End
                    ) {
                        TextButton(onClick = onDismiss) {
                            Text("CANCELAR", color = SteelText, letterSpacing = 1.sp)
                        }
                        Spacer(Modifier.width(4.dp))
                        Button(
                            onClick = { onStart(zMin, zMax) },
                            enabled = count in 1..8000,
                            shape = RoundedCornerShape(6.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = Gold,
                                contentColor = Navy
                            ),
                        ) {
                            Text("DESCARGAR", fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
                        }
                    }
                } else {
                    val frac = if (total > 0) done.toFloat() / total else 0f
                    val pct = (frac * 100).toInt()
                    Text(
                        "Descargando…  $done / $total  ($pct%)",
                        color = OffWhite,
                        fontSize = 13.sp
                    )
                    Spacer(Modifier.height(10.dp))
                    LinearProgressIndicator(
                        progress = { frac.coerceIn(0f, 1f) },
                        color = Gold,
                        trackColor = FieldLine,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(6.dp),
                    )
                    Spacer(Modifier.height(18.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.End
                    ) {
                        Button(
                            onClick = onCancelRunning,
                            shape = RoundedCornerShape(6.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = DangerRed,
                                contentColor = White
                            ),
                        ) {
                            Text("CANCELAR", fontWeight = FontWeight.Bold, letterSpacing = 1.sp)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun DetailChip(
    label: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    val bg = if (selected) Gold else Navy.copy(alpha = 0.5f)
    val fg = if (selected) Navy else SteelText
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(8.dp))
            .background(bg)
            .border(1.dp, Gold.copy(alpha = 0.5f), RoundedCornerShape(8.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = fg, fontSize = 11.sp, fontWeight = FontWeight.Bold)
    }
}
