package com.operaciones.operaciones_android.wear.data

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WearChatMessageTest {
    @Test
    fun fromJsonTreatsNullDestinationLabelAsMissing() {
        val message = WearChatMessage.fromJson(
            JSONObject()
                .put("id_mensaje", 10)
                .put("autor_nombre", "Operador")
                .put("contenido", "Enterado")
                .put("destino_label", JSONObject.NULL)
        )

        assertEquals("Operador", message.autor)
        assertNull(message.destinoLabel)
    }

    @Test
    fun fromJsonTreatsLiteralNullDestinationLabelAsMissing() {
        val message = WearChatMessage.fromJson(
            JSONObject()
                .put("id_mensaje", 11)
                .put("autor_nombre", "Operador")
                .put("contenido", "Enterado")
                .put("destino_label", "Null")
        )

        assertNull(message.destinoLabel)
    }
}
