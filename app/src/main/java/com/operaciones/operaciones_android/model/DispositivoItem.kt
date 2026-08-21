package com.operaciones.operaciones_android.model

data class DispositivoItem(
    val idDispositivo: Int,
    val tipo: String,
    val marca: String,
    val modelo: String,
    val numeroTelefono: String = "",
    val imei: String = "",
    val numeroSerie: String = "",
    val sistemaOperativo: String = "",
    val identificadorApp: String = "",
    val estado: String = "",
    val idPersonal: Int? = null,
    val personalApodo: String = "",
    val personalNombre: String = "",
    val personalApellido: String = "",
    val personalPuesto: String = "",
    val estadoAsignacion: String = "",
    val lat: Double? = null,
    val lon: Double? = null,
    val velocidadKmh: Double? = null,
    val rumboGrados: Double? = null,
    val precisionM: Double? = null,
    val bateriaPct: Double? = null,
    val ultimaActualizacion: String = ""
)
