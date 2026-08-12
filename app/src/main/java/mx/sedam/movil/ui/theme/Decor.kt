package mx.sedam.movil.ui.theme

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/** Degradado marino base de toda la app (descendencia de azules). */
val SedamBackdrop: Brush = Brush.verticalGradient(listOf(NavyAbyss, NavyDeep, Navy, NavyMid))

/** Color semántico "en línea" (verde), separado del acento dorado. */
val OnlineGreen = Color(0xFF4CD07A)

/**
 * Esquinas tipo HUD militar: cuatro corchetes dorados en los vértices de la
 * pantalla. Se coloca como capa superior dentro de un Box.
 */
@Composable
fun HudCorners(color: Color = Gold, modifier: Modifier = Modifier) {
    Canvas(modifier = modifier.fillMaxSize()) {
        val len = 22.dp.toPx()
        val sw = 2.dp.toPx()
        val m = 18.dp.toPx()
        val w = size.width
        val h = size.height
        val c = color.copy(alpha = 0.65f)

        // Superior izquierda
        drawLine(c, Offset(m, m), Offset(m + len, m), sw)
        drawLine(c, Offset(m, m), Offset(m, m + len), sw)
        // Superior derecha
        drawLine(c, Offset(w - m, m), Offset(w - m - len, m), sw)
        drawLine(c, Offset(w - m, m), Offset(w - m, m + len), sw)
        // Inferior izquierda
        drawLine(c, Offset(m, h - m), Offset(m + len, h - m), sw)
        drawLine(c, Offset(m, h - m), Offset(m, h - m - len), sw)
        // Inferior derecha
        drawLine(c, Offset(w - m, h - m), Offset(w - m - len, h - m), sw)
        drawLine(c, Offset(w - m, h - m), Offset(w - m, h - m - len), sw)
    }
}
