package com.operaciones.operaciones_android.ui.panel

import android.content.Context
import android.app.AlertDialog
import android.graphics.Color
import android.graphics.Typeface
import android.text.Editable
import android.text.TextWatcher
import android.view.View
import android.view.ViewGroup
import android.view.Gravity
import android.view.inputmethod.InputMethodManager
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.Spinner
import android.widget.TextView
import android.widget.Toast
import android.graphics.drawable.GradientDrawable
import android.widget.ScrollView
import android.widget.RelativeLayout
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.operaciones.operaciones_android.R
import com.operaciones.operaciones_android.model.ChatMessage
import com.operaciones.operaciones_android.model.PersonalItem
import com.operaciones.operaciones_android.model.User
import com.operaciones.operaciones_android.model.VehiculoItem
import com.operaciones.operaciones_android.ui.adapter.ChatAdapter

internal class ChatPanelRenderer(
    private val host: MainPanelRenderer.Host
) {
    private data class TargetEntry(
        val id: String,
        val label: String,
        val sendId: String = id
    )

    private data class ChannelDef(
        val type: String,
        val label: String,
        val targets: List<TargetEntry>,
        val destinatarioRol: String,
        val destinoTipo: String?,
        val fixedId: String? = null,
        val fixedLabel: String? = null
    )

    private data class ContactStyle(
        val rowColor: String,
        val accentColor: String,
        val avatarColor: String
    )

    fun inflate(
        panelContent: FrameLayout,
        messages: MutableList<ChatMessage>,
        currentUser: User,
        personalList: List<PersonalItem>,
        vehiculosList: List<VehiculoItem>,
        initialSelection: ChatChannelSelection? = null,
        onFilterChanged: (ChatChannelSelection) -> Unit = {},
        headerTitle: String? = null,
        headerSubtitle: String? = null,
        isGroup: Boolean = false,
        groupMembers: List<ChatGroupMember> = emptyList(),
        onGroupMemberSelected: ((ChatGroupMember) -> Unit)? = null,
        onBack: (() -> Unit)? = null
    ): ChatPanelRefs {
        val view = host.getLayoutInflater().inflate(R.layout.panel_chat, panelContent, false)
        panelContent.addView(view)

        val headerTitleView = view.findViewById<TextView>(R.id.chatHeaderTitle)
        val headerSubtitleView = view.findViewById<TextView>(R.id.chatHeaderSubtitle)
        val backBtn = view.findViewById<ImageButton>(R.id.chatBackBtn)
        val callBtn = view.findViewById<ImageButton>(R.id.chatCallBtn)
        val selectionCancelBtn = view.findViewById<ImageButton>(R.id.chatSelectionCancelBtn)
        val selectionForwardBtn = view.findViewById<ImageButton>(R.id.chatSelectionForwardBtn)
        val headerInfo = view.findViewById<View>(R.id.chatHeaderInfo)
        val chatHeader = view.findViewById<LinearLayout>(R.id.chatHeader)
        chatHeader.removeView(selectionCancelBtn)
        chatHeader.addView(selectionCancelBtn, 0)

        if (headerTitle != null) {
            headerTitleView.text = headerTitle
        }
        if (headerSubtitle != null) {
            headerSubtitleView.text = headerSubtitle
            headerSubtitleView.visibility = View.VISIBLE
        } else {
            headerSubtitleView.visibility = View.GONE
        }

        if (onBack != null) {
            backBtn.visibility = View.VISIBLE
            backBtn.setOnClickListener { onBack() }
        } else {
            backBtn.visibility = View.GONE
        }

        if (isGroup && groupMembers.isNotEmpty()) {
            headerInfo.isClickable = true
            headerInfo.isFocusable = true
            headerInfo.foreground = view.context.obtainStyledAttributes(
                intArrayOf(android.R.attr.selectableItemBackground)
            ).getDrawable(0)
            headerInfo.setOnClickListener {
                showGroupMembersDialog(
                    view,
                    headerTitle ?: "Grupo",
                    groupMembers,
                    onGroupMemberSelected
                )
            }
        }

        val chatRecycler = view.findViewById<RecyclerView>(R.id.chatRecycler)
        val msgInput = view.findViewById<EditText>(R.id.msgInput)
        val sendBtn = view.findViewById<ImageButton>(R.id.sendBtn)
        val voiceBtn = view.findViewById<ImageButton>(R.id.voiceBtn)
        val attachmentBtn = view.findViewById<ImageButton>(R.id.attachmentBtn)
        val channelSelector = view.findViewById<View?>(R.id.channelSelector)
        val destBtn = view.findViewById<TextView?>(R.id.destBtn)

        val isPersonalSelection = initialSelection?.type == "CUT_SPECIFIC" ||
                initialSelection?.type == "CET_SPECIFIC" ||
                initialSelection?.type == "CELL_SPECIFIC"
        callBtn.visibility = if (isPersonalSelection) View.VISIBLE else View.GONE
        lateinit var forwardVideo: (java.io.File, ChatMessage, String) -> Unit
        var selectedMessages: List<ChatMessage> = emptyList()
        lateinit var chatAdapter: ChatAdapter
        chatAdapter = ChatAdapter(
            messages = messages,
            isPersonal = isPersonalSelection,
            onForwardVideo = { file, sourceMessage -> forwardVideo(file, sourceMessage, "VIDEO") },
            onForwardImage = { file, sourceMessage -> forwardVideo(file, sourceMessage, "IMAGE") },
            onSelectionChanged = { selected ->
                selectedMessages = selected
                headerTitleView.text = if (selected.isEmpty()) {
                    headerTitle ?: "MENSAJES"
                } else {
                    "${selected.size} seleccionados"
                }
                selectionCancelBtn.visibility = if (selected.isEmpty()) View.GONE else View.VISIBLE
                selectionForwardBtn.visibility = if (selected.isEmpty()) View.GONE else View.VISIBLE
                headerInfo.visibility = View.VISIBLE
                backBtn.visibility = if (selected.isEmpty() && onBack != null) View.VISIBLE else View.GONE
                callBtn.visibility = if (selected.isEmpty() && isPersonalSelection) View.VISIBLE else View.GONE
            }
        )
        chatRecycler.layoutManager = LinearLayoutManager(view.context)
        chatRecycler.adapter = chatAdapter
        if (messages.isNotEmpty()) chatRecycler.scrollToPosition(messages.size - 1)

        val channelDefs = buildChannelDefs(currentUser, personalList, vehiculosList)
        var selectedChannel = channelDefs.first()
        var selectedTargetIdx = 0

        fun selectionFor(channel: ChannelDef, targetIdx: Int): ChatChannelSelection {
            val target = channel.targets.getOrNull(targetIdx)
            return ChatChannelSelection(
                type = channel.type,
                destinatarioRol = channel.destinatarioRol,
                destinoTipo = channel.destinoTipo,
                destinoId = target?.id ?: channel.fixedId,
                destinoLabel = target?.label ?: channel.fixedLabel,
                destinoSendId = target?.sendId ?: channel.fixedId
            )
        }

        forwardVideo = { file, sourceMessage, kind ->
            val entries = channelDefs.flatMap { channel ->
                if (channel.targets.isEmpty()) listOf(channel to 0)
                else channel.targets.indices.map { index -> channel to index }
            }
            val labels = entries.map { (channel, index) ->
                channel.targets.getOrNull(index)?.label
                    ?: channel.fixedLabel
                    ?: channel.label
            }.toTypedArray()
            val checked = BooleanArray(labels.size)
            val dialog = AlertDialog.Builder(view.context)
                .setTitle(if (kind == "IMAGE") "Reenviar imagen" else "Reenviar video")
                .setMultiChoiceItems(labels, checked) { _, which, isChecked ->
                    checked[which] = isChecked
                }
                .setNegativeButton("Cancelar", null)
                .setPositiveButton("Enviar") { _, _ ->
                    val selected = entries.mapIndexedNotNull { index, entry ->
                        if (checked[index]) selectionFor(entry.first, entry.second) else null
                    }
                    if (selected.isEmpty()) {
                        Toast.makeText(view.context, "Selecciona al menos un chat", Toast.LENGTH_SHORT).show()
                    } else {
                        host.forwardChatAttachment(file, selected, sourceMessage, kind)
                    }
                }
                .create()

            dialog.setOnShowListener {
                dialog.window?.setBackgroundDrawable(GradientDrawable().apply {
                    setColor(Color.rgb(24, 38, 54))
                    cornerRadius = 28f
                    setStroke(1, Color.rgb(67, 103, 132))
                })
                dialog.window?.setDimAmount(0.62f)
                dialog.getButton(AlertDialog.BUTTON_NEGATIVE)?.apply {
                    setTextColor(Color.rgb(126, 217, 239))
                    isAllCaps = false
                }
                dialog.getButton(AlertDialog.BUTTON_POSITIVE)?.apply {
                    setTextColor(Color.rgb(126, 217, 239))
                    isAllCaps = false
                }
                dialog.listView?.apply {
                    setPadding(18, 4, 18, 4)
                    divider = null
                    dividerHeight = 0
                }
            }
            dialog.show()
        }

        selectionCancelBtn.setOnClickListener { chatAdapter.clearSelection() }
        selectionForwardBtn.setOnClickListener {
            if (selectedMessages.isEmpty()) return@setOnClickListener
            val entries = channelDefs.flatMap { channel ->
                if (channel.targets.isEmpty()) listOf(channel to 0)
                else channel.targets.indices.map { index -> channel to index }
            }
            val labels = entries.map { (channel, index) ->
                channel.targets.getOrNull(index)?.label ?: channel.fixedLabel ?: channel.label
            }.toTypedArray()
            val checked = BooleanArray(labels.size)
            val multiDialog = AlertDialog.Builder(view.context)
                .setTitle("Reenviar ${selectedMessages.size} mensajes")
                .setMultiChoiceItems(labels, checked) { _, which, value -> checked[which] = value }
                .setNegativeButton("Cancelar", null)
                .setPositiveButton("Enviar") { _, _ ->
                    val destinations = entries.mapIndexedNotNull { index, entry ->
                        if (checked[index]) selectionFor(entry.first, entry.second) else null
                    }
                    if (destinations.isEmpty()) {
                        Toast.makeText(view.context, "Selecciona al menos un chat", Toast.LENGTH_SHORT).show()
                    } else {
                        host.forwardChatMessages(selectedMessages.toList(), destinations)
                        chatAdapter.clearSelection()
                    }
                }
                .create()
            multiDialog.setOnShowListener {
                val density = view.resources.displayMetrics.density
                multiDialog.window?.setBackgroundDrawable(GradientDrawable().apply {
                    setColor(Color.rgb(15, 31, 48))
                    cornerRadius = 20f * density
                    setStroke((1f * density).toInt(), Color.rgb(63, 94, 119))
                })
                multiDialog.window?.setDimAmount(0.68f)
                multiDialog.getButton(AlertDialog.BUTTON_NEGATIVE)?.apply {
                    setTextColor(Color.rgb(147, 197, 253))
                    isAllCaps = false
                }
                multiDialog.getButton(AlertDialog.BUTTON_POSITIVE)?.apply {
                    setTextColor(Color.rgb(147, 197, 253))
                    isAllCaps = false
                }
                multiDialog.listView?.apply {
                    setPadding((14 * density).toInt(), (4 * density).toInt(), (14 * density).toInt(), (4 * density).toInt())
                    divider = null
                    dividerHeight = 0
                    setBackgroundColor(Color.TRANSPARENT)
                }
            }
            multiDialog.show()
        }

        fun findInitialSelection(defs: List<ChannelDef>, sel: ChatChannelSelection?): Pair<ChannelDef, Int>? {
            if (sel == null) return null
            for (def in defs) {
                if (def.type == sel.type) {
                    if (def.targets.isEmpty()) return Pair(def, 0)
                    val idx = def.targets.indexOfFirst { it.id == sel.destinoId || it.sendId == sel.destinoSendId }
                    if (idx >= 0) return Pair(def, idx)
                }
            }
            return null
        }

        findInitialSelection(channelDefs, initialSelection)?.let { (channel, targetIdx) ->
            selectedChannel = channel
            selectedTargetIdx = targetIdx
        }

        fun payloadFor(channel: ChannelDef, targetIdx: Int): Triple<String?, String?, String?> =
            if (channel.targets.isEmpty()) {
                Triple(channel.destinoTipo, channel.fixedId, channel.fixedLabel)
            } else {
                val target = channel.targets.getOrNull(targetIdx)
                Triple(channel.destinoTipo, target?.sendId, target?.label)
            }

        fun currentSelection(): ChatChannelSelection = selectionFor(selectedChannel, selectedTargetIdx)
        callBtn.setOnClickListener { host.startVoiceCall(currentSelection()) }

        fun destinationLabel(): String {
            if (selectedChannel.targets.isEmpty()) return "${selectedChannel.label}  v"
            val target = selectedChannel.targets.getOrNull(selectedTargetIdx)
            return "${target?.label ?: selectedChannel.label}  v"
        }

        fun send(text: String, isAlert: Boolean) {
            val (tipo, id, label) = payloadFor(selectedChannel, selectedTargetIdx)
            host.sendChatMessage(
                text = text,
                alert = isAlert,
                destinatarioRol = selectedChannel.destinatarioRol,
                destinoTipo = tipo,
                destinoId = id,
                destinoLabel = label
            )
        }

        fun openChannelPicker() {
            openChannelPicker(
                anchorView = view,
                channelDefs = channelDefs,
                selectedChannel = selectedChannel,
                selectedTargetIdx = selectedTargetIdx
            ) { channel, targetIdx ->
                selectedChannel = channel
                selectedTargetIdx = targetIdx
                destBtn?.text = destinationLabel()
                onFilterChanged(currentSelection())
            }
        }

        if (channelSelector != null && destBtn != null) {
            if (channelDefs.size <= 1) {
                channelSelector.visibility = View.GONE
            } else {
                channelSelector.visibility = View.VISIBLE
                destBtn.text = destinationLabel()
                destBtn.setOnClickListener { openChannelPicker() }
            }
        }

        bindSendButton(msgInput, sendBtn, ::send)
        bindAttachmentButtons(voiceBtn, attachmentBtn) { source ->
            val (tipo, id, label) = payloadFor(selectedChannel, selectedTargetIdx)
            host.requestChatAttachment(
                source = source,
                destinatarioRol = selectedChannel.destinatarioRol,
                destinoTipo = tipo,
                destinoId = id,
                destinoLabel = label
            )
        }
        bindQuickReplies(view, ::send, msgInput)
        onFilterChanged(currentSelection())

        return ChatPanelRefs(recyclerView = chatRecycler, adapter = chatAdapter, input = msgInput)
    }

    fun inflateWorkspace(
        panelContent: FrameLayout,
        messages: MutableList<ChatMessage>,
        currentUser: User,
        personalList: List<PersonalItem>,
        vehiculosList: List<VehiculoItem>,
        initialSelection: ChatChannelSelection? = null,
        onContactSelected: (ChatChannelSelection) -> Unit,
        onFilterChanged: (ChatChannelSelection) -> Unit = {}
    ): ChatPanelRefs {
        var refs: ChatPanelRefs? = null
        var activeSelection = initialSelection
        lateinit var showChat: (ChatChannelSelection) -> Unit

        fun showContacts() {
            panelContent.removeAllViews()
            inflateContacts(
                panelContent = panelContent,
                currentUser = currentUser,
                personalList = personalList,
                vehiculosList = vehiculosList,
                onBack = { },
                onContactSelected = { selection ->
                    activeSelection = selection
                    onContactSelected(selection)
                    showChat(selection)
                }
            )
        }

        fun titleFor(selection: ChatChannelSelection): String =
            selection.destinoLabel?.takeIf { it.isNotBlank() }
                ?: selection.type.replace('_', ' ').lowercase().replaceFirstChar { it.uppercase() }

        showChat = { selection ->
            panelContent.removeAllViews()
            refs = inflate(
                panelContent = panelContent,
                messages = messages,
                currentUser = currentUser,
                personalList = personalList,
                vehiculosList = vehiculosList,
                initialSelection = selection,
                onFilterChanged = onFilterChanged,
                headerTitle = titleFor(selection),
                headerSubtitle = null,
                onBack = { showContacts() }
            )
        }

        if (activeSelection == null) {
            showContacts()
        } else {
            activeSelection?.let { showChat(it) }
        }

        return refs ?: ChatPanelRefs(
            recyclerView = RecyclerView(panelContent.context),
            adapter = ChatAdapter(
                messages,
                activeSelection?.type == "CUT_SPECIFIC" ||
                        activeSelection?.type == "CET_SPECIFIC" ||
                        activeSelection?.type == "CELL_SPECIFIC"
            ),
            input = EditText(panelContent.context)
        )
    }

    fun inflateContacts(
        panelContent: FrameLayout,
        currentUser: User,
        personalList: List<PersonalItem>,
        vehiculosList: List<VehiculoItem>,
        onBack: () -> Unit,
        unreadCountFor: (ChatChannelSelection) -> Int = { 0 },
        lastMessageFor: (ChatChannelSelection) -> String = { "Sin mensajes todavía" },
        onContactSelected: (ChatChannelSelection) -> Unit
    ) {
        val context = panelContent.context
        val density = context.resources.displayMetrics.density
        val channelDefs = buildChannelDefs(currentUser, personalList, vehiculosList)

        val root = RelativeLayout(context).apply {
            setBackgroundColor(Color.parseColor("#07111F"))
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        }

        val headerId = View.generateViewId()
        val header = LinearLayout(context).apply {
            id = headerId
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            setPadding(dp(density, 10), dp(density, 8), dp(density, 16), dp(density, 8))
            setBackgroundColor(Color.parseColor("#0D1B2E"))
            layoutParams = RelativeLayout.LayoutParams(
                RelativeLayout.LayoutParams.MATCH_PARENT,
                RelativeLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                addRule(RelativeLayout.ALIGN_PARENT_TOP)
            }
        }
        header.addView(ImageButton(context).apply {
            setImageResource(android.R.drawable.ic_menu_close_clear_cancel)
            setColorFilter(Color.parseColor("#A7B6CA"))
            setBackgroundColor(Color.TRANSPARENT)
            contentDescription = "Cerrar chat"
            setOnClickListener { onBack() }
            layoutParams = LinearLayout.LayoutParams(dp(density, 36), dp(density, 36))
        })
        header.addView(TextView(context).apply {
            text = "Mensajes"
            setTextColor(Color.parseColor("#EAF2FF"))
            textSize = 16f
            typeface = Typeface.DEFAULT_BOLD
            setPadding(dp(density, 6), 0, 0, 0)
            layoutParams = LinearLayout.LayoutParams(
                0,
                LinearLayout.LayoutParams.WRAP_CONTENT,
                1f
            )
        })
        val searchButton = ImageButton(context).apply {
            setImageResource(android.R.drawable.ic_menu_search)
            setColorFilter(Color.parseColor("#69B4FF"))
            setBackgroundColor(Color.TRANSPARENT)
            contentDescription = "Buscar conversaciones"
            layoutParams = LinearLayout.LayoutParams(dp(density, 40), dp(density, 40))
        }
        header.addView(searchButton)
        root.addView(header)

        val searchBarId = View.generateViewId()
        val searchBar = LinearLayout(context).apply {
            id = searchBarId
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            setPadding(dp(density, 12), dp(density, 8), dp(density, 12), dp(density, 8))
            setBackgroundColor(Color.parseColor("#0D1B2E"))
            visibility = View.GONE
            layoutParams = RelativeLayout.LayoutParams(
                RelativeLayout.LayoutParams.MATCH_PARENT,
                RelativeLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                addRule(RelativeLayout.BELOW, headerId)
            }
        }
        val searchInput = EditText(context).apply {
            hint = "Buscar canal, grupo o vehículo"
            setTextColor(Color.parseColor("#EAF2FF"))
            setHintTextColor(Color.parseColor("#8FA4BF"))
            textSize = 14f
            setSingleLine(true)
            setPadding(dp(density, 14), 0, dp(density, 10), 0)
            background = roundedDrawable(context, "#152A43", 8)
            layoutParams = LinearLayout.LayoutParams(0, dp(density, 40), 1f)
        }
        searchBar.addView(searchInput)
        searchBar.addView(ImageButton(context).apply {
            setImageResource(android.R.drawable.ic_menu_close_clear_cancel)
            setColorFilter(Color.parseColor("#A7B6CA"))
            setBackgroundColor(Color.TRANSPARENT)
            contentDescription = "Cerrar búsqueda"
            layoutParams = LinearLayout.LayoutParams(dp(density, 40), dp(density, 40)).apply {
                leftMargin = dp(density, 4)
            }
            setOnClickListener {
                searchInput.text.clear()
                searchInput.clearFocus()
                searchBar.visibility = View.GONE
                (context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
                    .hideSoftInputFromWindow(searchInput.windowToken, 0)
            }
        })
        root.addView(searchBar)

        val scroll = ScrollView(context).apply {
            isFillViewport = true
            layoutParams = RelativeLayout.LayoutParams(
                RelativeLayout.LayoutParams.MATCH_PARENT,
                RelativeLayout.LayoutParams.MATCH_PARENT
            ).apply {
                addRule(RelativeLayout.BELOW, searchBarId)
            }
        }
        val list = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(density, 12), dp(density, 10), dp(density, 12), dp(density, 18))
        }

        fun renderContacts(query: String = "") {
            list.removeAllViews()
            val normalizedQuery = query.trim().lowercase()
            channelDefs.forEach { channel ->
                val style = contactStyle(channel.type)
                if (channel.targets.isEmpty()) {
                    val label = channel.fixedLabel ?: channel.label
                    val selection = selectionFor(channel, 0)
                    if (normalizedQuery.isEmpty() || label.lowercase().contains(normalizedQuery)) {
                        list.addView(contactRow(label, lastMessageFor(selection), unreadCountFor(selection), style) {
                            onContactSelected(selection)
                        })
                    }
                } else {
                    val channelMatches = channel.label.lowercase().contains(normalizedQuery)
                    val visibleTargets = channel.targets.mapIndexedNotNull { index, target ->
                        if (normalizedQuery.isEmpty() || channelMatches ||
                            target.label.lowercase().contains(normalizedQuery)
                        ) {
                            index to target
                        } else {
                            null
                        }
                    }
                    if (visibleTargets.isNotEmpty()) {
                        list.addView(TextView(context).apply {
                            text = channel.label.uppercase()
                            setTextColor(Color.parseColor(style.accentColor))
                            textSize = 10f
                            typeface = Typeface.DEFAULT_BOLD
                            setPadding(dp(density, 6), dp(density, 12), dp(density, 6), dp(density, 6))
                        })
                    }
                    visibleTargets.forEach { (index, target) ->
                        val selection = selectionFor(channel, index)
                        list.addView(contactRow(target.label, lastMessageFor(selection), unreadCountFor(selection), style) {
                            onContactSelected(selection)
                        })
                    }
                }
            }
            if (list.childCount == 0) {
                list.addView(TextView(context).apply {
                    text = "No se encontraron conversaciones"
                    gravity = android.view.Gravity.CENTER
                    setTextColor(Color.parseColor("#A7B6CA"))
                    textSize = 14f
                    setPadding(0, dp(density, 28), 0, 0)
                })
            }
        }

        searchButton.setOnClickListener {
            searchBar.visibility = View.VISIBLE
            searchInput.requestFocus()
            (context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
                .showSoftInput(searchInput, InputMethodManager.SHOW_IMPLICIT)
        }
        searchInput.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(text: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(text: CharSequence?, start: Int, before: Int, count: Int) {
                renderContacts(text?.toString().orEmpty())
            }
            override fun afterTextChanged(text: Editable?) = Unit
        })
        renderContacts()

        scroll.addView(list)
        root.addView(scroll)
        panelContent.addView(root)
    }

    private fun contactRow(
        label: String,
        lastMessage: String,
        unreadCount: Int,
        style: ContactStyle,
        onClick: () -> Unit
    ): View {
        val context = host.getLayoutInflater().context
        val density = context.resources.displayMetrics.density
        return LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER_VERTICAL
            background = roundedDrawable(context, style.rowColor, 8)
            setPadding(dp(density, 10), dp(density, 8), dp(density, 10), dp(density, 8))
            isClickable = true
            isFocusable = true
            setOnClickListener { onClick() }
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(density, 6) }

            addView(TextView(context).apply {
                text = label.firstOrNull()?.uppercaseChar()?.toString() ?: "?"
                gravity = android.view.Gravity.CENTER
                setTextColor(Color.parseColor(style.accentColor))
                textSize = 13f
                typeface = Typeface.DEFAULT_BOLD
                background = roundedDrawable(context, style.avatarColor, 16)
                layoutParams = LinearLayout.LayoutParams(dp(density, 34), dp(density, 34)).apply {
                    rightMargin = dp(density, 10)
                }
            })
            addView(LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                gravity = android.view.Gravity.CENTER_VERTICAL
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                addView(TextView(context).apply {
                    text = label
                    setTextColor(Color.parseColor("#EAF2FF"))
                    textSize = 13f
                    typeface = Typeface.DEFAULT_BOLD
                    maxLines = 1
                    ellipsize = android.text.TextUtils.TruncateAt.END
                })
                addView(TextView(context).apply {
                    text = lastMessage
                    setTextColor(Color.parseColor("#9FB0C5"))
                    textSize = 11f
                    maxLines = 1
                    ellipsize = android.text.TextUtils.TruncateAt.END
                })
            })
            if (unreadCount > 0) {
                addView(TextView(context).apply {
                    text = if (unreadCount > 99) "99+" else unreadCount.toString()
                    gravity = android.view.Gravity.CENTER
                    setTextColor(Color.parseColor("#F2FAF8"))
                    textSize = 11f
                    typeface = Typeface.DEFAULT_BOLD
                    minWidth = dp(density, 22)
                    minHeight = dp(density, 22)
                    setPadding(dp(density, 6), 0, dp(density, 6), 0)
                    background = roundedDrawable(context, "#2563EB", 12)
                    contentDescription = "$unreadCount mensajes nuevos"
                })
            }
        }
    }

    private fun contactStyle(type: String): ContactStyle =
        when (type.uppercase()) {
            "FLOTILLA" -> ContactStyle("#12343B", "#58D1CC", "#174A50")
            "GRUPO" -> ContactStyle("#2B2745", "#B6A4FF", "#413968")
            "VEHICULO" -> ContactStyle("#1B3242", "#7EC3E8", "#254C61")
            "CUT_SPECIFIC" -> ContactStyle("#30294A", "#C1A7FF", "#493D6B")
            "CET_SPECIFIC", "CETS" -> ContactStyle("#17364B", "#69BFF2", "#22516D")
            "CELL_SPECIFIC" -> ContactStyle("#173A38", "#6FD1B2", "#23564F")
            else -> ContactStyle("#17304D", "#69B4FF", "#20466D")
        }

    private fun selectionFor(channel: ChannelDef, targetIdx: Int): ChatChannelSelection {
        val target = channel.targets.getOrNull(targetIdx)
        return ChatChannelSelection(
            type = channel.type,
            destinatarioRol = channel.destinatarioRol,
            destinoTipo = channel.destinoTipo,
            destinoId = target?.id ?: channel.fixedId,
            destinoLabel = target?.label ?: channel.fixedLabel,
            destinoSendId = target?.sendId ?: channel.fixedId
        )
    }

    private fun buildChannelDefs(
        currentUser: User,
        personalList: List<PersonalItem>,
        vehiculosList: List<VehiculoItem>
    ): List<ChannelDef> {
        val currentPersonalId = currentUser.id
            .takeIf { currentUser.tabla.equals("personal", ignoreCase = true) }
            ?.toString()
        val cuts = roleTargets(personalList, "CUT").filterNot { it.id == currentPersonalId }
        val cets = roleTargets(personalList, "CET").filterNot { it.id == currentPersonalId }
        val cells = roleTargets(personalList, "CELL").filterNot { it.id == currentPersonalId }
        val flotillas = flotillaTargets(personalList)
        val grupos = groupTargets(personalList)
        val vehiculos = vehicleTargets(vehiculosList)
        val currentPerson = personalList.firstOrNull {
            it.idPersonal.toString() == currentPersonalId
        }
        val assignedCetTargets = currentPerson?.let { person ->
            val byId = person.idCetRef?.toString()?.let { cetId ->
                cets.filter { it.id == cetId }
            }.orEmpty()
            if (byId.isNotEmpty()) byId else {
                val cetName = person.cetNombre.trim()
                cets.filter { cetName.isNotBlank() && it.label.equals(cetName, ignoreCase = true) }
            }
        }.orEmpty()
        val ownFlotilla = currentPerson?.let { flotillaTarget(it) }?.let(::listOf).orEmpty()
        val ownGroup = currentPerson?.let { groupTargets(listOf(it)) }.orEmpty()
        val ownVehicles = vehicleTargets(
            vehiculosList.filter { it.idPersonalAsignado?.toString() == currentPersonalId }
        )
        val companionCells = currentPerson?.let { person ->
            personalList
                .filter { candidate ->
                    candidate.rol.equals("CELL", ignoreCase = true) &&
                        candidate.idPersonal != person.idPersonal &&
                        when {
                            person.idGrupoOperacion != null ->
                                candidate.idGrupoOperacion == person.idGrupoOperacion
                            person.idGrupoPadre != null ->
                                candidate.idGrupoPadre == person.idGrupoPadre
                            person.cetFlotilla.isNotBlank() ->
                                candidate.cetFlotilla.equals(person.cetFlotilla, ignoreCase = true)
                            person.grupoPadreNombre.isNotBlank() ->
                                candidate.grupoPadreNombre.equals(person.grupoPadreNombre, ignoreCase = true)
                            else -> false
                        }
                }
                .map { TargetEntry(it.idPersonal.toString(), personName(it)) }
                .sortedBy { it.label }
        }.orEmpty()

        val rawDefs = when (currentUser.rol.name.uppercase()) {
            "CET" -> listOf(
                ChannelDef("GLOBAL", "Global", emptyList(), "GLOBAL", null),
                ChannelDef("CUT_SPECIFIC", "CUT", cuts, "CUT", "CUT"),
                ChannelDef("CETS", "Todos los CETs", emptyList(), "CET", "CETS", "ALL", "Todos los CETs"),
                ChannelDef("CET_SPECIFIC", "CET especifico", cets, "CET", "CET"),
                ChannelDef("CELL_SPECIFIC", "CELL especifico", cells, "CELL", "CELL"),
                ChannelDef("FLOTILLA", "Flotilla", flotillas, "CELL,CET", "FLOTILLA"),
                ChannelDef("GRUPO", "Grupo especifico", grupos, "CELL,CET", "GRUPO"),
                ChannelDef("VEHICULO", "Vehiculo", vehiculos, "CELL,CET", "CELL_LIST")
            )
            "CELL" -> listOf(
                ChannelDef("GLOBAL", "Global", emptyList(), "GLOBAL", null),
                ChannelDef("CUT_SPECIFIC", "CUT", cuts, "CUT", "CUT"),
                ChannelDef("CET_SPECIFIC", "CET asignado", assignedCetTargets, "CET", "CET"),
                ChannelDef("CELL_SPECIFIC", "Celulas asignadas", companionCells, "CELL", "CELL"),
                ChannelDef("FLOTILLA", "Mi flotilla", ownFlotilla, "CELL,CET", "FLOTILLA"),
                ChannelDef("GRUPO", "Mi grupo", ownGroup, "CELL,CET", "GRUPO"),
                ChannelDef("VEHICULO", "Mi vehiculo", ownVehicles, "CELL,CET", "CELL_LIST")
            )
            "CUT" -> listOf(
                ChannelDef("GLOBAL", "Global", emptyList(), "GLOBAL", null),
                ChannelDef("CETS", "Todos los CETs", emptyList(), "CET", "CETS", "ALL", "Todos los CETs"),
                ChannelDef("CET_SPECIFIC", "CET especifico", cets, "CET", "CET"),
                ChannelDef("CELL_SPECIFIC", "CELL especifico", cells, "CELL", "CELL"),
                ChannelDef("FLOTILLA", "Flotilla", flotillas, "CELL,CET", "FLOTILLA"),
                ChannelDef("GRUPO", "Grupo especifico", grupos, "CELL,CET", "GRUPO"),
                ChannelDef("VEHICULO", "Vehiculo", vehiculos, "CELL,CET", "CELL_LIST")
            )
            else -> listOf(ChannelDef("GLOBAL", "Global", emptyList(), "GLOBAL", null))
        }

        val groupChatTypes = setOf("GLOBAL", "CETS", "CUTS", "FLOTILLA", "GRUPO", "VEHICULO")
        return rawDefs
            .filter { it.fixedId != null || it.type == "GLOBAL" || it.targets.isNotEmpty() }
            .sortedBy { channel -> if (channel.type in groupChatTypes) 0 else 1 }
    }

    private fun openChannelPicker(
        anchorView: View,
        channelDefs: List<ChannelDef>,
        selectedChannel: ChannelDef,
        selectedTargetIdx: Int,
        onApplied: (ChannelDef, Int) -> Unit
    ) {
        val sheet = BottomSheetDialog(anchorView.context)
        val sheetView = host.getLayoutInflater().inflate(R.layout.sheet_channel_picker, null)
        val channelList = sheetView.findViewById<LinearLayout>(R.id.sheetChannelList)
        val sheetSpinner = sheetView.findViewById<Spinner>(R.id.sheetTargetSpinner)
        val applyBtn = sheetView.findViewById<Button>(R.id.sheetApplyBtn)
        val rows = mutableListOf<TextView>()

        var tempChannel = selectedChannel
        var tempTargetIdx = selectedTargetIdx

        fun refreshRows() = rows.forEachIndexed { index, row ->
            val selected = channelDefs[index].type == tempChannel.type
            row.setBackgroundColor(if (selected) Color.parseColor("#1e3a5f") else Color.TRANSPARENT)
            row.setTextColor(if (selected) Color.WHITE else Color.parseColor("#cbd5e1"))
            row.setTypeface(null, if (selected) Typeface.BOLD else Typeface.NORMAL)
        }

        fun refreshSheetSpinner() {
            val targets = tempChannel.targets
            if (targets.isEmpty()) {
                sheetSpinner.visibility = View.GONE
                return
            }

            sheetSpinner.adapter = makeSpinnerAdapter(anchorView, targets.map { it.label })
            sheetSpinner.setSelection(tempTargetIdx.coerceIn(0, targets.lastIndex))
            sheetSpinner.visibility = View.VISIBLE
        }

        sheetSpinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                tempTargetIdx = position
            }

            override fun onNothingSelected(parent: AdapterView<*>?) = Unit
        }

        channelDefs.forEach { channel ->
            val row = channelRow(anchorView, channel.label)
            row.setOnClickListener {
                tempChannel = channel
                tempTargetIdx = 0
                refreshRows()
                refreshSheetSpinner()
            }
            rows.add(row)
            channelList.addView(row)
        }

        refreshRows()
        refreshSheetSpinner()

        applyBtn.setOnClickListener {
            onApplied(tempChannel, tempTargetIdx)
            sheet.dismiss()
        }

        sheet.setContentView(sheetView)
        sheet.show()
    }

    private fun makeSpinnerAdapter(anchorView: View, items: List<String>) =
        object : ArrayAdapter<String>(anchorView.context, android.R.layout.simple_spinner_item, items) {
            private val txClr = Color.parseColor("#e2e8f0")
            private val bgClr = Color.parseColor("#1e293b")

            override fun getView(position: Int, convertView: View?, parent: ViewGroup): View =
                (super.getView(position, convertView, parent) as TextView).apply {
                    setTextColor(txClr)
                    setBackgroundColor(bgClr)
                }

            override fun getDropDownView(position: Int, convertView: View?, parent: ViewGroup): View =
                ((convertView as? TextView) ?: TextView(context)).apply {
                    text = getItem(position)
                    setTextColor(txClr)
                    setBackgroundColor(bgClr)
                    textSize = 14f
                    setPadding(32, 24, 32, 24)
                }
        }

    private fun channelRow(anchorView: View, label: String): TextView {
        val density = anchorView.context.resources.displayMetrics.density
        return TextView(anchorView.context).apply {
            text = label
            textSize = 14f
            setTextColor(Color.parseColor("#cbd5e1"))
            setPadding((16 * density).toInt(), (14 * density).toInt(), (16 * density).toInt(), (14 * density).toInt())
            isClickable = true
            isFocusable = true
            foreground = anchorView.context.obtainStyledAttributes(
                intArrayOf(android.R.attr.selectableItemBackground)
            ).getDrawable(0)
        }
    }

    private fun bindSendButton(
        input: EditText,
        sendBtn: ImageButton,
        send: (String, Boolean) -> Unit
    ) {
        sendBtn.setOnClickListener {
            val text = input.text.toString().trim()
            if (text.isNotEmpty()) {
                send(text, false)
                input.text.clear()
            }
        }

    }

    private fun bindAttachmentButtons(
        voiceBtn: ImageButton,
        attachmentBtn: ImageButton,
        request: (String) -> Unit
    ) {
        voiceBtn.setOnClickListener { request("voice") }
        attachmentBtn.setOnClickListener { showAttachmentDialog(attachmentBtn, request) }
    }

    private fun showAttachmentDialog(anchorView: View, request: (String) -> Unit) {
        val context = anchorView.context
        val density = context.resources.displayMetrics.density
        val sheet = BottomSheetDialog(context)

        val root = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            background = roundedDrawable(context, "#101A25", 26, "#294158", 1)
            setPadding(dp(density, 18), dp(density, 18), dp(density, 18), dp(density, 28))
        }

        root.addView(TextView(context).apply {
            text = "Adjuntar"
            setTextColor(Color.parseColor("#F1F7FA"))
            textSize = 17f
            typeface = Typeface.DEFAULT_BOLD
            setPadding(dp(density, 4), 0, 0, dp(density, 20))
        })

        data class AttachmentOption(
            val label: String,
            val source: String,
            val iconRes: Int,
            val color: String
        )

        val options = listOf(
            AttachmentOption("Galería", "gallery", R.drawable.ic_attach_gallery, "#64B5F6"),
            AttachmentOption("Cámara", "camera", R.drawable.ic_attach_camera, "#81C784"),
            AttachmentOption("Ubicación", "location", R.drawable.ic_attach_location, "#EF5350"),
            AttachmentOption("Archivo", "file", R.drawable.ic_attach_file, "#FFB74D")
        )

        val grid = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.TOP
        }
        options.forEach { option ->
            val iconColor = Color.parseColor(option.color)
            val item = LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_HORIZONTAL
                isClickable = true
                isFocusable = true
                setPadding(dp(density, 3), 0, dp(density, 3), dp(density, 6))
                setOnClickListener {
                    sheet.dismiss()
                    request(option.source)
                }
            }
            val iconCircle = FrameLayout(context).apply {
                background = roundedDrawable(
                    context,
                    "#294156",
                    34,
                    "#6E899E",
                    1
                )
            }
            iconCircle.addView(ImageView(context).apply {
                setImageResource(option.iconRes)
                imageTintList = android.content.res.ColorStateList.valueOf(iconColor)
                scaleType = ImageView.ScaleType.CENTER_INSIDE
                setPadding(dp(density, 17), dp(density, 17), dp(density, 17), dp(density, 17))
            }, FrameLayout.LayoutParams(dp(density, 68), dp(density, 68)))
            item.addView(iconCircle, LinearLayout.LayoutParams(dp(density, 68), dp(density, 68)))
            item.addView(TextView(context).apply {
                text = option.label
                gravity = Gravity.CENTER
                setTextColor(Color.parseColor("#E8F0F7"))
                textSize = 13f
                setPadding(0, dp(density, 10), 0, 0)
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            grid.addView(item, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        }
        root.addView(grid, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        sheet.setContentView(root)
        sheet.show()
        sheet.window?.setBackgroundDrawableResource(android.R.color.transparent)
        sheet.window?.navigationBarColor = Color.parseColor("#07111F")
        sheet.findViewById<FrameLayout>(com.google.android.material.R.id.design_bottom_sheet)?.apply {
            setBackgroundColor(Color.TRANSPARENT)
            backgroundTintList = android.content.res.ColorStateList.valueOf(Color.TRANSPARENT)
        }
    }

    private fun showGroupMembersDialog(
        anchorView: View,
        groupName: String,
        members: List<ChatGroupMember>,
        onMemberSelected: ((ChatGroupMember) -> Unit)?
    ) {
        val context = anchorView.context
        val density = context.resources.displayMetrics.density
        val sheet = BottomSheetDialog(context)

        val root = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0D1B2E"))
            setPadding(dp(density, 20), dp(density, 20), dp(density, 20), dp(density, 20))
        }

        root.addView(TextView(context).apply {
            text = groupName
            setTextColor(Color.parseColor("#F1F7FA"))
            textSize = 18f
            typeface = Typeface.DEFAULT_BOLD
            setPadding(0, 0, 0, dp(density, 4))
        })

        root.addView(TextView(context).apply {
            text = "${members.size} integrantes"
            setTextColor(Color.parseColor("#8FA3BD"))
            textSize = 12f
            setPadding(0, 0, 0, dp(density, 16))
        })

        val scroll = ScrollView(context).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }

        val list = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
        }

        members.forEach { member ->
            list.addView(LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
                setPadding(dp(density, 8), dp(density, 10), dp(density, 8), dp(density, 10))
                background = roundedDrawable(context, "#101F33", 8, "#274568", 1)
                isClickable = onMemberSelected != null
                isFocusable = onMemberSelected != null
                contentDescription = "Abrir chat privado con ${member.label}"
                if (onMemberSelected != null) {
                    foreground = context.obtainStyledAttributes(
                        intArrayOf(android.R.attr.selectableItemBackground)
                    ).let { attributes ->
                        attributes.getDrawable(0).also { attributes.recycle() }
                    }
                    setOnClickListener {
                        sheet.dismiss()
                        onMemberSelected(member)
                    }
                }
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply {
                    bottomMargin = dp(density, 4)
                }

                val initial = member.label.firstOrNull()?.uppercaseChar()?.toString() ?: "?"
                addView(TextView(context).apply {
                    text = initial
                    gravity = android.view.Gravity.CENTER
                    setTextColor(Color.parseColor("#93C5FD"))
                    textSize = 13f
                    typeface = Typeface.DEFAULT_BOLD
                    background = roundedDrawable(context, "#173A5E", 16, "#2F80C9", 1)
                    layoutParams = LinearLayout.LayoutParams(dp(density, 32), dp(density, 32)).apply {
                        rightMargin = dp(density, 10)
                    }
                })

                addView(TextView(context).apply {
                    text = member.label
                    setTextColor(Color.parseColor("#e2e8f0"))
                    textSize = 14f
                    maxLines = 1
                    ellipsize = android.text.TextUtils.TruncateAt.END
                })
            })
        }

        scroll.addView(list)
        root.addView(scroll)

        sheet.setContentView(root)
        sheet.show()
    }

    private fun dp(density: Float, value: Int): Int = (value * density).toInt()

    private fun roundedDrawable(
        context: android.content.Context,
        bgColor: String,
        radiusDp: Int,
        strokeColor: String? = null,
        strokeWidthDp: Int = 0
    ): GradientDrawable {
        val density = context.resources.displayMetrics.density
        return GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            setColor(Color.parseColor(bgColor))
            cornerRadius = radiusDp * density
            if (strokeColor != null && strokeWidthDp > 0) {
                setStroke((strokeWidthDp * density).toInt(), Color.parseColor(strokeColor))
            }
        }
    }

    private fun bindQuickReplies(
        view: View,
        send: (String, Boolean) -> Unit,
        input: EditText
    ) {
        val quickRepliesContainer = view.findViewById<LinearLayout>(R.id.quickRepliesContainer)
        listOf(
            "Recibido",
            "En camino",
            "Situacion controlada",
            "Zona despejada",
            "Solicito extraccion",
            "Apoyo necesario"
        ).forEach { text ->
            val chip = host.getLayoutInflater().inflate(R.layout.item_quick_reply, quickRepliesContainer, false)
            val tv = chip.findViewById<TextView>(R.id.replyText)
            tv.text = text
            if (text == "Apoyo necesario") {
                tv.setTextColor(Color.parseColor("#F87171"))
            }
            chip.setOnClickListener {
                send(text, text == "Apoyo necesario")
                input.text.clear()
            }
            quickRepliesContainer.addView(chip)
        }
    }

    private fun roleTargets(personalList: List<PersonalItem>, rol: String): List<TargetEntry> =
        personalList
            .filter { it.rol.equals(rol, ignoreCase = true) }
            .map { TargetEntry(it.idPersonal.toString(), personName(it)) }
            .sortedBy { it.label }

    private fun flotillaTargets(personalList: List<PersonalItem>): List<TargetEntry> =
        personalList
            .mapNotNull { flotillaTarget(it) }
            .filterNot { it.label.equals("GENERAL", ignoreCase = true) }
            .distinctBy { it.id.ifBlank { it.label.trim().lowercase() } }
            .sortedBy { it.label }

    private fun groupTargets(personalList: List<PersonalItem>): List<TargetEntry> =
        personalList
            .mapNotNull { person ->
                val padre = person.grupoPadreNombre.trim()
                val grupo = person.grupoNombre.trim()
                if (
                    grupo.isNotBlank() &&
                    padre.isNotBlank() &&
                    !padre.equals("Mando Operativo", ignoreCase = true)
                ) {
                    TargetEntry(person.idGrupoOperacion?.toString() ?: grupo, "$grupo ($padre)")
                } else {
                    null
                }
            }
            .distinctBy { it.id.ifBlank { it.label.trim().lowercase() } }
            .sortedBy { it.label }

    private fun vehicleTargets(vehiculosList: List<VehiculoItem>): List<TargetEntry> =
        vehiculosList
            .groupBy { it.idVehiculo }
            .mapNotNull { (idVehiculo, vehiculos) ->
                val occupantIds = vehiculos
                    .mapNotNull { it.idPersonalAsignado?.takeIf { id -> id > 0 }?.toString() }
                    .distinct()
                if (occupantIds.isEmpty()) return@mapNotNull null

                TargetEntry(
                    id = idVehiculo.toString(),
                    label = vehicleName(vehiculos.first()),
                    sendId = occupantIds.joinToString(",")
                )
            }
            .sortedBy { it.label }

    private fun flotillaTarget(person: PersonalItem): TargetEntry? {
        val padre = person.grupoPadreNombre.trim()
        val grupo = person.grupoNombre.trim()

        return when {
            person.cetFlotilla.isNotBlank() -> TargetEntry(
                person.idGrupoPadre?.toString() ?: person.cetFlotilla.trim(),
                person.cetFlotilla.trim()
            )
            padre.isNotBlank() && !padre.equals("Mando Operativo", ignoreCase = true) -> TargetEntry(
                person.idGrupoPadre?.toString() ?: padre,
                padre
            )
            grupo.isNotBlank() -> TargetEntry(
                person.idGrupoOperacion?.toString() ?: grupo,
                grupo
            )
            else -> null
        }
    }

    private fun personName(person: PersonalItem): String {
        val fullName = "${person.nombre} ${person.apellido}".trim()
        return fullName.ifBlank { person.apodo }
    }

    private fun vehicleName(vehicle: VehiculoItem): String {
        val codigo = vehicle.codigoInterno.trim()
        val alias = vehicle.alias.trim()
        val nombre = vehicle.nombre.trim()
        val tipo = vehicle.tipo.trim()

        return when {
            codigo.isNotBlank() && alias.isNotBlank() -> "$codigo - $alias"
            codigo.isNotBlank() -> codigo
            alias.isNotBlank() -> alias
            nombre.isNotBlank() -> nombre
            tipo.isNotBlank() -> tipo
            else -> "Vehiculo ${vehicle.idVehiculo}"
        }
    }
}
