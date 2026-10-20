package com.operaciones.operaciones_android.network

import android.content.Context
import android.util.Base64
import android.util.Log
import io.socket.client.IO
import io.socket.client.Socket
import com.operaciones.operaciones_android.R
import okhttp3.OkHttpClient
import org.json.JSONObject
import java.security.KeyFactory
import java.security.SecureRandom
import java.security.KeyStore
import java.security.cert.CertificateFactory
import javax.net.ssl.TrustManagerFactory
import java.security.spec.MGF1ParameterSpec
import java.security.spec.X509EncodedKeySpec
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/** Unidad de la red SEDAM recibida por el socket (OWNPOS / TRACKPOS / RADIOPOS). */
data class SedamUnitPosition(
    val id: String,
    val lat: Double,
    val lon: Double,
    val courseDeg: Double?,
    val speed: Double?,
    /** SIDC propio del mensaje (solo TRACKPOS); si es nulo se usa el catálogo por id. */
    val sidc: String?,
    val name: String?
)

/**
 * Cliente del socket cifrado de SEDAM, equivalente al del dashboard web:
 * 1. conecta con auth { serial_number }.
 * 2. el servidor manda `crypto:publicKey` (RSA-2048 PEM).
 * 3. se genera una AES-256 nueva, se envuelve con RSA-OAEP(SHA-256, MGF1 SHA-256) y se manda en `crypto:aesKey`.
 * 4. `crypto:ready` confirma; desde ahí cada `data` llega como AES-GCM { iv: hex, data: b64, tag: b64 }.
 */
class SedamSocketManager(
    private val context: Context,
    private val url: String,
    private val serial: String,
    private val onUnit: (SedamUnitPosition) -> Unit,
    private val onAlias: (id: String, alias: String) -> Unit,
    private val onUnitGone: (id: String) -> Unit,
    private val onTrackRemoved: (id: String) -> Unit,
    private val onStatus: (String) -> Unit
) {
    private var socket: Socket? = null
    private var aesKey: SecretKey? = null
    private var myId: String? = null

    fun isConnected(): Boolean = socket?.connected() == true

    fun connect() {
        if (socket != null) return
        // El servidor usa un certificado de la CA local (mkcert) que Android no conoce:
        // se confía solo en esa CA (res/raw/sedam_ca.pem) y solo para la dirección SEDAM configurada.
        val ca = context.resources.openRawResource(R.raw.sedam_ca).use {
            CertificateFactory.getInstance("X.509").generateCertificate(it)
        }
        val keyStore = KeyStore.getInstance(KeyStore.getDefaultType()).apply {
            load(null, null)
            setCertificateEntry("sedam_ca", ca)
        }
        val trustManager = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
            .apply { init(keyStore) }.trustManagers.filterIsInstance<X509TrustManager>().first()
        val sslContext = SSLContext.getInstance("TLS").apply {
            init(null, arrayOf<TrustManager>(trustManager), SecureRandom())
        }
        val host = android.net.Uri.parse(url).host.orEmpty()
        val client = OkHttpClient.Builder()
            .sslSocketFactory(sslContext.socketFactory, trustManager)
            .hostnameVerifier(HostnameVerifier { hostname, _ -> hostname == host })
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .build()

        val options = IO.Options().apply {
            callFactory = client
            webSocketFactory = client
            transports = arrayOf("polling", "websocket")
            auth = mapOf("serial_number" to serial)
            reconnection = true
            reconnectionAttempts = Int.MAX_VALUE
            reconnectionDelay = 500L
            reconnectionDelayMax = 3_000L
            timeout = 8_000L
        }
        val s = IO.socket(url, options)
        socket = s

        s.on(Socket.EVENT_CONNECT) { onStatus("Conectado, negociando cifrado…") }
        s.on(Socket.EVENT_DISCONNECT) {
            aesKey = null
            onStatus("Desconectado")
        }
        s.on(Socket.EVENT_CONNECT_ERROR) { args ->
            onStatus("Error de conexión: ${args.firstOrNull()}")
        }
        s.on("crypto:publicKey") { args ->
            try {
                val pem = args.firstOrNull()?.toString().orEmpty()
                val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
                aesKey = key
                s.emit("crypto:aesKey", wrapKey(pem, key))
            } catch (e: Exception) {
                Log.e(TAG, "Error en handshake", e)
                onStatus("Error de cifrado: ${e.message}")
            }
        }
        s.on("crypto:ready") { args ->
            if (args.firstOrNull() == true) onStatus("En línea") else onStatus("El servidor rechazó la clave AES")
        }
        s.on("data") { args -> handleData(args.firstOrNull()) }
        s.connect()
    }

    fun disconnect() {
        socket?.off()
        socket?.disconnect()
        socket = null
        aesKey = null
        myId = null
    }

    // OAEP con SHA-256 también en MGF1; el valor por defecto de Java usaría SHA-1 y Node no podría abrirlo.
    private fun wrapKey(pem: String, key: SecretKey): String {
        val der = Base64.decode(
            pem.replace("-----BEGIN PUBLIC KEY-----", "")
                .replace("-----END PUBLIC KEY-----", "")
                .replace("\\s".toRegex(), ""),
            Base64.DEFAULT
        )
        val publicKey = KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(der))
        val spec = OAEPParameterSpec("SHA-256", "MGF1", MGF1ParameterSpec.SHA256, PSource.PSpecified.DEFAULT)
        val cipher = Cipher.getInstance("RSA/ECB/OAEPPadding").apply { init(Cipher.ENCRYPT_MODE, publicKey, spec) }
        return Base64.encodeToString(cipher.doFinal(key.encoded), Base64.NO_WRAP)
    }

    private fun decrypt(payload: JSONObject): String? {
        val key = aesKey ?: return null
        val iv = payload.getString("iv").chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        val data = Base64.decode(payload.getString("data"), Base64.DEFAULT)
        val tag = Base64.decode(payload.getString("tag"), Base64.DEFAULT)
        // Java espera ciphertext||tag; en el cable van separados.
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
        }
        return String(cipher.doFinal(data + tag), Charsets.UTF_8)
    }

    private fun handleData(raw: Any?) {
        try {
            val text: String = when (raw) {
                is JSONObject -> if (raw.has("iv") && raw.has("data") && raw.has("tag")) {
                    decrypt(raw) ?: return
                } else {
                    // Mensaje de sesión { work_session, id } sin cifrar.
                    raw.optString("id").takeIf { it.isNotBlank() }?.let { myId = it }
                    return
                }
                is String -> raw
                else -> return
            }
            val trimmed = text.trim()
            if (trimmed.startsWith("{")) {
                val session = JSONObject(trimmed)
                if (session.has("work_session")) session.optString("id").takeIf { it.isNotBlank() }?.let { myId = it }
                return
            }
            parseMessage(trimmed)
        } catch (e: Exception) {
            Log.w(TAG, "Mensaje ilegible: ${e.message}")
        }
    }

    private fun parseMessage(message: String) {
        val fields = (message.split("[:]").lastOrNull() ?: message).split(",")
        when (fields.firstOrNull()?.trim()) {
            "OWNPOS" -> {
                val id = fields.getOrNull(1)?.trim().orEmpty()
                val lat = fields.getOrNull(2).toCoord() ?: return
                val lon = fields.getOrNull(3).toCoord() ?: return
                if (id.isEmpty() || id == myId) return
                emitUnit(id, lat, lon, fields.getOrNull(5).toCoord(), fields.getOrNull(6).toCoord(), null, null)
            }
            "RADIOPOS" -> {
                val id = fields.getOrNull(1)?.trim().orEmpty()
                val lat = fields.getOrNull(2).toCoord() ?: return
                val lon = fields.getOrNull(3).toCoord() ?: return
                if (id.isNotEmpty()) emitUnit("R$id", lat, lon, fields.getOrNull(4).toCoord(), fields.getOrNull(5).toCoord(), null, "Radio $id")
            }
            "TRACKPOS" -> {
                val unit = fields.getOrNull(1)?.trim().orEmpty()
                val num = fields.getOrNull(2)?.trim().orEmpty()
                if (unit.isEmpty() || unit == myId) return
                val key = "T$unit-$num"
                val lat = fields.getOrNull(5).toCoord() ?: 0.0
                val lon = fields.getOrNull(6).toCoord() ?: 0.0
                // 0,0 es la señal de borrado del blanco.
                if (lat == 0.0 && lon == 0.0) { onTrackRemoved(key); return }
                emitUnit(
                    key, lat, lon, fields.getOrNull(8).toCoord(), fields.getOrNull(9).toCoord(),
                    fields.getOrNull(3)?.trim()?.takeIf { it.length >= 10 }, fields.getOrNull(4)?.trim()
                )
            }
            "ID_ALIAS" -> {
                val id = fields.getOrNull(1)?.trim().orEmpty()
                val alias = fields.getOrNull(2)?.trim().orEmpty()
                if (id.isNotEmpty() && alias.isNotEmpty()) onAlias(id, alias)
            }
            "SESSION_OUT" -> fields.getOrNull(1)?.trim()?.takeIf { it.isNotEmpty() }?.let(onUnitGone)
        }
    }

    private fun emitUnit(id: String, lat: Double, lon: Double, course: Double?, speed: Double?, sidc: String?, name: String?) {
        onUnit(SedamUnitPosition(id, lat, lon, course, speed, sidc, name))
    }

    private fun String?.toCoord(): Double? = this?.trim()?.toDoubleOrNull()?.takeIf { it.isFinite() }

    private companion object {
        const val TAG = "SedamSocket"
    }
}
