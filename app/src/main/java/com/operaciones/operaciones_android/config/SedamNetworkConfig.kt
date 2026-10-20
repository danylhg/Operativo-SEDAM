package com.operaciones.operaciones_android.config

import android.content.Context

/** Conexión al servidor Socket.IO de la red SEDAM (el mismo que usa el dashboard web). */
object SedamNetworkConfig {
    private const val PREFS = "sedam_network_config"
    private const val KEY_URL = "socket_url"
    private const val KEY_SERIAL = "serial_number"
    const val DEFAULT_URL = "https://10.255.255.66:3000"

    data class Settings(val url: String, val serial: String) {
        val isConfigured: Boolean get() = url.isNotBlank() && serial.isNotBlank()
    }

    fun load(context: Context): Settings {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return Settings(
            url = prefs.getString(KEY_URL, DEFAULT_URL).orEmpty().ifBlank { DEFAULT_URL },
            serial = prefs.getString(KEY_SERIAL, "").orEmpty()
        )
    }

    fun save(context: Context, rawUrl: String, rawSerial: String): Settings {
        var url = rawUrl.trim().trimEnd('/').ifBlank { DEFAULT_URL }
        if (!url.startsWith("http://", true) && !url.startsWith("https://", true)) url = "https://$url"
        // Igual que el dashboard: el número de serie se envía en mayúsculas.
        val serial = rawSerial.trim().uppercase()
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_URL, url)
            .putString(KEY_SERIAL, serial)
            .apply()
        return Settings(url, serial)
    }
}
