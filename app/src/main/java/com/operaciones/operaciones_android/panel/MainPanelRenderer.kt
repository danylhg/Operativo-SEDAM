package com.operaciones.operaciones_android.ui.panel

import android.view.LayoutInflater
import android.widget.EditText
import android.widget.FrameLayout
import androidx.recyclerview.widget.RecyclerView
import com.operaciones.operaciones_android.model.ChatMessage
import com.operaciones.operaciones_android.model.DispositivoItem
import com.operaciones.operaciones_android.model.EquipoItem
import com.operaciones.operaciones_android.model.Operation
import com.operaciones.operaciones_android.model.PersonalItem
import com.operaciones.operaciones_android.model.PoiItem
import com.operaciones.operaciones_android.model.User
import com.operaciones.operaciones_android.model.VehiculoItem
import com.operaciones.operaciones_android.ui.adapter.ChatAdapter
import java.io.File

data class ChatChannelSelection(
    val type: String,
    val destinatarioRol: String,
    val destinoTipo: String? = null,
    val chatId: Int? = null,
    val destinoId: String? = null,
    val destinoLabel: String? = null,
    val destinoSendId: String? = null
)

data class ChatGroupMember(
    val id: String,
    val label: String,
    val role: String
)

data class ChatPanelRefs(
    val recyclerView: RecyclerView,
    val adapter: ChatAdapter,
    val input: EditText
)

class MainPanelRenderer(
    private val host: Host
) {
    private val operationRenderer = OperationPanelRenderer(host)
    private val chatRenderer = ChatPanelRenderer(host)
    private val personalRenderer = PersonalPanelRenderer(host)
    private val vehicleRenderer = VehiclePanelRenderer(host)
    private val equipmentRenderer = EquipmentPanelRenderer(host)
    private val deviceRenderer = DevicePanelRenderer(host)
    private val resourcesRenderer = ResourcesPanelRenderer(host)

    interface Host {
        fun getLayoutInflater(): LayoutInflater
        fun addMessage(msg: ChatMessage)
        fun openChatPanel()
        fun sendChatMessage(
            text: String,
            alert: Boolean = false,
            destinatarioRol: String? = null,
            destinoTipo: String? = null,
            destinoId: String? = null,
            destinoLabel: String? = null
        )
        fun requestChatAttachment(
            source: String,
            destinatarioRol: String? = null,
            destinoTipo: String? = null,
            destinoId: String? = null,
            destinoLabel: String? = null
        )
        fun forwardChatAttachment(file: File, destinations: List<ChatChannelSelection>, sourceMessage: ChatMessage, attachmentKind: String = "VIDEO")
        fun forwardChatMessages(messages: List<ChatMessage>, destinations: List<ChatChannelSelection>)
        fun startVoiceCall(selection: ChatChannelSelection)
        fun shouldShowSimulationButton(): Boolean
        fun isSimulationActive(): Boolean
        fun toggleSimulation()
        fun selectPersonalOnMap(idPersonal: Int, lat: Double, lon: Double, label: String)
        fun selectVehiculoOnMap(idVehiculo: Int, lat: Double?, lon: Double?, label: String)
        fun selectEquipoOnMap(idEquipo: Int, lat: Double?, lon: Double?, label: String)
        fun selectDispositivoOnMap(idDispositivo: Int, lat: Double?, lon: Double?, label: String)
        fun selectPoiOnMap(idPoi: Int, lat: Double, lon: Double, label: String)
        fun deletePoi(idPoi: Int, label: String)
        fun refreshPersonalPanelIfActive()
    }

    fun selectPersonal(idPersonal: Int?) {
        personalRenderer.selectPersonal(idPersonal)
        resourcesRenderer.selectPersonal(idPersonal)
    }

    fun selectVehiculo(idVehiculo: Int?) {
        vehicleRenderer.selectVehiculo(idVehiculo)
        resourcesRenderer.selectVehiculo(idVehiculo)
    }

    fun selectEquipo(idEquipo: Int?) {
        equipmentRenderer.selectEquipo(idEquipo)
        resourcesRenderer.selectEquipo(idEquipo)
    }

    fun selectDispositivo(idDispositivo: Int?) {
        deviceRenderer.selectDispositivo(idDispositivo)
        resourcesRenderer.selectDispositivo(idDispositivo)
    }

    fun updatePersonalLocation(id: Int, lat: Double, lon: Double) {
        personalRenderer.updatePersonalLocation(id, lat, lon)
        resourcesRenderer.updatePersonalLocation(id, lat, lon)
    }

    fun updateVehiculoLocation(id: Int, lat: Double, lon: Double) {
        vehicleRenderer.updateVehiculoLocation(id, lat, lon)
        resourcesRenderer.updateVehiculoLocation(id, lat, lon)
    }

    fun updateEquipoLocation(id: Int, lat: Double, lon: Double) {
        equipmentRenderer.updateEquipoLocation(id, lat, lon)
        resourcesRenderer.updateEquipoLocation(id, lat, lon)
    }

    fun updateDispositivoLocation(
        id: Int,
        lat: Double,
        lon: Double,
        numeroSerie: String? = null,
        imei: String? = null
    ) {
        deviceRenderer.updateDispositivoLocation(id, lat, lon, numeroSerie, imei)
        resourcesRenderer.updateDispositivoLocation(id, lat, lon)
    }

    fun inflateOperationPanel(
        panelContent: FrameLayout,
        operation: Operation
    ) {
        operationRenderer.inflate(panelContent, operation)
    }

    fun inflateChatPanel(
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
    ): ChatPanelRefs =
        chatRenderer.inflate(
            panelContent, messages, currentUser, personalList, vehiculosList,
            initialSelection, onFilterChanged,
            headerTitle = headerTitle,
            headerSubtitle = headerSubtitle,
            isGroup = isGroup,
            groupMembers = groupMembers,
            onGroupMemberSelected = onGroupMemberSelected,
            onBack = onBack
        )

    fun inflateChatWorkspace(
        panelContent: FrameLayout,
        messages: MutableList<ChatMessage>,
        currentUser: User,
        personalList: List<PersonalItem>,
        vehiculosList: List<VehiculoItem>,
        initialSelection: ChatChannelSelection? = null,
        onContactSelected: (ChatChannelSelection) -> Unit,
        onFilterChanged: (ChatChannelSelection) -> Unit = {}
    ): ChatPanelRefs =
        chatRenderer.inflateWorkspace(
            panelContent,
            messages,
            currentUser,
            personalList,
            vehiculosList,
            initialSelection,
            onContactSelected,
            onFilterChanged
        )

    fun inflateChatContacts(
        panelContent: FrameLayout,
        currentUser: User,
        personalList: List<PersonalItem>,
        vehiculosList: List<VehiculoItem>,
        onBack: () -> Unit,
        unreadCountFor: (ChatChannelSelection) -> Int = { 0 },
        lastMessageFor: (ChatChannelSelection) -> String = { "Sin mensajes todavía" },
        onContactSelected: (ChatChannelSelection) -> Unit
    ) {
        chatRenderer.inflateContacts(
            panelContent, currentUser, personalList, vehiculosList,
            onBack, unreadCountFor, lastMessageFor, onContactSelected
        )
    }

    fun inflatePersonalPanel(
        panelContent: FrameLayout,
        personalList: List<PersonalItem>,
        currentUser: User
    ) {
        personalRenderer.inflate(panelContent, personalList, currentUser)
    }

    fun inflateResourcesPanel(
        panelContent: FrameLayout,
        personalList: List<PersonalItem>,
        vehiculosList: List<VehiculoItem>,
        equiposList: List<EquipoItem>,
        dispositivosList: List<DispositivoItem>,
        currentUser: User,
        poisList: List<PoiItem> = emptyList()
    ) {
        resourcesRenderer.inflate(panelContent, personalList, vehiculosList, equiposList, dispositivosList, currentUser, poisList)
    }

    fun inflateVehiculoPanel(
        panelContent: FrameLayout,
        vehiculosList: List<VehiculoItem>
    ) {
        vehicleRenderer.inflate(panelContent, vehiculosList)
    }

    fun inflateEquipoPanel(
        panelContent: FrameLayout,
        equiposList: List<EquipoItem>
    ) {
        equipmentRenderer.inflate(panelContent, equiposList)
    }

    fun inflateDispositivoPanel(
        panelContent: FrameLayout,
        dispositivosList: List<DispositivoItem>
    ) {
        deviceRenderer.inflate(panelContent, dispositivosList)
    }
}
