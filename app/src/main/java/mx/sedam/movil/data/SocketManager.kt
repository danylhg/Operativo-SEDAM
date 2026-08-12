package mx.sedam.movil.data

import android.util.Log
import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONObject

/**
 * Envuelve el cliente Socket.IO y orquesta el handshake con el backend SEDAM:
 *
 *   1. connect() con auth = { serial_number, device_token }
 *   2. server emite "crypto:publicKey" (RSA PEM)
 *   3. respondemos "crypto:aesKey" (AES envuelta) vía CryptoManager
 *   4. server emite "crypto:ready" (true/false)
 *
 * Los callbacks se invocan en el hilo del cliente Socket.IO; el ViewModel los
 * traslada a su StateFlow.
 */
class SocketManager(private val crypto: CryptoManager) {

    private var socket: Socket? = null

    var onPublicKey: ((String) -> Unit)? = null
    var onReady: ((Boolean) -> Unit)? = null
    var onData: ((String) -> Unit)? = null
    var onError: ((String) -> Unit)? = null

    fun connect(host: String, port: Int, serial: String, token: String) {
        val url = "https://$host:$port"
        val opts = IO.Options().apply {
            // 2º factor + identificador van en el handshake auth.
            auth = mapOf("serial_number" to serial, "device_token" to token)
            forceNew = true
            reconnection = true
            reconnectionAttempts = 5
            transports = arrayOf("websocket", "polling")
        }

        val s = IO.socket(url, opts)
        socket = s

        s.on("crypto:publicKey") { args ->
            (args.getOrNull(0) as? String)?.let { onPublicKey?.invoke(it) }
        }
        s.on("crypto:ready") { args ->
            onReady?.invoke(args.getOrNull(0) as? Boolean ?: false)
        }
        s.on("data") { args ->
            runCatching { crypto.decryptIncoming(args.getOrNull(0)) }
                .onSuccess { onData?.invoke(it) }
                .onFailure { Log.w(TAG, "data indescifrable: ${it.message}") }
        }
        s.on(Socket.EVENT_CONNECT_ERROR) { args ->
            onError?.invoke(args.getOrNull(0)?.toString() ?: "Error de conexión")
        }
        s.on(Socket.EVENT_DISCONNECT) { args ->
            Log.i(TAG, "disconnect: ${args.getOrNull(0)}")
        }

        s.connect()
    }

    /** Envía la AES envuelta (base64) para cerrar el handshake. */
    fun sendAesKey(wrappedBase64: String) {
        socket?.emit("crypto:aesKey", wrappedBase64)
    }

    /** Emite un mensaje de app (OWNPOS, MSGPANIC, …) ya cifrado. */
    fun emitEncrypted(event: String, plaintext: String) {
        socket?.emit(event, crypto.encrypt(plaintext))
    }

    fun disconnect() {
        socket?.apply { off(); disconnect() }
        socket = null
        crypto.reset()
    }

    companion object { private const val TAG = "SocketManager" }
}
