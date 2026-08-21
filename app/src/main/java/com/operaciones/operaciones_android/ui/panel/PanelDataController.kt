package com.operaciones.operaciones_android.ui.panel

import com.operaciones.operaciones_android.model.DispositivoItem
import com.operaciones.operaciones_android.model.EquipoItem
import com.operaciones.operaciones_android.model.PersonalItem
import com.operaciones.operaciones_android.model.VehiculoItem
import com.operaciones.operaciones_android.network.DispositivoRepository
import com.operaciones.operaciones_android.network.EquipoRepository
import com.operaciones.operaciones_android.network.PersonalRepository
import com.operaciones.operaciones_android.network.VehiculoRepository

class PanelDataController(
    private val host: Host,
    private val personalRepository: PersonalRepository = PersonalRepository(),
    private val vehiculoRepository: VehiculoRepository = VehiculoRepository(),
    private val equipoRepository: EquipoRepository = EquipoRepository(),
    private val dispositivoRepository: DispositivoRepository = DispositivoRepository()
) {
    interface Host {
        fun getPanelDataOperationId(): Int
        fun getPanelDataToken(): String
        fun runPanelDataOnUi(block: () -> Unit)
        fun onPanelPersonalLoaded(items: List<PersonalItem>)
        fun onPanelVehiculosLoaded(items: List<VehiculoItem>)
        fun onPanelEquiposLoaded(items: List<EquipoItem>)
        fun onPanelDispositivosLoaded(items: List<DispositivoItem>)
        fun onPanelDataError(message: String)
    }

    fun fetchPersonal() {
        personalRepository.fetchPersonal(
            operationId = host.getPanelDataOperationId(),
            token = host.getPanelDataToken(),
            onSuccess = { items ->
                host.runPanelDataOnUi {
                    host.onPanelPersonalLoaded(items)
                }
            },
            onError = { message ->
                host.runPanelDataOnUi {
                    host.onPanelDataError(message)
                }
            }
        )
    }

    fun fetchVehiculos() {
        vehiculoRepository.fetchVehiculos(
            operationId = host.getPanelDataOperationId(),
            token = host.getPanelDataToken(),
            onSuccess = { items ->
                host.runPanelDataOnUi {
                    host.onPanelVehiculosLoaded(items)
                }
            },
            onError = { message ->
                host.runPanelDataOnUi {
                    host.onPanelDataError(message)
                }
            }
        )
    }

    fun fetchEquipos() {
        equipoRepository.fetchEquipos(
            operationId = host.getPanelDataOperationId(),
            token = host.getPanelDataToken(),
            onSuccess = { items ->
                host.runPanelDataOnUi {
                    host.onPanelEquiposLoaded(items)
                }
            },
            onError = { message ->
                host.runPanelDataOnUi {
                    host.onPanelDataError(message)
                }
            }
        )
    }

    fun fetchDispositivos() {
        dispositivoRepository.fetchDispositivos(
            operationId = host.getPanelDataOperationId(),
            token = host.getPanelDataToken(),
            onSuccess = { items ->
                host.runPanelDataOnUi {
                    host.onPanelDispositivosLoaded(items)
                }
            },
            onError = { message ->
                host.runPanelDataOnUi {
                    host.onPanelDataError(message)
                }
            }
        )
    }
}
