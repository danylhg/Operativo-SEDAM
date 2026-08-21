package com.operaciones.operaciones_android.ui.media

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.view.View
import android.widget.ImageButton
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.operaciones.operaciones_android.R
import com.operaciones.operaciones_android.model.User
import com.operaciones.operaciones_android.streaming.MediaStreamingService

class MediaStreamController(
    private val activity: AppCompatActivity,
    private val button: ImageButton,
    private val host: Host
) {
    interface Host {
        fun getMediaOperationId(): Int
        fun getMediaToken(): String
        fun getMediaUser(): User
        fun onInvalidMediaSession()
        fun shouldHideMediaControls(): Boolean
    }

    private var streamingActive = false
    private var promptShown = false

    fun setupButton() {
        button.setOnTouchListener(null)
        button.setOnClickListener {
            showVideoStreamsModal()
        }
        updateButton()
    }

    fun showVideoStreamsModal() {
        val user = host.getMediaUser()
        VideoStreamsDialog(
            activity = activity,
            operationId = host.getMediaOperationId(),
            token = host.getMediaToken(),
            currentUserId = user.id,
            currentUserName = user.nombreCompleto,
            onToggleMyBroadcast = {
                if (streamingActive || MediaStreamingService.isRunning) {
                    stop(showToast = true)
                } else {
                    start()
                }
            }
        ).show()
    }

    fun requestForOperation() {
        if (host.getMediaOperationId() <= 0) return
        if (promptShown || streamingActive || MediaStreamingService.isRunning) {
            updateButton()
            return
        }

        promptShown = true
        if (hasPermissions()) {
            start()
        } else {
            Toast.makeText(
                activity,
                "Autoriza camara y microfono para la transmision operativa.",
                Toast.LENGTH_LONG
            ).show()
            requestPermissions()
        }
    }

    fun ensureStartedForOperation() {
        if (host.getMediaOperationId() <= 0) return
        if (streamingActive || MediaStreamingService.isRunning) {
            updateButton()
            return
        }

        if (hasPermissions()) {
            promptShown = true
            start()
            return
        }

        requestForOperation()
    }

    fun handlePermissionsResult(requestCode: Int): Boolean {
        if (requestCode != REQUEST_CODE) return false

        if (hasPermissions()) {
            start()
        } else {
            promptShown = false
            Toast.makeText(
                activity,
                "Camara y microfono son necesarios para transmitir.",
                Toast.LENGTH_SHORT
            ).show()
        }

        return true
    }

    fun updateButton(readServiceState: Boolean = true) {
        if (readServiceState) {
            streamingActive = MediaStreamingService.isRunning
        }

        val hideControls = host.shouldHideMediaControls()
        button.visibility = if (!hideControls) View.VISIBLE else View.GONE

        button.alpha = if (streamingActive) 0.82f else 1f
        button.contentDescription = if (streamingActive) {
            "Detener transmision de camara y microfono"
        } else {
            "Iniciar transmision de camara y microfono"
        }

        if (streamingActive) {
            button.setBackgroundResource(R.drawable.bg_stream_active)
            button.setImageResource(R.drawable.ic_stream_camera_off)
            button.setColorFilter(ContextCompat.getColor(activity, android.R.color.white))
        } else {
            button.setBackgroundResource(R.drawable.bg_bluetooth_button)
            button.setImageResource(R.drawable.ic_stream_camera_on)
            button.setColorFilter(android.graphics.Color.parseColor("#F8FAFC"))
        }
    }

    fun stop(showToast: Boolean = true) {
        val wasActive = streamingActive || MediaStreamingService.isRunning
        if (!wasActive || host.getMediaOperationId() <= 0) return

        activity.startService(buildServiceIntent(MediaStreamingService.ACTION_STOP))
        streamingActive = false
        updateButton(readServiceState = false)

        if (showToast) {
            Toast.makeText(activity, "Transmision detenida.", Toast.LENGTH_SHORT).show()
        }
    }

    private fun start() {
        if (host.getMediaOperationId() <= 0) {
            Toast.makeText(activity, "Selecciona una operación activa para transmitir.", Toast.LENGTH_SHORT).show()
            return
        }
        if (!hasPermissions()) {
            requestPermissions()
            return
        }

        if (host.getMediaToken().isBlank()) {
            Toast.makeText(activity, "Sesion invalida. Vuelve a iniciar sesion.", Toast.LENGTH_SHORT).show()
            host.onInvalidMediaSession()
            return
        }

        val intent = buildServiceIntent(MediaStreamingService.ACTION_START)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            activity.startForegroundService(intent)
        } else {
            activity.startService(intent)
        }

        streamingActive = true
        updateButton(readServiceState = false)
        Toast.makeText(activity, "Transmision en vivo iniciando...", Toast.LENGTH_SHORT).show()
    }

    private fun hasPermissions(): Boolean {
        val cameraOk = ContextCompat.checkSelfPermission(activity, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED
        val micOk = ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
        val notificationsOk = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED

        return cameraOk && micOk && notificationsOk
    }

    private fun requestPermissions() {
        val permissions = mutableListOf(
            Manifest.permission.CAMERA,
            Manifest.permission.RECORD_AUDIO
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        }

        ActivityCompat.requestPermissions(activity, permissions.toTypedArray(), REQUEST_CODE)
    }

    private fun buildServiceIntent(action: String): Intent {
        val user = host.getMediaUser()
        return Intent(activity, MediaStreamingService::class.java).apply {
            this.action = action
            putExtra(MediaStreamingService.EXTRA_OPERATION_ID, host.getMediaOperationId())
            putExtra(MediaStreamingService.EXTRA_TOKEN, host.getMediaToken())
            putExtra(MediaStreamingService.EXTRA_USER_NAME, user.nombreCompleto)
            putExtra(MediaStreamingService.EXTRA_USER_ID, user.id)
            putExtra(MediaStreamingService.EXTRA_USER_ROLE, user.rol.name)
            putExtra(MediaStreamingService.EXTRA_USER_TABLE, user.tabla)
        }
    }

    private companion object {
        const val REQUEST_CODE = 202
    }
}
