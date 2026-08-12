package mx.sedam.movil.ui.map

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.VibrationEffect
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import mx.sedam.movil.data.ChatMessage
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
import java.text.SimpleDateFormat
import java.util.Locale

/** Id de hilo del chat general (grupal) — coincide con el "toId" del protocolo. */
const val GENERAL_CHAT_ID = "0"

private val timeFmt = SimpleDateFormat("HH:mm", Locale.US)

/**
 * Chat táctico (general + privados por unidad) a pantalla completa. `thread`/
 * `onThreadChange` están elevados al llamador (no es estado interno) para que
 * MapScreen sepa en todo momento qué conversación está viendo el usuario ahora
 * mismo — así puede silenciar el sonido/banner de un mensaje que llega del
 * mismo hilo que ya está abierto en pantalla.
 *
 * NO usa `Dialog`: un Dialog de Compose crea su PROPIA ventana Android, y en
 * varios equipos (confirmado en One UI de Samsung — S25 Ultra, A34, Tab S6 Lite)
 * esa ventana secundaria no redimensiona bien con el teclado ni respeta la barra
 * de navegación aunque se fuerce `decorFitsSystemWindows`/`softInputMode` a mano,
 * dejando el input tapado. En cambio, esto se compone directo dentro de la MISMA
 * ventana que el resto de MapScreen (que ya maneja bien esos insets), como una
 * capa más de contenido — por eso el llamador debe encargarse del z-order
 * (colocarlo después del resto en un mismo Box/columna de composables).
 */
@Composable
fun ChatOverlay(
    myId: String,
    thread: String?,
    onThreadChange: (String?) -> Unit,
    generalMessages: List<ChatMessage>,
    privateThreads: Map<String, List<ChatMessage>>,
    unreadGeneral: Int,
    unreadPrivate: Map<String, Int>,
    onlineUnits: List<Pair<String, String>>, // id -> nombre, para iniciar chats nuevos
    nameOf: (String) -> String,
    onSendGeneral: (String) -> Unit,
    onSendPrivate: (String, String) -> Unit,
    onMarkGeneralRead: () -> Unit,
    onMarkPrivateRead: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    LaunchedEffect(thread) {
        when (thread) {
            GENERAL_CHAT_ID -> onMarkGeneralRead()
            null -> Unit
            else -> onMarkPrivateRead(thread)
        }
    }

    // Atrás del sistema: dentro de un hilo vuelve a la bandeja; en la bandeja, cierra.
    BackHandler {
        if (thread != null) onThreadChange(null) else onDismiss()
    }

    Surface(color = NavyDeep, modifier = Modifier.fillMaxSize()) {
        // En pantallas angostas (celular) el contenido ocupa todo el ancho; en
        // pantallas anchas (tablet/landscape/foldables) se limita y centra para
        // que no queden burbujas ni filas estiradas de borde a borde.
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val contentWidth = maxWidth.coerceAtMost(640.dp)
            val bubbleMaxWidth = (contentWidth * 0.78f).coerceAtMost(480.dp)
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
                Box(
                    Modifier
                        .width(contentWidth)
                        .fillMaxHeight()
                ) {
                    val current = thread
                    if (current == null) {
                        ChatInbox(
                            unreadGeneral = unreadGeneral,
                            privateThreads = privateThreads,
                            unreadPrivate = unreadPrivate,
                            onlineUnits = onlineUnits,
                            nameOf = nameOf,
                            onOpenGeneral = { onThreadChange(GENERAL_CHAT_ID) },
                            onOpenPrivate = { onThreadChange(it) },
                            onDismiss = onDismiss,
                        )
                    } else {
                        ChatThread(
                            myId = myId,
                            title = if (current == GENERAL_CHAT_ID) "Chat general" else nameOf(
                                current
                            ),
                            messages = if (current == GENERAL_CHAT_ID) generalMessages else (privateThreads[current]
                                ?: emptyList()),
                            showSenderName = current == GENERAL_CHAT_ID,
                            bubbleMaxWidth = bubbleMaxWidth,
                            nameOf = nameOf,
                            onBack = { onThreadChange(null) },
                            onClose = onDismiss,
                            onSend = { text ->
                                if (current == GENERAL_CHAT_ID) onSendGeneral(text) else onSendPrivate(
                                    current,
                                    text
                                )
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ChatInbox(
    unreadGeneral: Int,
    privateThreads: Map<String, List<ChatMessage>>,
    unreadPrivate: Map<String, Int>,
    onlineUnits: List<Pair<String, String>>,
    nameOf: (String) -> String,
    onOpenGeneral: () -> Unit,
    onOpenPrivate: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val existingThreads = remember(privateThreads) {
        privateThreads.entries
            .sortedByDescending { it.value.lastOrNull()?.ts ?: 0L }
            .map { it.key }
    }
    val startableUnits = remember(onlineUnits, existingThreads) {
        onlineUnits.filter { it.first !in existingThreads }
    }

    Column(
        Modifier
            .fillMaxSize()
            .systemBarsPadding()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "MENSAJES",
                color = White,
                fontWeight = FontWeight.Bold,
                letterSpacing = 2.sp,
                fontSize = 15.sp,
                modifier = Modifier
                    .weight(1f)
                    .padding(start = 8.dp)
            )
            IconButton(onClick = onDismiss) {
                Icon(Icons.Filled.Close, contentDescription = "Cerrar", tint = White)
            }
        }
        HorizontalDivider(color = Gold.copy(alpha = 0.2f))

        LazyColumn(Modifier.fillMaxSize()) {
            item {
                InboxRow(
                    icon = Icons.Filled.Forum,
                    title = "Chat general",
                    subtitle = "Todas las unidades",
                    unread = unreadGeneral,
                    onClick = onOpenGeneral,
                )
                DrawerRowDivider()
            }
            if (existingThreads.isNotEmpty()) {
                item { DrawerSectionLabel("CONVERSACIONES") }
                itemsIndexed(existingThreads, key = { _, id -> "thread-$id" }) { i, id ->
                    if (i > 0) DrawerRowDivider()
                    val last = privateThreads[id]?.lastOrNull()
                    InboxRow(
                        icon = Icons.Filled.Person,
                        title = nameOf(id),
                        subtitle = last?.text ?: "",
                        unread = unreadPrivate[id] ?: 0,
                        onClick = { onOpenPrivate(id) },
                    )
                }
            }
            if (startableUnits.isNotEmpty()) {
                item { DrawerSectionLabel("INICIAR CHAT") }
                itemsIndexed(startableUnits, key = { _, u -> "new-${u.first}" }) { i, u ->
                    if (i > 0) DrawerRowDivider()
                    InboxRow(
                        icon = Icons.Filled.Person,
                        title = u.second,
                        subtitle = "Toca para escribir",
                        unread = 0,
                        onClick = { onOpenPrivate(u.first) },
                    )
                }
            }
            if (existingThreads.isEmpty() && startableUnits.isEmpty()) {
                item {
                    Text(
                        "Sin unidades conectadas para chat privado",
                        color = SteelText.copy(alpha = 0.6f),
                        fontSize = 12.sp,
                        modifier = Modifier.padding(20.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun InboxRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    subtitle: String,
    unread: Int,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(
            modifier = Modifier
                .size(38.dp)
                .clip(CircleShape)
                .background(Navy.copy(alpha = 0.55f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = Gold, modifier = Modifier.size(20.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(
                title,
                color = White,
                fontWeight = FontWeight.SemiBold,
                fontSize = 14.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            if (subtitle.isNotBlank()) {
                Text(
                    subtitle,
                    color = SteelText.copy(alpha = 0.7f),
                    fontSize = 11.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
        if (unread > 0) ChatBadge(unread)
    }
}

/** Insignia numérica de no-leídos, reusable en el inbox y en botones de entrada. */
@Composable
fun ChatBadge(count: Int) {
    // Mismo lenguaje visual que OnlineBadge/PanicBanner (MapScreen.kt): un pulso
    // sutil que llama la atención sin ser molesto. El borde blanco recorta la
    // insignia contra cualquier fondo. OJO: tiene que ser claramente más CHICA
    // que el ícono que acompaña (chat = 19-22dp) — antes medía casi lo mismo
    // (20dp, hasta ~23.6dp en el pico del pulso) y terminaba TAPANDO el ícono en
    // vez de leerse como un punto pequeño en la esquina.
    val t = rememberInfiniteTransition(label = "chatBadge")
    val scale by t.animateFloat(
        initialValue = 1f,
        targetValue = 1.12f,
        animationSpec = infiniteRepeatable(tween(650), RepeatMode.Reverse),
        label = "chatBadgeScale",
    )
    Box(
        modifier = Modifier
            .scale(scale)
            .size(15.dp)
            .clip(CircleShape)
            .background(DangerRed)
            .border(1.2.dp, White, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        AnimatedContent(targetState = count, label = "chatBadgeCount") { c ->
            Text(
                if (c > 9) "9+" else "$c",
                color = White,
                fontSize = 8.sp,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

@Composable
private fun ChatThread(
    myId: String,
    title: String,
    messages: List<ChatMessage>,
    showSenderName: Boolean,
    bubbleMaxWidth: Dp,
    nameOf: (String) -> String,
    onBack: () -> Unit,
    onClose: () -> Unit,
    onSend: (String) -> Unit,
) {
    var input by remember { mutableStateOf("") }
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()

    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.size - 1)
    }

    Column(
        Modifier
            .fillMaxSize()
            .systemBarsPadding()
            .imePadding()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 4.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onBack) {
                Icon(
                    Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = "Volver",
                    tint = White
                )
            }
            Text(
                title, color = White, fontWeight = FontWeight.Bold, fontSize = 15.sp,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            IconButton(onClick = onClose) {
                Icon(Icons.Filled.Close, contentDescription = "Cerrar", tint = White)
            }
        }
        HorizontalDivider(color = Gold.copy(alpha = 0.2f))

        if (messages.isEmpty()) {
            Box(
                Modifier
                    .weight(1f)
                    .fillMaxWidth(), contentAlignment = Alignment.Center
            ) {
                Text("Sin mensajes todavía", color = SteelText.copy(alpha = 0.6f), fontSize = 12.sp)
            }
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                contentPadding = PaddingValues(horizontal = 10.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                items(messages, key = { it.id }) { m ->
                    ChatBubble(m, showSenderName, bubbleMaxWidth, nameOf)
                }
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedTextField(
                value = input,
                onValueChange = { input = it },
                placeholder = { Text("Mensaje…", fontSize = 13.sp) },
                shape = RoundedCornerShape(20.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedTextColor = White, unfocusedTextColor = OffWhite,
                    focusedContainerColor = FieldFill, unfocusedContainerColor = FieldFill,
                    cursorColor = Gold, focusedBorderColor = Gold, unfocusedBorderColor = FieldLine,
                ),
                modifier = Modifier.weight(1f),
            )
            val canSend = input.isNotBlank()
            IconButton(
                onClick = {
                    val text = input.trim()
                    if (text.isNotEmpty()) {
                        onSend(text)
                        input = ""
                        scope.launch {
                            if (messages.isNotEmpty()) listState.animateScrollToItem(
                                messages.size
                            )
                        }
                    }
                },
                enabled = canSend,
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.Send,
                    contentDescription = "Enviar",
                    tint = if (canSend) Gold else SteelText.copy(alpha = 0.4f),
                )
            }
        }
    }
}

@Composable
private fun ChatBubble(
    m: ChatMessage,
    showSenderName: Boolean,
    maxWidth: Dp,
    nameOf: (String) -> String
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (m.mine) Arrangement.End else Arrangement.Start,
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = maxWidth)
                .clip(
                    RoundedCornerShape(
                        topStart = 12.dp,
                        topEnd = 12.dp,
                        bottomStart = if (m.mine) 12.dp else 2.dp,
                        bottomEnd = if (m.mine) 2.dp else 12.dp
                    )
                )
                .background(if (m.mine) Gold else Navy.copy(alpha = 0.65f))
                .padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            if (showSenderName && !m.mine) {
                Text(
                    nameOf(m.fromId),
                    color = GoldBright,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold
                )
                Spacer(Modifier.height(1.dp))
            }
            Text(m.text, color = if (m.mine) Navy else OffWhite, fontSize = 14.sp)
            Spacer(Modifier.height(2.dp))
            Text(
                timeFmt.format(java.util.Date(m.ts)),
                color = if (m.mine) Navy.copy(alpha = 0.6f) else SteelText.copy(alpha = 0.7f),
                fontSize = 9.sp,
                modifier = Modifier.align(Alignment.End),
            )
        }
    }
}

/**
 * Banner de notificación (mensaje nuevo de otra unidad, chat cerrado o mostrando
 * otro hilo). Se autodescarta a los 4s; tocarlo abre esa conversación. Mismo
 * lenguaje visual que `PanicBanner` (MapScreen.kt) pero en dorado, no en rojo de
 * alerta — esto es un aviso normal, no una emergencia.
 */
@Composable
fun ChatToast(
    message: ChatMessage,
    title: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
    onDismiss: () -> Unit,
) {
    LaunchedEffect(message.id) {
        delay(4000)
        onDismiss()
    }
    Row(
        modifier = modifier
            .widthIn(max = 360.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(NavyDeep)
            .border(1.dp, Gold.copy(alpha = 0.45f), RoundedCornerShape(14.dp))
            .clickable { onDismiss(); onClick() }
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            modifier = Modifier
                .size(34.dp)
                .clip(CircleShape)
                .background(Gold.copy(alpha = 0.18f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.AutoMirrored.Filled.Chat,
                contentDescription = null,
                tint = Gold,
                modifier = Modifier.size(18.dp)
            )
        }
        Column(Modifier.weight(1f)) {
            Text(
                title,
                color = GoldBright,
                fontWeight = FontWeight.Bold,
                fontSize = 12.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                message.text,
                color = White,
                fontSize = 13.sp,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )
        }
        IconButton(onClick = onDismiss, modifier = Modifier.size(28.dp)) {
            Icon(
                Icons.Filled.Close,
                contentDescription = "Descartar",
                tint = SteelText,
                modifier = Modifier.size(16.dp)
            )
        }
    }
}

/**
 * Ping corto (tono + vibración breve) para un mensaje entrante — distinto de la
 * sirena de PanicAlarm: un solo beep en el stream de NOTIFICATION (respeta el
 * volumen de notificaciones del usuario, no el de alarma). No requiere assets
 * de audio, igual que PanicAlarm.
 */
suspend fun playChatPing(context: Context) {
    runCatching {
        val tone = ToneGenerator(AudioManager.STREAM_NOTIFICATION, 85)
        tone.startTone(ToneGenerator.TONE_PROP_BEEP2, 150)
        delay(250)
        tone.release()
    }
    runCatching {
        val vibrator = getVibrator(context)
        val attrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator?.vibrate(
                VibrationEffect.createOneShot(120, VibrationEffect.DEFAULT_AMPLITUDE),
                attrs
            )
        } else {
            @Suppress("DEPRECATION") vibrator?.vibrate(120)
        }
    }
}
