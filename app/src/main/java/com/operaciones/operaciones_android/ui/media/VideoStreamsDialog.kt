package com.operaciones.operaciones_android.ui.media

import android.app.Dialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.operaciones.operaciones_android.R
import com.operaciones.operaciones_android.config.ApiConfig
import com.operaciones.operaciones_android.model.EquipoItem
import com.operaciones.operaciones_android.model.PersonalItem
import com.operaciones.operaciones_android.network.EquipoRepository
import com.operaciones.operaciones_android.network.PersonalRepository
import com.operaciones.operaciones_android.streaming.MediaStreamingService
import com.operaciones.operaciones_android.ui.adapter.CameraGridAdapter
import com.operaciones.operaciones_android.ui.adapter.CameraSlotItem
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import java.io.IOException

class VideoStreamsDialog(
    private val activity: AppCompatActivity,
    private val operationId: Int,
    private val token: String,
    private val currentUserId: Int = -1,
    private val currentUserName: String = "",
    private val onToggleMyBroadcast: () -> Unit
) {
    private var dialog: Dialog? = null
    private val client = OkHttpClient()
    private val handler = Handler(Looper.getMainLooper())
    private val personalRepo = PersonalRepository(client)
    private val equipoRepo = EquipoRepository(client)

    private var activeTabMode = TabMode.COMUNICACIONES
    private var personalList: List<PersonalItem> = emptyList()
    private var equiposList: List<EquipoItem> = emptyList()
    private var activeStreams: List<StreamItem> = emptyList()

    private var tabComunicaciones: LinearLayout? = null
    private var ivTabComunicacionesIcon: ImageView? = null
    private var tvTabComunicacionesText: TextView? = null

    private var tabDron: LinearLayout? = null
    private var ivTabDronIcon: ImageView? = null
    private var tvTabDronText: TextView? = null

    private var rvCameraGrid: RecyclerView? = null
    private var cameraAdapter: CameraGridAdapter? = null
    private var cardRtmpUrl: LinearLayout? = null
    private var tvRtmpUrl: TextView? = null

    private enum class TabMode {
        COMUNICACIONES,
        DRON
    }

    private val pollRunnable = object : Runnable {
        override fun run() {
            fetchActiveStreams()
            handler.postDelayed(this, 4000)
        }
    }

    data class StreamItem(
        val idStream: Int,
        val label: String,
        val sourceType: String,
        val protocol: String,
        val playbackUrl: String,
        val idPersonal: Int?,
        val idEquipo: Int?
    )

    fun show() {
        if (operationId <= 0) {
            Toast.makeText(activity, "Selecciona una operación activa.", Toast.LENGTH_SHORT).show()
            return
        }

        dialog = Dialog(activity, android.R.style.Theme_Black_NoTitleBar_Fullscreen).apply {
            setContentView(R.layout.dialog_video_streams)
            window?.setBackgroundDrawable(ColorDrawable(Color.parseColor("#0A1424")))
            window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        bindViews(dialog!!)
        setupListeners()
        setupRecyclerView()

        updateTabState()
        fetchOperationData()
        fetchActiveStreams()
        handler.post(pollRunnable)

        dialog?.setOnDismissListener {
            handler.removeCallbacks(pollRunnable)
        }

        dialog?.show()
    }

    private fun bindViews(d: Dialog) {
        tabComunicaciones = d.findViewById(R.id.tabComunicaciones)
        ivTabComunicacionesIcon = d.findViewById(R.id.ivTabComunicacionesIcon)
        tvTabComunicacionesText = d.findViewById(R.id.tvTabComunicacionesText)

        tabDron = d.findViewById(R.id.tabDron)
        ivTabDronIcon = d.findViewById(R.id.ivTabDronIcon)
        tvTabDronText = d.findViewById(R.id.tvTabDronText)

        rvCameraGrid = d.findViewById(R.id.rvCameraGrid)
        cardRtmpUrl = d.findViewById(R.id.cardRtmpUrl)
        tvRtmpUrl = d.findViewById(R.id.tvRtmpUrl)

        val defaultRtmpUrl = "${ApiConfig.RTMP_PUBLISH_BASE_URL}/dron01"
        tvRtmpUrl?.text = defaultRtmpUrl
    }

    private fun setupListeners() {
        dialog?.findViewById<ImageButton>(R.id.btnCloseVideoModal)?.setOnClickListener {
            dialog?.dismiss()
        }

        tabComunicaciones?.setOnClickListener {
            if (activeTabMode != TabMode.COMUNICACIONES) {
                activeTabMode = TabMode.COMUNICACIONES
                updateTabState()
                renderCurrentGrid()
            }
        }

        tabDron?.setOnClickListener {
            if (activeTabMode != TabMode.DRON) {
                activeTabMode = TabMode.DRON
                updateTabState()
                renderCurrentGrid()
            }
        }

        cardRtmpUrl?.setOnClickListener {
            val url = tvRtmpUrl?.text?.toString() ?: return@setOnClickListener
            val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
            val clip = ClipData.newPlainText("RTMP PUSH URL", url)
            clipboard?.setPrimaryClip(clip)
            Toast.makeText(activity, "URL RTMP copiada al portapapeles", Toast.LENGTH_SHORT).show()
        }
    }

    private fun setupRecyclerView() {
        val spanCount = if (activity.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE) 3 else 2
        cameraAdapter = CameraGridAdapter(
            onToggleBroadcast = {
                onToggleMyBroadcast()
                renderCurrentGrid()
            },
            onCardDoubleTap = { slot, slots ->
                openFullscreenStream(slot, slots)
            }
        )
        rvCameraGrid?.layoutManager = GridLayoutManager(activity, spanCount)
        rvCameraGrid?.adapter = cameraAdapter
    }

    private fun openFullscreenStream(selectedSlot: CameraSlotItem, slots: List<CameraSlotItem>) {
        if (slots.isEmpty()) return

        val fullscreenDialog = Dialog(activity, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
        fullscreenDialog.setContentView(R.layout.dialog_fullscreen_stream)
        fullscreenDialog.window?.setBackgroundDrawable(ColorDrawable(Color.parseColor("#060C17")))
        fullscreenDialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)

        val tvTitle = fullscreenDialog.findViewById<TextView>(R.id.tvFullscreenTitle)
        val tvCounter = fullscreenDialog.findViewById<TextView>(R.id.tvFullscreenCounter)
        val btnClose = fullscreenDialog.findViewById<ImageButton>(R.id.btnCloseFullscreen)
        val containerNative = fullscreenDialog.findViewById<FrameLayout>(R.id.fullscreenNativeContainer)
        val containerWeb = fullscreenDialog.findViewById<WebView>(R.id.fullscreenWebView)
        val containerWaiting = fullscreenDialog.findViewById<LinearLayout>(R.id.fullscreenWaitingContainer)
        val tvWaitingBadge = fullscreenDialog.findViewById<TextView>(R.id.tvFullscreenWaitingBadge)
        val fullscreenTouchOverlay = fullscreenDialog.findViewById<View>(R.id.fullscreenTouchOverlay)

        btnClose.setOnClickListener {
            fullscreenDialog.dismiss()
        }

        var currentIndex = slots.indexOfFirst { it.id == selectedSlot.id }.coerceAtLeast(0)

        fun bindStream(slot: CameraSlotItem) {
            tvTitle.text = slot.name
            tvCounter.text = "${currentIndex + 1}/${slots.size}"

            val videoTrack = MediaStreamingService.activeVideoTrack
            val eglBase = MediaStreamingService.activeEglBase

            if (slot.isSelf && slot.isLive && videoTrack != null && eglBase != null) {
                containerWaiting.visibility = View.GONE
                containerWeb.visibility = View.GONE
                containerNative.visibility = View.VISIBLE
                containerNative.removeAllViews()

                val renderer = SurfaceViewRenderer(activity).apply {
                    init(eglBase.eglBaseContext, null)
                    setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FIT)
                    setMirror(false)
                    setEnableHardwareScaler(true)
                }

                try {
                    videoTrack.addSink(renderer)
                } catch (_: Exception) {}

                containerNative.addView(
                    renderer,
                    FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                )
            } else if (slot.isLive && !slot.playbackUrl.isNullOrBlank()) {
                containerNative.visibility = View.GONE
                containerWaiting.visibility = View.GONE
                containerWeb.visibility = View.VISIBLE

                containerWeb.settings.javaScriptEnabled = true
                containerWeb.settings.domStorageEnabled = true
                containerWeb.settings.mediaPlaybackRequiresUserGesture = false
                containerWeb.settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                containerWeb.webChromeClient = WebChromeClient()
                containerWeb.webViewClient = WebViewClient()

                val rawUrl = slot.playbackUrl
                val uri = Uri.parse(ApiConfig.BASE_URL)
                val host = uri.host ?: "192.168.202.112"

                val hlsUrl = when {
                    rawUrl.startsWith("http://") || rawUrl.startsWith("https://") -> rawUrl
                    rawUrl.startsWith("/runtime/ffmpeg-streams/") -> "http://$host:3000/Operaciones$rawUrl"
                    rawUrl.startsWith("/Operaciones/") -> "http://$host:3000$rawUrl"
                    rawUrl.startsWith("/") -> "http://$host:3001$rawUrl"
                    else -> "${ApiConfig.BASE_URL}/$rawUrl"
                }

                val playerHtml = """
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <style>
                            body, html { margin:0; padding:0; background:#060C17; width:100%; height:100%; display:flex; justify-content:center; align-items:center; overflow:hidden; }
                            video { width:100%; height:100%; object-fit:contain; background:#000; }
                        </style>
                        <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
                    </head>
                    <body>
                        <video id="video" controls autoplay playsinline muted></video>
                        <script>
                            var video = document.getElementById('video');
                            var videoSrc = '$hlsUrl';
                            if (Hls.isSupported() && (videoSrc.includes('.m3u8') || videoSrc.includes('/ffmpeg-streams/'))) {
                                var hls = new Hls({ manifestLoadingTimeOut: 5000 });
                                hls.loadSource(videoSrc);
                                hls.attachMedia(video);
                                hls.on(Hls.Events.MANIFEST_PARSED, function() { video.play().catch(function(){}); });
                            } else {
                                video.src = videoSrc;
                                video.play().catch(function(){});
                            }
                        </script>
                    </body>
                    </html>
                """.trimIndent()

                containerWeb.loadDataWithBaseURL(ApiConfig.BASE_URL, playerHtml, "text/html", "UTF-8", null)
            } else {
                containerNative.visibility = View.GONE
                containerWeb.visibility = View.GONE
                containerWaiting.visibility = View.VISIBLE
                val badgeText = if (slot.isSelf) "Sin transmisión activa" else if (slot.protocol.uppercase() == "WEBRTC") "Esperando señal WEBRTC" else "ESPERANDO SEÑAL"
                tvWaitingBadge.text = badgeText
            }
        }

        bindStream(slots[currentIndex])

        val gestureDetector = GestureDetector(activity, object : GestureDetector.SimpleOnGestureListener() {
            private val SWIPE_THRESHOLD = 80
            private val SWIPE_VELOCITY_THRESHOLD = 80

            override fun onDown(e: MotionEvent): Boolean = true

            override fun onFling(
                e1: MotionEvent?,
                e2: MotionEvent,
                velocityX: Float,
                velocityY: Float
            ): Boolean {
                if (e1 == null) return false
                val diffX = e2.x - e1.x
                val diffY = e2.y - e1.y

                if (Math.abs(diffX) > Math.abs(diffY)) {
                    if (Math.abs(diffX) > SWIPE_THRESHOLD && Math.abs(velocityX) > SWIPE_VELOCITY_THRESHOLD) {
                        if (diffX < 0) {
                            // Swipe a la Izquierda -> Siguiente Cámara
                            currentIndex = (currentIndex + 1) % slots.size
                            bindStream(slots[currentIndex])
                        } else {
                            // Swipe a la Derecha -> Cámara Anterior
                            currentIndex = if (currentIndex - 1 < 0) slots.size - 1 else currentIndex - 1
                            bindStream(slots[currentIndex])
                        }
                        return true
                    }
                }
                return false
            }

            override fun onDoubleTap(e: MotionEvent): Boolean {
                fullscreenDialog.dismiss()
                return true
            }
        })

        fullscreenTouchOverlay?.setOnTouchListener { _, event ->
            gestureDetector.onTouchEvent(event)
            true
        }

        fullscreenDialog.show()
    }

    private fun updateTabState() {
        if (activeTabMode == TabMode.COMUNICACIONES) {
            tabComunicaciones?.setBackgroundResource(R.drawable.bg_map_drawer_action_selected)
            ivTabComunicacionesIcon?.setColorFilter(Color.parseColor("#38BDF8"))
            tvTabComunicacionesText?.setTextColor(Color.parseColor("#38BDF8"))

            tabDron?.setBackgroundResource(0)
            ivTabDronIcon?.setColorFilter(Color.parseColor("#94A3B8"))
            tvTabDronText?.setTextColor(Color.parseColor("#94A3B8"))
        } else {
            tabDron?.setBackgroundResource(R.drawable.bg_map_drawer_action_selected)
            ivTabDronIcon?.setColorFilter(Color.parseColor("#F59E0B"))
            tvTabDronText?.setTextColor(Color.parseColor("#F59E0B"))

            tabComunicaciones?.setBackgroundResource(0)
            ivTabComunicacionesIcon?.setColorFilter(Color.parseColor("#94A3B8"))
            tvTabComunicacionesText?.setTextColor(Color.parseColor("#94A3B8"))
        }
    }

    private fun fetchOperationData() {
        personalRepo.fetchPersonal(operationId, token, onSuccess = { list ->
            activity.runOnUiThread {
                personalList = list
                renderCurrentGrid()
            }
        }, onError = {})

        equipoRepo.fetchEquipos(operationId, token, onSuccess = { list ->
            activity.runOnUiThread {
                equiposList = list
                renderCurrentGrid()
            }
        }, onError = {})
    }

    private fun fetchActiveStreams() {
        if (token.isBlank() || operationId <= 0) return

        val request = Request.Builder()
            .url("${ApiConfig.BASE_URL}/ops/$operationId/streams?status=ACTIVE")
            .addHeader("Authorization", "Bearer $token")
            .get()
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {}

            override fun onResponse(call: Call, response: Response) {
                val bodyStr = response.body?.string() ?: return
                try {
                    val json = JSONObject(bodyStr)
                    if (!json.optBoolean("ok")) return
                    val items = json.optJSONArray("items") ?: JSONArray()
                    val list = mutableListOf<StreamItem>()
                    for (i in 0 until items.length()) {
                        val obj = items.getJSONObject(i)
                        list.add(
                            StreamItem(
                                idStream = obj.optInt("id_stream"),
                                label = obj.optString("label", "Stream"),
                                sourceType = obj.optString("source_type", "ANDROID"),
                                protocol = obj.optString("protocol", "WEBRTC"),
                                playbackUrl = obj.optString("playback_url").ifBlank { obj.optString("rtmp_playback_url", "") },
                                idPersonal = if (obj.has("id_personal") && !obj.isNull("id_personal")) obj.optInt("id_personal") else null,
                                idEquipo = if (obj.has("id_equipo") && !obj.isNull("id_equipo")) obj.optInt("id_equipo") else null
                            )
                        )
                    }
                    activity.runOnUiThread {
                        activeStreams = list
                        renderCurrentGrid()
                    }
                } catch (_: Exception) {}
            }
        })
    }

    private fun abbreviatePuesto(puesto: String): String {
        val clean = puesto.trim()
        if (clean.isBlank()) return ""

        val upper = clean.uppercase()
        return when {
            upper.contains("SUBTENIENTE") -> "Subtte."
            upper.contains("TENIENTE") -> "Tte."
            upper.contains("CAPITAN") || upper.contains("CAPITÁN") -> "Cap."
            upper.contains("MAYOR") -> "May."
            upper.contains("CORONEL") -> "Cnel."
            upper.contains("GENERAL") -> "Gral."
            upper.contains("SUBCOMANDANTE") -> "Subcmdt."
            upper.contains("COMANDANTE") -> "Cmdt."
            upper.contains("SARGENTO") -> "Sgto."
            upper.contains("CABO") -> "Cbo."
            upper.contains("SOLDADO") -> "Sdo."
            upper.contains("AGENTE") -> "Agt."
            upper.contains("OFICIAL") -> "Of."
            upper.contains("INSPECTOR") -> "Insp."
            upper.contains("PARAMEDICO") || upper.contains("PARAMÉDICO") -> "Prm."
            clean.length <= 4 -> "$clean."
            else -> "${clean.take(3).lowercase().replaceFirstChar { it.uppercase() }}."
        }
    }

    private fun renderCurrentGrid() {
        val slots = mutableListOf<CameraSlotItem>()

        if (activeTabMode == TabMode.COMUNICACIONES) {
            if (personalList.isNotEmpty()) {
                personalList.forEach { p ->
                    val fullName = listOf(p.nombre, p.apellido).filter { it.isNotBlank() }.joinToString(" ")
                    val baseLabel = fullName.ifBlank { p.apodo.ifBlank { "Agente ${p.idPersonal}" } }
                    val isMe = (currentUserId > 0 && p.idPersonal == currentUserId) ||
                            (currentUserName.isNotBlank() && (
                                baseLabel.contains(currentUserName, ignoreCase = true) ||
                                currentUserName.contains(p.nombre, ignoreCase = true)
                            ))

                    val rankAbbr = abbreviatePuesto(p.puesto)
                    val nameWithRank = if (rankAbbr.isNotBlank()) "$rankAbbr $baseLabel" else baseLabel
                    val displayLabel = if (isMe) "$nameWithRank (yo)" else nameWithRank

                    val activeStream = activeStreams.find { s ->
                        (s.idPersonal != null && s.idPersonal == p.idPersonal) ||
                        (p.nombre.isNotBlank() && s.label.contains(p.nombre, ignoreCase = true)) ||
                        (p.apellido.isNotBlank() && s.label.contains(p.apellido, ignoreCase = true)) ||
                        (isMe && currentUserName.isNotBlank() && s.label.contains(currentUserName, ignoreCase = true))
                    } ?: if (isMe && MediaStreamingService.isRunning) activeStreams.firstOrNull { it.sourceType.equals("ANDROID", ignoreCase = true) } else null

                    val isLiveNow = (activeStream != null) || (isMe && MediaStreamingService.isRunning)
                    val streamPlaybackUrl = activeStream?.playbackUrl.orEmpty()
                    val playback = if (streamPlaybackUrl.isNotBlank()) {
                        streamPlaybackUrl
                    } else if (activeStream != null && activeStream.idStream > 0) {
                        "${ApiConfig.HLS_PLAYBACK_BASE_URL}/stream_${activeStream.idStream}/index.m3u8"
                    } else if (isMe && MediaStreamingService.isRunning) {
                        val anyAndroid = activeStreams.firstOrNull { it.sourceType.equals("ANDROID", ignoreCase = true) }
                        if (anyAndroid != null) {
                            anyAndroid.playbackUrl.ifBlank { "${ApiConfig.HLS_PLAYBACK_BASE_URL}/stream_${anyAndroid.idStream}/index.m3u8" }
                        } else {
                            "${ApiConfig.HLS_PLAYBACK_BASE_URL}/stream_live/index.m3u8"
                        }
                    } else {
                        null
                    }

                    slots.add(
                        CameraSlotItem(
                            id = "p-${p.idPersonal}",
                            name = displayLabel,
                            isDrone = false,
                            protocol = activeStream?.protocol ?: "WEBRTC",
                            playbackUrl = playback,
                            isLive = isLiveNow,
                            isSelf = isMe
                        )
                    )
                }
            } else {
                val anyAndroid = activeStreams.firstOrNull { it.sourceType.equals("ANDROID", ignoreCase = true) }
                val playback = anyAndroid?.playbackUrl.orEmpty().ifBlank {
                    if (anyAndroid != null) "${ApiConfig.HLS_PLAYBACK_BASE_URL}/stream_${anyAndroid.idStream}/index.m3u8"
                    else if (MediaStreamingService.isRunning) "${ApiConfig.HLS_PLAYBACK_BASE_URL}/stream_live/index.m3u8"
                    else null
                }
                slots.add(
                    CameraSlotItem(
                        id = "p-default",
                        name = if (currentUserName.isNotBlank()) "$currentUserName (yo)" else "Mi Cámara (yo)",
                        isDrone = false,
                        protocol = "WEBRTC",
                        playbackUrl = playback,
                        isLive = MediaStreamingService.isRunning || anyAndroid != null,
                        isSelf = true
                    )
                )
            }
        } else if (activeTabMode == TabMode.DRON) {
            val droneEquipos = equiposList.filter {
                it.categoria.equals("TACTICO", ignoreCase = true) ||
                it.tipoEquipo.contains("DRON", ignoreCase = true) ||
                it.nombre.contains("DRON", ignoreCase = true) ||
                it.nombre.contains("DJI", ignoreCase = true)
            }

            if (droneEquipos.isNotEmpty()) {
                droneEquipos.forEach { e ->
                    val activeStream = activeStreams.find { it.idEquipo == e.idEquipo || it.label.contains(e.nombre, ignoreCase = true) }
                    val playback = activeStream?.playbackUrl.orEmpty().ifBlank {
                        if (activeStream != null) "${ApiConfig.HLS_PLAYBACK_BASE_URL}/stream_${activeStream.idStream}/index.m3u8" else null
                    }
                    slots.add(
                        CameraSlotItem(
                            id = "e-${e.idEquipo}",
                            name = e.nombre,
                            isDrone = true,
                            protocol = activeStream?.protocol ?: "RTMP",
                            playbackUrl = playback,
                            isLive = activeStream != null,
                            isSelf = false
                        )
                    )
                }
            } else {
                listOf("DJI MATRICE 4T", "Dron VANT 01", "Dron VANT 02").forEachIndexed { idx, name ->
                    val activeStream = activeStreams.find { it.label.contains(name, ignoreCase = true) }
                    val playback = activeStream?.playbackUrl.orEmpty().ifBlank {
                        if (activeStream != null) "${ApiConfig.HLS_PLAYBACK_BASE_URL}/stream_${activeStream.idStream}/index.m3u8" else null
                    }
                    slots.add(
                        CameraSlotItem(
                            id = "drone-placeholder-$idx",
                            name = name,
                            isDrone = true,
                            protocol = "RTMP",
                            playbackUrl = playback,
                            isLive = activeStream != null,
                            isSelf = false
                        )
                    )
                }
            }
        }

        cameraAdapter?.updateSlots(slots)
    }
}
