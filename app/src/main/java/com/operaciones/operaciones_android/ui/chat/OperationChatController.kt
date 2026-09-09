package com.operaciones.operaciones_android.ui.chat

import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.recyclerview.widget.RecyclerView
import com.operaciones.operaciones_android.model.ChatMessage
import com.operaciones.operaciones_android.model.MessageType
import com.operaciones.operaciones_android.model.PersonalItem
import com.operaciones.operaciones_android.model.User
import com.operaciones.operaciones_android.network.ChatRepository
import com.operaciones.operaciones_android.ui.panel.ChatChannelSelection
import com.operaciones.operaciones_android.ui.panel.ChatPanelRefs
import com.operaciones.operaciones_android.ui.adapter.ChatAdapter
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

class OperationChatController(
    private val repository: ChatRepository = ChatRepository(),
    private val host: Host,
    private val vibrationController: ChatVibrationController? = null,
    private val mainHandler: Handler = Handler(Looper.getMainLooper())
) {
    interface Host {
        fun getChatOperationId(): Int
        fun getChatToken(): String
        fun getChatCurrentUser(): User
        fun getChatPersonal(): List<PersonalItem>
        fun getChatContentResolver(): android.content.ContentResolver
        fun getChatLastLocation(): Pair<Double, Double>?
        fun getChatReadMessageIds(): Set<Int>
        fun saveChatReadMessageIds(ids: Set<Int>)
        fun onChatMessageAdded(message: ChatMessage, visibleInActiveChat: Boolean)
        fun onChatVisibleMessagesRead(messages: List<ChatMessage>)
        fun onChatUnreadCountsChanged()
    }

    private val messages = mutableListOf<ChatMessage>()
    private val unreadMessages = mutableListOf<ChatMessage>()
    private val readMessageIds by lazy { host.getChatReadMessageIds().toMutableSet() }
    val visibleMessages = mutableListOf<ChatMessage>()

    private var chatLoaded = false
    private var activeSelection = ChatChannelSelection(
        type = "GLOBAL",
        destinatarioRol = "GLOBAL"
    )
    private var chatAdapter: ChatAdapter? = null
    private var chatRecycler: RecyclerView? = null
    private var conversationOpen = false
    private var historySyncInFlight = false

    fun bindPanel(refs: ChatPanelRefs) {
        chatRecycler = refs.recyclerView
        chatAdapter = refs.adapter
        refreshVisibleMessages()
    }

    fun setActiveSelection(selection: ChatChannelSelection) {
        activeSelection = selection
        refreshVisibleMessages()
    }

    fun setConversationOpen(open: Boolean) {
        conversationOpen = open
        if (open) markActiveSelectionRead()
    }

    fun unreadCountFor(selection: ChatChannelSelection): Int =
        unreadMessages.count { isVisibleInChatFilter(it, selection) }

    fun lastMessagePreviewFor(selection: ChatChannelSelection): String {
        val message = messages.lastOrNull {
            it.type != MessageType.SYSTEM && isVisibleInChatFilter(it, selection)
        } ?: return "Sin mensajes todavía"

        return when (message.attachmentKind.orEmpty().uppercase()) {
            "AUDIO" -> "Mensaje de voz"
            "IMAGE" -> "Imagen"
            "VIDEO" -> "Video"
            "FILE" -> "Archivo adjunto"
            else -> message.text.trim().ifBlank { "Archivo adjunto" }
        }
    }

    fun totalUnreadCount(): Int = unreadMessages.size

    fun markActiveSelectionRead() {
        val readNow = unreadMessages.filter { isVisibleInActiveChatFilter(it) }
        val removed = unreadMessages.removeAll(readNow.toSet())
        rememberMessagesAsRead(readNow)
        if (removed) host.onChatUnreadCountsChanged()
    }

    fun addMessage(msg: ChatMessage) {
        mainHandler.post {
            val exists = msg.id != null && messages.any { it.id == msg.id }
            if (exists) return@post

            val visibleInActiveChat = isVisibleInActiveChatFilter(msg)

            messages.add(msg)
            if (!msg.isMine && msg.type != MessageType.SYSTEM &&
                !(conversationOpen && visibleInActiveChat)) {
                unreadMessages.add(msg)
                host.onChatUnreadCountsChanged()
            } else if (!msg.isMine && conversationOpen && visibleInActiveChat) {
                rememberMessagesAsRead(listOf(msg))
            }
            vibrationController?.vibrateForMessage(msg)
            host.onChatMessageAdded(msg, visibleInActiveChat)

            if (visibleInActiveChat) {
                visibleMessages.add(msg)
            } else {
                return@post
            }

            chatAdapter?.notifyItemInserted(visibleMessages.size - 1)
            chatRecycler?.scrollToPosition(visibleMessages.size - 1)
        }
    }

    private fun removeMessageById(id: Int) {
        mainHandler.post {
            messages.removeAll { it.id == id }
            val index = visibleMessages.indexOfFirst { it.id == id }
            if (index >= 0) {
                visibleMessages.removeAt(index)
                chatAdapter?.notifyItemRemoved(index)
            }
        }
    }

    fun addMessageFromJson(item: JSONObject) {
        addMessage(parseChatMessage(item))
    }

    fun sendMessage(
        text: String,
        alert: Boolean,
        destinatarioRol: String?,
        destinoTipo: String?,
        destinoId: String?,
        destinoLabel: String?
    ) {
        val operationId = host.getChatOperationId()
        if (operationId <= 0) {
            addMessage(
                ChatMessage(
                    user = "Sistema",
                    text = "No hay operacion activa para enviar mensajes.",
                    type = MessageType.SYSTEM
                )
            )
            return
        }

        repository.sendMessage(
            operationId = operationId,
            token = host.getChatToken(),
            contenido = text,
            tipoMensaje = if (alert) "URGENTE" else "NORMAL",
            destinatarioRol = destinatarioRol,
            destinoTipo = destinoTipo,
            destinoId = destinoId,
            destinoLabel = destinoLabel,
            onSuccess = { item ->
                // El callback de OkHttp llega en un hilo de red.  Una respuesta
                // valida pero con algun campo inesperado no debe tumbar la UI.
                mainHandler.post {
                    runCatching { parseChatMessage(item) }
                        .onSuccess(::addMessage)
                        .onFailure { error ->
                            Log.e("CHAT_HTTP", "No se pudo interpretar el mensaje enviado", error)
                            addMessage(
                                ChatMessage(
                                    user = "Sistema",
                                    text = "El mensaje se envio, pero no se pudo mostrar la respuesta.",
                                    type = MessageType.SYSTEM
                                )
                            )
                        }
                }
            },
            onError = { message ->
                addMessage(ChatMessage(user = "Sistema", text = message, type = MessageType.SYSTEM))
            }
        )
    }

    fun sendAttachment(
        uri: Uri,
        fileName: String,
        mimeType: String,
        attachmentKind: String,
        destinatarioRol: String?,
        destinoTipo: String?,
        destinoId: String?,
        destinoLabel: String?,
        durationMs: Long? = null,
        caption: String? = null,
        onComplete: ((Boolean) -> Unit)? = null
    ) {
        val operationId = host.getChatOperationId()
        if (operationId <= 0) {
            onComplete?.invoke(false)
            addMessage(
                ChatMessage(
                    user = "Sistema",
                    text = "No hay operacion activa para enviar adjuntos.",
                    type = MessageType.SYSTEM
                )
            )
            return
        }

        val pendingId = -kotlin.math.abs(System.nanoTime().toInt())
        addMessage(
            ChatMessage(
                id = pendingId,
                user = host.getChatCurrentUser().nombreCompleto,
                text = caption.orEmpty(),
                isMine = true,
                destinatarioRol = destinatarioRol,
                destinoTipo = destinoTipo,
                destinoId = destinoId,
                destinoLabel = destinoLabel,
                attachmentKind = attachmentKind,
                attachmentUrl = uri.toString(),
                attachmentMime = mimeType,
                attachmentName = fileName,
                isUploading = true
            )
        )

        repository.sendAttachment(
            operationId = operationId,
            token = host.getChatToken(),
            contentResolver = host.getChatContentResolver(),
            uri = uri,
            fileName = fileName,
            mimeType = mimeType,
            attachmentKind = attachmentKind,
            destinatarioRol = destinatarioRol,
            destinoTipo = destinoTipo,
            destinoId = destinoId,
            destinoLabel = destinoLabel,
            durationMs = durationMs,
            caption = caption,
            onSuccess = { item ->
                // OkHttp ejecuta este callback fuera del hilo de UI. Protegemos
                // tambien la respuesta de adjuntos (especialmente imagenes),
                // que puede traer campos distintos a los de un mensaje normal.
                mainHandler.post {
                    removeMessageById(pendingId)
                    runCatching { parseChatMessage(item) }
                        .onSuccess(::addMessage)
                        .onFailure { error ->
                            Log.e("CHAT_HTTP", "No se pudo interpretar el adjunto enviado", error)
                            addMessage(
                                ChatMessage(
                                    user = "Sistema",
                                    text = "La foto se envio, pero no se pudo mostrar la respuesta.",
                                    type = MessageType.SYSTEM
                                )
                            )
                        }
                    onComplete?.invoke(true)
                }
            },
            onError = { message ->
                mainHandler.post {
                    removeMessageById(pendingId)
                    addMessage(ChatMessage(user = "Sistema", text = message, type = MessageType.SYSTEM))
                    onComplete?.invoke(false)
                }
            }
        )
    }

    fun loadHistoryIfNeeded() {
        val operationId = host.getChatOperationId()
        if (chatLoaded || operationId <= 0) return

        repository.getMessages(
            operationId = operationId,
            token = host.getChatToken(),
            onSuccess = { items ->
                mainHandler.post {
                    messages.clear()
                    unreadMessages.clear()

                    for (i in 0 until items.length()) {
                        val item = items.optJSONObject(i) ?: continue
                        val message = parseChatMessage(item)
                        messages.add(message)
                        val visibleInOpenConversation = conversationOpen && isVisibleInActiveChatFilter(message)
                        if (!message.isMine && message.type != MessageType.SYSTEM &&
                            (message.id == null || message.id !in readMessageIds) && !visibleInOpenConversation) {
                            unreadMessages.add(message)
                        } else if (!message.isMine && visibleInOpenConversation) {
                            rememberMessagesAsRead(listOf(message))
                        }
                    }

                    chatLoaded = true
                    refreshVisibleMessages()
                    host.onChatUnreadCountsChanged()
                }
            },
            onError = { message ->
                Log.w("CHAT_HTTP", "No se pudo cargar historial de chat: $message")
            }
        )
    }

    fun refreshVisibleMessages(notify: Boolean = true) {
        visibleMessages.clear()
        visibleMessages.addAll(messages.filter { isVisibleInActiveChatFilter(it) })

        if (notify) {
            chatAdapter?.notifyDataSetChanged()
            if (visibleMessages.isNotEmpty()) {
                chatRecycler?.scrollToPosition(visibleMessages.size - 1)
            }
        }
    }

    private fun parseChatMessage(item: JSONObject): ChatMessage {
        val id = item.optInt("id_mensaje", -1).takeIf { it > 0 }
        val autor = item.optString("autor_nombre", "Sistema")
        val contenido = item.optString("contenido", "")
        val tipoMensaje = item.optString("tipo_mensaje", "NORMAL").uppercase()

        val messageType = when (tipoMensaje) {
            "URGENTE" -> MessageType.ALERT
            "SISTEMA" -> MessageType.SYSTEM
            else -> MessageType.NORMAL
        }

        val idPersonal = item.optInt("id_personal", -1).takeIf { it > 0 }
        val idUsuario = item.optInt("id_usuario", -1).takeIf { it > 0 }
        val currentUser = host.getChatCurrentUser()
        val isMine = (idPersonal != null && idPersonal == currentUser.id) ||
            (idUsuario != null && idUsuario == currentUser.id)

        return ChatMessage(
            id = id,
            idUsuario = idUsuario,
            idPersonal = idPersonal,
            user = autor,
            text = contenido,
            type = messageType,
            isMine = isMine,
            destinatarioRol = item.optString("destinatario_rol", "GLOBAL"),
            autorRol = item.optString("autor_rol", "").uppercase().ifBlank { null },
            sentAtLabel = messageTimeLabel(item),
            destinoTipo = optionalJsonString(item, "destino_tipo"),
            destinoId = optionalJsonString(item, "destino_id"),
            destinoLabel = optionalJsonString(item, "destino_label"),
            attachmentKind = optionalJsonString(item, "attachment_kind"),
            attachmentUrl = optionalJsonString(item, "attachment_url"),
            attachmentMime = optionalJsonString(item, "attachment_mime"),
            attachmentName = optionalJsonString(item, "attachment_name"),
            attachmentSize = optionalJsonLong(item, "attachment_size"),
            attachmentDurationMs = optionalJsonLong(item, "attachment_duration_ms")
        )
    }

    private fun optionalJsonString(item: JSONObject, key: String): String? {
        if (!item.has(key) || item.isNull(key)) return null
        return item.optString(key, "").trim()
            .takeUnless { it.isBlank() || it.equals("null", ignoreCase = true) }
    }

    fun syncMissedMessages() {
        if (!chatLoaded) {
            loadHistoryIfNeeded()
            return
        }
        if (historySyncInFlight) return
        historySyncInFlight = true

        repository.getMessages(
            operationId = host.getChatOperationId(),
            token = host.getChatToken(),
            onSuccess = { items ->
                historySyncInFlight = false
                for (i in 0 until items.length()) {
                    items.optJSONObject(i)?.let(::addMessageFromJson)
                }
            },
            onError = { message ->
                historySyncInFlight = false
                Log.w("CHAT_HTTP", "No se pudieron sincronizar mensajes: $message")
            }
        )
    }

    private fun messageTimeLabel(item: JSONObject): String {
        val raw = listOf(
            "created_at",
            "fecha_creacion",
            "fecha_envio",
            "hora_envio",
            "timestamp",
            "createdAt"
        ).firstNotNullOfOrNull { key -> optionalJsonString(item, key) }

        return raw?.let { formatMessageTime(it) }
            ?: SimpleDateFormat("HH:mm", Locale.getDefault()).format(java.util.Date())
    }

    private fun formatMessageTime(value: String): String {
        val trimmed = value.trim()
        if (Regex("""^\d{1,2}:\d{2}(:\d{2})?$""").matches(trimmed)) {
            return trimmed.take(5)
        }

        val normalized = trimmed.replace("Z", "+0000")
        val inputPatterns = listOf(
            "yyyy-MM-dd'T'HH:mm:ss.SSSZ",
            "yyyy-MM-dd'T'HH:mm:ssZ",
            "yyyy-MM-dd HH:mm:ss",
            "yyyy-MM-dd HH:mm",
            "dd/MM/yyyy HH:mm:ss",
            "HH:mm:ss dd/MM/yyyy"
        )
        val output = SimpleDateFormat("HH:mm", Locale.getDefault())

        for (pattern in inputPatterns) {
            val parsed = runCatching {
                SimpleDateFormat(pattern, Locale.US).apply {
                    if (pattern.endsWith("Z")) timeZone = TimeZone.getTimeZone("UTC")
                }.parse(normalized)
            }.getOrNull()
            if (parsed != null) return output.format(parsed)
        }

        return trimmed
    }

    private fun optionalJsonLong(item: JSONObject, key: String): Long? {
        if (!item.has(key) || item.isNull(key)) return null
        return runCatching { item.getLong(key) }.getOrNull()
    }

    private fun isVisibleInActiveChatFilter(msg: ChatMessage): Boolean {
        return isVisibleInChatFilter(msg, activeSelection)
    }

    private fun rememberMessagesAsRead(readMessages: Collection<ChatMessage>) {
        var changed = false
        readMessages.mapNotNull { it.id }.forEach { id ->
            if (readMessageIds.add(id)) changed = true
        }
        if (changed) {
            host.saveChatReadMessageIds(readMessageIds.sortedDescending().take(500).toSet())
        }
    }

    private fun isVisibleInChatFilter(
        msg: ChatMessage,
        selection: ChatChannelSelection
    ): Boolean {
        if (msg.type == MessageType.SYSTEM) return true
        val destinatario = msg.destinatarioRol.orEmpty().trim().uppercase().ifBlank { "GLOBAL" }
        val destinoTipo = msg.destinoTipo.orEmpty().trim().uppercase()
        val destinoId = msg.destinoId

        return when (selection.type.uppercase()) {
            // UBICACION es metadato de una foto o mensaje global, no un canal
            // de conversación. Debe seguir viéndose en el chat Global.
            "GLOBAL" -> destinatario == "GLOBAL" &&
                (destinoTipo.isBlank() || destinoTipo == "GLOBAL" || destinoTipo == "UBICACION")
            "CETS" -> destinatario == "CET" && (destinoTipo.isBlank() || destinoTipo == "CETS")
            "CET_SPECIFIC" -> directMessageMatches(msg, selection, "CET", "CELL", "CUT")
            "CUTS" -> destinoTipo == "CUTS" || (destinatario == "CUT" && destinoTipo.isBlank())
            "CUT_SPECIFIC" -> directMessageMatches(msg, selection, "CUT", "CET")
            "CELL_SPECIFIC" -> directMessageMatches(msg, selection, "CELL", "CET")
            "FLOTILLA" -> isFlotillaMessageForSelection(msg, selection)
            "GRUPO" -> destinoTipo == "GRUPO" && matchesGroupSelection(msg, selection)
            "VEHICULO" -> (destinoTipo == "VEHICULO" && sameChatValue(destinoId, selection.destinoId)) ||
                cellListMatchesVehicleSelection(msg, selection)
            else -> destinatario == "GLOBAL" && destinoTipo.isBlank()
        }
    }

    private fun directMessageMatches(
        msg: ChatMessage,
        selection: ChatChannelSelection,
        vararg allowedDestinationTypes: String
    ): Boolean {
        val destinationType = msg.destinoTipo.orEmpty().trim().uppercase()
        if (destinationType !in allowedDestinationTypes) return false

        val contactId = selection.destinoId
        return sameChatValue(msg.destinoId, contactId) ||
            sameChatValue(msg.idPersonal?.toString(), contactId) ||
            sameChatValue(msg.idUsuario?.toString(), contactId)
    }

    private fun cellListMatchesVehicleSelection(
        msg: ChatMessage,
        selection: ChatChannelSelection
    ): Boolean {
        if (!msg.destinoTipo.equals("CELL_LIST", ignoreCase = true)) return false
        val msgLabelNorm = normalizeChatValue(msg.destinoLabel)
        val selLabelNorm = normalizeChatValue(selection.destinoLabel)
        if (msgLabelNorm.isNotBlank() && selLabelNorm.isNotBlank() &&
            (msgLabelNorm.contains(selLabelNorm) || selLabelNorm.contains(msgLabelNorm))) return true

        val messageRecipientIds = splitChatIds(msg.destinoId)
        val selectedRecipientIds = splitChatIds(selection.destinoSendId)
        if (messageRecipientIds.isEmpty() || selectedRecipientIds.isEmpty()) return false
        return messageRecipientIds.any { it in selectedRecipientIds }
    }

    private fun isFlotillaMessageForSelection(
        msg: ChatMessage,
        selection: ChatChannelSelection
    ): Boolean {
        return when (msg.destinoTipo.orEmpty().trim().uppercase()) {
            "FLOTILLA" -> matchesAnyChatAlias(
                listOf(msg.destinoId, msg.destinoLabel),
                flotillaAliasesForSelection(selection)
            )
            else -> false
        }
    }

    private fun matchesGroupSelection(
        msg: ChatMessage,
        selection: ChatChannelSelection
    ): Boolean = matchesAnyChatAlias(
        listOf(msg.destinoId, msg.destinoLabel),
        groupAliasesForSelection(selection)
    )

    private fun cellBelongsToFlotilla(cellId: String?, selection: ChatChannelSelection): Boolean {
        val cell = host.getChatPersonal().firstOrNull {
            it.rol.equals("CELL", ignoreCase = true) &&
                sameChatValue(it.idPersonal.toString(), cellId)
        } ?: return false

        return matchesAnyChatAlias(personalFlotillaAliases(cell), flotillaAliasesForSelection(selection))
    }

    private fun flotillaAliasesForSelection(selection: ChatChannelSelection): Set<String> {
        val aliases = linkedSetOf<String>()
        aliases.addNormalized(selection.destinoId)
        aliases.addNormalized(selection.destinoLabel)

        host.getChatPersonal().forEach { person ->
            val personAliases = personalFlotillaAliases(person)
            if (matchesAnyChatAlias(personAliases, aliases)) {
                aliases.addNormalized(personAliases)
            }
        }

        return aliases
    }

    private fun groupAliasesForSelection(selection: ChatChannelSelection): Set<String> {
        val aliases = linkedSetOf<String>()
        aliases.addNormalized(selection.destinoId)
        aliases.addNormalized(selection.destinoLabel)
        selection.destinoLabel
            ?.substringBefore("(")
            ?.trim()
            ?.let { aliases.addNormalized(it) }

        host.getChatPersonal().forEach { person ->
            val personAliases = personalGroupAliases(person)
            if (matchesAnyChatAlias(personAliases, aliases)) {
                aliases.addNormalized(personAliases)
            }
        }

        return aliases
    }

    private fun personalFlotillaAliases(person: PersonalItem): List<String?> {
        val padre = person.grupoPadreNombre.trim()
        val padreApodo = person.grupoPadreApodo.trim()
        val grupo = person.grupoNombre.trim()
        val grupoApodo = person.grupoApodo.trim()
        val useParent = (padre.isNotBlank() || padreApodo.isNotBlank()) &&
            !isRootGroupName(padre) &&
            !isRootGroupName(padreApodo)

        return if (useParent) {
            listOf(
                person.idGrupoPadre?.toString(),
                padre,
                padreApodo,
                person.cetFlotilla
            )
        } else {
            listOf(
                person.idGrupoOperacion?.toString(),
                grupo,
                grupoApodo,
                person.cetFlotilla
            )
        }
    }

    private fun personalGroupAliases(person: PersonalItem): List<String?> {
        val grupo = person.grupoNombre.trim()
        val grupoApodo = person.grupoApodo.trim()
        val padre = person.grupoPadreNombre.trim()
        val padreApodo = person.grupoPadreApodo.trim()
        return listOf(
            person.idGrupoOperacion?.toString(),
            grupo,
            grupoApodo,
            if (grupo.isNotBlank() && padre.isNotBlank()) "$grupo ($padre)" else null,
            if (grupoApodo.isNotBlank() && padreApodo.isNotBlank()) "$grupoApodo ($padreApodo)" else null
        )
    }

    private fun isRootGroupName(value: String?): Boolean {
        val normalized = normalizeChatValue(value)
        return normalized.isBlank() ||
            normalized == "mando operativo" ||
            normalized == "sin flotilla" ||
            normalized == "root"
    }

    private fun matchesAnyChatAlias(values: Iterable<String?>, aliases: Iterable<String?>): Boolean {
        val normalizedAliases = aliases
            .map { normalizeChatValue(it) }
            .filter { it.isNotBlank() }
            .toSet()
        if (normalizedAliases.isEmpty()) return false
        return values.any { normalizeChatValue(it) in normalizedAliases }
    }

    private fun sameChatValue(a: String?, b: String?): Boolean {
        val left = normalizeChatValue(a)
        val right = normalizeChatValue(b)
        return left.isNotBlank() && left == right
    }

    private fun splitChatIds(value: String?): Set<String> =
        value.orEmpty()
            .split(",")
            .map { normalizeChatValue(it) }
            .filter { it.isNotBlank() }
            .toSet()

    private fun normalizeChatValue(value: String?): String =
        value.orEmpty().trim().lowercase()

    private fun MutableSet<String>.addNormalized(value: String?) {
        val normalized = value.orEmpty().trim()
        if (normalized.isNotBlank()) add(normalized)
    }

    private fun MutableSet<String>.addNormalized(values: Iterable<String?>) {
        values.forEach { addNormalized(it) }
    }
}
