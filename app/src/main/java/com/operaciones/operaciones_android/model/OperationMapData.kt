package com.operaciones.operaciones_android.model

data class OperationMapData(
    val personal: List<PersonalItem>,
    val vehiculos: List<VehiculoItem>,
    val equipos: List<EquipoItem>,
    val dispositivos: List<DispositivoItem> = emptyList(),
    val rutasNavegacion: String? = null,
    val rutasTacticas: String? = null,
    val operationZone: OperationZoneItem? = null,
    val pois: List<PoiItem> = emptyList(),
    val coverageCircles: List<CoverageCircleItem> = emptyList(),
    val areaPolygons: List<AreaPolygonItem> = emptyList(),
    val structures: List<StructureItem> = emptyList(),
    val operationGrid: OperationGridItem? = null
)
