package com.operaciones.operaciones_android.wear.bridge

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.ContextCompat
import androidx.wear.remote.interactions.RemoteActivityHelper
import com.google.android.gms.wearable.Wearable
import com.operaciones.operaciones_android.wear.data.WearOperation
import org.json.JSONObject

class PhoneBridge(private val context: Context) {
    companion object {
        const val PATH_OPEN_PHONE = "/sedam/open-phone"
        const val PATH_EMERGENCY = "/sedam/emergency"
        const val PATH_SESSION_REQUEST = "/sedam/session/request"
    }

    fun openPhone(operation: WearOperation?, onDone: (Boolean) -> Unit = {}) {
        val uri = Uri.Builder()
            .scheme("sedam")
            .authority("open-operation")
            .appendQueryParameter("operation_id", (operation?.id ?: -1).toString())
            .appendQueryParameter("op_codigo", operation?.codigo.orEmpty())
            .appendQueryParameter("op_nombre", operation?.nombre.orEmpty())
            .appendQueryParameter("op_prioridad", operation?.prioridad.orEmpty())
            .appendQueryParameter("op_estado", operation?.status?.name.orEmpty())
            .appendQueryParameter("op_fecha_inicio", operation?.fechaInicio.orEmpty())
            .appendQueryParameter("op_fecha_fin", operation?.fechaFin.orEmpty())
            .appendQueryParameter("op_lat", (operation?.zonaLat ?: 0.0).toString())
            .appendQueryParameter("op_lon", (operation?.zonaLon ?: 0.0).toString())
            .appendQueryParameter("op_zoom", (operation?.zonaZoom ?: 8000).toString())
            .build()
        val intent = Intent(Intent.ACTION_VIEW, uri).apply {
            addCategory(Intent.CATEGORY_BROWSABLE)
        }
        val executor = ContextCompat.getMainExecutor(context)
        val future = RemoteActivityHelper(context, executor).startRemoteActivity(intent, null)
        future.addListener({
            onDone(runCatching { future.get(); true }.getOrDefault(false))
        }, executor)
    }

    fun mirrorEmergency(operationId: Int, source: String, onDone: (Boolean) -> Unit = {}) {
        val payload = JSONObject().apply {
            put("operation_id", operationId)
            put("source", source)
            put("timestamp", System.currentTimeMillis())
        }
        sendMessage(PATH_EMERGENCY, payload, onDone)
    }

    fun requestSessionSync(device: JSONObject, onDone: (Boolean) -> Unit = {}) {
        val payload = JSONObject().apply {
            put("device", device)
            put("timestamp", System.currentTimeMillis())
        }
        sendMessage(PATH_SESSION_REQUEST, payload, onDone)
    }

    private fun sendMessage(path: String, json: JSONObject, onDone: (Boolean) -> Unit) {
        val bytes = json.toString().toByteArray(Charsets.UTF_8)
        Wearable.getNodeClient(context).connectedNodes
            .addOnSuccessListener { nodes ->
                if (nodes.isEmpty()) {
                    onDone(false)
                    return@addOnSuccessListener
                }
                var pending = nodes.size
                var anyOk = false
                nodes.forEach { node ->
                    Wearable.getMessageClient(context)
                        .sendMessage(node.id, path, bytes)
                        .addOnSuccessListener {
                            anyOk = true
                            pending--
                            if (pending == 0) onDone(anyOk)
                        }
                        .addOnFailureListener {
                            pending--
                            if (pending == 0) onDone(anyOk)
                        }
                }
            }
            .addOnFailureListener { onDone(false) }
    }
}
