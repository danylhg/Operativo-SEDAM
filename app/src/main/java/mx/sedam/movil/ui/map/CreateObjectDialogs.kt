package mx.sedam.movil.ui.map

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Flag
import androidx.compose.material.icons.filled.Place
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import mx.sedam.movil.data.MilSymbolRenderer
import mx.sedam.movil.data.SidcCatalog
import mx.sedam.movil.ui.theme.DangerRed
import mx.sedam.movil.ui.theme.FieldFill
import mx.sedam.movil.ui.theme.FieldLine
import mx.sedam.movil.ui.theme.Gold
import mx.sedam.movil.ui.theme.GoldBright
import mx.sedam.movil.ui.theme.Navy
import mx.sedam.movil.ui.theme.NavyDeep
import mx.sedam.movil.ui.theme.OffWhite
import mx.sedam.movil.ui.theme.SteelText
import mx.sedam.movil.ui.theme.White
import java.util.Locale

/** Menú tras long-press: elegir crear waypoint o blanco en (lat,lng). */
@Composable
fun CreateObjectMenu(
    lat: Double, lng: Double, onWaypoint: () -> Unit, onTarget: () -> Unit, onDismiss: () -> Unit
) {
    Dialog(onDismissRequest = onDismiss) {
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = NavyDeep,
            border = BorderStroke(1.dp, Gold.copy(alpha = 0.3f))
        ) {
            Column(Modifier.padding(20.dp)) {
                Text(
                    "CREAR EN ESTE PUNTO",
                    color = GoldBright,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 2.sp,
                    fontSize = 13.sp
                )
                Text(
                    "%.5f, %.5f".format(Locale.US, lat, lng),
                    color = SteelText, fontSize = 11.sp,
                    modifier = Modifier.padding(top = 2.dp, bottom = 14.dp),
                )
                MenuOption(
                    Icons.Filled.Place, "Waypoint", "Punto táctico de referencia", onWaypoint
                )
                Spacer(Modifier.height(8.dp))
                MenuOption(Icons.Filled.Flag, "Blanco", "Objetivo / contacto", onTarget)
            }
        }
    }
}

@Composable
private fun MenuOption(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    sub: String,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .border(1.dp, Gold.copy(alpha = 0.25f), RoundedCornerShape(10.dp))
            .clickable(onClick = onClick)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Icon(icon, contentDescription = null, tint = Gold, modifier = Modifier.size(26.dp))
        Column {
            Text(title, color = White, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            Text(sub, color = SteelText.copy(alpha = 0.7f), fontSize = 11.sp)
        }
    }
}

/**
 * Diálogo de WAYPOINT (identidad × tipo). Sirve para crear (initialSidc=null) y
 * para editar (se pasa el SIDC/nombre actuales y se prellenan los selectores).
 */
@Composable
fun WaypointDialog(
    lat: Double,
    lng: Double,
    initialName: String = "",
    initialSidc: String? = null,
    onSave: (sidc: String, name: String) -> Unit,
    onDismiss: () -> Unit,
) {
    val (initIdentity, initType) = remember(initialSidc) {
        initialSidc?.let { SidcCatalog.parseWaypointSidc(it) }
            ?: (SidcCatalog.Identity.FRIENDLY to SidcCatalog.WaypointType.REFERENCE)
    }
    var name by remember { mutableStateOf(initialName) }
    var identity by remember { mutableStateOf(initIdentity) }
    var type by remember { mutableStateOf(initType) }
    val sidc = SidcCatalog.waypointSidc(identity, type)
    val isEdit = initialSidc != null

    ObjectDialog(
        title = if (isEdit) "Editar Waypoint" else "Nuevo Waypoint",
        saveLabel = if (isEdit) "GUARDAR" else "CREAR",
        sidc = sidc,
        name = name,
        onName = { name = it },
        lat = lat, lng = lng,
        onSave = { onSave(sidc, name.trim()) },
        onDismiss = onDismiss,
    ) {
        ChipRow("IDENTIDAD", SidcCatalog.Identity.entries, identity, { it.label }) { identity = it }
        Spacer(Modifier.height(10.dp))
        ChipRow("TIPO", SidcCatalog.WaypointType.entries, type, { it.label }) { type = it }
    }
}

/**
 * Diálogo de BLANCO (identidad × plataforma + rumbo/velocidad). Sirve para crear
 * y para editar (con los valores actuales prellenados).
 */
@Composable
fun TargetDialog(
    lat: Double,
    lng: Double,
    initialName: String = "",
    initialSidc: String? = null,
    initialHeading: Float = 0f,
    initialSpeed: Float = 0f,
    onSave: (sidc: String, name: String, heading: Float, speed: Float) -> Unit,
    onDismiss: () -> Unit,
) {
    val (initIdentity, initPlatform) = remember(initialSidc) {
        initialSidc?.let { SidcCatalog.parseTargetSidc(it) }
            ?: (SidcCatalog.Identity.UNKNOWN to SidcCatalog.Platform.LAND)
    }
    var name by remember { mutableStateOf(initialName) }
    var identity by remember { mutableStateOf(initIdentity) }
    var platform by remember { mutableStateOf(initPlatform) }
    var heading by remember {
        mutableStateOf(
            if (initialHeading != 0f) initialHeading.toInt().toString() else ""
        )
    }
    var speed by remember { mutableStateOf(if (initialSpeed != 0f) initialSpeed.toString() else "") }
    val sidc = SidcCatalog.targetSidc(identity, platform)
    val isEdit = initialSidc != null

    ObjectDialog(
        title = if (isEdit) "Editar Blanco" else "Nuevo Blanco",
        saveLabel = if (isEdit) "GUARDAR" else "CREAR",
        sidc = sidc,
        name = name,
        onName = { name = it },
        lat = lat, lng = lng,
        onSave = {
            onSave(
                sidc, name.trim(), heading.toFloatOrNull() ?: 0f, speed.toFloatOrNull() ?: 0f
            )
        },
        onDismiss = onDismiss,
    ) {
        ChipRow("IDENTIDAD", SidcCatalog.Identity.entries, identity, { it.label }) { identity = it }
        Spacer(Modifier.height(10.dp))
        ChipRow("PLATAFORMA", SidcCatalog.Platform.entries, platform, { it.label }) {
            platform = it
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            NumberField("Rumbo (°)", heading, Modifier.weight(1f)) { heading = it }
            NumberField("Vel. (km/h)", speed, Modifier.weight(1f)) { speed = it }
        }
    }
}

@Composable
private fun NumberField(
    label: String, value: String, modifier: Modifier = Modifier, onChange: (String) -> Unit
) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label, fontSize = 11.sp) },
        singleLine = true,
        shape = RoundedCornerShape(8.dp),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        colors = OutlinedTextFieldDefaults.colors(
            focusedTextColor = White, unfocusedTextColor = OffWhite,
            focusedContainerColor = FieldFill, unfocusedContainerColor = FieldFill,
            cursorColor = Gold, focusedBorderColor = Gold, unfocusedBorderColor = FieldLine,
            focusedLabelColor = GoldBright, unfocusedLabelColor = SteelText,
        ),
        modifier = modifier,
    )
}

@Composable
private fun ObjectDialog(
    title: String,
    saveLabel: String = "CREAR",
    sidc: String,
    name: String,
    onName: (String) -> Unit,
    lat: Double,
    lng: Double,
    onSave: () -> Unit,
    onDismiss: () -> Unit,
    selectors: @Composable () -> Unit,
) {
    val preview = remember(sidc) { MilSymbolRenderer.bitmapFor(sidc, 80)?.asImageBitmap() }
    Dialog(onDismissRequest = onDismiss) {
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = NavyDeep,
            border = BorderStroke(1.dp, Gold.copy(alpha = 0.3f))
        ) {
            Column(Modifier.padding(20.dp)) {
                Text(title, color = White, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                Spacer(Modifier.height(14.dp))
                // Preview del símbolo + SIDC
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(Navy.copy(alpha = 0.5f))
                        .padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    if (preview != null) Image(
                        preview, contentDescription = null, modifier = Modifier.size(44.dp)
                    )
                    Column {
                        Text(
                            "Vista previa 2525C",
                            color = SteelText.copy(alpha = 0.6f),
                            fontSize = 10.sp
                        )
                        Text(
                            name.ifBlank { "Sin nombre" },
                            color = White,
                            fontWeight = FontWeight.Bold,
                            fontSize = 14.sp
                        )
                        Text(sidc, color = SteelText.copy(alpha = 0.5f), fontSize = 10.sp)
                    }
                }
                Spacer(Modifier.height(14.dp))
                OutlinedTextField(
                    value = name,
                    onValueChange = onName,
                    label = { Text("Nombre") },
                    singleLine = true,
                    shape = RoundedCornerShape(8.dp),
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
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(14.dp))
                selectors()
                Spacer(Modifier.height(10.dp))
                Text("%.5f, %.5f".format(Locale.US, lat, lng), color = SteelText, fontSize = 11.sp)
                Spacer(Modifier.height(16.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = onDismiss) {
                        Text(
                            "CANCELAR", color = SteelText, letterSpacing = 1.sp
                        )
                    }
                    Spacer(Modifier.width(4.dp))
                    Button(
                        onClick = onSave,
                        enabled = name.isNotBlank(),
                        shape = RoundedCornerShape(6.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Gold, contentColor = Navy
                        ),
                    ) { Text(saveLabel, fontWeight = FontWeight.Bold, letterSpacing = 1.sp) }
                }
            }
        }
    }
}

@Composable

private fun <T> ChipRow(
    label: String, options: List<T>, selected: T, labelOf: (T) -> String, onSelect: (T) -> Unit
) {
    Column {
        Text(
            label,
            color = SteelText,
            fontSize = 10.sp,
            letterSpacing = 2.sp,
            fontWeight = FontWeight.SemiBold
        )
        Spacer(Modifier.height(6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            options.forEach { opt ->
                val sel = opt == selected
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(8.dp))
                        .background(if (sel) Gold else Navy.copy(alpha = 0.5f))
                        .border(1.dp, Gold.copy(alpha = 0.5f), RoundedCornerShape(8.dp))
                        .clickable { onSelect(opt) }
                        .padding(vertical = 8.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        labelOf(opt),
                        color = if (sel) Navy else SteelText,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                    )
                }
            }
        }
    }
}
