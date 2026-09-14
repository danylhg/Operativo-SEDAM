package com.operaciones.operaciones_android.model

data class PoiItem(
    val idPoi: Int,
    val nombre: String,
    val tipoPoi: String,
    val lat: Double,
    val lon: Double,
    val velocidadKmh: Double? = null,
    val rumboGrados: Double? = null,
    val color: String,
    val iconoSrc: String? = null,
    val sidc: String? = null,
    val creatorLabel: String = "",
    val creatorRank: String = "",
    val visibility: String = "PRIVADO",
    val creatorType: String = "",
    val creatorUserId: Int? = null,
    val creatorPersonalId: Int? = null,
    val editorLabel: String = ""
)
