package com.operaciones.operaciones_android.ui.adapter

import android.app.Dialog
import android.content.Intent
import android.content.res.ColorStateList
import android.content.ActivityNotFoundException
import android.graphics.BitmapFactory
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.SurfaceTexture
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.GradientDrawable
import android.media.MediaMetadataRetriever
import android.media.MediaPlayer
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.LruCache
import android.view.Gravity
import android.view.LayoutInflater
import android.view.Surface
import android.view.TextureView
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.Button
import android.widget.ProgressBar
import android.widget.SeekBar
import android.widget.ImageView
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.MediaController
import android.widget.TextView
import android.widget.Toast
import android.widget.VideoView
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.graphics.drawable.toBitmap
import androidx.core.graphics.drawable.DrawableCompat
import androidx.recyclerview.widget.RecyclerView
import com.operaciones.operaciones_android.R
import com.operaciones.operaciones_android.auth.AuthManager
import com.operaciones.operaciones_android.config.ApiConfig
import com.operaciones.operaciones_android.model.ChatMessage
import com.operaciones.operaciones_android.model.MessageType
import com.operaciones.operaciones_android.ui.widget.AudioWaveformView
import com.operaciones.operaciones_android.ui.MainActivity
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import kotlin.math.abs

class ChatAdapter(
    private val messages: List<ChatMessage>,
    private val isPersonal: Boolean = false,
    private val onForwardVideo: ((File, ChatMessage) -> Unit)? = null,
    private val onForwardImage: ((File, ChatMessage) -> Unit)? = null,
    private val onSelectionChanged: ((List<ChatMessage>) -> Unit)? = null
) : RecyclerView.Adapter<ChatAdapter.ViewHolder>() {

    private val selectedPositions = linkedSetOf<Int>()

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
        private val imageCache = object : LruCache<String, android.graphics.Bitmap>(24 * 1024) {
            override fun sizeOf(key: String, value: android.graphics.Bitmap): Int = value.byteCount / 1024
        }
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
        val uploadProgress: ProgressBar = view.findViewById(R.id.msgUploadProgress)
        val videoAttachment: VideoView = view.findViewById(R.id.msgVideoAttachment)
        val audioPlayer: LinearLayout = view.findViewById(R.id.msgAudioPlayer)
        val audioPlay: TextView = view.findViewById(R.id.msgAudioPlay)
        val audioWaveform: AudioWaveformView = view.findViewById(R.id.msgAudioWaveform)
        val audioDuration: TextView = view.findViewById(R.id.msgAudioDuration)
        val attachment: TextView = view.findViewById(R.id.msgAttachment)
        val selectionIndicator: TextView = view.findViewById(R.id.msgSelectionIndicator)
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
        holder.itemView.setOnLongClickListener {
            toggleSelection(holder.bindingAdapterPosition)
            true
        }
        val selectFromAttachment = View.OnLongClickListener {
            toggleSelection(holder.bindingAdapterPosition)
            true
        }
        holder.imageAttachment.setOnLongClickListener(selectFromAttachment)
        holder.videoAttachment.setOnLongClickListener(selectFromAttachment)
        holder.audioPlayer.setOnLongClickListener(selectFromAttachment)
        holder.attachment.setOnLongClickListener(selectFromAttachment)
        holder.itemView.setOnClickListener {
            if (selectedPositions.isNotEmpty()) toggleSelection(holder.bindingAdapterPosition)
        }
        holder.bubble.alpha = if (position in selectedPositions) 0.72f else 1f
        holder.selectionIndicator.visibility = if (selectedPositions.isNotEmpty()) View.VISIBLE else View.GONE
        holder.selectionIndicator.text = if (position in selectedPositions) "✓" else ""
        holder.selectionIndicator.setTextColor(
            if (position in selectedPositions) Color.WHITE else Color.parseColor("#9BB4C5")
        )
        holder.selectionIndicator.setBackgroundResource(
            if (position in selectedPositions) R.drawable.bg_message_selection else R.drawable.bg_message_selection_empty
        )
        if (selectedPositions.isNotEmpty()) {
            val params = holder.bubble.layoutParams as FrameLayout.LayoutParams
            params.marginStart += (42 * dm.density + 0.5f).toInt()
            holder.bubble.layoutParams = params
        }
    }

    private fun toggleSelection(position: Int) {
        if (position == RecyclerView.NO_POSITION) return
        if (!selectedPositions.add(position)) selectedPositions.remove(position)
        notifyDataSetChanged()
        onSelectionChanged?.invoke(selectedPositions.mapNotNull { messages.getOrNull(it) })
    }

    fun clearSelection() {
        selectedPositions.clear()
        notifyDataSetChanged()
        onSelectionChanged?.invoke(emptyList())
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

        val location = when {
            msg.destinoTipo.equals("UBICACION", true) -> msg.destinoId?.split(',')
            msg.destinoLabel?.startsWith("UBICACION:") == true -> msg.destinoLabel.removePrefix("UBICACION:").split(',')
            else -> {
                val labeled = Regex(
                    "LAT\\s*:\\s*(-?\\d+(?:[.,]\\d+)?)\\s*,?\\s*LON\\s*:\\s*(-?\\d+(?:[.,]\\d+)?)",
                    RegexOption.IGNORE_CASE
                ).find(msg.text)
                val raw = Regex("(-?\\d+(?:[.,]\\d+)?)\\s*,\\s*(-?\\d+(?:[.,]\\d+)?)").find(msg.text)
                (labeled ?: raw)?.destructured?.let { (lat, lon) ->
                    listOf(lat.replace(',', '.'), lon.replace(',', '.'))
                }
            }
        }
        if (location?.size == 2) {
            val lat = location[0].toDoubleOrNull()
            val lon = location[1].toDoubleOrNull()
            if (lat != null && lon != null) {
                holder.attachment.visibility = View.VISIBLE
                holder.attachment.text = "LAT: %.5f   LON: %.5f\nVer ubicación".format(lat, lon)
                holder.attachment.tag = holder.attachment.text.toString()
                holder.attachment.setBackgroundColor(Color.TRANSPARENT)
                holder.attachment.setPadding(0, 4, 0, 0)
                holder.attachment.setOnClickListener {
                    (holder.itemView.context as? MainActivity)?.openChatLocation(lat, lon)
                }
            }
        }

        val url = msg.attachmentUrl?.takeIf { it.isNotBlank() }
        if (url == null) {
            bindLegacyAttachment(holder, legacyAttachment(msg))
            return
        }

        val fullUrl = absoluteAttachmentUrl(url)
        if (msg.isUploading) holder.uploadProgress.visibility = View.VISIBLE
        when (attachmentKind(msg)) {
            "IMAGE" -> bindImageAttachment(holder, fullUrl, msg)
            "VIDEO" -> bindVideoAttachment(holder, fullUrl, msg)
            "AUDIO" -> bindAudioAttachment(holder, fullUrl, msg)
            else -> bindFileAttachment(holder, fullUrl, msg)
        }
    }

    private fun resetAttachmentViews(holder: ViewHolder) {
        holder.imageAttachment.visibility = View.GONE
        holder.uploadProgress.visibility = View.GONE
        holder.imageAttachment.setImageDrawable(null)
        holder.imageAttachment.foreground = null
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
        holder.attachment.tag = null
        holder.attachment.setOnClickListener(null)
    }

    private fun absoluteAttachmentUrl(url: String): String {
        if (url.startsWith("content://") || url.startsWith("file://")) return url
        // El backend móvil expone los adjuntos en /storage/chat. Algunos
        // mensajes antiguos guardaron /api/storage/chat, prefijo que el
        // servidor Android no monta y que impedía guardar o reenviar.
        if (url.startsWith("/api/storage/chat/")) {
            return "${ApiConfig.BASE_URL}${url.removePrefix("/api")}"
        }
        if (url.startsWith("/api/")) {
            val base = Uri.parse(ApiConfig.BASE_URL)
            return base.buildUpon()
                .path(url)
                .encodedQuery(null)
                .fragment(null)
                .build()
                .toString()
        }
        if (url.startsWith("http://") || url.startsWith("https://")) {
            val parsed = Uri.parse(url)
            if (parsed.path?.startsWith("/api/storage/") == true) {
                return Uri.parse(ApiConfig.BASE_URL)
                    .buildUpon()
                    .encodedPath(parsed.encodedPath?.removePrefix("/api"))
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
        if (attachmentKind(msg) == "IMAGE") return imageCaptionText(msg.text)
        if (attachmentKind(msg) == "VIDEO") return imageCaptionText(msg.text)
        if (msg.text.contains("Ver ubicación", ignoreCase = true)) return ""
        if (attachmentKind(msg) == "IMAGE") {
            // La imagen ya identifica el adjunto; evitar repetir caption y
            // coordenadas en el texto blanco. La ubicación queda en su bloque inferior.
            return ""
        }
        if (attachmentKind(msg) == "VIDEO") {
            // La información del video se muestra en la miniatura; si tiene
            // ubicación, se conserva únicamente el bloque inferior de ubicación.
            return imageCaptionText(msg.text)
        }
        if (attachmentKind(msg) == "AUDIO" && msg.text.trim().equals("Mensaje de voz", ignoreCase = true)) return ""
        val legacy = legacyAttachment(msg) ?: return callHistoryText(msg.text)
        return legacy.caption?.takeIf { it.isNotBlank() } ?: legacyLabel(legacy)
    }

    private fun imageCaptionText(text: String): String {
        val lines = text.lines()
        val locationStart = lines.indexOfFirst {
            it.trim().matches(Regex("LAT\\s*:\\s*-?\\d+(?:[.,]\\d+)?\\s*,?\\s*LON\\s*:\\s*-?\\d+(?:[.,]\\d+)?", RegexOption.IGNORE_CASE))
        }
        return lines.take(if (locationStart >= 0) locationStart else lines.size)
            .joinToString("\\n")
            .trim()
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

    private fun sizeImageToBitmap(holder: ViewHolder, bitmap: Bitmap) {
        val density = holder.itemView.context.resources.displayMetrics.density
        val maxWidth = (240 * density).toInt()
        val maxHeight = (220 * density).toInt()
        holder.imageAttachment.layoutParams = holder.imageAttachment.layoutParams.apply {
            // El contenedor debe quedar completamente ocupado; FIT_CENTER
            // conserva la proporción dentro de este marco.
            width = maxWidth
            height = maxHeight
        }
    }

    private fun bindDataImageAttachment(holder: ViewHolder, dataUrl: String) {
        val density = holder.itemView.context.resources.displayMetrics.density
        holder.imageAttachment.layoutParams = holder.imageAttachment.layoutParams.apply {
            width = (200 * density).toInt()
            height = (150 * density).toInt()
        }
        holder.imageAttachment.visibility = View.VISIBLE
        holder.imageAttachment.tag = dataUrl
        holder.imageAttachment.scaleType = ImageView.ScaleType.CENTER_CROP
        holder.imageAttachment.setBackgroundColor(Color.parseColor("#0f172a"))

        Thread {
            val bitmap = decodeDataImage(dataUrl)
            mainHandler.post {
                if (holder.imageAttachment.tag == dataUrl && bitmap != null) {
                    sizeImageToBitmap(holder, bitmap)
                    holder.imageAttachment.setImageBitmap(bitmap)
                    holder.imageAttachment.requestLayout()
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

    private fun decodeSampledImage(bytes: ByteArray) = runCatching {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        var sample = 1
        while (bounds.outWidth / sample > 2048 || bounds.outHeight / sample > 2048) sample *= 2
        val options = BitmapFactory.Options().apply {
            inSampleSize = sample
            inPreferredConfig = android.graphics.Bitmap.Config.RGB_565
        }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
    }.getOrNull()

    private fun cachedImageFile(context: android.content.Context, url: String): File {
        return File(context.filesDir, "chat_images/img_${abs(url.hashCode())}.jpg")
    }

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

    private fun bindImageAttachment(holder: ViewHolder, fullUrl: String, msg: ChatMessage) {
        val context = holder.itemView.context.applicationContext
        holder.imageAttachment.layoutParams = holder.imageAttachment.layoutParams.apply {
            width = (200 * context.resources.displayMetrics.density).toInt()
            height = (150 * context.resources.displayMetrics.density).toInt()
        }
        holder.imageAttachment.visibility = View.VISIBLE
        holder.imageAttachment.tag = fullUrl
        holder.imageAttachment.scaleType = ImageView.ScaleType.CENTER_CROP
        holder.imageAttachment.setBackgroundColor(Color.parseColor("#0f172a"))
        holder.imageAttachment.setOnClickListener {
            holder.imageAttachment.drawable?.let { drawable -> showImagePreview(holder.itemView.context, drawable, msg) }
        }

        if (!fullUrl.startsWith("content://") && !fullUrl.startsWith("file://")) {
            val cachedFile = cachedImageFile(context, fullUrl)
            if (cachedFile.exists() && cachedFile.length() > 0L) {
                decodeSampledImage(cachedFile.readBytes())?.let {
                    imageCache.put(fullUrl, it)
                    sizeImageToBitmap(holder, it)
                    holder.imageAttachment.setImageBitmap(it)
                    return
                }
            }
        }

        imageCache.get(fullUrl)?.let {
            sizeImageToBitmap(holder, it)
            holder.imageAttachment.setImageBitmap(it)
            return
        }

        Thread {
            val bitmap = runCatching {
                if (fullUrl.startsWith("content://") || fullUrl.startsWith("file://")) {
                    context.contentResolver.openInputStream(Uri.parse(fullUrl))?.use { decodeSampledImage(it.readBytes()) }
                } else {
                    val token = AuthManager.getToken(context)
                    val request = Request.Builder()
                        .url(fullUrl)
                        .apply { if (token.isNotBlank()) addHeader("Authorization", "Bearer $token") }
                        .build()
                    attachmentHttp.newCall(request).execute().use { response ->
                        if (!response.isSuccessful) return@runCatching null
                        response.body?.bytes()?.let { bytes ->
                            runCatching {
                                val cachedFile = cachedImageFile(context, fullUrl)
                                cachedFile.parentFile?.mkdirs()
                                cachedFile.outputStream().use { it.write(bytes) }
                            }
                            decodeSampledImage(bytes)
                        }
                    }
                }
            }.getOrNull()

            mainHandler.post {
                if (holder.imageAttachment.tag == fullUrl && bitmap != null) {
                    imageCache.put(fullUrl, bitmap)
                    sizeImageToBitmap(holder, bitmap)
                    holder.imageAttachment.setImageBitmap(bitmap)
                    holder.imageAttachment.requestLayout()
                }
            }
        }.start()
    }

    private fun bindVideoAttachment(holder: ViewHolder, fullUrl: String, msg: ChatMessage) {
        val context = holder.itemView.context.applicationContext
        val density = context.resources.displayMetrics.density
        holder.imageAttachment.layoutParams = holder.imageAttachment.layoutParams.apply {
            width = (240 * density).toInt()
            height = (130 * density).toInt()
        }
        val locationLabel = holder.attachment.tag as? String
        val savedVideo = File(context.cacheDir, "chat_media/chat_share_${abs(fullUrl.hashCode())}.mp4")
            .takeIf { it.exists() && it.length() > 0L }
        // VideoView dentro del RecyclerView pinta un Surface negro en este
        // dispositivo aun con un MP4 correcto. Mostramos un control claro y
        // abrimos el reproductor solo al tocarlo.
        holder.videoAttachment.stopPlayback()
        holder.videoAttachment.visibility = View.GONE
        holder.imageAttachment.tag = fullUrl
        val thumbnail = msg.attachmentName
            ?.let { File(context.cacheDir, "chat_thumb_$it.jpg") }
            ?.takeIf { it.exists() }
            ?.let { BitmapFactory.decodeFile(it.absolutePath) }
        if (thumbnail != null) {
            holder.uploadProgress.visibility = View.GONE
            holder.imageAttachment.visibility = View.VISIBLE
            holder.imageAttachment.setImageBitmap(thumbnail)
        } else {
            holder.imageAttachment.visibility = View.GONE
            holder.uploadProgress.visibility = View.VISIBLE
        }
        holder.imageAttachment.scaleType = if (thumbnail != null) {
            ImageView.ScaleType.CENTER_CROP
        } else {
            ImageView.ScaleType.CENTER
        }
        holder.imageAttachment.setBackgroundColor(Color.parseColor("#0B1625"))
        // El icono se mantiene encima de la miniatura, como control de reproducción.
        holder.imageAttachment.foreground = ContextCompat.getDrawable(context, R.drawable.ic_media_play)
        holder.imageAttachment.foregroundGravity = Gravity.CENTER
        holder.imageAttachment.contentDescription = "Reproducir video"
        holder.imageAttachment.setOnClickListener {
            if (savedVideo != null) showVideoPreview(holder.itemView.context, savedVideo, msg)
            else showVideoPreviewUrl(holder.itemView.context, fullUrl, msg)
        }
        if (locationLabel == null) {
            holder.attachment.visibility = View.VISIBLE
            holder.attachment.text = "Reproducir video"
            holder.attachment.setOnClickListener {
                if (savedVideo != null) showVideoPreview(holder.itemView.context, savedVideo, msg)
                else showVideoPreviewUrl(holder.itemView.context, fullUrl, msg)
            }
        }
        return

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
                    // Algunos MP4 vÃ¡lidos (en especial los grabados por
                    // MediaRecorder en Samsung) no reportan duraciÃ³n al
                    // MediaMetadataRetriever hasta que se abren en VideoView.
                    // No los descartamos: basta con que la descarga exista y
                    // tenga contenido; VideoView informarÃ¡ si no puede abrirlo.
                    if (file.length() > 0L) file else null
                }
            }.getOrNull()

            mainHandler.post {
                if (holder.videoAttachment.tag != fullUrl) return@post

                if (cachedFile == null || !cachedFile.exists()) {
                    holder.videoAttachment.visibility = View.GONE
                    holder.attachment.text = locationLabel ?: "Abrir video"
                    holder.attachment.setOnClickListener { openExternal(holder, fullUrl) }
                    return@post
                }
                val localFile = cachedFile ?: return@post

                // VideoView dentro de RecyclerView deja un Surface negro en
                // varios Samsung. Se muestra una miniatura y se reproduce en
                // una ventana propia, fuera de la lista desplazable.
                val thumbnail = runCatching {
                    val retriever = MediaMetadataRetriever()
                    retriever.setDataSource(localFile.absolutePath)
                    val frame = retriever.getFrameAtTime(1_000_000L, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
                    retriever.release()
                    frame
                }.getOrNull()
                holder.videoAttachment.stopPlayback()
                holder.videoAttachment.visibility = View.GONE
                holder.imageAttachment.visibility = View.VISIBLE
                holder.imageAttachment.tag = fullUrl
                holder.imageAttachment.setImageBitmap(thumbnail)
                holder.imageAttachment.setBackgroundColor(Color.parseColor("#0B1625"))
                holder.imageAttachment.setOnClickListener {
                    showVideoPreview(holder.itemView.context, localFile)
                }
                if (locationLabel != null) {
                    holder.attachment.visibility = View.VISIBLE
                    holder.attachment.text = locationLabel
                } else {
                    holder.attachment.visibility = View.VISIBLE
                    holder.attachment.text = "Reproducir video"
                    holder.attachment.setOnClickListener { showVideoPreview(holder.itemView.context, localFile) }
                }
            }
        }
    }

    private fun showVideoPreview(context: android.content.Context, file: File, sourceMessage: ChatMessage? = null) {
        showVideoPreviewSource(context, file = file, sourceMessage = sourceMessage) { player ->
            player.setDataSource(file.absolutePath)
        }
    }

    private fun showVideoPreviewSource(
        context: android.content.Context,
        file: File? = null,
        remoteUrl: String? = null,
        sourceMessage: ChatMessage? = null,
        setDataSource: (MediaPlayer) -> Unit
    ) {
        val dialog = Dialog(context)
        val density = context.resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()
        val root = FrameLayout(context).apply { setBackgroundColor(Color.BLACK) }
        val texture = TextureView(context)
        val control = ImageView(context).apply {
            setImageResource(R.drawable.ic_media_pause)
            imageTintList = ColorStateList.valueOf(Color.WHITE)
            setBackgroundResource(R.drawable.bg_video_circle)
            backgroundTintList = null
            setPadding(dp(16), dp(16), dp(16), dp(16))
            contentDescription = "Pausar video"
        }
        val close = ImageButton(context).apply {
            setImageResource(R.drawable.ic_chat_back)
            imageTintList = ColorStateList.valueOf(Color.WHITE)
            setBackgroundResource(R.drawable.bg_video_circle)
            backgroundTintList = null
            setPadding(dp(10), dp(10), dp(10), dp(10))
            stateListAnimator = null
            contentDescription = "Volver al chat"
        }
        val actions = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            clipChildren = false
            clipToPadding = false
            setPadding(0, 0, 0, 0)
            setBackgroundColor(Color.TRANSPARENT)
        }
        val save = ImageButton(context).apply {
            setImageResource(R.drawable.ic_video_download)
            imageTintList = ColorStateList.valueOf(Color.WHITE)
            contentDescription = "Guardar video"
            setBackgroundResource(R.drawable.bg_video_circle)
            backgroundTintList = null
            setPadding(dp(10), dp(10), dp(10), dp(10))
            stateListAnimator = null
        }
        val share = ImageButton(context).apply {
            setImageResource(R.drawable.ic_forward_video)
            imageTintList = ColorStateList.valueOf(Color.WHITE)
            contentDescription = "Compartir video"
            setBackgroundResource(R.drawable.bg_video_circle)
            backgroundTintList = null
            setPadding(dp(10), dp(10), dp(10), dp(10))
            stateListAnimator = null
        }
        actions.addView(save, LinearLayout.LayoutParams(dp(48), dp(48)).apply { marginEnd = dp(16) })
        actions.addView(share, LinearLayout.LayoutParams(dp(48), dp(48)))
        root.addView(texture, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ))
        root.addView(control, FrameLayout.LayoutParams(dp(56), dp(56), Gravity.CENTER))
        root.addView(actions, FrameLayout.LayoutParams(dp(112), dp(48), Gravity.TOP or Gravity.END).apply { topMargin = dp(14); rightMargin = dp(16) })
        root.addView(close, FrameLayout.LayoutParams(dp(48), dp(48), Gravity.TOP or Gravity.START).apply { topMargin = dp(14); leftMargin = dp(14) })
        val seek = SeekBar(context).apply {
            max = 1000
            splitTrack = false
            setProgressDrawable(resources.getDrawable(R.drawable.seek_video_progress, context.theme))
            thumb = resources.getDrawable(R.drawable.seek_video_thumb, context.theme)
        }
        val timeline = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(18), dp(3), dp(18), dp(3))
            setBackgroundColor(Color.TRANSPARENT)
        }
        val time = TextView(context).apply {
            setTextColor(Color.rgb(225, 242, 255))
            textSize = 12f
            text = "0:00 / 0:00"
        }
        timeline.addView(time, LinearLayout.LayoutParams(dp(66), dp(30)))
        timeline.addView(seek, LinearLayout.LayoutParams(0, dp(26), 1f))
        root.addView(timeline, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(38), Gravity.BOTTOM).apply {
            bottomMargin = dp(10)
        })
        val loading = ProgressBar(context).apply { visibility = View.VISIBLE }
        root.addView(loading, FrameLayout.LayoutParams(72, 72, Gravity.CENTER))

        var surface: Surface? = null
        var player: MediaPlayer? = null
        var isPrepared = false
        var controlsVisible = true
        fun setControlsVisible(visible: Boolean) {
            controlsVisible = visible
            control.visibility = if (visible) View.VISIBLE else View.GONE
            timeline.visibility = if (visible) View.VISIBLE else View.GONE
            actions.visibility = if (visible) View.VISIBLE else View.GONE
            close.visibility = if (visible) View.VISIBLE else View.GONE
        }
        texture.setOnClickListener {
            val active = player ?: return@setOnClickListener
            if (!isPrepared) return@setOnClickListener
            if (active.isPlaying) {
                active.pause()
                control.setImageResource(R.drawable.ic_media_play)
                control.contentDescription = "Reproducir video"
            }
            setControlsVisible(true)
        }
        val progressHandler = Handler(Looper.getMainLooper())
        val progressUpdate = object : Runnable {
            override fun run() {
                val active = player
                if (active != null && isPrepared && active.duration > 0) {
                    seek.progress = (active.currentPosition * 1000 / active.duration).coerceIn(0, 1000)
                    time.text = "${formatVideoTime(active.currentPosition)} / ${formatVideoTime(active.duration)}"
                }
                progressHandler.postDelayed(this, 500)
            }
        }
        fun releasePlayer() {
            progressHandler.removeCallbacks(progressUpdate)
            player?.runCatching { stop() }
            player?.release()
            player = null
            surface?.release()
            surface = null
        }
        fun fitVideoToScreen(videoWidth: Int, videoHeight: Int) {
            if (videoWidth <= 0 || videoHeight <= 0 || root.width <= 0 || root.height <= 0) return
            val scale = minOf(
                root.width.toFloat() / videoWidth,
                root.height.toFloat() / videoHeight
            )
            texture.layoutParams = FrameLayout.LayoutParams(
                (videoWidth * scale).toInt().coerceAtLeast(1),
                (videoHeight * scale).toInt().coerceAtLeast(1),
                Gravity.CENTER
            )
        }
        texture.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
            override fun onSurfaceTextureAvailable(surfaceTexture: SurfaceTexture, width: Int, height: Int) {
                surface = Surface(surfaceTexture)
                player = MediaPlayer().apply {
                    setDataSource(this)
                    setSurface(surface)
                    setOnPreparedListener {
                        isPrepared = true
                        fitVideoToScreen(videoWidth, videoHeight)
                        progressHandler.post(progressUpdate)
                        loading.visibility = View.GONE
                        start()
                        control.setImageResource(R.drawable.ic_media_pause)
                        setControlsVisible(false)
                    }
                    setOnCompletionListener {
                        control.setImageResource(R.drawable.ic_media_play)
                        control.contentDescription = "Reproducir video"
                        setControlsVisible(true)
                    }
                    setOnErrorListener { _, _, _ ->
                        loading.visibility = View.GONE
                        Toast.makeText(context, "No se pudo reproducir el video", Toast.LENGTH_SHORT).show()
                        true
                    }
                    prepareAsync()
                }
            }

            override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) = Unit
            override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean {
                releasePlayer()
                return true
            }
            override fun onSurfaceTextureUpdated(surface: SurfaceTexture) = Unit
        }
        close.setOnClickListener { dialog.dismiss() }
        seek.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(bar: SeekBar?, value: Int, fromUser: Boolean) {
                if (fromUser && isPrepared) player?.seekTo((player?.duration ?: 0) * value / 1000)
            }
            override fun onStartTrackingTouch(bar: SeekBar?) = Unit
            override fun onStopTrackingTouch(bar: SeekBar?) = Unit
        })
        fun downloadForAction(action: (File) -> Unit) {
            if (file != null && file.exists() && file.length() > 0L) { action(file); return }
            val url = remoteUrl?.let(::absoluteAttachmentUrl) ?: return
            loading.visibility = View.VISIBLE
            Thread {
                val downloaded = runCatching {
                    val request = Request.Builder().url(url).apply {
                        AuthManager.getToken(context.applicationContext).takeIf { it.isNotBlank() }?.let { addHeader("Authorization", "Bearer $it") }
                    }.header("Accept", "video/mp4,video/*,*/*")
                        .header("Cache-Control", "no-cache")
                        .build()
                    attachmentHttp.newCall(request).execute().use { response ->
                        if (!response.isSuccessful || response.body == null) {
                            android.util.Log.e("CHAT_ATTACHMENT", "Descarga de video falló: HTTP ${response.code} URL=$url")
                            return@runCatching null
                        }
                        // La copia debe quedar en chat_media: es la única ruta
                        // expuesta por FileProvider para reenviar el video.
                        // Primero escribimos un archivo temporal para no usar una
                        // descarga parcial si se corta la conexión.
                        val mediaDir = File(context.cacheDir, "chat_media").apply { mkdirs() }
                        val target = File(mediaDir, "chat_share_${abs(url.hashCode())}.mp4")
                        val temporary = File(mediaDir, "${target.name}.part")
                        temporary.delete()
                        response.body!!.byteStream().use { input ->
                            FileOutputStream(temporary).use { output -> input.copyTo(output) }
                        }
                        check(temporary.length() > 0L) { "El servidor devolvió un video vacío" }
                        if (target.exists()) target.delete()
                        check(temporary.renameTo(target)) { "No se pudo finalizar la descarga" }
                        target
                    }
                }.onFailure {
                    android.util.Log.e("CHAT_ATTACHMENT", "No se pudo descargar el video: $url", it)
                }.getOrNull()
                mainHandler.post {
                    loading.visibility = View.GONE
                    if (downloaded == null) Toast.makeText(context, "No se pudo descargar el video", Toast.LENGTH_SHORT).show()
                    else action(downloaded)
                }
            }.start()
        }
        save.setOnClickListener { downloadForAction { saveVideo(context, it) } }
        share.setOnClickListener {
            downloadForAction { file ->
                if (sourceMessage != null) onForwardVideo?.invoke(file, sourceMessage)
                else shareVideo(context, file)
            }
        }
        control.setOnClickListener {
            val activePlayer = player ?: return@setOnClickListener
            if (!isPrepared) return@setOnClickListener
            if (activePlayer.isPlaying) {
                activePlayer.pause()
                control.setImageResource(R.drawable.ic_media_play)
                control.contentDescription = "Reproducir video"
                setControlsVisible(true)
            } else {
                activePlayer.start()
                control.setImageResource(R.drawable.ic_media_pause)
                control.contentDescription = "Pausar video"
                setControlsVisible(false)
            }
        }
        dialog.setOnDismissListener { releasePlayer() }
        dialog.setContentView(root)
        dialog.window?.setBackgroundDrawableResource(android.R.color.black)
        dialog.show()
        dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    }

    private fun showVideoPreviewUrl(context: android.content.Context, url: String, sourceMessage: ChatMessage? = null) {
        // ReproducciÃ³n progresiva: no esperamos a descargar el archivo completo.
        val remoteContext = context.applicationContext
        val remoteToken = AuthManager.getToken(remoteContext)
        showVideoPreviewSource(context, remoteUrl = url, sourceMessage = sourceMessage) { player ->
            val headers = if (remoteToken.isBlank()) emptyMap() else mapOf("Authorization" to "Bearer $remoteToken")
            player.setDataSource(remoteContext, Uri.parse(url), headers)
        }
        return

        // El reproductor de este dispositivo deja negro el Surface cuando la
        // fuente es HTTP. Se descarga primero a la cachÃ© y se reproduce el MP4
        // local, manteniendo la reproducciÃ³n dentro de la aplicaciÃ³n.
        Toast.makeText(context, "Cargando video...", Toast.LENGTH_SHORT).show()
        val appContext = context.applicationContext
        Thread {
            val localFile = runCatching {
                val token = AuthManager.getToken(appContext)
                val request = Request.Builder()
                    .url(url)
                    .apply {
                        if (token.isNotBlank()) addHeader("Authorization", "Bearer $token")
                    }
                    .build()
                attachmentHttp.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) return@runCatching null
                    val extension = videoExtension(url, response.header("Content-Type").orEmpty())
                    val file = File(appContext.cacheDir, "chat_play_${abs(url.hashCode())}$extension")
                    response.body?.byteStream()?.use { input ->
                        FileOutputStream(file).use { output -> input.copyTo(output) }
                    } ?: return@runCatching null
                    file.takeIf { it.length() > 0L }
                }
            }.getOrNull()
            mainHandler.post {
                if (localFile == null) {
                    Toast.makeText(context, "No se pudo cargar el video", Toast.LENGTH_SHORT).show()
                } else {
                    showVideoPreview(context, localFile)
                }
            }
        }.start()
    }

    private fun formatVideoTime(milliseconds: Int): String {
        val totalSeconds = (milliseconds / 1000).coerceAtLeast(0)
        return "%d:%02d".format(totalSeconds / 60, totalSeconds % 60)
    }

    private fun saveVideo(context: android.content.Context, file: File) {
        val values = android.content.ContentValues().apply {
            put(android.provider.MediaStore.Video.Media.DISPLAY_NAME, file.name)
            put(android.provider.MediaStore.Video.Media.MIME_TYPE, "video/mp4")
            put(android.provider.MediaStore.Video.Media.RELATIVE_PATH, "Movies/Operaciones")
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                put(android.provider.MediaStore.Video.Media.IS_PENDING, 1)
            }
        }
        val uri = context.contentResolver.insert(android.provider.MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values)
        if (uri == null) { Toast.makeText(context, "No se pudo guardar el video", Toast.LENGTH_SHORT).show(); return }
        runCatching {
            context.contentResolver.openOutputStream(uri)?.use { output ->
                file.inputStream().use { input -> input.copyTo(output) }
            } ?: error("No se pudo abrir el destino de guardado")
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                context.contentResolver.update(uri, android.content.ContentValues().apply {
                    put(android.provider.MediaStore.Video.Media.IS_PENDING, 0)
                }, null, null)
            }
        }
            .onSuccess { Toast.makeText(context, "Video guardado en Movies/Operaciones", Toast.LENGTH_SHORT).show() }
            .onFailure { context.contentResolver.delete(uri, null, null); Toast.makeText(context, "No se pudo guardar el video", Toast.LENGTH_SHORT).show() }
    }

    private fun shareVideo(context: android.content.Context, file: File) {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "video/mp4"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        try { context.startActivity(Intent.createChooser(intent, "Compartir video")) }
        catch (_: ActivityNotFoundException) { Toast.makeText(context, "No hay aplicaciones para compartir", Toast.LENGTH_SHORT).show() }
    }

    private fun showImagePreview(context: android.content.Context, drawable: android.graphics.drawable.Drawable, sourceMessage: ChatMessage? = null) {
        val dialog = Dialog(context)
        val density = context.resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()
        val root = FrameLayout(context).apply { setBackgroundColor(Color.BLACK) }
        val image = ImageView(context).apply {
            setImageDrawable(drawable)
            scaleType = ImageView.ScaleType.FIT_CENTER
            contentDescription = "Vista ampliada de la imagen. Toca para cerrar"
        }
        root.addView(image, FrameLayout.LayoutParams(-1, -1))
        val close = ImageButton(context).apply {
            setImageResource(R.drawable.ic_chat_back); imageTintList = ColorStateList.valueOf(Color.WHITE)
            setBackgroundResource(R.drawable.bg_video_circle); setPadding(dp(10), dp(10), dp(10), dp(10))
            setOnClickListener { dialog.dismiss() }
        }
        image.setOnClickListener { dialog.dismiss() }
        val actions = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL }
        val save = ImageButton(context).apply { setImageResource(R.drawable.ic_video_download); imageTintList = ColorStateList.valueOf(Color.WHITE); setBackgroundResource(R.drawable.bg_video_circle); setPadding(dp(10), dp(10), dp(10), dp(10)); setOnClickListener { saveImage(context, drawable.toBitmap()); Toast.makeText(context, "Imagen guardada", Toast.LENGTH_SHORT).show() } }
        val share = ImageButton(context).apply { setImageResource(R.drawable.ic_forward_video); imageTintList = ColorStateList.valueOf(Color.WHITE); setBackgroundResource(R.drawable.bg_video_circle); setPadding(dp(10), dp(10), dp(10), dp(10)); setOnClickListener { shareImage(context, drawable.toBitmap(), sourceMessage) } }
        actions.addView(save, LinearLayout.LayoutParams(dp(48), dp(48)).apply { marginEnd = dp(16) }); actions.addView(share, LinearLayout.LayoutParams(dp(48), dp(48)))
        root.addView(close, FrameLayout.LayoutParams(dp(48), dp(48), Gravity.TOP or Gravity.START).apply { topMargin = dp(14); leftMargin = dp(14) })
        root.addView(actions, FrameLayout.LayoutParams(dp(112), dp(48), Gravity.TOP or Gravity.END).apply { topMargin = dp(14); rightMargin = dp(16) })
        dialog.setContentView(root)
        dialog.window?.setBackgroundDrawableResource(android.R.color.black)
        dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        dialog.show()
        dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    }

    private fun saveImage(context: android.content.Context, bitmap: android.graphics.Bitmap) {
        val values = android.content.ContentValues().apply { put(android.provider.MediaStore.Images.Media.DISPLAY_NAME, "imagen_${System.currentTimeMillis()}.jpg"); put(android.provider.MediaStore.Images.Media.MIME_TYPE, "image/jpeg"); put(android.provider.MediaStore.Images.Media.RELATIVE_PATH, "Pictures/Operaciones") }
        context.contentResolver.insert(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)?.let { uri -> context.contentResolver.openOutputStream(uri)?.use { bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 95, it) } }
    }

    private fun shareImage(context: android.content.Context, bitmap: android.graphics.Bitmap, sourceMessage: ChatMessage? = null) {
        val file = File(context.cacheDir, "shared_image_${System.currentTimeMillis()}.jpg")
        FileOutputStream(file).use { bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 95, it) }
        if (sourceMessage != null) { onForwardImage?.invoke(file, sourceMessage); return }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
        context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply { type = "image/jpeg"; putExtra(Intent.EXTRA_STREAM, uri); addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION) }, "Compartir imagen"))
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
