package com.operaciones.operaciones_android.model

data class PoiItem(
    val idPoi: Int,
    val nombre: String,
    val tipoPoi: String,
    val lat: Double,
    val lon: Double,
    val color: String,
    val iconoSrc: String? = null,
    val sidc: String? = null,
    val creatorLabel: String = ""
)
