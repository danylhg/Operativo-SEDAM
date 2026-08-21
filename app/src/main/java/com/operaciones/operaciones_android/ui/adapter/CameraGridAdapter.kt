package com.operaciones.operaciones_android.ui.adapter

import android.graphics.Color
import android.net.Uri
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.operaciones.operaciones_android.R
import com.operaciones.operaciones_android.config.ApiConfig
import com.operaciones.operaciones_android.streaming.MediaStreamingService
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer

data class CameraSlotItem(
    val id: String,
    val name: String,
    val isDrone: Boolean,
    val protocol: String,
    val playbackUrl: String? = null,
    val isLive: Boolean = false,
    val isSelf: Boolean = false
)

class CameraGridAdapter(
    private var slots: List<CameraSlotItem> = emptyList(),
    private val onToggleBroadcast: (() -> Unit)? = null,
    private val onCardDoubleTap: ((CameraSlotItem, List<CameraSlotItem>) -> Unit)? = null
) : RecyclerView.Adapter<CameraGridAdapter.CameraViewHolder>() {

    fun updateSlots(newSlots: List<CameraSlotItem>) {
        slots = newSlots
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): CameraViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_camera_card, parent, false)
        return CameraViewHolder(view, onToggleBroadcast, { slot -> onCardDoubleTap?.invoke(slot, slots) })
    }

    override fun onBindViewHolder(holder: CameraViewHolder, position: Int) {
        holder.bind(slots[position])
    }

    override fun getItemCount(): Int = slots.size

    class CameraViewHolder(
        itemView: View,
        private val onToggleBroadcast: (() -> Unit)?,
        private val onCardDoubleTap: ((CameraSlotItem) -> Unit)?
    ) : RecyclerView.ViewHolder(itemView) {
        private val tvCardName: TextView = itemView.findViewById(R.id.tvCardName)
        private val btnCardCameraToggle: ImageButton = itemView.findViewById(R.id.btnCardCameraToggle)
        private val cardCameraPreviewContainer: FrameLayout = itemView.findViewById(R.id.cardCameraPreviewContainer)
        private val cardWaitingContainer: LinearLayout = itemView.findViewById(R.id.cardWaitingContainer)
        private val ivWaitingIcon: ImageView = itemView.findViewById(R.id.ivWaitingIcon)
        private val tvWaitingBadge: TextView = itemView.findViewById(R.id.tvWaitingBadge)
        private val tvWaitingSubtitle: TextView = itemView.findViewById(R.id.tvWaitingSubtitle)
        private val cardWebView: WebView = itemView.findViewById(R.id.cardWebView)
        private val cardTouchOverlay: View = itemView.findViewById(R.id.cardTouchOverlay)

        private var currentSlot: CameraSlotItem? = null
        private var lastClickTime = 0L

        init {
            cardWebView.settings.javaScriptEnabled = true
            cardWebView.settings.domStorageEnabled = true
            cardWebView.settings.mediaPlaybackRequiresUserGesture = false
            cardWebView.settings.allowFileAccess = true
            cardWebView.settings.allowContentAccess = true
            cardWebView.settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            cardWebView.webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest?) {
                    request?.grant(request.resources)
                }
            }
            cardWebView.webViewClient = WebViewClient()

            btnCardCameraToggle.setOnClickListener {
                onToggleBroadcast?.invoke()
            }

            val doubleClickListener = View.OnClickListener {
                val currentTime = System.currentTimeMillis()
                if (currentTime - lastClickTime < 450) {
                    currentSlot?.let { onCardDoubleTap?.invoke(it) }
                    lastClickTime = 0L
                } else {
                    lastClickTime = currentTime
                }
            }

            cardTouchOverlay.setOnClickListener(doubleClickListener)
            itemView.setOnClickListener(doubleClickListener)
            cardCameraPreviewContainer.setOnClickListener(doubleClickListener)
            cardWaitingContainer.setOnClickListener(doubleClickListener)
        }

        fun bind(slot: CameraSlotItem) {
            currentSlot = slot
            tvCardName.text = slot.name

            // 1. Botón de control de cámara propio (arriba a la derecha)
            if (slot.isSelf) {
                btnCardCameraToggle.visibility = View.VISIBLE
                if (slot.isLive) {
                    btnCardCameraToggle.setImageResource(R.drawable.ic_stream_camera_on)
                    btnCardCameraToggle.setColorFilter(Color.parseColor("#00E5F0"))
                } else {
                    btnCardCameraToggle.setImageResource(R.drawable.ic_stream_camera_on)
                    btnCardCameraToggle.setColorFilter(Color.parseColor("#64748B"))
                }
            } else {
                btnCardCameraToggle.visibility = View.GONE
            }

            // 2. Resolver URL HLS para flujos remotos
            val rawUrl = slot.playbackUrl.orEmpty()
            val uri = Uri.parse(ApiConfig.BASE_URL)
            val host = uri.host ?: "192.168.202.112"

            val hlsUrl = when {
                rawUrl.isBlank() -> ""
                rawUrl.startsWith("http://") || rawUrl.startsWith("https://") -> rawUrl
                rawUrl.startsWith("/runtime/ffmpeg-streams/") -> "http://$host:3000/Operaciones$rawUrl"
                rawUrl.startsWith("/Operaciones/") -> "http://$host:3000$rawUrl"
                rawUrl.startsWith("/") -> "http://$host:3001$rawUrl"
                else -> "${ApiConfig.BASE_URL}/$rawUrl"
            }

            // 3. Renderizado de Video: Nativo WebRTC para Cámara Propia vs WebView para Remotos
            val videoTrack = MediaStreamingService.activeVideoTrack
            val eglBase = MediaStreamingService.activeEglBase

            if (slot.isSelf && slot.isLive && videoTrack != null && eglBase != null) {
                // RENDERIZADO NATIVO WEBRTC (SurfaceViewRenderer) EN TIEMPO REAL 60FPS
                cardWaitingContainer.visibility = View.GONE
                cardWebView.visibility = View.GONE
                cardCameraPreviewContainer.visibility = View.VISIBLE

                cardCameraPreviewContainer.removeAllViews()

                val renderer = SurfaceViewRenderer(itemView.context).apply {
                    init(eglBase.eglBaseContext, null)
                    setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FILL)
                    setMirror(false)
                    setEnableHardwareScaler(true)
                }

                try {
                    videoTrack.addSink(renderer)
                } catch (_: Exception) {}

                cardCameraPreviewContainer.addView(
                    renderer,
                    FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    )
                )
            } else if (slot.isLive && hlsUrl.isNotBlank()) {
                // RENDERIZADO REMOTO HLS (WebView)
                cardCameraPreviewContainer.visibility = View.GONE
                cardWaitingContainer.visibility = View.GONE
                cardWebView.visibility = View.VISIBLE

                val statusText = if (slot.isSelf) "● TRANSMITIENDO EN VIVO (Tu cámara)" else "● EN VIVO"
                val subText = if (slot.isSelf) "Tu señal está siendo transmitida a la operación." else "Sincronizando flujo de video..."

                val playerHtml = """
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <style>
                            body, html { margin:0; padding:0; background:#060C17; color:#F1F5F9; font-family:sans-serif; width:100%; height:100%; display:flex; justify-content:center; align-items:center; overflow:hidden; }
                            video { width:100%; height:100%; object-fit:cover; background:#000; display:none; }
                            .loader { display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; padding:12px; }
                            .pulse-icon { width:32px; height:32px; color:#00E5F0; margin-bottom:8px; animation:pulse 1.5s infinite; }
                            @keyframes pulse { 0% { opacity:0.4; transform:scale(0.95); } 50% { opacity:1; transform:scale(1.05); } 100% { opacity:0.4; transform:scale(0.95); } }
                            .badge { background:rgba(0,229,240,0.15); border:1px solid #00E5F0; color:#00E5F0; font-size:11px; font-weight:bold; padding:5px 12px; border-radius:16px; }
                            .subtext { font-size:10px; color:#64748B; margin-top:6px; }
                        </style>
                        <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
                    </head>
                    <body>
                        <div id="loader" class="loader">
                            <svg class="pulse-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M23 7l-7 5 7 5V7z"/>
                                <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                            </svg>
                            <div class="badge">$statusText</div>
                            <div class="subtext">$subText</div>
                        </div>
                        <video id="video" playsinline muted autoplay poster="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='1' height='1'></svg>"></video>
                        <script>
                            var video = document.getElementById('video');
                            var loader = document.getElementById('loader');
                            var videoSrc = '$hlsUrl';

                            function showVideo() {
                                if (loader) loader.style.display = 'none';
                                video.style.display = 'block';
                                video.play().catch(function(){});
                            }

                            if (Hls.isSupported() && (videoSrc.includes('.m3u8') || videoSrc.includes('/ffmpeg-streams/'))) {
                                var hls = new Hls({
                                    manifestLoadingTimeOut: 5000,
                                    manifestLoadingMaxRetry: 10,
                                    levelLoadingMaxRetry: 10
                                });
                                hls.loadSource(videoSrc);
                                hls.attachMedia(video);
                                hls.on(Hls.Events.MANIFEST_PARSED, function() {
                                    showVideo();
                                });
                                hls.on(Hls.Events.ERROR, function(event, data) {
                                    if (data.fatal) {
                                        setTimeout(function() { hls.loadSource(videoSrc); }, 3000);
                                    }
                                });
                            } else {
                                video.src = videoSrc;
                                video.oncanplay = showVideo;
                                video.onerror = function() {
                                    if (loader) loader.style.display = 'flex';
                                };
                            }
                        </script>
                    </body>
                    </html>
                """.trimIndent()

                cardWebView.loadDataWithBaseURL(ApiConfig.BASE_URL, playerHtml, "text/html", "UTF-8", null)
            } else {
                // INACTIVO O ESPERANDO SEÑAL
                cardCameraPreviewContainer.visibility = View.GONE
                cardWebView.visibility = View.GONE
                cardWaitingContainer.visibility = View.VISIBLE
                ivWaitingIcon.visibility = View.GONE

                val badgeText = if (slot.isSelf) "Sin transmisión activa" else if (slot.protocol.uppercase() == "WEBRTC") "Esperando señal WEBRTC" else "ESPERANDO SEÑAL"
                tvWaitingBadge.text = badgeText
                tvWaitingBadge.setTextColor(Color.parseColor("#E2E8F0"))
                tvWaitingBadge.setBackgroundResource(R.drawable.bg_map_drawer_action)

                tvWaitingSubtitle.visibility = View.GONE
            }
        }
    }
}
