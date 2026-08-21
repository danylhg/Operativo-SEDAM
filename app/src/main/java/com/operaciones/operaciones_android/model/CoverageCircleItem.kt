package com.operaciones.operaciones_android.model

data class CoverageCircleItem(
    val idArea: Int,
    val nombre: String,
    val centerLat: Double,
    val centerLon: Double,
    val radiusM: Double,
    val color: String = "#FF4500",
    val opacity: Double = 0.35,
    val outlineWidth: Double = 3.0,
    val creatorLabel: String = ""
)
