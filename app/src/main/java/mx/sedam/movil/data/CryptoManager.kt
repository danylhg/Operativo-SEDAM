package mx.sedam.movil.data

import android.util.Base64
import org.json.JSONObject
import java.security.KeyFactory
import java.security.SecureRandom
import java.security.spec.MGF1ParameterSpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import javax.crypto.spec.SecretKeySpec

/**
 * Criptografía del canal SEDAM, compatible con src/crypto.js del backend.
 *
 *  - RSA-2048 OAEP(SHA-256, MGF1=SHA-256) para envolver la AES key de sesión.
 *  - AES-256-GCM con IV de 12 bytes y tag de 16 bytes para los mensajes.
 *  - Formato en el cable: { iv: hex, data: base64(ciphertext), tag: base64(tag) }.
 *
 * OJO (gotcha de Java): el string "RSA/ECB/OAEPWithSHA-256AndMGF1Padding" usa
 * MGF1 con SHA-1 por defecto. Node usa SHA-256 para MGF1, así que forzamos el
 * OAEPParameterSpec explícito o el server no podría descifrar la key.
 */
class CryptoManager {

    @Volatile
    private var aesKey: SecretKey? = null

    val isReady: Boolean get() = aesKey != null

    /** Genera una AES-256 nueva y la devuelve envuelta con la RSA pública (base64). */
    fun generateAndWrapKey(publicKeyPem: String): String {
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        aesKey = key

        val cipher = Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding")
        val oaep = OAEPParameterSpec(
            "SHA-256", "MGF1", MGF1ParameterSpec.SHA256, PSource.PSpecified.DEFAULT
        )
        cipher.init(Cipher.ENCRYPT_MODE, parsePublicKey(publicKeyPem), oaep)
        val wrapped = cipher.doFinal(key.encoded)
        return Base64.encodeToString(wrapped, Base64.NO_WRAP)
    }

    /** Cifra texto plano → objeto { iv, data, tag } listo para emitir por Socket.IO. */
    fun encrypt(plaintext: String): JSONObject {
        val key = aesKey ?: error("AES key no establecida (handshake incompleto)")
        val iv = ByteArray(12).also { SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, iv))

        // Java concatena ciphertext||tag; el backend los espera separados.
        val out = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        val data = out.copyOfRange(0, out.size - 16)
        val tag = out.copyOfRange(out.size - 16, out.size)

        return JSONObject().apply {
            put("iv", iv.toHex())
            put("data", Base64.encodeToString(data, Base64.NO_WRAP))
            put("tag", Base64.encodeToString(tag, Base64.NO_WRAP))
        }
    }

    /**
     * Descifra un mensaje entrante. El backend puede mandar objeto cifrado
     * { iv, data, tag } o texto plano; devolvemos el string en ambos casos.
     */
    fun decryptIncoming(raw: Any?): String {
        val key = aesKey
        if (key != null && raw is JSONObject &&
            raw.has("iv") && raw.has("data") && raw.has("tag")
        ) {
            val iv = raw.getString("iv").hexToBytes()
            val data = Base64.decode(raw.getString("data"), Base64.NO_WRAP)
            val tag = Base64.decode(raw.getString("tag"), Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
            return String(cipher.doFinal(data + tag), Charsets.UTF_8)
        }
        return raw?.toString() ?: ""
    }

    fun reset() { aesKey = null }

    private fun parsePublicKey(pem: String): java.security.PublicKey {
        val body = pem
            .replace("-----BEGIN PUBLIC KEY-----", "")
            .replace("-----END PUBLIC KEY-----", "")
            .replace("\\s".toRegex(), "")
        val der = Base64.decode(body, Base64.DEFAULT)
        return KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(der))
    }

    private fun ByteArray.toHex(): String =
        joinToString("") { "%02x".format(it) }

    private fun String.hexToBytes(): ByteArray =
        chunked(2).map { it.toInt(16).toByte() }.toByteArray()
}
