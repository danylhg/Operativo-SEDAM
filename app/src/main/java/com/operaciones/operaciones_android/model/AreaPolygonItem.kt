package com.operaciones.operaciones_android.model

data class AreaPolygonItem(
    val idArea: Int,
    val nombre: String,
    val points: List<Pair<Double, Double>>,
    val color: String = "#FFD700",
    val opacity: Double = 0.35,
    val outlineWidth: Double = 3.0,
    val creatorLabel: String = ""
)
