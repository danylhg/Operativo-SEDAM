package com.operaciones.operaciones_android.ui.panel

import android.graphics.Color
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.TextView
import com.operaciones.operaciones_android.R
import com.operaciones.operaciones_android.model.Operation

internal class OperationPanelRenderer(
    private val host: MainPanelRenderer.Host
) {
    fun inflate(panelContent: FrameLayout, operation: Operation) {
        val view = host.getLayoutInflater().inflate(R.layout.panel_operation, panelContent, false)
        panelContent.addView(view)

        view.findViewById<TextView>(R.id.opNombre).text = operation.nombre
        view.findViewById<TextView>(R.id.opCodigo).text = operation.codigo
        view.findViewById<TextView>(R.id.opDescripcion).text = operation.descripcion
        view.findViewById<TextView>(R.id.opPrioridad).text = operation.prioridad
        view.findViewById<TextView>(R.id.opEstado).text = operation.status.name
        view.findViewById<TextView>(R.id.opFechaInicio).text = operation.fechaInicio

        view.findViewById<TextView>(R.id.opPrioridad).setTextColor(priorityColor(operation.prioridad))
        bindSimulationButton(view.findViewById(R.id.btnSimulacion))
    }

    private fun priorityColor(prioridad: String): Int =
        when (prioridad.uppercase()) {
            "ALTA" -> Color.parseColor("#ef4444")
            "MEDIA" -> Color.parseColor("#f59e0b")
            "BAJA" -> Color.parseColor("#22c55e")
            else -> Color.parseColor("#94a3b8")
        }

    private fun bindSimulationButton(simulationBtn: Button) {
        if (!host.shouldShowSimulationButton()) {
            simulationBtn.visibility = View.GONE
            return
        }

        fun refreshSimulationText() {
            simulationBtn.text = if (host.isSimulationActive()) {
                "Detener simulacion"
            } else {
                "Activar simulacion"
            }
        }

        simulationBtn.visibility = View.VISIBLE
        refreshSimulationText()
        simulationBtn.setOnClickListener {
            host.toggleSimulation()
            refreshSimulationText()
        }
    }
}
