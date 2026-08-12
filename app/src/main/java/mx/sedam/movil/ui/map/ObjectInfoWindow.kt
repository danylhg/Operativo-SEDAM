package mx.sedam.movil.ui.map

import android.view.View
import android.widget.ImageView
import android.widget.TextView
import mx.sedam.movil.R
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.Marker
import org.osmdroid.views.overlay.infowindow.MarkerInfoWindow
import kotlin.math.roundToInt

/**
 * Datos del tooltip de un waypoint o blanco. Reutiliza el mismo layout/estilo
 * (marino + dorado) que las unidades, para mantener consistencia visual.
 *
 * `course`: si no es null, se muestra + rota la flecha (blancos, que sí tienen
 * rumbo); si es null, la flecha se oculta. `detail` es texto libre para esa fila
 * (p. ej. rumbo/velocidad de un blanco); en blanco (waypoints) la fila entera se
 * oculta — sus coordenadas ya se muestran en la fila dedicada (`lat`/`lng`).
 */
data class ObjectTip(
    val name: String,
    val subtitle: String,
    val detail: String,
    val course: Float? = null,
    val lat: Double,
    val lng: Double,
)

/** Tooltip de waypoint/blanco, mismo estilo y mismo mecanismo de refresco en vivo. */
class ObjectInfoWindow(mapView: MapView) : MarkerInfoWindow(R.layout.unit_info_window, mapView) {

    var openMarker: Marker? = null
        private set

    override fun onOpen(item: Any?) {
        val marker = item as? Marker ?: return
        openMarker = marker
        val tip = marker.relatedObject as? ObjectTip ?: return
        val v = mView ?: return

        v.findViewById<TextView>(R.id.uiw_name).text = tip.name
        v.findViewById<TextView>(R.id.uiw_sub).apply {
            text = tip.subtitle
            visibility = if (tip.subtitle.isBlank()) View.GONE else View.VISIBLE
        }
        v.findViewById<View>(R.id.uiw_course_row).visibility =
            if (tip.detail.isBlank()) View.GONE else View.VISIBLE
        v.findViewById<TextView>(R.id.uiw_course).text = tip.detail
        v.findViewById<ImageView>(R.id.uiw_arrow).apply {
            if (tip.course != null) {
                visibility = View.VISIBLE
                rotation = tip.course
            } else {
                visibility = View.GONE
            }
        }
        bindCoordsRow(v, tip.lat, tip.lng)

        v.setOnClickListener { close() }
    }

    override fun close() {
        super.close()
        openMarker = null
    }
}

/** Arma el texto de rumbo/velocidad para un blanco, igual formato que las unidades. */
fun targetDetailText(course: Float, speedKmh: Float): String {
    val deg = ((course % 360f) + 360f) % 360f
    return "RUMBO ${deg.roundToInt()}° ${cardinalOf(deg)}   ·   VEL ${"%.1f".format(java.util.Locale.US, speedKmh)} km/h"
}
