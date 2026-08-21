package com.operaciones.operaciones_android.model

data class ChatMessage(
    val id: Int? = null,
    val idUsuario: Int? = null,
    val idPersonal: Int? = null,
    val user: String,
    val text: String,
    val type: MessageType = MessageType.NORMAL,
    val isMine: Boolean = false,
    val destinatarioRol: String? = null,
    val autorRol: String? = null,   // "ADMIN" | "CUT" | "CET" | "CELL"
    val sentAtLabel: String? = null,
    val destinoTipo: String? = null,
    val destinoId: String? = null,
    val destinoLabel: String? = null,
    val attachmentKind: String? = null,
    val attachmentUrl: String? = null,
    val attachmentMime: String? = null,
    val attachmentName: String? = null,
    val attachmentSize: Long? = null,
    val attachmentDurationMs: Long? = null
)

enum class MessageType { NORMAL, SYSTEM, ALERT }
