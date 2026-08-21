package com.operaciones.operaciones_android.streaming

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.operaciones.operaciones_android.R
import com.operaciones.operaciones_android.config.ApiConfig
import com.pedro.common.ConnectChecker
import com.pedro.library.rtmp.RtmpCamera2
import io.socket.client.Ack
import io.socket.client.IO
import io.socket.client.Socket
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.Camera2Enumerator
import org.webrtc.CameraVideoCapturer
import org.webrtc.DataChannel
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.RtpSender
import org.webrtc.SessionDescription
import org.webrtc.SdpObserver
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoCapturer
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap

class MediaStreamingService : Service(), ConnectChecker {

    companion object {
        const val ACTION_START = "com.operaciones.operaciones_android.streaming.START"
        const val ACTION_STOP = "com.operaciones.operaciones_android.streaming.STOP"

        const val EXTRA_OPERATION_ID = "OPERATION_ID"
        const val EXTRA_TOKEN = "TOKEN"
        const val EXTRA_USER_NAME = "USER_NAME"
        const val EXTRA_USER_ID = "USER_ID"
        const val EXTRA_USER_ROLE = "USER_ROLE"
        const val EXTRA_USER_TABLE = "USER_TABLE"

        @Volatile
        var isRunning: Boolean = false
            private set

        @Volatile
        var activeVideoTrack: VideoTrack? = null
            internal set

        @Volatile
        var activeEglBase: EglBase? = null
            internal set

        private const val TAG = "MEDIA_STREAM"
        private const val CHANNEL_ID = "sedam_media_stream"
        private const val NOTIFICATION_ID = 3001
        private const val LOCAL_STREAM_ID = "sedam_local_stream"
        private const val STREAM_VIDEO_WIDTH = 640
        private const val STREAM_VIDEO_HEIGHT = 360
        private const val STREAM_VIDEO_FPS = 24
        private const val STREAM_VIDEO_BITRATE = 900 * 1024
        private const val STREAM_AUDIO_BITRATE = 64 * 1024
        private const val RTMP_AUDIO_SAMPLE_RATE = 44_100
        private const val MAX_PUBLISHER_JOIN_ATTEMPTS = 6
        private const val PUBLISHER_JOIN_RETRY_MS = 2_500L
    }

    private val mainHandler = Handler(Looper.getMainLooper())
    private val streamThread = HandlerThread("SedamMediaStreamThread").apply { start() }
    private val streamHandler = Handler(streamThread.looper)
    private val httpClient = OkHttpClient()
    private val peerConnections = ConcurrentHashMap<String, PeerConnection>()

    private var operationId = -1
    private var streamId = -1
    private var token = ""
    private var userName = ""
    private var userId = -1
    private var userRole = ""
    private var userTable = "personal"
    private var rtmpPublishUrl = ""
    private var rtmpPlaybackUrl = ""

    private var socket: Socket? = null
    private var rootEglBase: EglBase? = null
    private var peerConnectionFactory: PeerConnectionFactory? = null
    private var videoCapturer: VideoCapturer? = null
    private var surfaceTextureHelper: SurfaceTextureHelper? = null
    private var videoSource: VideoSource? = null
    private var audioSource: AudioSource? = null
    private var localVideoTrack: VideoTrack? = null
    private var localAudioTrack: AudioTrack? = null
    private var rtmpCamera: RtmpCamera2? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var iceServers: List<PeerConnection.IceServer> = defaultIceServers()
    private var stopping = false
    private var publisherJoinAttempts = 0

    private val pingRunnable = object : Runnable {
        override fun run() {
            val currentStreamId = streamId
            if (currentStreamId > 0 && socket?.connected() == true) {
                socket?.emit("stream_ping", JSONObject().apply {
                    put("id_operacion", operationId)
                    put("id_stream", currentStreamId)
                })
                mainHandler.postDelayed(this, 15_000L)
            }
        }
    }

    private val publisherJoinRetryRunnable = object : Runnable {
        override fun run() {
            emitPublisherJoin()
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopStreaming(notifyServer = true)
            stopSelf()
            return START_NOT_STICKY
        }

        operationId = intent?.getIntExtra(EXTRA_OPERATION_ID, -1) ?: -1
        token = intent?.getStringExtra(EXTRA_TOKEN).orEmpty()
        userName = intent?.getStringExtra(EXTRA_USER_NAME).orEmpty()
        userId = intent?.getIntExtra(EXTRA_USER_ID, -1) ?: -1
        userRole = intent?.getStringExtra(EXTRA_USER_ROLE).orEmpty()
        userTable = intent?.getStringExtra(EXTRA_USER_TABLE).orEmpty().ifBlank { "personal" }

        startForegroundCompat(buildNotification("Preparando camara y microfono..."))

        if (operationId <= 0 || token.isBlank()) {
            Log.e(TAG, "No hay operacion o token valido")
            stopSelf()
            return START_NOT_STICKY
        }

        if (!hasCameraAndMicPermissions()) {
            Log.e(TAG, "Faltan permisos CAMERA/RECORD_AUDIO")
            stopSelf()
            return START_NOT_STICKY
        }

        if (isRunning) return START_STICKY

        isRunning = true
        stopping = false
        acquireWakeLock()

        streamHandler.post {
            try {
                val stream = createStreamSession()
                streamId = stream.getInt("id_stream")
                rtmpPublishUrl = stream.optString("rtmp_publish_url", "")
                rtmpPlaybackUrl = stream.optString("rtmp_playback_url", stream.optString("playback_url", ""))
                if (!isRtmpUrl(rtmpPublishUrl)) {
                    iceServers = fetchIceServers()
                }

                try {
                    if (isRtmpUrl(rtmpPublishUrl)) {
                        startRtmpPublisher()
                    } else {
                        startWebRtcPublisher()
                    }
                    mainHandler.post {
                        connectSignalingSocket()
                        updateNotification(
                            if (isRtmpUrl(rtmpPublishUrl)) {
                                "Transmitiendo camara y microfono en vivo por RTMP"
                            } else {
                                "Transmitiendo camara y microfono en vivo por WebRTC"
                            }
                        )
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error iniciando transmision", e)
                    if (isRtmpUrl(rtmpPublishUrl)) {
                        notifyStreamStopHttp("ERROR")
                        stopStreaming(notifyServer = false)
                    } else {
                        stopStreaming(notifyServer = true)
                    }
                    stopSelf()
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error creando sesion de transmision", e)
                mainHandler.post {
                    stopStreaming(notifyServer = false)
                    stopSelf()
                }
            }
        }

        return START_NOT_STICKY
    }

    override fun onDestroy() {
        stopStreaming(notifyServer = true)
        streamThread.quitSafely()
        super.onDestroy()
    }

    private fun hasCameraAndMicPermissions(): Boolean {
        val cameraOk = ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        val micOk = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        return cameraOk && micOk
    }

    private fun createStreamSession(): JSONObject {
        val body = JSONObject().apply {
            put("kind", "AUDIO_VIDEO")
            put("protocol", "WEBRTC")
            put("label", userName.ifBlank { "Android" })
            put("consent_ack", true)
            put("foreground_notice", true)
        }

        val request = Request.Builder()
            .url("${ApiConfig.BASE_URL}/ops/$operationId/streams")
            .addHeader("Authorization", "Bearer $token")
            .post(body.toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
            .build()

        httpClient.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (!response.isSuccessful) throw IOException("POST stream fallo ${response.code}: $text")
            val json = JSONObject(text)
            return json.getJSONObject("stream")
        }
    }

    private fun fetchIceServers(): List<PeerConnection.IceServer> {
        val request = Request.Builder()
            .url("${ApiConfig.BASE_URL}/ops/$operationId/streams/webrtc-config")
            .addHeader("Authorization", "Bearer $token")
            .get()
            .build()

        return try {
            httpClient.newCall(request).execute().use { response ->
                val text = response.body?.string().orEmpty()
                if (!response.isSuccessful) return defaultIceServers()
                val servers = JSONObject(text)
                    .optJSONObject("config")
                    ?.optJSONArray("iceServers")
                    ?: return defaultIceServers()
                parseIceServers(servers).ifEmpty { defaultIceServers() }
            }
        } catch (e: Exception) {
            Log.w(TAG, "No se pudo cargar ICE config, usando STUN default: ${e.message}")
            defaultIceServers()
        }
    }

    private fun parseIceServers(items: JSONArray): List<PeerConnection.IceServer> {
        val result = mutableListOf<PeerConnection.IceServer>()
        for (i in 0 until items.length()) {
            val item = items.optJSONObject(i) ?: continue
            val urlsAny = item.opt("urls") ?: continue
            val urls = when (urlsAny) {
                is JSONArray -> (0 until urlsAny.length()).mapNotNull { idx -> urlsAny.optString(idx).takeIf { it.isNotBlank() } }
                else -> listOf(urlsAny.toString()).filter { it.isNotBlank() }
            }
            if (urls.isEmpty()) continue

            val builder = if (urls.size == 1) {
                PeerConnection.IceServer.builder(urls.first())
            } else {
                PeerConnection.IceServer.builder(urls)
            }
            val username = item.optString("username", "")
            val credential = item.optString("credential", "")
            if (username.isNotBlank()) builder.setUsername(username)
            if (credential.isNotBlank()) builder.setPassword(credential)
            result.add(builder.createIceServer())
        }
        return result
    }

    private fun defaultIceServers(): List<PeerConnection.IceServer> =
        listOf(PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer())

    @SuppressLint("MissingPermission")
    private fun startRtmpPublisher() {
        val url = rtmpPublishUrl.trim()
        if (!isRtmpUrl(url)) throw IllegalStateException("URL RTMP invalida: $url")

        val camera = RtmpCamera2(applicationContext, this)
        rtmpCamera = camera

        val videoReady = camera.prepareVideo(
            STREAM_VIDEO_WIDTH,
            STREAM_VIDEO_HEIGHT,
            STREAM_VIDEO_FPS,
            STREAM_VIDEO_BITRATE,
            1,
            0
        )
        val audioReady = camera.prepareAudio(
            STREAM_AUDIO_BITRATE,
            RTMP_AUDIO_SAMPLE_RATE,
            true
        )
        if (!videoReady || !audioReady) {
            throw IllegalStateException("No se pudo preparar encoder RTMP video=$videoReady audio=$audioReady")
        }

        camera.startStream(url)
        Log.d(TAG, "RTMP publisher iniciando streamId=$streamId publish=$url playback=$rtmpPlaybackUrl")
    }

    private fun isRtmpUrl(url: String?): Boolean {
        val value = url?.trim().orEmpty()
        return value.startsWith("rtmp://", ignoreCase = true) ||
            value.startsWith("rtmps://", ignoreCase = true)
    }

    @SuppressLint("MissingPermission")
    private fun startWebRtcPublisher() {
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(applicationContext)
                .createInitializationOptions()
        )

        rootEglBase = EglBase.create()
        val eglContext = rootEglBase!!.eglBaseContext

        val encoderFactory = DefaultVideoEncoderFactory(eglContext, true, true)
        val decoderFactory = DefaultVideoDecoderFactory(eglContext)

        peerConnectionFactory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(encoderFactory)
            .setVideoDecoderFactory(decoderFactory)
            .createPeerConnectionFactory()

        audioSource = peerConnectionFactory!!.createAudioSource(MediaConstraints())
        localAudioTrack = peerConnectionFactory!!.createAudioTrack("sedam_audio", audioSource)

        videoCapturer = createCameraCapturer()
        videoSource = peerConnectionFactory!!.createVideoSource(false)
        surfaceTextureHelper = SurfaceTextureHelper.create("SedamCameraThread", eglContext)
        videoCapturer?.initialize(surfaceTextureHelper, applicationContext, videoSource!!.capturerObserver)
        videoCapturer?.startCapture(STREAM_VIDEO_WIDTH, STREAM_VIDEO_HEIGHT, STREAM_VIDEO_FPS)
        localVideoTrack = peerConnectionFactory!!.createVideoTrack("sedam_video", videoSource)
        activeVideoTrack = localVideoTrack
        activeEglBase = rootEglBase

        Log.d(TAG, "WebRTC publisher listo streamId=$streamId rtmp=$rtmpPublishUrl playback=$rtmpPlaybackUrl")
    }

    private fun createCameraCapturer(): CameraVideoCapturer {
        val enumerator = Camera2Enumerator(this)
        val deviceName = enumerator.deviceNames.firstOrNull { enumerator.isBackFacing(it) }
            ?: enumerator.deviceNames.firstOrNull { enumerator.isFrontFacing(it) }
            ?: throw IllegalStateException("No se encontro camara disponible")

        return enumerator.createCapturer(deviceName, object : CameraVideoCapturer.CameraEventsHandler {
            override fun onCameraError(errorDescription: String?) {
                Log.e(TAG, "Camera error: $errorDescription")
            }

            override fun onCameraDisconnected() {
                Log.w(TAG, "Camera disconnected")
            }

            override fun onCameraFreezed(errorDescription: String?) {
                Log.e(TAG, "Camera freezed: $errorDescription")
            }

            override fun onCameraOpening(cameraName: String?) {
                Log.d(TAG, "Opening camera: $cameraName")
            }

            override fun onFirstFrameAvailable() {
                Log.d(TAG, "First camera frame available")
            }

            override fun onCameraClosed() {
                Log.d(TAG, "Camera closed")
            }
        }) ?: throw IllegalStateException("No se pudo crear capturer")
    }

    private fun connectSignalingSocket() {
        socket = IO.socket(ApiConfig.BASE_URL)

        socket?.on(Socket.EVENT_CONNECT) {
            Log.d(TAG, "Socket stream conectado")
            mainHandler.post { handleSignalingConnected() }
        }

        socket?.on("webrtc_viewer_joined") { args ->
            val payload = args.firstOrNull() as? JSONObject ?: return@on
            val viewerSocketId = payload.optString("viewer_socket_id", "")
            if (viewerSocketId.isNotBlank()) {
                mainHandler.post { createOfferForViewer(viewerSocketId, replaceExisting = true) }
            }
        }

        socket?.on("webrtc_answer") { args ->
            val payload = args.firstOrNull() as? JSONObject ?: return@on
            val from = payload.optString("from_socket_id", payload.optString("from", ""))
            val sdp = payload.optString("sdp", "")
            if (from.isNotBlank() && sdp.isNotBlank()) {
                mainHandler.post {
                    peerConnections[from]?.setRemoteDescription(
                        SimpleSdpObserver("setRemoteAnswer:$from"),
                        SessionDescription(SessionDescription.Type.ANSWER, sdp)
                    )
                }
            }
        }

        socket?.on("webrtc_ice_candidate") { args ->
            val payload = args.firstOrNull() as? JSONObject ?: return@on
            val from = payload.optString("from_socket_id", payload.optString("from", ""))
            val candidate = parseIceCandidate(payload)
            if (from.isNotBlank() && candidate != null) {
                mainHandler.post { peerConnections[from]?.addIceCandidate(candidate) }
            }
        }

        socket?.on("webrtc_viewer_left") { args ->
            val payload = args.firstOrNull() as? JSONObject ?: return@on
            val viewerSocketId = payload.optString("viewer_socket_id", "")
            if (viewerSocketId.isNotBlank()) {
                mainHandler.post { closePeer(viewerSocketId) }
            }
        }

        socket?.on("media_stream_stopped") {
            mainHandler.post {
                if (!stopping) {
                    stopStreaming(notifyServer = false)
                    stopSelf()
                }
            }
        }

        socket?.on(Socket.EVENT_CONNECT_ERROR) { args ->
            Log.e(TAG, "Socket stream connect_error: ${args.firstOrNull()}")
            mainHandler.post { updateNotification("Reconectando transmision WebRTC...") }
        }

        socket?.on(Socket.EVENT_DISCONNECT) { args ->
            Log.w(TAG, "Socket stream desconectado: ${args.firstOrNull()}")
            mainHandler.post {
                mainHandler.removeCallbacks(pingRunnable)
                mainHandler.removeCallbacks(publisherJoinRetryRunnable)
                closeAllPeers()
                if (!stopping) updateNotification("Reconectando transmision WebRTC...")
            }
        }

        socket?.connect()
    }

    private fun handleSignalingConnected() {
        closeAllPeers()
        socket?.emit("join_operacion", JSONObject().apply {
            put("id_operacion", operationId)
            if (userId > 0 && userTable == "personal") put("id_personal", userId)
            if (userRole.isNotBlank()) put("rol", userRole)
        })
        publisherJoinAttempts = 0
        emitPublisherJoin()
        socket?.emit("stream_ping", JSONObject().apply {
            put("id_operacion", operationId)
            put("id_stream", streamId)
        })
        mainHandler.removeCallbacks(pingRunnable)
        mainHandler.postDelayed(pingRunnable, 15_000L)
        updateNotification(
            if (isRtmpUrl(rtmpPublishUrl)) {
                "Transmitiendo por RTMP"
            } else {
                "Transmitiendo camara y microfono en vivo por WebRTC"
            }
        )
    }

    private fun emitPublisherJoin() {
        val currentSocket = socket ?: return
        if (stopping || !currentSocket.connected() || operationId <= 0 || streamId <= 0) return

        publisherJoinAttempts += 1
        currentSocket.emit("stream_join", JSONObject().apply {
            put("id_operacion", operationId)
            put("id_stream", streamId)
            put("role", "publisher")
            put("refresh", true)
        }, Ack { args ->
            val ack = args.firstOrNull() as? JSONObject
            mainHandler.post {
                if (ack?.optBoolean("ok", false) == true) {
                    Log.d(TAG, "Publisher WebRTC unido streamId=$streamId socket=${ack.optString("socket_id")}")
                    publisherJoinAttempts = 0
                    mainHandler.removeCallbacks(publisherJoinRetryRunnable)
                    updateNotification("Transmitiendo camara y microfono en vivo por WebRTC")
                    return@post
                }

                val reason = ack?.optString("mensaje", "sin respuesta") ?: "sin respuesta"
                Log.w(TAG, "stream_join publisher fallo intento=$publisherJoinAttempts: $reason")
                schedulePublisherJoinRetry()
            }
        })

        schedulePublisherJoinRetry()
    }

    private fun schedulePublisherJoinRetry() {
        mainHandler.removeCallbacks(publisherJoinRetryRunnable)
        if (stopping || publisherJoinAttempts >= MAX_PUBLISHER_JOIN_ATTEMPTS) {
            if (!stopping && publisherJoinAttempts >= MAX_PUBLISHER_JOIN_ATTEMPTS) {
                updateNotification("No se pudo enlazar la senal WebRTC. Revisa conexion.")
            }
            return
        }
        mainHandler.postDelayed(publisherJoinRetryRunnable, PUBLISHER_JOIN_RETRY_MS)
    }

    private fun createOfferForViewer(viewerSocketId: String, replaceExisting: Boolean = false) {
        if (peerConnections.containsKey(viewerSocketId)) {
            if (!replaceExisting) return
            closePeer(viewerSocketId)
        }
        val factory = peerConnectionFactory ?: return

        val rtcConfig = PeerConnection.RTCConfiguration(iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }

        val peerConnection = factory.createPeerConnection(
            rtcConfig,
            object : PeerConnection.Observer {
                override fun onSignalingChange(newState: PeerConnection.SignalingState?) {}
                override fun onIceConnectionChange(newState: PeerConnection.IceConnectionState?) {
                    Log.d(TAG, "ICE $viewerSocketId: $newState")
                }
                override fun onIceConnectionReceivingChange(receiving: Boolean) {}
                override fun onIceGatheringChange(newState: PeerConnection.IceGatheringState?) {}
                override fun onIceCandidate(candidate: IceCandidate?) {
                    if (candidate != null) sendIceCandidate(viewerSocketId, candidate)
                }
                override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) {}
                override fun onAddStream(stream: MediaStream?) {}
                override fun onRemoveStream(stream: MediaStream?) {}
                override fun onDataChannel(dataChannel: DataChannel?) {}
                override fun onRenegotiationNeeded() {}
                override fun onAddTrack(receiver: RtpReceiver?, mediaStreams: Array<out MediaStream>?) {}
            }
        ) ?: run {
            Log.e(TAG, "No se pudo crear PeerConnection para $viewerSocketId")
            return
        }

        peerConnections[viewerSocketId] = peerConnection
        localAudioTrack?.let { peerConnection.addTrack(it, listOf(LOCAL_STREAM_ID)) }
        localVideoTrack?.let {
            val sender = peerConnection.addTrack(it, listOf(LOCAL_STREAM_ID))
            limitVideoSender(sender)
        }

        val constraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveAudio", "false"))
            mandatory.add(MediaConstraints.KeyValuePair("OfferToReceiveVideo", "false"))
        }

        peerConnection.createOffer(object : SdpObserver {
            override fun onCreateSuccess(description: SessionDescription?) {
                if (description == null) return
                peerConnection.setLocalDescription(object : SdpObserver {
                    override fun onCreateSuccess(description: SessionDescription?) {}
                    override fun onSetSuccess() {
                        socket?.emit("webrtc_offer", JSONObject().apply {
                            put("id_operacion", operationId)
                            put("id_stream", streamId)
                            put("to", viewerSocketId)
                            put("type", description.type.canonicalForm())
                            put("sdp", description.description)
                        })
                    }
                    override fun onCreateFailure(error: String?) {}
                    override fun onSetFailure(error: String?) {
                        Log.e(TAG, "setLocalDescription offer fallo: $error")
                    }
                }, description)
            }

            override fun onSetSuccess() {}
            override fun onCreateFailure(error: String?) {
                Log.e(TAG, "createOffer fallo: $error")
            }
            override fun onSetFailure(error: String?) {}
        }, constraints)
    }

    private fun limitVideoSender(sender: RtpSender?) {
        if (sender == null) return
        try {
            val parameters = sender.parameters ?: return
            parameters.degradationPreference = org.webrtc.RtpParameters.DegradationPreference.MAINTAIN_FRAMERATE
            parameters.encodings.forEach { encoding ->
                encoding.maxBitrateBps = STREAM_VIDEO_BITRATE
                encoding.minBitrateBps = STREAM_VIDEO_BITRATE / 2
                encoding.maxFramerate = STREAM_VIDEO_FPS
            }
            sender.parameters = parameters
        } catch (e: Exception) {
            Log.w(TAG, "No se pudo limitar bitrate WebRTC: ${e.message}")
        }
    }

    private fun sendIceCandidate(viewerSocketId: String, candidate: IceCandidate) {
        socket?.emit("webrtc_ice_candidate", JSONObject().apply {
            put("id_operacion", operationId)
            put("id_stream", streamId)
            put("to", viewerSocketId)
            put("candidate", JSONObject().apply {
                put("sdpMid", candidate.sdpMid)
                put("sdpMLineIndex", candidate.sdpMLineIndex)
                put("candidate", candidate.sdp)
            })
        })
    }

    private fun parseIceCandidate(payload: JSONObject): IceCandidate? {
        val candidateObj = payload.optJSONObject("candidate")
        val source = candidateObj ?: payload
        val candidate = source.optString("candidate", "")
        if (candidate.isBlank()) return null
        return IceCandidate(
            source.optString("sdpMid", ""),
            source.optInt("sdpMLineIndex", source.optInt("sdp_m_line_index", 0)),
            candidate
        )
    }



    private fun closePeer(viewerSocketId: String) {
        peerConnections.remove(viewerSocketId)?.dispose()
    }

    private fun closeAllPeers() {
        peerConnections.values.forEach { it.dispose() }
        peerConnections.clear()
    }

    private fun stopStreaming(notifyServer: Boolean) {
        if (stopping) return
        stopping = true
        isRunning = false
        activeVideoTrack = null
        activeEglBase = null

        mainHandler.removeCallbacks(pingRunnable)
        mainHandler.removeCallbacks(publisherJoinRetryRunnable)

        if (notifyServer && streamId > 0) {
            val status = "STOPPED"
            if (socket?.connected() == true) {
                socket?.emit("stream_stop", JSONObject().apply {
                    put("id_operacion", operationId)
                    put("id_stream", streamId)
                    put("status", status)
                })
            }
            notifyStreamStopHttp(status)
        }

        closeAllPeers()

        rtmpCamera?.let { camera ->
            try {
                if (camera.isStreaming) camera.stopStream()
            } catch (e: Exception) {
                Log.w(TAG, "stop RTMP stream: ${e.message}")
            }
            try {
                camera.stopCamera()
            } catch (e: Exception) {
                Log.w(TAG, "stop RTMP camera: ${e.message}")
            }
        }
        rtmpCamera = null

        try {
            videoCapturer?.stopCapture()
        } catch (e: Exception) {
            Log.w(TAG, "stopCapture: ${e.message}")
        }
        videoCapturer?.dispose()
        videoCapturer = null

        localVideoTrack?.dispose()
        localVideoTrack = null
        localAudioTrack?.dispose()
        localAudioTrack = null
        videoSource?.dispose()
        videoSource = null
        audioSource?.dispose()
        audioSource = null
        surfaceTextureHelper?.dispose()
        surfaceTextureHelper = null
        peerConnectionFactory?.dispose()
        peerConnectionFactory = null
        rootEglBase?.release()
        rootEglBase = null

        socket?.disconnect()
        socket?.off()
        socket = null

        releaseWakeLock()
        Log.d(TAG, "Transmision detenida")
    }

    override fun onConnectionStarted(url: String) {
        Log.d(TAG, "RTMP conectando: $url")
        mainHandler.post { updateNotification("Conectando RTMP...") }
    }

    override fun onConnectionSuccess() {
        Log.d(TAG, "RTMP conectado")
        mainHandler.post { updateNotification("Transmitiendo por RTMP") }
    }

    override fun onConnectionFailed(reason: String) {
        Log.e(TAG, "RTMP fallo: $reason")
        notifyStreamStopHttp("ERROR")
        mainHandler.post {
            if (!stopping) {
                updateNotification("RTMP fallo")
                stopStreaming(notifyServer = false)
                stopSelf()
            }
        }
    }

    override fun onNewBitrate(bitrate: Long) {
        Log.d(TAG, "RTMP bitrate=$bitrate")
    }

    override fun onDisconnect() {
        Log.d(TAG, "RTMP desconectado")
    }

    override fun onAuthError() {
        Log.e(TAG, "RTMP auth error")
        notifyStreamStopHttp("ERROR")
        mainHandler.post {
            if (!stopping) {
                stopStreaming(notifyServer = false)
                stopSelf()
            }
        }
    }

    override fun onAuthSuccess() {
        Log.d(TAG, "RTMP auth OK")
    }

    private fun notifyStreamStopHttp(status: String) {
        if (operationId <= 0 || streamId <= 0 || token.isBlank()) return

        val body = JSONObject()
            .put("status", status)
            .toString()
            .toRequestBody("application/json; charset=utf-8".toMediaType())

        val request = Request.Builder()
            .url("${ApiConfig.BASE_URL}/ops/$operationId/streams/$streamId/stop")
            .addHeader("Authorization", "Bearer $token")
            .patch(body)
            .build()

        Thread {
            try {
                httpClient.newCall(request).execute().use { response ->
                    val responseBody = response.body?.string().orEmpty()
                    if (!response.isSuccessful) {
                        Log.w(TAG, "PATCH stop stream fallo ${response.code}: $responseBody")
                    }
                }
            } catch (e: Exception) {
                Log.w(TAG, "No se pudo confirmar stop stream por HTTP: ${e.message}")
            }
        }.start()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Transmision de camara y microfono",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Canal de transmision WebRTC en vivo SEDAM"
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun buildNotification(text: String): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("SEDAM - Transmision activa")
            .setContentText(text)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .build()

    private fun startForegroundCompat(notification: Notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun updateNotification(text: String) {
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(NOTIFICATION_ID, buildNotification(text))
    }

    @SuppressLint("WakelockTimeout")
    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "operaciones:media_stream")
        wakeLock?.acquire()
    }

    private fun releaseWakeLock() {
        try {
            if (wakeLock?.isHeld == true) wakeLock?.release()
        } catch (_: Exception) {
        }
        wakeLock = null
    }

    private class SimpleSdpObserver(private val tag: String) : SdpObserver {
        override fun onCreateSuccess(description: SessionDescription?) {}
        override fun onSetSuccess() {}
        override fun onCreateFailure(error: String?) {
            Log.e(TAG, "$tag onCreateFailure: $error")
        }
        override fun onSetFailure(error: String?) {
            Log.e(TAG, "$tag onSetFailure: $error")
        }
    }
}
