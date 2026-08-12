package mx.sedam.movil.ui.session

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import mx.sedam.movil.R
import mx.sedam.movil.ui.theme.BlueGlow
import mx.sedam.movil.ui.theme.FieldLine
import mx.sedam.movil.ui.theme.Gold
import mx.sedam.movil.ui.theme.GoldBright
import mx.sedam.movil.ui.theme.HudCorners
import mx.sedam.movil.ui.theme.SedamBackdrop
import mx.sedam.movil.ui.theme.SteelText

/**
 * Pantalla de transición tras el login. El emblema aparece con un fundido y
 * ondas de radar expansivas (guiño al logo); abajo, una barra indeterminada
 * indica que se está preparando el mapa. MainActivity la reemplaza por el mapa
 * tras unos segundos.
 */
@Composable
fun ConnectedScreen() {
    val radar = rememberInfiniteTransition(label = "radar")
    val pulse by radar.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(2600, easing = LinearEasing)),
        label = "pulse",
    )

    var appear by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { appear = true }
    val reveal by animateFloatAsState(if (appear) 1f else 0f, tween(700), label = "reveal")

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(SedamBackdrop)
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .safeDrawingPadding()
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier
                    .align(Alignment.Center)
                    .graphicsLayer { alpha = reveal },
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Canvas(modifier = Modifier.size(240.dp)) {
                        val maxR = size.minDimension / 2f
                        // Anillos guía estáticos
                        listOf(0.5f, 0.75f, 1f).forEach { f ->
                            drawCircle(
                                BlueGlow.copy(alpha = 0.12f),
                                maxR * f,
                                style = Stroke(1.dp.toPx())
                            )
                        }
                        // Tres ondas expansivas desfasadas
                        for (k in 0 until 3) {
                            val t = (pulse + k / 3f) % 1f
                            drawCircle(
                                color = Gold.copy(alpha = (1f - t) * 0.5f),
                                radius = maxR * (0.25f + t * 0.75f),
                                style = Stroke(2.dp.toPx()),
                            )
                        }
                    }
                    Image(
                        painter = painterResource(R.drawable.logo_sedam),
                        contentDescription = "Emblema SEDAM",
                        modifier = Modifier
                            .size(116.dp)
                            .graphicsLayer {
                                val s = 0.85f + reveal * 0.15f
                                scaleX = s; scaleY = s
                            },
                    )
                }

                Spacer(Modifier.height(12.dp))
                Text(
                    "ENLACE ESTABLECIDO",
                    color = GoldBright,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 3.sp,
                    fontSize = 16.sp,
                )
                Text(
                    "Canal cifrado activo",
                    color = SteelText,
                    fontSize = 12.sp,
                    letterSpacing = 1.sp,
                )
            }

            Column(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .padding(horizontal = 44.dp, vertical = 52.dp)
                    .graphicsLayer { alpha = reveal },
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    "INICIANDO MAPA TÁCTICO",
                    color = SteelText,
                    fontSize = 10.sp,
                    letterSpacing = 3.sp,
                    textAlign = TextAlign.Center,
                )
                LinearProgressIndicator(
                    color = Gold,
                    trackColor = FieldLine,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(3.dp),
                )
            }

            HudCorners()
        }
    }
}
