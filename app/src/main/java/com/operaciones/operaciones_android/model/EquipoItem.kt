package com.operaciones.operaciones_android.model

/**
 * Representa un equipo asignado a la operación.
 * 
 * [tipoDestino] refleja el nuevo modelo de BD:
 *   PERSONAL  -> asignado a una persona ([personalAsignado])
 *   VEHICULO  -> asignado a un vehículo ([vehiculoAsignado])
 *   GRUPO     -> asignado a un grupo ([grupoAsignado])
 *   FLOTILLA  -> asignado a la flotilla completa ([flotillaAsignada])
 */
data class EquipoItem(
    val idEquipo: Int,
    val numeroSerie: String,
    val nombre: String,
    val categoria: String,
    val tipoEquipo: String = "",
    val detalle: String = "",
    val asignadoA: String = "", // Texto descriptivo formateado (e.g., "Asignado a grupo: Alfa")
    
    // 🔥 Nuevos campos de jerarquía flexible
    val tipoDestino: String = "",
    val idPersonalAsignado: Int? = null,
    val idVehiculoAsignado: Int? = null,
    val personalAsignado: String = "",
    val vehiculoAsignado: String = "",
    val grupoAsignado: String = "",
    val flotillaAsignada: String = "",
    val gruposVinculados: List<String> = emptyList(),
    val flotillasVinculadas: List<String> = emptyList(),
    val lat: Double? = null,
    val lon: Double? = null,
    val rumboGrados: Double? = null,
    val ultimaActualizacion: String = ""
)
