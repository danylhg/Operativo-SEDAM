package com.operaciones.operaciones_android.ui.lifecycle

import android.os.Handler
import android.os.Looper
import com.operaciones.operaciones_android.config.ApiConfig
import com.operaciones.operaciones_android.model.Operation
import com.operaciones.operaciones_android.model.OperationStatus
import com.operaciones.operaciones_android.network.OperationStatusRepository
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException

class OperationLifecycleMonitor(
    private val httpClient: OkHttpClient,
    private val statusRepository: OperationStatusRepository = OperationStatusRepository(),
    private val host: Host,
    private val handler: Handler = Handler(Looper.getMainLooper())
) {
    interface Host {
        fun getLifecycleUserId(): Int?
        fun getLifecycleOperationId(): Int
        fun getLifecycleToken(): String
        fun onServerConnectionChanged(isDisconnected: Boolean)
        fun onAssignedOperationClosed(operation: Operation?)
    }

    private val monitorRunnable = object : Runnable {
        override fun run() {
            checkServerConnection()
            checkAssignedOperationStatus()
            handler.postDelayed(this, CHECK_INTERVAL_MS)
        }
    }

    fun start() {
        checkServerConnection()
        checkAssignedOperationStatus()
        handler.removeCallbacks(monitorRunnable)
        handler.postDelayed(monitorRunnable, CHECK_INTERVAL_MS)
    }

    fun stop() {
        handler.removeCallbacks(monitorRunnable)
    }

    private fun checkServerConnection() {
        val request = Request.Builder()
            .url("${ApiConfig.BASE_URL}/health")
            .get()
            .build()

        httpClient.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                handler.post { host.onServerConnectionChanged(isDisconnected = true) }
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    val body = it.body?.string().orEmpty()
                    val isConnected = try {
                        it.isSuccessful && JSONObject(body).optBoolean("ok", false)
                    } catch (_: Exception) {
                        false
                    }

                    handler.post { host.onServerConnectionChanged(isDisconnected = !isConnected) }
                }
            }
        })
    }

    private fun checkAssignedOperationStatus() {
        val userId = host.getLifecycleUserId() ?: return
        val operationId = host.getLifecycleOperationId()
        if (operationId <= 0) return

        statusRepository.fetchAssignedOperation(
            userId = userId,
            token = host.getLifecycleToken(),
            onSuccess = { operation ->
                if (operation == null) {
                    handler.post { host.onAssignedOperationClosed(null) }
                    return@fetchAssignedOperation
                }

                if (operation.id != operationId || operation.status != OperationStatus.ACTIVA) {
                    handler.post { host.onAssignedOperationClosed(operation) }
                }
            },
            onError = { }
        )
    }

    private companion object {
        const val CHECK_INTERVAL_MS = 10_000L
    }
}
