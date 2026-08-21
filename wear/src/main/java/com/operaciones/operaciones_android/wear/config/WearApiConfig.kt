package com.operaciones.operaciones_android.wear.config

import android.content.Context
import android.net.Uri

object WearApiConfig {
    private const val PREFS = "sedam_wear_api_config"
    private const val KEY_BASE_URL = "base_url"
    private const val DEFAULT_API_PORT = 3001

    const val DEFAULT_BASE_URL = "http://192.168.202.103:3001"

    var baseUrl: String = DEFAULT_BASE_URL
        private set

    fun load(context: Context): String {
        val saved = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_BASE_URL, DEFAULT_BASE_URL)
            ?: DEFAULT_BASE_URL
        baseUrl = normalizeBaseUrl(saved)
        return baseUrl
    }

    fun saveBaseUrl(context: Context, rawUrl: String): String {
        val normalized = normalizeBaseUrl(rawUrl)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_BASE_URL, normalized)
            .apply()
        baseUrl = normalized
        return normalized
    }

    fun normalizeBaseUrl(rawUrl: String): String {
        var value = rawUrl.trim().trimEnd('/')
        require(value.isNotBlank()) { "Ingresa la direccion del servidor." }

        if (!value.startsWith("http://", ignoreCase = true) &&
            !value.startsWith("https://", ignoreCase = true)
        ) {
            value = "http://$value"
        }

        val uri = Uri.parse(value)
        val scheme = uri.scheme?.lowercase()
        require((scheme == "http" || scheme == "https") && !uri.host.isNullOrBlank()) {
            "Direccion invalida."
        }

        val path = uri.encodedPath.orEmpty()
        if (uri.port == -1 && shouldAppendDefaultApiPort(uri) && (path.isBlank() || path == "/")) {
            value = "$value:$DEFAULT_API_PORT"
        }

        return value.trimEnd('/')
    }

    private fun shouldAppendDefaultApiPort(uri: Uri): Boolean {
        val scheme = uri.scheme?.lowercase()
        return scheme == "http"
    }

    fun absoluteUrl(pathOrUrl: String): String {
        if (pathOrUrl.startsWith("http://", true) || pathOrUrl.startsWith("https://", true)) {
            return pathOrUrl
        }
        return "${baseUrl.trimEnd('/')}/${pathOrUrl.trimStart('/')}"
    }
}
