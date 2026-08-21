package com.operaciones.operaciones_android.model

data class OperationZoneItem(
    val idZona: Int,
    val nombre: String,
    val centerLat: Double,
    val centerLon: Double,
    val zoomInicial: Int,
    val color: String,
    val points: List<Pair<Double, Double>>
)
