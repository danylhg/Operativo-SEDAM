package mx.sedam.movil.ui.login

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import mx.sedam.movil.R
import mx.sedam.movil.ui.theme.DangerRed
import mx.sedam.movil.ui.theme.FieldFill
import mx.sedam.movil.ui.theme.FieldLine
import mx.sedam.movil.ui.theme.Gold
import mx.sedam.movil.ui.theme.GoldBright
import mx.sedam.movil.ui.theme.GoldDeep
import mx.sedam.movil.ui.theme.Navy
import mx.sedam.movil.ui.theme.NavyAbyss
import mx.sedam.movil.ui.theme.NavyDeep
import mx.sedam.movil.ui.theme.NavyMid
import mx.sedam.movil.ui.theme.OffWhite
import mx.sedam.movil.ui.theme.SteelText
import mx.sedam.movil.ui.theme.White

/**
 * Login con identidad militar SEDAM: fondo en degradado de azul marino,
 * logo del emblema, acentos dorados y tipografía en versalitas espaciadas.
 */
@Composable
fun LoginScreen(vm: LoginViewModel) {
    val form by vm.form.collectAsStateWithLifecycle()
    val state by vm.state.collectAsStateWithLifecycle()
    val busy = state is LoginState.Connecting || state is LoginState.Handshake

    val backdrop = Brush.verticalGradient(listOf(NavyAbyss, NavyDeep, Navy, NavyMid))

    // Emblema proporcional al ancho de pantalla (teléfono chico ↔ tablet), acotado.
    val screenWidthDp = LocalConfiguration.current.screenWidthDp
    val emblemSize = (screenWidthDp * 0.42f).coerceIn(120f, 190f).dp
    // Padding horizontal que crece un poco en pantallas anchas.
    val hPadding = (screenWidthDp * 0.07f).coerceIn(20f, 48f).dp

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(backdrop)
            .safeDrawingPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = hPadding, vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        // ── Emblema ──
        Image(
            painter = painterResource(R.drawable.logo_sedam),
            contentDescription = "Emblema SEDAM",
            modifier = Modifier.size(emblemSize),
        )

        Row(
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "SEDAM",
                color = White,
                fontWeight = FontWeight.Bold,
                fontSize = 30.sp,
                letterSpacing = 5.sp,
            )
            Text(
                "MÓVIL",
                color = White,
                fontWeight = FontWeight.Bold,
                fontSize = 30.sp,
                letterSpacing = 5.sp,
            )
        }
        Text(
            "SISTEMA DE ENLACE DE DATOS\nDE LA ARMADA DE MÉXICO",
            color = SteelText,
            fontSize = 11.sp,
            letterSpacing = 3.sp,
            lineHeight = 18.sp,
            textAlign = TextAlign.Center,
        )

        GoldRule()

        Text(
            "ACCESO AL SISTEMA",
            color = GoldBright,
            fontWeight = FontWeight.SemiBold,
            fontSize = 13.sp,
            letterSpacing = 3.sp,
            modifier = Modifier.padding(top = 4.dp, bottom = 4.dp),
        )

        MilitaryField(form.server, { vm.onFormChange(form.copy(server = it)) }, "SERVIDOR (IP)", enabled = !busy)
        MilitaryField(form.serial, { vm.onFormChange(form.copy(serial = it)) }, "NÚMERO DE SERIE", enabled = !busy)
        MilitaryField(
            form.token, { vm.onFormChange(form.copy(token = it)) }, "TOKEN DE DISPOSITIVO", enabled = !busy,
            keyboard = KeyboardType.Password, isSecret = true,
        )

        Spacer(Modifier.height(6.dp))

        Button(
            onClick = { vm.connect() },
            enabled = !busy,
            shape = RoundedCornerShape(6.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = Gold,
                contentColor = Navy,
                disabledContainerColor = GoldDeep,
                disabledContentColor = NavyDeep,
            ),
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp)
                .widthIn(max = 420.dp),
        ) {
            Text(
                if (busy) "CONECTANDO…" else "CONECTAR",
                fontWeight = FontWeight.Bold,
                letterSpacing = 3.sp,
                fontSize = 15.sp,
            )
        }

        StatusArea(state)
    }
}

@Composable
private fun StatusArea(state: LoginState) {
    when (state) {
        is LoginState.Connecting -> StatusRow("ESTABLECIENDO ENLACE…")
        is LoginState.Handshake -> StatusRow("CIFRANDO CANAL…")
        is LoginState.Error -> Text(
            state.message,
            color = DangerRed,
            fontSize = 13.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 8.dp),
        )
        else -> Unit
    }
}

@Composable
private fun StatusRow(text: String) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.padding(top = 10.dp),
    ) {
        CircularProgressIndicator(color = Gold, strokeWidth = 3.dp, modifier = Modifier.size(28.dp))
        Text(text, color = SteelText, fontSize = 12.sp, letterSpacing = 2.sp)
    }
}

@Composable
private fun GoldRule() {
    HorizontalDivider(
        color = Gold,
        thickness = 1.dp,
        modifier = Modifier
            .padding(vertical = 8.dp)
            .widthIn(max = 120.dp)
            .fillMaxWidth(),
    )
}

@Composable
private fun MilitaryField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    enabled: Boolean,
    keyboard: KeyboardType = KeyboardType.Text,
    isSecret: Boolean = false,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label, letterSpacing = 1.5.sp, fontSize = 12.sp) },
        singleLine = true,
        enabled = enabled,
        shape = RoundedCornerShape(6.dp),
        visualTransformation = if (isSecret) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = keyboard),
        colors = OutlinedTextFieldDefaults.colors(
            focusedTextColor = White,
            unfocusedTextColor = OffWhite,
            focusedContainerColor = FieldFill,
            unfocusedContainerColor = FieldFill,
            cursorColor = Gold,
            focusedBorderColor = Gold,
            unfocusedBorderColor = FieldLine,
            focusedLabelColor = GoldBright,
            unfocusedLabelColor = SteelText,
            disabledBorderColor = FieldLine,
            disabledTextColor = SteelText,
        ),
        modifier = Modifier
            .fillMaxWidth()
            .widthIn(max = 420.dp),
    )
}
