package com.operaciones.operaciones_android.model

/**
 * Representa un vehículo asignado a la operación.
 *
 * [tipoDestino] refleja el nuevo modelo de BD:
 *   PERSONAL  → asignado a una persona específica ([asignadoAApodo])
 *   GRUPO     → asignado a un grupo dentro de la flotilla ([grupoNombre])
 *   FLOTILLA  → asignado a la flotilla completa ([grupoNombre] = nombre flotilla)
 */
data class VehiculoItem(
    val idVehiculo: Int,
    val codigoInterno: String,
    val nombre: String,
    val tipo: String,
    val alias: String = "",
    val detalle: String = "",
    val idPersonalAsignado: Int? = null,

    // Jerarquía real del backend (tipo_destino / nivel_asignacion)
    val tipoDestino: String = "",       // "PERSONAL" | "GRUPO" | "FLOTILLA" | ""
    val asignadoAApodo: String = "",    // persona custodio
    val personalNombre: String = "",
    val personalApellido: String = "",
    val personalPuesto: String = "",
    val cetNombre: String = "",
    val grupoNombre: String = "",       // grupo directo del vehículo
    val grupoPadreNombre: String = "",  // flotilla (padre del grupo)

    val lat: Double? = null,
    val lon: Double? = null,
    val rumboGrados: Double? = null
)
