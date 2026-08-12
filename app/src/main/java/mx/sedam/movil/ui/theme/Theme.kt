package mx.sedam.movil.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

// Esquema oscuro fijo: la app es de uso táctico, siempre en tema marino.
private val SedamColorScheme = darkColorScheme(
    primary = Gold,
    onPrimary = Navy,
    secondary = BlueGlow,
    onSecondary = White,
    background = Navy,
    onBackground = OffWhite,
    surface = NavyDeep,
    onSurface = OffWhite,
    error = DangerRed,
    onError = White,
)

private val SedamTypography = Typography(
    headlineMedium = TextStyle(
        fontWeight = FontWeight.Bold, fontSize = 26.sp, letterSpacing = 3.sp
    ),
    titleMedium = TextStyle(
        fontWeight = FontWeight.SemiBold, fontSize = 16.sp, letterSpacing = 2.sp
    ),
    labelLarge = TextStyle(
        fontWeight = FontWeight.Bold, fontSize = 15.sp, letterSpacing = 2.sp
    ),
)

@Composable
fun SedamTheme(content: @Composable () -> Unit) {
    // Identidad visual constante (marino), independiente del modo del sistema.
    MaterialTheme(
        colorScheme = SedamColorScheme,
        typography = SedamTypography,
        content = content,
    )
}
