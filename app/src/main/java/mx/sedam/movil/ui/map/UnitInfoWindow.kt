package mx.sedam.movil.ui.map

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.view.View
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import mx.sedam.movil.R
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.Marker
import org.osmdroid.views.overlay.infowindow.MarkerInfoWindow
import java.util.Locale
import kotlin.math.roundToInt

/** Datos que se muestran en el tooltip de una unidad (guardados en el Marker). */
data class UnitTip(
    val name: String,
    val subtitle: String,
    val course: Float,   // grados 0..360
    val speedKmh: Float,
    val lat: Double,
    val lng: Double,
)

/** Rumbo en grados → punto cardinal. Compartido por unidades/waypoints/blancos. */
fun cardinalOf(deg: Float): String {
    val dirs = arrayOf("N", "NE", "E", "SE", "S", "SO", "O", "NO")
    return dirs[(deg / 45f).roundToInt() % 8]
}

/**
 * Llena y activa la fila de coordenadas (ícono + texto monoespaciado + copiar)
 * del tooltip compartido — usada por unidades, waypoints y blancos por igual.
 * Un tap copia "lat, lng" al portapapeles (útil para pasarlas por radio).
 */
fun bindCoordsRow(v: View, lat: Double, lng: Double) {
    val coords = String.format(Locale.US, "%.5f, %.5f", lat, lng)
    v.findViewById<TextView>(R.id.uiw_latlng).text = coords
    v.findViewById<View>(R.id.uiw_latlng_row).apply {
        visibility = View.VISIBLE
        setOnClickListener {
            val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            cm.setPrimaryClip(ClipData.newPlainText("Coordenadas", coords))
            Toast.makeText(context, "Coordenadas copiadas: $coords", Toast.LENGTH_SHORT).show()
        }
    }
}

/**
 * Tooltip estilizado (marino + dorado) de una unidad: nombre, numeral·descripción,
 * y línea de rumbo (grados + cardinal, con flecha que apunta al rumbo) y velocidad.
 *
 * Recuerda qué marker tiene el tooltip abierto (openMarker) para que quien pinta
 * los markers pueda forzar un refresco (llamando onOpen otra vez) cuando cambian
 * los datos MIENTRAS está abierto — si no, el usuario tenía que cerrar y volver a
 * abrir para ver el rumbo/velocidad/posición actualizados.
 */
class UnitInfoWindow(mapView: MapView) : MarkerInfoWindow(R.layout.unit_info_window, mapView) {

    var openMarker: Marker? = null
        private set

    override fun onOpen(item: Any?) {
        val marker = item as? Marker ?: return
        openMarker = marker
        val tip = marker.relatedObject as? UnitTip ?: return
        val v = mView ?: return

        v.findViewById<TextView>(R.id.uiw_name).text = tip.name
        v.findViewById<TextView>(R.id.uiw_sub).apply {
            text = tip.subtitle
            visibility = if (tip.subtitle.isBlank()) View.GONE else View.VISIBLE
        }
        v.findViewById<TextView>(R.id.uiw_course).text =
            "RUMBO ${tip.course.roundToInt()}° ${cardinalOf(tip.course)}   ·   VEL ${
                String.format(
                    Locale.US,
                    "%.1f",
                    tip.speedKmh
                )
            } km/h"
        // La flecha rota para apuntar al rumbo (0° = norte, arriba).
        v.findViewById<ImageView>(R.id.uiw_arrow).apply {
            visibility = View.VISIBLE
            rotation = tip.course
        }
        bindCoordsRow(v, tip.lat, tip.lng)

        v.setOnClickListener { close() }
    }

    override fun close() {
        super.close()
        openMarker = null
    }
}
