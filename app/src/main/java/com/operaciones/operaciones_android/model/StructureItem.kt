package com.operaciones.operaciones_android.model

data class StructureItem(
    val idMarca: Int,
    val nombre: String,
    val tipoEstructura: String,
    val lat: Double,
    val lon: Double,
    val iconoSrc: String? = null,
    val creatorLabel: String = ""
)
