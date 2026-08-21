package com.operaciones.operaciones_android.model

// Estados de operación — exactamente igual que estado_operacion_enum en la BD
enum class OperationStatus {
    PLANIFICADA,   // antes de iniciar   → pantalla de espera
    ACTIVA,        // en curso            → pantalla operativa (mapa)
    CERRADA,       // concluida
    CANCELADA      // cancelada
}

// Usuario autenticado en sesión
data class User(
    val id: Int,
    val nombre: String,
    val apellido: String,
    val username: String,
    val rol: UserRole,
    val jerarquia: String,  // campo "puesto" en la BD
    val tabla: String,      // "usuario" | "personal" — de qué tabla viene
    val idDispositivo: Int? = null
) {
    val nombreCompleto get() = "$nombre $apellido"
    val puedeAsignarEstructuras get() = rol == UserRole.CET
}

// Operación táctica (datos de la BD)
data class Operation(
    val id: Int,
    val codigo: String,
    val nombre: String,
    val descripcion: String,
    val prioridad: String,      // BAJA / MEDIA / ALTA
    val status: OperationStatus,
    val fechaInicio: String,
    val fechaFin: String,
    // Zona principal de la operación (null si aún no fue definida en el dashboard)
    val zonaLat:  Double = 0.0,
    val zonaLon:  Double = 0.0,
    val zonaZoom: Int    = 8000
)
