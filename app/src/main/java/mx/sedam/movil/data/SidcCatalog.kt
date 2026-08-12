package mx.sedam.movil.data

/**
 * Tablas de SIDC para blancos y waypoints, portadas 1:1 de milSymbolFactory.js
 * del web-system. Formato de 15 chars (2525C).
 */
object SidcCatalog {

    enum class Identity(val label: String) {
        FRIENDLY("Amigo"), HOSTILE("Hostil"), NEUTRAL("Neutral"), UNKNOWN("Desconocido")
    }

    enum class Platform(val label: String) {
        SURFACE("Superficie"), LAND("Tierra"), AIR("Aire"), SUBMARINE("Submarino")
    }

    enum class WaypointType(val label: String) {
        REFERENCE("Referencia"), ROUTE("Ruta"), ACTION("Acción")
    }

    // Blancos: S{identidad}{dimensión}P-----------  (15 chars)
    fun targetSidc(id: Identity, p: Platform): String {
        val i = when (id) {
            Identity.FRIENDLY -> 'F'; Identity.HOSTILE -> 'H'
            Identity.NEUTRAL -> 'N'; Identity.UNKNOWN -> 'U'
        }
        val d = when (p) {
            Platform.SURFACE -> 'S'; Platform.LAND -> 'G'
            Platform.AIR -> 'A'; Platform.SUBMARINE -> 'U'
        }
        return "S$i${d}P-----------"
    }

    // Waypoints (Tactical Graphics): G{identidad}GPGP{tipo}W------X (15 chars)
    fun waypointSidc(id: Identity, t: WaypointType): String {
        val i = when (id) {
            Identity.FRIENDLY -> 'F'; Identity.HOSTILE -> 'H'
            Identity.NEUTRAL -> 'N'; Identity.UNKNOWN -> 'U'
        }
        val ty = when (t) {
            WaypointType.REFERENCE -> 'R'; WaypointType.ROUTE -> 'O'; WaypointType.ACTION -> 'P'
        }
        return "G${i}GPGP${ty}W------X"
    }

    private fun identityFromChar(c: Char?): Identity = when (c?.uppercaseChar()) {
        'F' -> Identity.FRIENDLY; 'H' -> Identity.HOSTILE; 'N' -> Identity.NEUTRAL
        else -> Identity.UNKNOWN
    }

    /** Para editar: extrae (identidad, plataforma) de un SIDC de blanco existente. */
    fun parseTargetSidc(sidc: String): Pair<Identity, Platform> {
        val identity = identityFromChar(sidc.getOrNull(1))
        val platform = when (sidc.getOrNull(2)?.uppercaseChar()) {
            'S' -> Platform.SURFACE; 'G' -> Platform.LAND
            'A' -> Platform.AIR; 'U' -> Platform.SUBMARINE
            else -> Platform.LAND
        }
        return identity to platform
    }

    /** Para editar: extrae (identidad, tipo) de un SIDC de waypoint existente. */
    fun parseWaypointSidc(sidc: String): Pair<Identity, WaypointType> {
        val identity = identityFromChar(sidc.getOrNull(1))
        val type = when (sidc.getOrNull(6)?.uppercaseChar()) {
            'R' -> WaypointType.REFERENCE; 'O' -> WaypointType.ROUTE; 'P' -> WaypointType.ACTION
            else -> WaypointType.REFERENCE
        }
        return identity to type
    }
}
