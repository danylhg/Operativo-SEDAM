package com.operaciones.operaciones_android.data

/** IDs de los tipos de chat que existen en la pantalla de Chats. */
object SedamMovilChatIds {
    const val TODOS = 721
    const val VEHICULO = 722
    const val FLOTILLA = 723
    const val GRUPO = 724
    const val TODOS_CET = 725
    const val CET = 726
    const val CELL = 727
    const val CUT = 728

    private const val PRIMER_ID_PERSONAL = 729
    private const val ULTIMO_ID_DISPONIBLE = 799

    /** Relación explícita ID → tipo. Los IDs 728–799 quedan libres. */
    val porId: Map<Int, String> = mapOf(
        TODOS to "TODOS",
        VEHICULO to "VEHICULO",
        FLOTILLA to "FLOTILLA",
        GRUPO to "GRUPO",
        TODOS_CET to "TODOS_CET",
        CET to "CET",
        CELL to "CELL",
        CUT to "CUT"
    )

    val porTipo: Map<String, Int> = porId.entries.associate { (id, tipo) -> tipo to id }

    fun idDeTipo(tipo: String): Int? = porTipo[tipo.trim().uppercase()]

    fun tipoDeId(id: Int): String? = porId[id]

    /** Asigna un ID estable durante la sesión a cada conversación concreta. */
    private val idsConversaciones = linkedMapOf<String, Int>()

    @Synchronized
    fun idDeChat(tipo: String, destinoId: String?): Int? {
        val tipoNormalizado = tipo.trim().uppercase()
        val idDestino = destinoId.orEmpty().trim()
        val idBase = when (tipoNormalizado) {
            "GLOBAL" -> TODOS
            "CETS" -> TODOS_CET
            "FLOTILLA" -> FLOTILLA
            "GRUPO" -> GRUPO
            "VEHICULO" -> VEHICULO
            "CET", "CET_SPECIFIC" -> CET
            "CELL", "CELL_SPECIFIC" -> CELL
            "CUT", "CUT_SPECIFIC" -> CUT
            else -> null
        }
        if (idBase == null) return null

        // Los chats de grupo/categoría tienen un ID fijo. Las conversaciones
        // personales reciben uno propio usando el destinatario como clave.
        val esConversacionConcreta = tipoNormalizado.endsWith("_SPECIFIC") ||
            tipoNormalizado in setOf("FLOTILLA", "GRUPO", "VEHICULO")
        if (!esConversacionConcreta || idDestino.isBlank()) return idBase

        val clave = "$tipoNormalizado:$idDestino"
        idsConversaciones[clave]?.let { return it }
        val siguiente = (idsConversaciones.values.maxOrNull() ?: PRIMER_ID_PERSONAL - 1) + 1
        if (siguiente > ULTIMO_ID_DISPONIBLE) return null
        idsConversaciones[clave] = siguiente
        return siguiente
    }
}
