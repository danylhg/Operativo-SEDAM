package com.operaciones.operaciones_android.model

data class OperationGridItem(
    val idCuadricula: Int,
    val size: String,
    val rows: Int,
    val cols: Int,
    val names: List<String>
)
