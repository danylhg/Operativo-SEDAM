package com.operaciones.operaciones_android.ui.adapter

import android.content.Intent
import android.graphics.BitmapFactory
import android.graphics.Color
import android.media.MediaPlayer
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.MediaController
import android.widget.TextView
import android.widget.VideoView
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.DrawableCompat
import androidx.recyclerview.widget.RecyclerView
import com.operaciones.operaciones_android.R
import com.operaciones.operaciones_android.auth.AuthManager
import com.operaciones.operaciones_android.config.ApiConfig
import com.operaciones.operaciones_android.model.ChatMessage
import com.operaciones.operaciones_android.model.MessageType
import com.operaciones.operaciones_android.ui.widget.AudioWaveformView
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import kotlin.math.abs

class ChatAdapter(
    private val messages: List<ChatMessage>,
    private val isPersonal: Boolean = false
) : RecyclerView.Adapter<ChatAdapter.ViewHolder>() {

    companion object {
        private const val LEGACY_ATTACHMENT_PREFIX = "CHAT_ATTACHMENT:"
        private val COLOR_META_DEFAULT = Color.parseColor("#A7B6C8")
        private val COLOR_META_MINE = Color.parseColor("#93C5FD")
        private val COLOR_META_ADMIN = Color.parseColor("#C4B5FD")
        private val COLOR_META_CUT = Color.parseColor("#7DD3FC")
        private val COLOR_META_CET = Color.parseColor("#6EE7B7")
        private val COLOR_META_ALERT = Color.parseColor("#FCA5A5")
        private val COLOR_TEXT_NORMAL = Color.parseColor("#F1F5F9")
        private val COLOR_TEXT_ALERT = Color.parseColor("#F1F5F9")
        private val COLOR_TEXT_SYSTEM = Color.parseColor("#A7B6C8")
        private val mainHandler = Handler(Looper.getMainLooper())
        private val attachmentHttp = OkHttpClient()
    }

    private var activeAudioPlayer: MediaPlayer? = null
    private var activeAudioUrl: String? = null
    private var activeAudioHolder: ViewHolder? = null
    private var activeAudioPrepared = false
    private var audioProgressTask: Runnable? = null

    class ViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        val bubble: LinearLayout = view.findViewById(R.id.bubble)
        val meta: TextView = view.findViewById(R.id.msgMeta)
        val text: TextView = view.findViewById(R.id.msgText)
        val imageAttachment: ImageView = view.findViewById(R.id.msgImageAttachment)
        val videoAttachment: VideoView = view.findViewById(R.id.msgVideoAttachment)
        val audioPlayer: LinearLayout = view.findViewById(R.id.msgAudioPlayer)
        val audioPlay: TextView = view.findViewById(R.id.msgAudioPlay)
        val audioWaveform: AudioWaveformView = view.findViewById(R.id.msgAudioWaveform)
        val audioDuration: TextView = view.findViewById(R.id.msgAudioDuration)
        val attachment: TextView = view.findViewById(R.id.msgAttachment)
    }

    private data class LegacyAttachment(
        val kind: String,
        val dataUrl: String,
        val name: String?,
        val caption: String?
    )

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_message, parent, false)
        return ViewHolder(view)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val msg = messages[position]
        val dm = holder.itemView.resources.displayMetrics
        val maxW = (dm.widthPixels * 0.72f).toInt()
        val dp64 = (64 * dm.density + 0.5f).toInt()

        holder.text.maxWidth = maxW
        holder.meta.maxWidth = maxW
        holder.text.setCompoundDrawablesRelative(null, null, null, null)
        holder.text.compoundDrawablePadding = 0

        when (msg.type) {
            MessageType.SYSTEM -> {
                holder.meta.visibility = View.GONE
                holder.text.text = displayText(msg)
                holder.text.setTextColor(COLOR_TEXT_SYSTEM)
                holder.text.textSize = 11f
                holder.text.gravity = Gravity.CENTER
                bindAttachment(holder, msg)
                holder.bubble.setBackgroundColor(Color.TRANSPARENT)
                val p = holder.bubble.layoutParams as FrameLayout.LayoutParams
                p.gravity = Gravity.CENTER_HORIZONTAL
                p.marginStart = 0
                p.marginEnd = 0
                holder.bubble.layoutParams = p
            }

            MessageType.ALERT -> {
                holder.meta.visibility = View.VISIBLE
                holder.meta.text = buildMeta(msg)
                holder.meta.setTextColor(COLOR_META_ALERT)
                holder.text.text = displayText(msg)
                holder.text.setTextColor(COLOR_TEXT_ALERT)
                holder.text.textSize = 13f
                holder.text.gravity = Gravity.START
                bindAttachment(holder, msg)
                holder.bubble.setBackgroundResource(R.drawable.bg_bubble_alert)
                val p = holder.bubble.layoutParams as FrameLayout.LayoutParams
                p.gravity = if (msg.isMine) Gravity.END else Gravity.START
                p.marginStart = if (msg.isMine) dp64 else 0
                p.marginEnd = if (msg.isMine) 0 else dp64
                holder.bubble.layoutParams = p
            }

            MessageType.NORMAL -> {
                holder.meta.visibility = View.VISIBLE
                holder.meta.text = buildMeta(msg)
                holder.meta.setTextColor(metaColor(msg))
                holder.text.text = displayText(msg)
                holder.text.setTextColor(COLOR_TEXT_NORMAL)
                holder.text.textSize = 13f
                holder.text.gravity = Gravity.START
                if (isCallHistory(msg)) bindCallIcon(holder)
                bindAttachment(holder, msg)
                holder.bubble.setBackgroundResource(
                    if (msg.isMine) R.drawable.bg_bubble_sent else R.drawable.bg_bubble_recv
                )
                val p = holder.bubble.layoutParams as FrameLayout.LayoutParams
                p.gravity = if (msg.isMine) Gravity.END else Gravity.START
                p.marginStart = if (msg.isMine) dp64 else 0
                p.marginEnd = if (msg.isMine) 0 else dp64
                holder.bubble.layoutParams = p
            }
        }
        holder.text.visibility = if (holder.text.text.isNullOrBlank()) View.GONE else View.VISIBLE
    }

    override fun getItemCount() = messages.size

    override fun onViewRecycled(holder: ViewHolder) {
        super.onViewRecycled(holder)
        holder.videoAttachment.stopPlayback()
        holder.videoAttachment.setMediaController(null)
        holder.imageAttachment.setImageDrawable(null)
        if (activeAudioHolder === holder) releaseActiveAudio()
    }

    private fun metaColor(msg: ChatMessage): Int {
        if (msg.isMine) return COLOR_META_MINE
        return when (msg.autorRol?.uppercase()) {
            "ADMIN" -> COLOR_META_ADMIN
            "CUT" -> COLOR_META_CUT
            "CET" -> COLOR_META_CET
            else -> COLOR_META_DEFAULT
        }
    }

    private fun buildMeta(msg: ChatMessage): String {
        if (isPersonal) {
            return msg.sentAtLabel?.takeIf { it.isNotBlank() } ?: ""
        }

        val parts = mutableListOf<String>()
        if (msg.user.isNotBlank() && msg.user != "Sistema") parts.add(msg.user)
        msg.sentAtLabel?.takeIf { it.isNotBlank() }?.let { parts.add(it) }
        return parts.joinToString("  ")
    }

    private fun bindAttachment(holder: ViewHolder, msg: ChatMessage) {
        resetAttachmentViews(holder)

        val url = msg.attachmentUrl?.takeIf { it.isNotBlank() }
        if (url == null) {
            bindLegacyAttachment(holder, legacyAttachment(msg))
            return
        }

        val fullUrl = absoluteAttachmentUrl(url)
        when (attachmentKind(msg)) {
            "IMAGE" -> bindImageAttachment(holder, fullUrl)
            "VIDEO" -> bindVideoAttachment(holder, fullUrl)
            "AUDIO" -> bindAudioAttachment(holder, fullUrl, msg)
            else -> bindFileAttachment(holder, fullUrl, msg)
        }
    }

    private fun resetAttachmentViews(holder: ViewHolder) {
        holder.imageAttachment.visibility = View.GONE
        holder.imageAttachment.setImageDrawable(null)
        holder.imageAttachment.tag = null
        holder.imageAttachment.setOnClickListener(null)

        holder.videoAttachment.stopPlayback()
        holder.videoAttachment.setMediaController(null)
        holder.videoAttachment.visibility = View.GONE

        holder.audioPlayer.visibility = View.GONE
        holder.audioPlayer.tag = null
        holder.audioPlay.text = "▶"
        holder.audioPlay.contentDescription = "Reproducir audio"
        holder.audioPlay.setOnClickListener(null)
        holder.audioWaveform.progress = 0f
        holder.audioWaveform.onSeekRequested = null
        holder.audioDuration.text = "0:00"

        holder.attachment.visibility = View.GONE
        holder.attachment.setOnClickListener(null)
    }

    private fun absoluteAttachmentUrl(url: String): String {
        if (url.startsWith("http://") || url.startsWith("https://")) {
            val parsed = Uri.parse(url)
            if (parsed.path?.startsWith("/api/storage/") == true) {
                return Uri.parse(ApiConfig.BASE_URL)
                    .buildUpon()
                    .encodedPath(parsed.encodedPath)
                    .encodedQuery(parsed.encodedQuery)
                    .fragment(parsed.fragment)
                    .build()
                    .toString()
            }
            return url
        }
        return "${ApiConfig.BASE_URL}${if (url.startsWith("/")) "" else "/"}$url"
    }

    private fun legacyAttachment(msg: ChatMessage): LegacyAttachment? {
        val text = msg.text.trim()
        if (!text.startsWith(LEGACY_ATTACHMENT_PREFIX)) return null
        return runCatching {
            val json = JSONObject(text.removePrefix(LEGACY_ATTACHMENT_PREFIX))
            LegacyAttachment(
                kind = json.optString("kind", ""),
                dataUrl = json.optString("dataUrl", ""),
                name = json.optString("name", "").takeIf { it.isNotBlank() },
                caption = json.optString("caption", "").takeIf { it.isNotBlank() }
            )
        }.getOrNull()?.takeIf { it.dataUrl.isNotBlank() }
    }

    private fun displayText(msg: ChatMessage): String {
        if (attachmentKind(msg) == "AUDIO" && msg.text.trim().equals("Mensaje de voz", ignoreCase = true)) return ""
        val legacy = legacyAttachment(msg) ?: return callHistoryText(msg.text)
        return legacy.caption?.takeIf { it.isNotBlank() } ?: legacyLabel(legacy)
    }

    private fun isCallHistory(msg: ChatMessage): Boolean {
        val text = callHistoryText(msg.text)
        return text.startsWith("Llamada de voz", ignoreCase = true) ||
            text.startsWith("Llamada no contestada", ignoreCase = true)
    }

    private fun callHistoryText(text: String): String =
        text.trim().removePrefix("☎️").removePrefix("☎").removePrefix("📞").trimStart()

    private fun bindCallIcon(holder: ViewHolder) {
        val icon = ContextCompat.getDrawable(holder.itemView.context, R.drawable.ic_call)
            ?.mutate()
            ?: return
        val size = (16 * holder.itemView.resources.displayMetrics.density + 0.5f).toInt()
        icon.setBounds(0, 0, size, size)
        DrawableCompat.setTint(icon, COLOR_TEXT_NORMAL)
        holder.text.setCompoundDrawablesRelative(icon, null, null, null)
        holder.text.compoundDrawablePadding =
            (6 * holder.itemView.resources.displayMetrics.density + 0.5f).toInt()
    }

    private fun bindLegacyAttachment(holder: ViewHolder, legacy: LegacyAttachment?) {
        if (legacy == null) return
        when (legacyKind(legacy)) {
            "IMAGE" -> bindDataImageAttachment(holder, legacy.dataUrl)
            else -> {
                holder.attachment.visibility = View.VISIBLE
                holder.attachment.text = legacyLabel(legacy)
            }
        }
    }

    private fun legacyKind(legacy: LegacyAttachment): String {
        val kind = legacy.kind.trim().uppercase()
        if (kind in setOf("IMAGE", "VIDEO", "AUDIO", "FILE")) return kind
        val dataUrl = legacy.dataUrl.lowercase()
        return when {
            dataUrl.startsWith("data:image/") -> "IMAGE"
            dataUrl.startsWith("data:video/") -> "VIDEO"
            dataUrl.startsWith("data:audio/") -> "AUDIO"
            else -> "FILE"
        }
    }

    private fun legacyLabel(legacy: LegacyAttachment): String {
        val name = legacy.name?.takeIf { it.isNotBlank() }
        return when (legacyKind(legacy)) {
            "IMAGE" -> name?.let { "Imagen: $it" } ?: "Imagen adjunta"
            "VIDEO" -> name?.let { "Video: $it" } ?: "Video adjunto"
            "AUDIO" -> name?.let { "Audio: $it" } ?: "Audio adjunto"
            else -> name?.let { "Archivo: $it" } ?: "Archivo adjunto"
        }
    }

    private fun bindDataImageAttachment(holder: ViewHolder, dataUrl: String) {
        holder.imageAttachment.visibility = View.VISIBLE
        holder.imageAttachment.tag = dataUrl
        holder.imageAttachment.setBackgroundColor(Color.parseColor("#0f172a"))

        Thread {
            val bitmap = decodeDataImage(dataUrl)
            mainHandler.post {
                if (holder.imageAttachment.tag == dataUrl && bitmap != null) {
                    holder.imageAttachment.setImageBitmap(bitmap)
                }
            }
        }.start()
    }

    private fun decodeDataImage(dataUrl: String) = runCatching {
        val comma = dataUrl.indexOf(',')
        if (comma == -1) return@runCatching null
        val bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT)
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    }.getOrNull()

    private fun attachmentKind(msg: ChatMessage): String {
        val kind = msg.attachmentKind?.uppercase().orEmpty()
        if (kind in setOf("IMAGE", "VIDEO", "AUDIO")) return kind
        val mime = msg.attachmentMime.orEmpty().lowercase()
        return when {
            mime.startsWith("image/") -> "IMAGE"
            mime.startsWith("video/") -> "VIDEO"
            mime.startsWith("audio/") -> "AUDIO"
            else -> "FILE"
        }
    }

    private fun bindImageAttachment(holder: ViewHolder, fullUrl: String) {
        val context = holder.itemView.context.applicationContext
        holder.imageAttachment.visibility = View.VISIBLE
        holder.imageAttachment.tag = fullUrl
        holder.imageAttachment.setBackgroundColor(Color.parseColor("#0f172a"))
        holder.imageAttachment.setOnClickListener { openExternal(holder, fullUrl) }

        Thread {
            val bitmap = runCatching {
                val token = AuthManager.getToken(context)
                val request = Request.Builder()
                    .url(fullUrl)
                    .apply {
                        if (token.isNotBlank()) addHeader("Authorization", "Bearer $token")
                    }
                    .build()

                attachmentHttp.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) return@runCatching null
                    response.body?.byteStream()?.use { BitmapFactory.decodeStream(it) }
                }
            }.getOrNull()

            mainHandler.post {
                if (holder.imageAttachment.tag == fullUrl && bitmap != null) {
                    holder.imageAttachment.setImageBitmap(bitmap)
                }
            }
        }.start()
    }

    private fun bindVideoAttachment(holder: ViewHolder, fullUrl: String) {
        val context = holder.itemView.context.applicationContext
        val controller = MediaController(context)
        holder.videoAttachment.visibility = View.VISIBLE
        holder.videoAttachment.tag = fullUrl
        holder.videoAttachment.setMediaController(controller)
        controller.setAnchorView(holder.videoAttachment)
        holder.attachment.visibility = View.VISIBLE
        holder.attachment.text = "Cargando video..."
        holder.attachment.setOnClickListener(null)

        Thread {
            val cachedFile = runCatching {
                val token = AuthManager.getToken(context)
                val request = Request.Builder()
                    .url(fullUrl)
                    .apply {
                        if (token.isNotBlank()) addHeader("Authorization", "Bearer $token")
                    }
                    .build()

                attachmentHttp.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) return@runCatching null
                    val extension = videoExtension(fullUrl, response.header("Content-Type").orEmpty())
                    val file = File(context.cacheDir, "chat_video_${abs(fullUrl.hashCode())}$extension")
                    response.body?.byteStream()?.use { input ->
                        FileOutputStream(file).use { output ->
                            input.copyTo(output)
                        }
                    } ?: return@runCatching null
                    file
                }
            }.getOrNull()

            mainHandler.post {
                if (holder.videoAttachment.tag != fullUrl) return@post

                if (cachedFile == null || !cachedFile.exists()) {
                    holder.attachment.text = "Abrir video"
                    holder.attachment.setOnClickListener { openExternal(holder, fullUrl) }
                    return@post
                }

                holder.videoAttachment.setVideoURI(Uri.fromFile(cachedFile))
                holder.videoAttachment.setOnPreparedListener {
                    holder.videoAttachment.seekTo(1)
                    holder.attachment.text = "Reproducir video"
                    holder.attachment.setOnClickListener {
                        holder.videoAttachment.start()
                    }
                }
                holder.videoAttachment.setOnErrorListener { _, _, _ ->
                    holder.videoAttachment.visibility = View.GONE
                    holder.attachment.text = "Abrir video"
                    holder.attachment.setOnClickListener { openExternal(holder, fullUrl) }
                    true
                }
                holder.videoAttachment.requestFocus()
            }
        }
    }

    private fun videoExtension(url: String, contentType: String): String {
        val path = Uri.parse(url).path.orEmpty().lowercase()
        return when {
            path.endsWith(".mp4") || contentType.contains("mp4", ignoreCase = true) -> ".mp4"
            path.endsWith(".webm") || contentType.contains("webm", ignoreCase = true) -> ".webm"
            path.endsWith(".3gp") || contentType.contains("3gpp", ignoreCase = true) -> ".3gp"
            else -> ".mp4"
        }
    }

    private fun bindAudioAttachment(holder: ViewHolder, fullUrl: String, msg: ChatMessage) {
        holder.audioPlayer.visibility = View.VISIBLE
        holder.audioPlayer.tag = fullUrl
        holder.audioPlay.setOnClickListener {
            toggleAudioPlayback(holder, fullUrl, msg)
        }
        holder.audioWaveform.onSeekRequested = { fraction ->
            val player = activeAudioPlayer
            if (activeAudioUrl == fullUrl && activeAudioPrepared && player != null) {
                player.seekTo((player.duration * fraction).toInt())
                syncAudioUi(holder, player)
            }
        }

        if (activeAudioUrl == fullUrl && activeAudioPrepared) {
            activeAudioHolder = holder
            activeAudioPlayer?.let { syncAudioUi(holder, it) }
            holder.audioPlay.text = if (activeAudioPlayer?.isPlaying == true) "Ⅱ" else "▶"
        }
    }

    private fun toggleAudioPlayback(holder: ViewHolder, fullUrl: String, msg: ChatMessage) {
        val current = activeAudioPlayer
        if (activeAudioUrl == fullUrl && activeAudioPrepared && current != null) {
            activeAudioHolder = holder
            if (current.isPlaying) {
                current.pause()
                holder.audioPlay.text = "▶"
                holder.audioPlay.contentDescription = "Reproducir audio"
                stopAudioProgressUpdates()
            } else {
                current.start()
                holder.audioPlay.text = "Ⅱ"
                holder.audioPlay.contentDescription = "Pausar audio"
                startAudioProgressUpdates(holder, current)
            }
            return
        }

        releaseActiveAudio()
        activeAudioUrl = fullUrl
        activeAudioHolder = holder
        activeAudioPrepared = false
        holder.audioPlay.text = "…"
        holder.audioPlay.contentDescription = "Cargando audio"

        val player = MediaPlayer()
        activeAudioPlayer = player
        player.setOnPreparedListener {
            activeAudioPrepared = true
            it.start()
            if (holder.audioPlayer.tag == fullUrl) {
                holder.audioPlay.text = "Ⅱ"
                holder.audioPlay.contentDescription = "Pausar audio"
                syncAudioUi(holder, it)
                startAudioProgressUpdates(holder, it)
            }
        }
        player.setOnCompletionListener {
            if (holder.audioPlayer.tag == fullUrl) {
                holder.audioPlay.text = "▶"
                holder.audioPlay.contentDescription = "Reproducir audio"
                holder.audioWaveform.progress = 0f
                holder.audioDuration.text = formatAudioTime(it.duration)
            }
            it.seekTo(0)
            stopAudioProgressUpdates()
        }
        player.setOnErrorListener { mediaPlayer, _, _ ->
            mediaPlayer.release()
            if (activeAudioPlayer === mediaPlayer) {
                activeAudioPlayer = null
                activeAudioUrl = null
                activeAudioPrepared = false
            }
            if (holder.audioPlayer.tag == fullUrl) {
                holder.audioPlay.text = "!"
                holder.audioPlay.contentDescription = "No se pudo reproducir audio"
            }
            true
        }
        runCatching {
            player.setDataSource(fullUrl)
            player.prepareAsync()
        }.onFailure {
            player.release()
            if (activeAudioPlayer === player) {
                activeAudioPlayer = null
                activeAudioUrl = null
                activeAudioPrepared = false
            }
            holder.audioPlay.text = "!"
            holder.audioPlay.contentDescription = "No se pudo reproducir audio"
        }
    }

    private fun startAudioProgressUpdates(holder: ViewHolder, player: MediaPlayer) {
        stopAudioProgressUpdates()
        audioProgressTask = object : Runnable {
            override fun run() {
                if (activeAudioPlayer !== player || activeAudioHolder !== holder || !activeAudioPrepared) return
                syncAudioUi(holder, player)
                if (player.isPlaying) mainHandler.postDelayed(this, 120L)
            }
        }.also { mainHandler.post(it) }
    }

    private fun stopAudioProgressUpdates() {
        audioProgressTask?.let(mainHandler::removeCallbacks)
        audioProgressTask = null
    }

    private fun syncAudioUi(holder: ViewHolder, player: MediaPlayer) {
        if (!activeAudioPrepared || player.duration <= 0) return
        holder.audioWaveform.progress = player.currentPosition.toFloat() / player.duration.toFloat()
        holder.audioDuration.text = formatAudioTime(if (player.isPlaying) player.currentPosition else player.duration)
    }

    private fun formatAudioTime(milliseconds: Int): String {
        val totalSeconds = (milliseconds.coerceAtLeast(0) / 1000)
        return "%d:%02d".format(totalSeconds / 60, totalSeconds % 60)
    }

    private fun releaseActiveAudio() {
        stopAudioProgressUpdates()
        runCatching { activeAudioPlayer?.release() }
        activeAudioPlayer = null
        activeAudioUrl = null
        activeAudioHolder = null
        activeAudioPrepared = false
    }

    private fun bindFileAttachment(holder: ViewHolder, fullUrl: String, msg: ChatMessage) {
        holder.attachment.visibility = View.VISIBLE
        holder.attachment.text = attachmentLabel(msg)
        holder.attachment.setOnClickListener { openExternal(holder, fullUrl) }
    }

    private fun openExternal(holder: ViewHolder, fullUrl: String) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(fullUrl)).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        holder.itemView.context.startActivity(intent)
    }

    private fun attachmentLabel(msg: ChatMessage): String {
        val name = msg.attachmentName?.takeIf { it.isNotBlank() }
        return when (attachmentKind(msg)) {
            "IMAGE" -> name?.let { "Imagen: $it" } ?: "Imagen adjunta"
            "VIDEO" -> name?.let { "Video: $it" } ?: "Video adjunto"
            "AUDIO" -> name?.let { "Audio: $it" } ?: "Reproducir audio"
            else -> name?.let { "Archivo: $it" } ?: "Abrir archivo"
        }
    }
}
