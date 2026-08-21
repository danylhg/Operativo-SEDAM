package com.operaciones.operaciones_android.model

data class PersonalItem(
    val idPersonal: Int,
    val apodo: String,
    val nombre: String,
    val apellido: String,
    val rol: String,
    val puesto: String,
    val lat: Double? = null,
    val lon: Double? = null,
    val rumboGrados: Double? = null,
    val grupoNombre: String = "",
    val grupoApodo: String = "",
    val idGrupoOperacion: Int? = null,
    val idGrupoPadre: Int? = null,
    val grupoPadreNombre: String = "",
    val grupoPadreApodo: String = "",
    val idCetRef: Int? = null,
    val cetNombre: String = "",
    val cetFlotilla: String = "",
    val velocidadKmh: Double? = null,
    val frecuenciaCardiacaBpm: Int? = null,
    val presionBarometricaHpa: Double? = null,
    val bateriaPct: Double? = null,
    val ultimaActualizacion: String = ""
)
