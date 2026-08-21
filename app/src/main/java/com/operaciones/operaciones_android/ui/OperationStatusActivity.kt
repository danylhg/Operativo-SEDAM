package com.operaciones.operaciones_android.ui

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import com.operaciones.operaciones_android.R
import com.operaciones.operaciones_android.auth.AuthManager
import com.operaciones.operaciones_android.model.Operation
import com.operaciones.operaciones_android.model.OperationStatus
import com.operaciones.operaciones_android.network.OperationStatusRepository

class OperationStatusActivity : AppCompatActivity() {

    private lateinit var tvTitulo: TextView
    private lateinit var tvMensaje: TextView
    private lateinit var btnSalir: Button
    private lateinit var btnRefresh: Button
    private val statusRepository = OperationStatusRepository()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_operation_status)

        tvTitulo = findViewById(R.id.tvStatusTitle)
        tvMensaje = findViewById(R.id.tvStatusMessage)
        btnSalir = findViewById(R.id.btnLogout)
        btnRefresh = findViewById(R.id.btnRefresh)

        bindUserHeader()

        val operationId = intent.getIntExtra("OPERATION_ID", -1)
        val estado = intent.getStringExtra("OP_ESTADO") ?: ""

        configurarMensaje(operationId, estado)

        btnSalir.setOnClickListener {
            salirAlLogin()
        }
        btnRefresh.setOnClickListener { comprobarOperacion() }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                salirAlLogin()
            }
        })
    }

    private fun bindUserHeader() {
        val user = AuthManager.getCurrentUser(this)
        val name = user?.nombreCompleto?.trim().orEmpty().ifBlank { user?.username.orEmpty() }
        findViewById<TextView>(R.id.tvUserName).text = name
        findViewById<TextView>(R.id.tvUserRole).text = user?.rol?.name.orEmpty()
        findViewById<TextView>(R.id.tvUserHierarchy).text = user?.jerarquia.orEmpty()
        findViewById<View>(R.id.userMeta).visibility =
            if (user == null || (user.rol.name.isBlank() && user.jerarquia.isBlank())) View.GONE else View.VISIBLE
    }

    private fun comprobarOperacion() {
        val user = AuthManager.getCurrentUser(this) ?: run {
            salirAlLogin()
            return
        }
        btnRefresh.isEnabled = false
        btnRefresh.text = "Comprobando..."

        statusRepository.fetchAssignedOperation(
            userId = user.id,
            token = AuthManager.getToken(this),
            onSuccess = { operation ->
                runOnUiThread {
                    btnRefresh.isEnabled = true
                    btnRefresh.text = "Comprobar operación"
                    if (operation?.status == OperationStatus.ACTIVA) {
                        abrirOperacion(operation)
                    } else {
                        configurarMensaje(operation?.id ?: -1, operation?.status?.name.orEmpty())
                        Toast.makeText(this, "Estado actualizado", Toast.LENGTH_SHORT).show()
                    }
                }
            },
            onError = { message ->
                runOnUiThread {
                    btnRefresh.isEnabled = true
                    btnRefresh.text = "Comprobar operación"
                    Toast.makeText(this, message, Toast.LENGTH_LONG).show()
                }
            }
        )
    }

    private fun abrirOperacion(operation: Operation) {
        startActivity(Intent(this, MainActivity::class.java).apply {
            putExtra("USER_ID", AuthManager.getCurrentUser(this@OperationStatusActivity)?.id ?: -1)
            putExtra("OPERATION_ID", operation.id)
            putExtra("OP_ESTADO", operation.status.name)
            putExtra("OP_CODIGO", operation.codigo)
            putExtra("OP_NOMBRE", operation.nombre)
            putExtra("OP_DESCRIPCION", operation.descripcion)
            putExtra("OP_PRIORIDAD", operation.prioridad)
            putExtra("OP_FECHA_INICIO", operation.fechaInicio)
            putExtra("OP_FECHA_FIN", operation.fechaFin)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        })
        finish()
    }

    private fun configurarMensaje(operationId: Int, estado: String) {
        if (operationId == -1) {
            tvTitulo.text = "Sin operación asignada"
            tvMensaje.text = "No tienes una operación asignada en este momento."
            return
        }

        when (estado.uppercase()) {
            "PLANIFICADA" -> {
                tvTitulo.text = "Operación no activa"
                tvMensaje.text = "Tu operación asignada todavía no está activa."
            }
            "CERRADA" -> {
                tvTitulo.text = "Operación finalizada"
                tvMensaje.text = "Tu operación asignada ya fue cerrada."
            }
            "CANCELADA" -> {
                tvTitulo.text = "Operación cancelada"
                tvMensaje.text = "Tu operación asignada fue cancelada."
            }
            else -> {
                tvTitulo.text = "Operación no disponible"
                tvMensaje.text = "No es posible ingresar a la operación en este momento."
            }
        }
    }

    private fun salirAlLogin() {
        AuthManager.logout(this)

        val intent = Intent(this, LoginActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        }

        startActivity(intent)
        finish()
    }
}
