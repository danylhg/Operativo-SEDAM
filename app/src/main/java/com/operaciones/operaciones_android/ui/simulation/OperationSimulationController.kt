package com.operaciones.operaciones_android.ui.simulation

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.widget.Toast
import com.operaciones.operaciones_android.model.EquipoItem
import com.operaciones.operaciones_android.model.Operation
import com.operaciones.operaciones_android.model.OperationStatus
import com.operaciones.operaciones_android.model.PersonalItem
import com.operaciones.operaciones_android.model.User
import com.operaciones.operaciones_android.model.VehiculoItem
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.text.Normalizer
import kotlin.math.cos
import kotlin.math.sin

class OperationSimulationController(
    private val context: Context,
    private val httpClient: OkHttpClient,
    private val host: Host,
    private val mainHandler: Handler = Handler(Looper.getMainLooper())
) {
    interface Host {
        fun getSimulationOperation(): Operation
        fun getSimulationUser(): User
        fun getSimulationPersonal(): List<PersonalItem>
        fun getSimulationVehiculos(): List<VehiculoItem>
        fun getSimulationEquipos(): List<EquipoItem>
        fun getSimulationOperationLat(): Double
        fun getSimulationOperationLon(): Double
        fun getSimulationLastKnownLat(): Double?
        fun getSimulationLastKnownLon(): Double?
        fun hasSimulationSocket(): Boolean
        fun fetchSimulationPersonal()
        fun fetchSimulationVehiculos()
        fun fetchSimulationEquipos()
        fun emitSimulationPersonalTracking(idPersonal: Int, lat: Double, lon: Double, apodo: String, rol: String)
        fun emitSimulationVehiculoTracking(idVehiculo: Int, lat: Double, lon: Double, alias: String)
        fun emitSimulationEquipoTracking(
            idEquipo: Int,
            lat: Double,
            lon: Double,
            label: String,
            categoria: String,
            tipoEquipo: String,
            numeroSerie: String,
            altitud: Double?,
            speedKmh: Double?,
            headingDegrees: Double?,
            accuracyMeters: Float?
        )
        fun isSimulationCesiumReady(): Boolean
        fun updateSimulationPersonalOnMap(idPersonal: Int, lat: Double, lon: Double, label: String)
        fun hideSimulationPersonalOnMap(idPersonal: Int)
        fun updateSimulationVehiculoOnMap(idVehiculo: Int, lat: Double, lon: Double, label: String)
        fun updateSimulationVehicleOccupants(idVehiculo: Int, occupants: List<PersonalItem>)
        fun updateSimulationEquipoOnMap(
            idEquipo: Int,
            lat: Double,
            lon: Double,
            label: String,
            categoria: String,
            tipoEquipo: String,
            numeroSerie: String,
            headingDegrees: Double?
        )
        fun updateSimulationPersonalPanel(idPersonal: Int, lat: Double, lon: Double)
        fun updateSimulationEquipoPanel(idEquipo: Int, lat: Double, lon: Double)
    }

    private data class SimulationRoutePoint(
        val lat: Double,
        val lon: Double
    )

    private data class SimulationRoutePlan(
        val idRoute: Int?,
        val vehicleId: Int?,
        val points: List<SimulationRoutePoint>,
        val distanceSq: Double
    )

    private data class SimulationVehicleGroup(
        val vehicle: VehiculoItem,
        val assignedPersonalIds: Set<Int>,
        val targets: List<PersonalItem>,
        val routePlan: SimulationRoutePlan?
    )

    private data class SimulationVehicleRuntime(
        val group: SimulationVehicleGroup,
        val homePoint: SimulationRoutePoint,
        var routePlan: SimulationRoutePlan?,
        var routeStartTick: Int? = null,
        var routeDeletedTick: Int? = null,
        var lastVehiclePoint: SimulationRoutePoint? = null,
        var returnVehiclePoint: SimulationRoutePoint? = null,
        val personToVehicleRoutes: MutableMap<Int, List<SimulationRoutePoint>> = mutableMapOf(),
        val personReturnRoutes: MutableMap<Int, List<SimulationRoutePoint>> = mutableMapOf(),
        var vehicleToRoutePoints: List<SimulationRoutePoint> = emptyList(),
        var vehicleReturnPoints: List<SimulationRoutePoint> = emptyList()
    )

    private var simulationRunnable: Runnable? = null
    private var simulationTick = 0
    private var simulationActive = false
    private val simulationRoutePoints = mutableListOf<SimulationRoutePoint>()
    private var simulationRouteStartTick: Int? = null
    private var simulationRouteDeletedTick: Int? = null
    private var simulationActiveRouteId: Int? = null
    private val simulationRoutesByVehicle = mutableMapOf<Int, SimulationRoutePlan>()
    private var simulationGlobalRoutePlan: SimulationRoutePlan? = null
    private val simulationPersonStartPoints = mutableMapOf<Int, SimulationRoutePoint>()
    private val simulationLastPersonPoints = mutableMapOf<Int, SimulationRoutePoint>()
    private val simulationReturnStartPersonPoints = mutableMapOf<Int, SimulationRoutePoint>()
    private var simulationLastVehiclePoint: SimulationRoutePoint? = null
    private var simulationReturnVehiclePoint: SimulationRoutePoint? = null
    private val simulationPersonToVehicleRoutes = mutableMapOf<Int, List<SimulationRoutePoint>>()
    private val simulationPersonReturnRoutes = mutableMapOf<Int, List<SimulationRoutePoint>>()
    private var simulationVehicleToRoutePoints: List<SimulationRoutePoint> = emptyList()
    private var simulationVehicleReturnPoints: List<SimulationRoutePoint> = emptyList()
    private var simulationVehicleStartPoint: SimulationRoutePoint? = null
    private val simulationVehicleRuntimes = mutableMapOf<Int, SimulationVehicleRuntime>()
    private var simulationRoutePlanGeneration = 0
    private var simulationTargetsSnapshot: List<PersonalItem> = emptyList()
    private var simulationVehicleTargetSnapshot: VehiculoItem? = null
    private var simulationRouteDistanceSq = Double.POSITIVE_INFINITY
    private val fallbackSimulationAnchorLat = 19.04497
    private val fallbackSimulationAnchorLon = -95.97219
    private val combiningMarksRegex = Regex("\\p{Mn}+")

    val isActive: Boolean
        get() = simulationActive

    fun canRun(): Boolean {
        val operation = host.getSimulationOperation()
        return operation.id > 0 && operation.status == OperationStatus.ACTIVA
    }

    fun toggle() {
        if (simulationActive) {
            stop()
            showToast("Simulacion detenida")
        } else {
            start()
        }
    }

    fun updateRoutesFromJson(routesJson: String) {
        try {
            val routes = JSONArray(routesJson)
            simulationRoutesByVehicle.clear()
            simulationGlobalRoutePlan = null

            for (i in 0 until routes.length()) {
                val route = routes.optJSONObject(i) ?: continue
                val plan = parseSimulationRoutePlan(route) ?: continue
                storeSimulationRoutePlan(plan)
            }

            if (simulationActive && simulationVehicleRuntimes.isNotEmpty()) {
                refreshSimulationRuntimeRoutePlans(resetTicks = true)
            } else {
                val activeVehicle = simulationVehicleTargetSnapshot
                if (activeVehicle != null) {
                    applySimulationRoutePlan(selectRoutePlanForVehicle(activeVehicle), resetTicks = true)
                } else {
                    applySimulationRoutePlan(selectDefaultRoutePlan(), resetTicks = true)
                }
            }
        } catch (e: Exception) {
            Log.w("SIMULATION", "No se pudo cargar ruta para simulacion: ${e.message}")
        }
    }

    fun updateRouteFromJson(routeJson: String) {
        try {
            val plan = parseSimulationRoutePlan(JSONObject(routeJson)) ?: return
            storeSimulationRoutePlan(plan)

            if (simulationActive && simulationVehicleRuntimes.isNotEmpty()) {
                refreshSimulationRuntimeRoutePlans(resetTicks = true)
            } else {
                val activeVehicle = simulationVehicleTargetSnapshot
                val shouldApply = when {
                    activeVehicle != null -> selectRoutePlanForVehicle(activeVehicle)?.idRoute == plan.idRoute
                    plan.vehicleId != null -> true
                    else -> plan.distanceSq <= simulationRouteDistanceSq
                }
                if (shouldApply) {
                    applySimulationRoutePlan(plan, resetTicks = true)
                }
            }
        } catch (e: Exception) {
            Log.w("SIMULATION", "No se pudo actualizar ruta para simulacion: ${e.message}")
        }
    }

    fun handleRouteDeleted(idRoute: Int = -1) {
        val deletedRouteId = idRoute.takeIf { it > 0 }
        if (deletedRouteId != null) {
            removeSimulationRoutePlan(deletedRouteId)
        }

        if (simulationActive && simulationVehicleRuntimes.isNotEmpty()) {
            val generation = ++simulationRoutePlanGeneration
            var handledByRuntime = false

            simulationVehicleRuntimes.values.forEach { runtime ->
                val routeMatches = deletedRouteId == null || runtime.routePlan?.idRoute == deletedRouteId
                if (!routeMatches) return@forEach

                val replacementPlan = selectRoutePlanForVehicle(runtime.group.vehicle)
                if (deletedRouteId != null && replacementPlan != null && replacementPlan.idRoute != deletedRouteId) {
                    runtime.routePlan = replacementPlan
                    runtime.routeStartTick = null
                    runtime.routeDeletedTick = null
                    runtime.returnVehiclePoint = null
                    prepareSimulationRuntimeActiveRouteLegs(runtime, generation)
                } else {
                    runtime.routePlan = null
                    prepareSimulationRuntimeReturnRouteLegs(runtime, generation)
                }
                handledByRuntime = true
            }

            if (handledByRuntime) return
        }

        if (deletedRouteId != null && deletedRouteId != simulationActiveRouteId) {
            return
        }

        val replacementPlan = simulationVehicleTargetSnapshot?.let { selectRoutePlanForVehicle(it) }
        if (replacementPlan != null && replacementPlan.idRoute != deletedRouteId) {
            applySimulationRoutePlan(replacementPlan, resetTicks = true)
            return
        }

        simulationRoutePoints.clear()
        simulationRouteDistanceSq = Double.POSITIVE_INFINITY
        simulationActiveRouteId = null
        simulationRouteStartTick = null
        if (simulationActive) {
            simulationRouteDeletedTick = simulationTick
            simulationReturnStartPersonPoints.clear()
            simulationReturnStartPersonPoints.putAll(simulationLastPersonPoints)
            simulationReturnVehiclePoint = simulationLastVehiclePoint
            prepareSimulationReturnRouteLegs()
        } else {
            simulationRouteDeletedTick = null
            simulationReturnStartPersonPoints.clear()
            simulationReturnVehiclePoint = null
            clearSimulationRouteLegs()
        }
    }

    fun stop() {
        simulationActive = false
        simulationRunnable?.let { mainHandler.removeCallbacks(it) }
        simulationRunnable = null
        simulationRouteStartTick = null
        simulationRouteDeletedTick = null
        simulationPersonStartPoints.clear()
        simulationLastPersonPoints.clear()
        simulationReturnStartPersonPoints.clear()
        simulationLastVehiclePoint = null
        simulationReturnVehiclePoint = null
        clearSimulationRouteLegs()
        simulationVehicleStartPoint = null
        simulationVehicleRuntimes.values.forEach { runtime ->
            host.updateSimulationVehicleOccupants(runtime.group.vehicle.idVehiculo, emptyList())
        }
        simulationVehicleRuntimes.clear()
        simulationTargetsSnapshot = emptyList()
        simulationVehicleTargetSnapshot = null
    }

    private fun start() {
        if (!canRun()) {
            showToast("La simulacion solo esta disponible en operaciones activas")
            return
        }

        if (!host.hasSimulationSocket()) {
            showToast("Socket no disponible para simulacion")
            return
        }

        val personalList = host.getSimulationPersonal()
        if (personalList.isEmpty()) {
            host.fetchSimulationPersonal()
            showToast("Cargando personal de la flotilla. Intenta de nuevo en unos segundos.")
            return
        }

        val vehiculosList = host.getSimulationVehiculos()
        if (vehiculosList.isEmpty()) {
            host.fetchSimulationVehiculos()
            showToast("Cargando vehiculos asignados. Intenta de nuevo en unos segundos.")
            return
        }

        if (host.getSimulationEquipos().isEmpty()) {
            host.fetchSimulationEquipos()
        }

        val vehicleGroups = buildSimulationVehicleGroups(personalList, vehiculosList)
        if (vehicleGroups.isEmpty()) {
            showToast("No se encontraron vehiculos asignados para simular.")
            return
        }

        val targets = vehicleGroups
            .flatMap { it.targets }
            .distinctBy { it.idPersonal }

        simulationTick = 0
        simulationRouteStartTick = null
        simulationRouteDeletedTick = null
        simulationLastPersonPoints.clear()
        simulationReturnStartPersonPoints.clear()
        simulationLastVehiclePoint = null
        simulationReturnVehiclePoint = null
        clearSimulationRouteLegs()
        simulationTargetsSnapshot = targets
        simulationVehicleTargetSnapshot = vehicleGroups.firstOrNull { it.routePlan != null }?.vehicle
            ?: vehicleGroups.first().vehicle
        simulationVehicleStartPoint = null
        prepareSimulationStartPoints(targets)

        simulationVehicleRuntimes.clear()
        vehicleGroups.forEachIndexed { index, group ->
            val trackedStart = coordinatePointOrNull(group.vehicle.lat, group.vehicle.lon)
            val routeStart = group.routePlan?.points?.firstOrNull()
            simulationVehicleRuntimes[group.vehicle.idVehiculo] = SimulationVehicleRuntime(
                group = group,
                homePoint = trackedStart ?: routeStart ?: simulationVehicleHomePoint(group.vehicle, index),
                routePlan = group.routePlan
            )
        }

        simulationActive = true
        refreshSimulationRuntimeRoutePlans(resetTicks = true)

        simulationRunnable?.let { mainHandler.removeCallbacks(it) }
        simulationRunnable = object : Runnable {
            override fun run() {
                emitSimulationPositions()
                simulationTick += 1
                if (simulationActive) mainHandler.postDelayed(this, 2500)
            }
        }
        simulationRunnable?.run()
        showToast("Simulacion activada: ${vehicleGroups.size} vehiculos, ${targets.size} personal")
    }

    private fun selectSimulationVehicleGroup(
        personalList: List<PersonalItem>,
        vehiculosList: List<VehiculoItem>
    ): SimulationVehicleGroup? {
        val groups = buildSimulationVehicleGroups(personalList, vehiculosList)
        val currentUserId = host.getSimulationUser().id
        val routedAssignedGroups = groups.filter {
            it.assignedPersonalIds.isNotEmpty() && it.routePlan?.vehicleId != null
        }

        return routedAssignedGroups.firstOrNull {
            currentUserId in it.assignedPersonalIds && it.targets.isNotEmpty()
        } ?: routedAssignedGroups.firstOrNull {
            it.targets.isNotEmpty()
        } ?: routedAssignedGroups.firstOrNull {
            currentUserId in it.assignedPersonalIds
        } ?: routedAssignedGroups.firstOrNull()
            ?: groups.firstOrNull { it.routePlan != null && it.targets.isNotEmpty() }
            ?: fallbackSimulationVehicleGroup(personalList, vehiculosList)
    }

    private fun buildSimulationVehicleGroups(
        personalList: List<PersonalItem>,
        vehiculosList: List<VehiculoItem>
    ): List<SimulationVehicleGroup> {
        val candidates = personalList.filter(::isSimulationCandidate)
        val routedVehicleIds = simulationRoutesByVehicle.keys.toSet()
        val rawGroups = vehiculosList
            .groupBy { it.idVehiculo }
            .values
            .mapNotNull { vehicleRows ->
                val vehicle = vehicleRows.firstOrNull() ?: return@mapNotNull null
                val assignedIds = vehicleRows.mapNotNull { it.idPersonalAsignado }.toSet()
                val targets = candidates.filter { person ->
                    person.idPersonal in assignedIds || vehicleMatchesPersonScope(vehicle, person)
                }.distinctBy { it.idPersonal }
                SimulationVehicleGroup(
                    vehicle = vehicle,
                    assignedPersonalIds = assignedIds,
                    targets = targets,
                    routePlan = selectRoutePlanForVehicle(vehicle)
                )
            }
            .let { groups ->
                if (routedVehicleIds.isEmpty()) {
                    groups
                } else {
                    groups.filter { it.vehicle.idVehiculo in routedVehicleIds }
                }
            }

        val orderedGroups = rawGroups.sortedWith(
            compareByDescending<SimulationVehicleGroup> { it.assignedPersonalIds.isNotEmpty() }
                .thenByDescending { it.routePlan != null }
                .thenBy { it.vehicle.idVehiculo }
        )
        val allocatedPersonalIds = mutableSetOf<Int>()
        val uniqueGroups = orderedGroups.map { group ->
            val uniqueTargets = group.targets.filter { allocatedPersonalIds.add(it.idPersonal) }
            group.copy(targets = uniqueTargets)
        }.toMutableList()

        if (routedVehicleIds.isNotEmpty()) {
            return uniqueGroups
        }

        val unassignedTargets = candidates.filter { it.idPersonal !in allocatedPersonalIds }

        if (unassignedTargets.isNotEmpty() && uniqueGroups.isNotEmpty()) {
            val currentUserId = host.getSimulationUser().id
            val fallbackIndex = uniqueGroups.indexOfFirst {
                currentUserId in it.assignedPersonalIds || it.targets.any { target -> target.idPersonal == currentUserId }
            }.takeIf { it >= 0 }
                ?: uniqueGroups.indexOfFirst { it.routePlan != null }.takeIf { it >= 0 }
                ?: 0
            val fallbackGroup = uniqueGroups[fallbackIndex]
            uniqueGroups[fallbackIndex] = fallbackGroup.copy(
                targets = (fallbackGroup.targets + unassignedTargets).distinctBy { it.idPersonal }
            )
        }

        return uniqueGroups
    }

    private fun vehicleMatchesPersonScope(vehicle: VehiculoItem, person: PersonalItem): Boolean {
        val destinationType = vehicle.tipoDestino.trim().uppercase()
        val vehicleGroup = vehicle.grupoNombre.trim()
        val vehicleParentGroup = vehicle.grupoPadreNombre.trim()
        val personGroup = person.grupoNombre.trim()
        val personParentGroup = person.grupoPadreNombre.trim()
        val personFleet = simulationFlotillaName(person)

        return when (destinationType) {
            "GRUPO" -> vehicleGroup.isNotBlank() &&
                (vehicleGroup.equals(personGroup, ignoreCase = true) ||
                    vehicleGroup.equals(personParentGroup, ignoreCase = true))
            "FLOTILLA" -> {
                val fleetName = vehicleParentGroup.ifBlank { vehicleGroup }
                fleetName.isNotBlank() && fleetName.equals(personFleet, ignoreCase = true)
            }
            else -> {
                vehicleGroup.isNotBlank() && vehicleGroup.equals(personGroup, ignoreCase = true) ||
                    vehicleParentGroup.isNotBlank() && vehicleParentGroup.equals(personFleet, ignoreCase = true)
            }
        }
    }

    private fun fallbackSimulationVehicleGroup(
        personalList: List<PersonalItem>,
        vehiculosList: List<VehiculoItem>
    ): SimulationVehicleGroup? {
        val vehicle = getSimulationVehicleTarget(vehiculosList) ?: return null
        return SimulationVehicleGroup(
            vehicle = vehicle,
            assignedPersonalIds = vehiculosList
                .filter { it.idVehiculo == vehicle.idVehiculo }
                .mapNotNull { it.idPersonalAsignado }
                .toSet(),
            targets = getSimulationTargets(personalList),
            routePlan = selectRoutePlanForVehicle(vehicle) ?: selectDefaultRoutePlan()
        )
    }

    private fun getSimulationTargets(personalList: List<PersonalItem>): List<PersonalItem> {
        val currentUser = host.getSimulationUser()
        val myRecord = personalList.firstOrNull { it.idPersonal == currentUser.id }
        val myFlotilla = myRecord?.let { simulationFlotillaName(it) }.orEmpty()

        val sameFlotilla = if (myFlotilla.isNotBlank()) {
            personalList.filter {
                simulationFlotillaName(it).equals(myFlotilla, ignoreCase = true) &&
                    isSimulationCandidate(it)
            }
        } else {
            emptyList()
        }

        return sameFlotilla.ifEmpty {
            personalList.filter(::isSimulationCandidate)
        }
    }

    private fun getSimulationVehicleTarget(vehiculosList: List<VehiculoItem>): VehiculoItem? =
        vehiculosList.firstOrNull { it.lat == null && it.lon == null } ?: vehiculosList.firstOrNull()

    private fun prepareSimulationStartPoints(targets: List<PersonalItem>) {
        simulationPersonStartPoints.clear()
        val anchor = simulationAnchorPoint()
        val radiusLat = 8.0 / 111_320.0
        val radiusLon = 8.0 / 104_500.0
        targets.forEachIndexed { index, person ->
            val angle = Math.PI * 2.0 * index / targets.size.coerceAtLeast(1)
            val personPoint = coordinatePointOrNull(person.lat, person.lon)
            simulationPersonStartPoints[person.idPersonal] = SimulationRoutePoint(
                lat = personPoint?.lat ?: (anchor.lat + sin(angle) * radiusLat),
                lon = personPoint?.lon ?: (anchor.lon + cos(angle) * radiusLon)
            )
        }
    }

    private fun isSimulationCandidate(person: PersonalItem): Boolean {
        val isOperationalRole =
            person.rol.equals("CELL", ignoreCase = true) ||
                person.rol.equals("CET", ignoreCase = true)
        if (!isOperationalRole) return false

        val isCurrentDevice = person.idPersonal == host.getSimulationUser().id
        val currentDeviceHasGps = isCurrentDevice &&
            host.getSimulationLastKnownLat() != null &&
            host.getSimulationLastKnownLon() != null

        return !currentDeviceHasGps
    }

    private fun simulationFlotillaName(person: PersonalItem): String {
        val parent = person.grupoPadreNombre.trim()
        val group = person.grupoNombre.trim()
        return when {
            person.cetFlotilla.isNotBlank() -> person.cetFlotilla.trim()
            parent.isNotBlank() && !parent.equals("Mando Operativo", ignoreCase = true) -> parent
            group.isNotBlank() -> group
            else -> ""
        }
    }

    private fun emitSimulationPositions() {
        val emittedEquipmentIds = mutableSetOf<Int>()
        simulationVehicleRuntimes.values.forEachIndexed { index, runtime ->
            emitSimulationRuntimePositions(runtime, index, emittedEquipmentIds)
        }
        emitUnanchoredSimulationEquipmentPositions(emittedEquipmentIds)
    }

    private fun emitSimulationRuntimePositions(
        runtime: SimulationVehicleRuntime,
        runtimeIndex: Int,
        emittedEquipmentIds: MutableSet<Int>
    ) {
        val routePoints = runtime.routePlan?.points.orEmpty()
        val hasRoute = routePoints.size >= 2
        if (hasRoute && runtime.routeStartTick == null) {
            runtime.routeStartTick = simulationTick
            if (runtime.personToVehicleRoutes.isEmpty() && runtime.vehicleToRoutePoints.isEmpty()) {
                prepareSimulationRuntimeActiveRouteLegs(runtime, simulationRoutePlanGeneration)
            }
        }

        val phaseTick = if (hasRoute) {
            simulationTick - (runtime.routeStartTick ?: simulationTick)
        } else {
            0
        }
        val vehicleStart = runtime.homePoint
        val routeStart = routePoints.firstOrNull() ?: vehicleStart
        val personToVehicleTicks = if (runtime.group.targets.isEmpty()) {
            0
        } else {
            simulationMaxRouteTickCount(runtime.personToVehicleRoutes.values)
        }
        val vehicleToRouteRoute = runtime.vehicleToRoutePoints.ifEmpty {
            fallbackSimulationRoute(vehicleStart, routeStart)
        }
        val vehicleToRouteTicks = simulationRouteTickCount(vehicleToRouteRoute)
        val vehicleReturnStart = runtime.returnVehiclePoint ?: runtime.lastVehiclePoint ?: vehicleStart
        val vehicleReturnRoute = runtime.vehicleReturnPoints.ifEmpty {
            fallbackSimulationRoute(vehicleReturnStart, vehicleStart)
        }
        val vehicleReturnTicks = simulationRouteTickCount(vehicleReturnRoute)
        val personReturnTicks = if (runtime.group.targets.isEmpty()) {
            0
        } else {
            simulationMaxRouteTickCount(runtime.personReturnRoutes.values)
        }
        val isReturning = !hasRoute && runtime.routeDeletedTick != null
        val returnTick = simulationTick - (runtime.routeDeletedTick ?: simulationTick)
        val vehiclePosition = when {
            isReturning && returnTick < vehicleReturnTicks ->
                simulationRoutePointAtTick(vehicleReturnRoute, returnTick, vehicleStart)
            isReturning -> vehicleStart
            !hasRoute -> vehicleStart
            phaseTick < personToVehicleTicks -> vehicleStart
            phaseTick < personToVehicleTicks + vehicleToRouteTicks ->
                simulationRoutePointAtTick(
                    points = vehicleToRouteRoute,
                    tick = phaseTick - personToVehicleTicks,
                    fallback = routeStart
                )
            else -> {
                val routeTick = phaseTick - personToVehicleTicks - vehicleToRouteTicks
                routePoints[routeTick.coerceIn(0, routePoints.lastIndex)]
            }
        }
        val vehicleLat = vehiclePosition.lat
        val vehicleLon = vehiclePosition.lon
        val targets = runtime.group.targets
        val groupRadiusLat = 1.6 / 111_320.0
        val groupRadiusLon = 1.6 / 104_500.0
        val phase = simulationTick * 0.22 + runtimeIndex * 0.37
        val personPositions = mutableMapOf<Int, SimulationRoutePoint>()
        val peopleInsideVehicle = (hasRoute && phaseTick >= personToVehicleTicks) ||
            (isReturning && returnTick < vehicleReturnTicks)
        host.updateSimulationVehicleOccupants(
            runtime.group.vehicle.idVehiculo,
            if (peopleInsideVehicle) targets else emptyList()
        )

        targets.forEachIndexed { index, person ->
            val baseAngle = Math.PI * 2.0 * index / targets.size.coerceAtLeast(1)
            val angle = if (
                isReturning ||
                (hasRoute && phaseTick >= personToVehicleTicks + vehicleToRouteTicks)
            ) {
                baseAngle + phase
            } else {
                baseAngle
            }
            val groupedPoint = SimulationRoutePoint(
                lat = vehicleLat + sin(angle) * groupRadiusLat,
                lon = vehicleLon + cos(angle) * groupRadiusLon
            )
            val startPoint = simulationPersonStartPoints[person.idPersonal] ?: groupedPoint
            val personPosition = if (isReturning) {
                if (returnTick < vehicleReturnTicks) {
                    groupedPoint
                } else if (returnTick - vehicleReturnTicks < personReturnTicks) {
                    val personReturnRoute = runtime.personReturnRoutes[person.idPersonal].orEmpty()
                        .ifEmpty { fallbackSimulationRoute(vehicleStart, startPoint) }
                    simulationRoutePointAtTick(
                        points = personReturnRoute,
                        tick = returnTick - vehicleReturnTicks,
                        fallback = startPoint
                    )
                } else {
                    val orbitRadiusLat = 1.4 / 111_320.0
                    val orbitRadiusLon = 1.4 / 104_500.0
                    SimulationRoutePoint(
                        lat = startPoint.lat + sin(baseAngle + phase) * orbitRadiusLat,
                        lon = startPoint.lon + cos(baseAngle + phase) * orbitRadiusLon
                    )
                }
            } else if (!hasRoute) {
                startPoint
            } else if (phaseTick < personToVehicleTicks) {
                val personToVehicleRoute = runtime.personToVehicleRoutes[person.idPersonal].orEmpty()
                    .ifEmpty { fallbackSimulationRoute(startPoint, vehicleStart) }
                simulationRoutePointAtTick(
                    points = personToVehicleRoute,
                    tick = phaseTick,
                    fallback = groupedPoint
                )
            } else {
                groupedPoint
            }
            val lat = personPosition.lat
            val lon = personPosition.lon
            simulationLastPersonPoints[person.idPersonal] = personPosition
            personPositions[person.idPersonal] = personPosition
            val name = person.apodo.ifBlank { "${person.nombre} ${person.apellido}".trim() }
                .ifBlank { "Personal ${person.idPersonal}" }

            host.emitSimulationPersonalTracking(
                idPersonal = person.idPersonal,
                lat = lat,
                lon = lon,
                apodo = name,
                rol = person.rol
            )

            if (host.isSimulationCesiumReady() && peopleInsideVehicle) {
                host.hideSimulationPersonalOnMap(person.idPersonal)
            } else if (host.isSimulationCesiumReady()) {
                host.updateSimulationPersonalOnMap(person.idPersonal, lat, lon, name)
            }
            host.updateSimulationPersonalPanel(person.idPersonal, lat, lon)
        }

        val vehicleName = vehicleDisplayName(runtime.group.vehicle)
        runtime.lastVehiclePoint = vehiclePosition
        host.emitSimulationVehiculoTracking(
            idVehiculo = runtime.group.vehicle.idVehiculo,
            lat = vehicleLat,
            lon = vehicleLon,
            alias = vehicleName
        )

        if (host.isSimulationCesiumReady()) {
            host.updateSimulationVehiculoOnMap(runtime.group.vehicle.idVehiculo, vehicleLat, vehicleLon, vehicleName)
        }

        emitSimulationEquipmentPositions(
            runtime = runtime,
            runtimeIndex = runtimeIndex,
            vehiclePosition = vehiclePosition,
            personPositions = personPositions,
            emittedEquipmentIds = emittedEquipmentIds
        )
    }

    private fun emitSimulationEquipmentPositions(
        runtime: SimulationVehicleRuntime,
        runtimeIndex: Int,
        vehiclePosition: SimulationRoutePoint,
        personPositions: Map<Int, SimulationRoutePoint>,
        emittedEquipmentIds: MutableSet<Int>
    ) {
        host.getSimulationEquipos()
            .asSequence()
            .filter { it.idEquipo > 0 && isSimulationEquipment(it) }
            .forEach { equipo ->
                if (equipo.idEquipo in emittedEquipmentIds) return@forEach
                val base = equipmentBasePoint(
                    equipo = equipo,
                    runtime = runtime,
                    runtimeIndex = runtimeIndex,
                    vehiclePosition = vehiclePosition,
                    personPositions = personPositions
                ) ?: return@forEach

                emittedEquipmentIds.add(equipo.idEquipo)
                emitSimulationEquipmentAtBase(equipo, base, runtimeIndex)
            }
    }

    private fun emitUnanchoredSimulationEquipmentPositions(emittedEquipmentIds: MutableSet<Int>) {
        host.getSimulationEquipos()
            .asSequence()
            .filter { it.idEquipo > 0 && isSimulationEquipment(it) }
            .forEachIndexed { index, equipo ->
                if (equipo.idEquipo in emittedEquipmentIds) return@forEachIndexed
                val base = coordinatePointOrNull(equipo.lat, equipo.lon)
                    ?: coordinatePointOrNull(host.getSimulationLastKnownLat(), host.getSimulationLastKnownLon())
                    ?: simulationAnchorPoint()
                emittedEquipmentIds.add(equipo.idEquipo)
                emitSimulationEquipmentAtBase(equipo, base, index)
            }
    }

    private fun emitSimulationEquipmentAtBase(
        equipo: EquipoItem,
        base: SimulationRoutePoint,
        runtimeIndex: Int
    ) {
        val drone = isDroneEquipment(equipo)
        val point = equipmentPoint(equipo, base, drone, runtimeIndex)
        val label = equipmentDisplayName(equipo)
        val heading = ((simulationTick * 11 + equipo.idEquipo * 23) % 360).toDouble()
        val altitude = if (drone) {
            85.0 + (equipo.idEquipo % 4) * 12.0 + sin(simulationTick * 0.25 + equipo.idEquipo) * 6.0
        } else {
            null
        }

        host.emitSimulationEquipoTracking(
            idEquipo = equipo.idEquipo,
            lat = point.lat,
            lon = point.lon,
            label = label,
            categoria = equipo.categoria,
            tipoEquipo = equipo.tipoEquipo,
            numeroSerie = equipo.numeroSerie,
            altitud = altitude,
            speedKmh = if (drone) 22.0 else 0.0,
            headingDegrees = heading,
            accuracyMeters = if (drone) 6f else 3f
        )

        if (host.isSimulationCesiumReady()) {
            host.updateSimulationEquipoOnMap(
                idEquipo = equipo.idEquipo,
                lat = point.lat,
                lon = point.lon,
                label = label,
                categoria = equipo.categoria,
                tipoEquipo = equipo.tipoEquipo,
                numeroSerie = equipo.numeroSerie,
                headingDegrees = heading
            )
        }
        host.updateSimulationEquipoPanel(equipo.idEquipo, point.lat, point.lon)
    }

    private fun equipmentBasePoint(
        equipo: EquipoItem,
        runtime: SimulationVehicleRuntime,
        runtimeIndex: Int,
        vehiclePosition: SimulationRoutePoint,
        personPositions: Map<Int, SimulationRoutePoint>
    ): SimulationRoutePoint? {
        equipo.idPersonalAsignado?.let { idPersonal ->
            personPositions[idPersonal]?.let { return it }
            if (idPersonal == host.getSimulationUser().id) {
                coordinatePointOrNull(
                    host.getSimulationLastKnownLat(),
                    host.getSimulationLastKnownLon()
                )?.let { return it }
            }
            return null
        }

        equipo.idVehiculoAsignado?.let { idVehiculo ->
            return if (idVehiculo == runtime.group.vehicle.idVehiculo) vehiclePosition else null
        }

        val destinationType = normalizeSimulationText(equipo.tipoDestino).uppercase()
        return when (destinationType) {
            "PERSONAL", "VEHICULO" -> null
            "GRUPO", "FLOTILLA" -> if (equipmentMatchesRuntimeScope(equipo, runtime)) vehiclePosition else null
            else -> when {
                equipmentMatchesRuntimeScope(equipo, runtime) -> vehiclePosition
                runtimeIndex == 0 -> vehiclePosition
                else -> null
            }
        }
    }

    private fun equipmentMatchesRuntimeScope(
        equipo: EquipoItem,
        runtime: SimulationVehicleRuntime
    ): Boolean {
        val equipmentGroups = (equipo.gruposVinculados + equipo.grupoAsignado)
            .map(::normalizeSimulationText)
            .filter { it.isNotBlank() }
            .toSet()
        val equipmentFleets = (equipo.flotillasVinculadas + equipo.flotillaAsignada)
            .map(::normalizeSimulationText)
            .filter { it.isNotBlank() }
            .toSet()
        if (equipmentGroups.isEmpty() && equipmentFleets.isEmpty()) return false

        val runtimeGroups = (
            listOf(runtime.group.vehicle.grupoNombre) +
                runtime.group.targets.map { it.grupoNombre }
            )
            .map(::normalizeSimulationText)
            .filter { it.isNotBlank() }
            .toSet()
        val runtimeFleets = (
            listOf(runtime.group.vehicle.grupoPadreNombre) +
                runtime.group.targets.map { simulationFlotillaName(it) }
            )
            .map(::normalizeSimulationText)
            .filter { it.isNotBlank() }
            .toSet()

        return equipmentGroups.any { it in runtimeGroups } || equipmentFleets.any { it in runtimeFleets }
    }

    private fun equipmentPoint(
        equipo: EquipoItem,
        base: SimulationRoutePoint,
        drone: Boolean,
        runtimeIndex: Int
    ): SimulationRoutePoint {
        val phase = simulationTick * if (drone) 0.34 else 0.18
        val angle = phase + equipo.idEquipo * 0.73 + runtimeIndex * 0.41
        val meters = if (drone) {
            24.0 + (equipo.idEquipo % 5) * 4.0
        } else {
            1.2 + (equipo.idEquipo % 3) * 0.4
        }
        return SimulationRoutePoint(
            lat = base.lat + sin(angle) * (meters / 111_320.0),
            lon = base.lon + cos(angle) * (meters / 104_500.0)
        )
    }

    private fun isSimulationEquipment(equipo: EquipoItem): Boolean {
        val category = normalizeSimulationText(equipo.categoria)
        return category.contains("comunicacion") ||
            category.contains("tactico") ||
            isDroneEquipment(equipo)
    }

    private fun isDroneEquipment(equipo: EquipoItem): Boolean {
        val text = normalizeSimulationText(
            listOf(equipo.categoria, equipo.tipoEquipo, equipo.nombre, equipo.numeroSerie)
                .joinToString(" ")
        )
        return listOf("dron", "drone", "uav", "matrice", "dji").any { text.contains(it) }
    }

    private fun equipmentDisplayName(equipo: EquipoItem): String =
        equipo.nombre.ifBlank { equipo.tipoEquipo }
            .ifBlank { equipo.numeroSerie }
            .ifBlank { "Equipo ${equipo.idEquipo}" }

    private fun normalizeSimulationText(value: String): String =
        Normalizer.normalize(value.trim(), Normalizer.Form.NFD)
            .replace(combiningMarksRegex, "")
            .lowercase()

    private fun emitSimulationPositions(
        targets: List<PersonalItem>,
        vehicleTarget: VehiculoItem
    ) {
        val routePoints = simulationRoutePoints.toList()
        val hasRoute = routePoints.size >= 2
        if (hasRoute && simulationRouteStartTick == null) {
            simulationRouteStartTick = simulationTick
            if (simulationPersonToVehicleRoutes.isEmpty() && simulationVehicleToRoutePoints.isEmpty()) {
                prepareSimulationActiveRouteLegs()
            }
        }
        val phaseTick = if (hasRoute) {
            simulationTick - (simulationRouteStartTick ?: simulationTick)
        } else {
            0
        }
        val vehicleStart = simulationVehicleStartPoint ?: simulationVehicleHomePoint(vehicleTarget)
        val routeStart = routePoints.firstOrNull() ?: vehicleStart
        val personToVehicleTicks = simulationMaxRouteTickCount(simulationPersonToVehicleRoutes.values)
        val vehicleToRouteRoute = simulationVehicleToRoutePoints.ifEmpty {
            fallbackSimulationRoute(vehicleStart, routeStart)
        }
        val vehicleToRouteTicks = simulationRouteTickCount(vehicleToRouteRoute)
        val vehicleReturnStart = simulationReturnVehiclePoint ?: simulationLastVehiclePoint ?: vehicleStart
        val vehicleReturnRoute = simulationVehicleReturnPoints.ifEmpty {
            fallbackSimulationRoute(vehicleReturnStart, vehicleStart)
        }
        val vehicleReturnTicks = simulationRouteTickCount(vehicleReturnRoute)
        val personReturnTicks = simulationMaxRouteTickCount(simulationPersonReturnRoutes.values)
        val isReturning = !hasRoute && simulationRouteDeletedTick != null
        val returnTick = simulationTick - (simulationRouteDeletedTick ?: simulationTick)
        val vehiclePosition = when {
            isReturning && returnTick < vehicleReturnTicks ->
                simulationRoutePointAtTick(vehicleReturnRoute, returnTick, vehicleStart)
            isReturning -> vehicleStart
            !hasRoute -> vehicleStart
            phaseTick < personToVehicleTicks -> vehicleStart
            phaseTick < personToVehicleTicks + vehicleToRouteTicks ->
                simulationRoutePointAtTick(
                    points = vehicleToRouteRoute,
                    tick = phaseTick - personToVehicleTicks,
                    fallback = routeStart
                )
            else -> {
                val routeTick = phaseTick - personToVehicleTicks - vehicleToRouteTicks
                routePoints[routeTick.coerceIn(0, routePoints.lastIndex)]
            }
        }
        val vehicleLat = vehiclePosition.lat
        val vehicleLon = vehiclePosition.lon
        val groupRadiusLat = 1.6 / 111_320.0
        val groupRadiusLon = 1.6 / 104_500.0
        val phase = simulationTick * 0.22

        targets.forEachIndexed { index, person ->
            val baseAngle = Math.PI * 2.0 * index / targets.size.coerceAtLeast(1)
            val angle = if (
                isReturning ||
                (hasRoute && phaseTick >= personToVehicleTicks + vehicleToRouteTicks)
            ) {
                baseAngle + phase
            } else {
                baseAngle
            }
            val groupedPoint = SimulationRoutePoint(
                lat = vehicleLat + sin(angle) * groupRadiusLat,
                lon = vehicleLon + cos(angle) * groupRadiusLon
            )
            val startPoint = simulationPersonStartPoints[person.idPersonal] ?: groupedPoint
            val personPosition = if (isReturning) {
                if (returnTick < vehicleReturnTicks) {
                    groupedPoint
                } else if (returnTick - vehicleReturnTicks < personReturnTicks) {
                    val personReturnRoute = simulationPersonReturnRoutes[person.idPersonal].orEmpty()
                        .ifEmpty { fallbackSimulationRoute(vehicleStart, startPoint) }
                    simulationRoutePointAtTick(
                        points = personReturnRoute,
                        tick = returnTick - vehicleReturnTicks,
                        fallback = startPoint
                    )
                } else {
                    val orbitRadiusLat = 1.4 / 111_320.0
                    val orbitRadiusLon = 1.4 / 104_500.0
                    SimulationRoutePoint(
                        lat = startPoint.lat + sin(baseAngle + phase) * orbitRadiusLat,
                        lon = startPoint.lon + cos(baseAngle + phase) * orbitRadiusLon
                    )
                }
            } else if (!hasRoute) {
                startPoint
            } else if (phaseTick < personToVehicleTicks) {
                val personToVehicleRoute = simulationPersonToVehicleRoutes[person.idPersonal].orEmpty()
                    .ifEmpty { fallbackSimulationRoute(startPoint, vehicleStart) }
                simulationRoutePointAtTick(
                    points = personToVehicleRoute,
                    tick = phaseTick,
                    fallback = groupedPoint
                )
            } else {
                groupedPoint
            }
            val lat = personPosition.lat
            val lon = personPosition.lon
            simulationLastPersonPoints[person.idPersonal] = personPosition
            val name = person.apodo.ifBlank { "${person.nombre} ${person.apellido}".trim() }
                .ifBlank { "Personal ${person.idPersonal}" }

            host.emitSimulationPersonalTracking(
                idPersonal = person.idPersonal,
                lat = lat,
                lon = lon,
                apodo = name,
                rol = person.rol
            )

            if (host.isSimulationCesiumReady()) {
                host.updateSimulationPersonalOnMap(person.idPersonal, lat, lon, name)
            }
            host.updateSimulationPersonalPanel(person.idPersonal, lat, lon)
        }

        val vehicleName = vehicleDisplayName(vehicleTarget)
        simulationLastVehiclePoint = vehiclePosition
        host.emitSimulationVehiculoTracking(
            idVehiculo = vehicleTarget.idVehiculo,
            lat = vehicleLat,
            lon = vehicleLon,
            alias = vehicleName
        )

        if (host.isSimulationCesiumReady()) {
            host.updateSimulationVehiculoOnMap(vehicleTarget.idVehiculo, vehicleLat, vehicleLon, vehicleName)
        }
    }

    private fun vehicleDisplayName(vehicle: VehiculoItem): String =
        vehicle.alias.ifBlank { vehicle.codigoInterno }
            .ifBlank { vehicle.nombre }
            .ifBlank { "Vehiculo ${vehicle.idVehiculo}" }

    private fun parseSimulationRoutePlan(route: JSONObject): SimulationRoutePlan? {
        val points = parseSimulationRoutePoints(route)
        if (points.size < 2) return null
        return SimulationRoutePlan(
            idRoute = positiveJsonInt(route, "id_ruta"),
            vehicleId = positiveJsonInt(route, "id_vehiculo")
                ?: positiveJsonInt(route, "id_vehiculo_asignado")
                ?: positiveJsonInt(route, "vehiculo_id"),
            points = points,
            distanceSq = routeDistanceToSimulationAnchorSq(points)
        )
    }

    private fun storeSimulationRoutePlan(plan: SimulationRoutePlan) {
        val vehicleId = plan.vehicleId
        if (vehicleId != null) {
            simulationRoutesByVehicle[vehicleId] = plan
            return
        }

        val currentGlobal = simulationGlobalRoutePlan
        if (currentGlobal == null || plan.distanceSq <= currentGlobal.distanceSq) {
            simulationGlobalRoutePlan = plan
        }
    }

    private fun removeSimulationRoutePlan(idRoute: Int) {
        simulationRoutesByVehicle.entries.removeAll { it.value.idRoute == idRoute }
        if (simulationGlobalRoutePlan?.idRoute == idRoute) {
            simulationGlobalRoutePlan = null
        }
    }

    private fun selectRoutePlanForVehicle(vehicle: VehiculoItem): SimulationRoutePlan? =
        simulationRoutesByVehicle[vehicle.idVehiculo] ?: simulationGlobalRoutePlan

    private fun selectDefaultRoutePlan(): SimulationRoutePlan? =
        simulationRoutesByVehicle.values.minByOrNull { it.distanceSq } ?: simulationGlobalRoutePlan

    private fun applySimulationRoutePlan(plan: SimulationRoutePlan?, resetTicks: Boolean) {
        simulationRoutePoints.clear()
        simulationRouteDistanceSq = Double.POSITIVE_INFINITY
        simulationActiveRouteId = null
        if (plan != null) {
            simulationRoutePoints.addAll(plan.points)
            simulationRouteDistanceSq = plan.distanceSq
            simulationActiveRouteId = plan.idRoute
        }

        if (resetTicks) {
            simulationRouteStartTick = null
            simulationRouteDeletedTick = null
            simulationReturnStartPersonPoints.clear()
            simulationReturnVehiclePoint = null
        }

        if (simulationActive) {
            if (simulationRoutePoints.size >= 2) {
                prepareSimulationActiveRouteLegs()
            } else {
                clearSimulationRouteLegs()
            }
        }
    }

    private fun routeDistanceToSimulationAnchorSq(points: List<SimulationRoutePoint>): Double {
        if (points.isEmpty()) return Double.POSITIVE_INFINITY
        val anchor = simulationAnchorPoint()
        var best = Double.POSITIVE_INFINITY
        points.forEach { point ->
            val dLat = point.lat - anchor.lat
            val dLon = point.lon - anchor.lon
            val distanceSq = dLat * dLat + dLon * dLon
            if (distanceSq < best) best = distanceSq
        }
        return best
    }

    private fun simulationAnchorPoint(): SimulationRoutePoint {
        val operation = host.getSimulationOperation()
        coordinatePointOrNull(operation.zonaLat, operation.zonaLon)?.let { return it }
        coordinatePointOrNull(host.getSimulationOperationLat(), host.getSimulationOperationLon())?.let { return it }
        simulationRoutesByVehicle.values.firstOrNull()?.points?.firstOrNull()?.let { return it }
        simulationGlobalRoutePlan?.points?.firstOrNull()?.let { return it }
        simulationRoutePoints.firstOrNull()?.let { return it }

        host.getSimulationPersonal().forEach { person ->
            coordinatePointOrNull(person.lat, person.lon)?.let { return it }
        }

        host.getSimulationVehiculos().forEach { vehiculo ->
            coordinatePointOrNull(vehiculo.lat, vehiculo.lon)?.let { return it }
        }

        return SimulationRoutePoint(
            lat = fallbackSimulationAnchorLat,
            lon = fallbackSimulationAnchorLon
        )
    }

    private fun coordinatePointOrNull(lat: Double?, lon: Double?): SimulationRoutePoint? {
        if (lat == null || lon == null) return null
        if (lat !in -90.0..90.0 || lon !in -180.0..180.0) return null
        if (lat == 0.0 && lon == 0.0) return null
        return SimulationRoutePoint(lat = lat, lon = lon)
    }

    private fun parseSimulationRoutePoints(route: JSONObject): List<SimulationRoutePoint> {
        val geojsonValue = when {
            route.has("geojson") -> route.opt("geojson")
            route.has("geometria") -> route.opt("geometria")
            else -> null
        }
        val geojson = when (geojsonValue) {
            is JSONObject -> geojsonValue
            is String -> JSONObject(geojsonValue)
            else -> return emptyList()
        }
        val coords = geojson.optJSONArray("coordinates") ?: return emptyList()
        val points = mutableListOf<SimulationRoutePoint>()
        for (i in 0 until coords.length()) {
            val coord = coords.optJSONArray(i) ?: continue
            if (coord.length() < 2) continue
            points.add(
                SimulationRoutePoint(
                    lat = coord.optDouble(1),
                    lon = coord.optDouble(0)
                )
            )
        }
        return points
    }

    private fun positiveJsonInt(json: JSONObject, key: String): Int? {
        if (!json.has(key) || json.isNull(key)) return null
        return json.optInt(key, 0).takeIf { it > 0 }
    }

    private fun clearSimulationRouteLegs() {
        simulationRoutePlanGeneration += 1
        simulationPersonToVehicleRoutes.clear()
        simulationPersonReturnRoutes.clear()
        simulationVehicleToRoutePoints = emptyList()
        simulationVehicleReturnPoints = emptyList()
        simulationVehicleRuntimes.values.forEach { runtime ->
            runtime.personToVehicleRoutes.clear()
            runtime.personReturnRoutes.clear()
            runtime.vehicleToRoutePoints = emptyList()
            runtime.vehicleReturnPoints = emptyList()
        }
    }

    private fun simulationDefaultVehicleStartPoint(
        vehicle: VehiculoItem? = null,
        offsetIndex: Int = 0
    ): SimulationRoutePoint {
        val seed = (vehicle?.idVehiculo ?: (offsetIndex + 1)).coerceAtLeast(1)
        val angle = Math.PI * 2.0 * ((seed + offsetIndex) % 12) / 12.0
        val vehicleStartDistanceM = 65.0 + ((seed + offsetIndex) % 5) * 18.0
        val anchor = simulationAnchorPoint()
        return SimulationRoutePoint(
            lat = anchor.lat + sin(angle) * (vehicleStartDistanceM / 111_320.0),
            lon = anchor.lon + cos(angle) * (vehicleStartDistanceM / 104_500.0)
        )
    }

    private fun simulationVehicleHomePoint(
        vehicle: VehiculoItem? = simulationVehicleTargetSnapshot,
        offsetIndex: Int = 0
    ): SimulationRoutePoint {
        val point = coordinatePointOrNull(vehicle?.lat, vehicle?.lon)
        return if (point != null) {
            point
        } else {
            val legacyStart = if (vehicle == simulationVehicleTargetSnapshot && offsetIndex == 0) {
                simulationVehicleStartPoint
            } else {
                null
            }
            legacyStart ?: simulationDefaultVehicleStartPoint(vehicle, offsetIndex)
        }
    }

    private fun fallbackSimulationRoute(
        from: SimulationRoutePoint,
        to: SimulationRoutePoint
    ): List<SimulationRoutePoint> = listOf(from, to)

    private fun normalizeSimulationRoute(
        from: SimulationRoutePoint,
        to: SimulationRoutePoint,
        points: List<SimulationRoutePoint>
    ): List<SimulationRoutePoint> {
        if (points.isEmpty()) return fallbackSimulationRoute(from, to)
        val normalized = mutableListOf<SimulationRoutePoint>()
        normalized.add(from)
        normalized.addAll(points)
        normalized.add(to)
        return normalized
    }

    private fun simulationRoutePointAtTick(
        points: List<SimulationRoutePoint>,
        tick: Int,
        fallback: SimulationRoutePoint
    ): SimulationRoutePoint {
        if (points.isEmpty()) return fallback
        return points[tick.coerceIn(0, points.lastIndex)]
    }

    private fun simulationRouteTickCount(points: List<SimulationRoutePoint>): Int =
        points.size.coerceAtLeast(2)

    private fun simulationMaxRouteTickCount(routes: Collection<List<SimulationRoutePoint>>): Int =
        routes.maxOfOrNull { simulationRouteTickCount(it) } ?: 2

    private fun refreshSimulationRuntimeRoutePlans(resetTicks: Boolean) {
        if (simulationVehicleRuntimes.isEmpty()) return
        val generation = ++simulationRoutePlanGeneration
        simulationVehicleRuntimes.values.forEach { runtime ->
            runtime.routePlan = selectRoutePlanForVehicle(runtime.group.vehicle)
            if (resetTicks) {
                runtime.routeStartTick = null
                runtime.routeDeletedTick = null
                runtime.returnVehiclePoint = null
            }
            prepareSimulationRuntimeActiveRouteLegs(runtime, generation)
        }

        val defaultPlan = selectDefaultRoutePlan()
        simulationRoutePoints.clear()
        simulationRouteDistanceSq = Double.POSITIVE_INFINITY
        simulationActiveRouteId = null
        if (defaultPlan != null) {
            simulationRoutePoints.addAll(defaultPlan.points)
            simulationRouteDistanceSq = defaultPlan.distanceSq
            simulationActiveRouteId = defaultPlan.idRoute
        }
    }

    private fun prepareSimulationRuntimeActiveRouteLegs(
        runtime: SimulationVehicleRuntime,
        generation: Int
    ) {
        val routeStart = runtime.routePlan?.points?.firstOrNull()
        runtime.personToVehicleRoutes.clear()
        runtime.personReturnRoutes.clear()
        runtime.vehicleReturnPoints = emptyList()
        runtime.vehicleToRoutePoints = emptyList()
        if (routeStart == null) return

        val vehicleHome = runtime.homePoint
        runtime.vehicleToRoutePoints = fallbackSimulationRoute(vehicleHome, routeStart)
        runtime.group.targets.forEach { person ->
            val personStart = simulationPersonStartPoints[person.idPersonal] ?: vehicleHome
            runtime.personToVehicleRoutes[person.idPersonal] =
                fallbackSimulationRoute(personStart, vehicleHome)
            requestSimulationOsrmRoute(
                from = personStart,
                to = vehicleHome,
                generation = generation
            ) { points ->
                runtime.personToVehicleRoutes[person.idPersonal] = points
            }
        }

        requestSimulationOsrmRoute(
            from = vehicleHome,
            to = routeStart,
            generation = generation
        ) { points ->
            runtime.vehicleToRoutePoints = points
        }
    }

    private fun prepareSimulationRuntimeReturnRouteLegs(
        runtime: SimulationVehicleRuntime,
        generation: Int
    ) {
        val vehicleHome = runtime.homePoint
        val vehicleReturnStart = runtime.returnVehiclePoint ?: runtime.lastVehiclePoint ?: vehicleHome
        runtime.routeStartTick = null
        runtime.routeDeletedTick = simulationTick
        runtime.returnVehiclePoint = vehicleReturnStart
        runtime.personToVehicleRoutes.clear()
        runtime.vehicleToRoutePoints = emptyList()
        runtime.personReturnRoutes.clear()
        runtime.vehicleReturnPoints = fallbackSimulationRoute(vehicleReturnStart, vehicleHome)

        requestSimulationOsrmRoute(
            from = vehicleReturnStart,
            to = vehicleHome,
            generation = generation
        ) { points ->
            runtime.vehicleReturnPoints = points
        }

        runtime.group.targets.forEach { person ->
            val personHome = simulationPersonStartPoints[person.idPersonal] ?: vehicleHome
            runtime.personReturnRoutes[person.idPersonal] =
                fallbackSimulationRoute(vehicleHome, personHome)
            requestSimulationOsrmRoute(
                from = vehicleHome,
                to = personHome,
                generation = generation
            ) { points ->
                runtime.personReturnRoutes[person.idPersonal] = points
            }
        }
    }

    private fun prepareSimulationActiveRouteLegs() {
        val routeStart = simulationRoutePoints.firstOrNull() ?: return
        val vehicleHome = simulationVehicleHomePoint()
        val generation = ++simulationRoutePlanGeneration

        simulationPersonToVehicleRoutes.clear()
        simulationPersonReturnRoutes.clear()
        simulationVehicleReturnPoints = emptyList()
        simulationVehicleToRoutePoints = fallbackSimulationRoute(vehicleHome, routeStart)

        simulationTargetsSnapshot.forEach { person ->
            val personStart = simulationPersonStartPoints[person.idPersonal] ?: vehicleHome
            simulationPersonToVehicleRoutes[person.idPersonal] =
                fallbackSimulationRoute(personStart, vehicleHome)
            requestSimulationOsrmRoute(
                from = personStart,
                to = vehicleHome,
                generation = generation
            ) { points ->
                simulationPersonToVehicleRoutes[person.idPersonal] = points
            }
        }

        requestSimulationOsrmRoute(
            from = vehicleHome,
            to = routeStart,
            generation = generation
        ) { points ->
            simulationVehicleToRoutePoints = points
        }
    }

    private fun prepareSimulationReturnRouteLegs() {
        val vehicleHome = simulationVehicleHomePoint()
        val vehicleReturnStart = simulationReturnVehiclePoint ?: simulationLastVehiclePoint ?: vehicleHome
        val generation = ++simulationRoutePlanGeneration

        simulationPersonToVehicleRoutes.clear()
        simulationVehicleToRoutePoints = emptyList()
        simulationPersonReturnRoutes.clear()
        simulationVehicleReturnPoints = fallbackSimulationRoute(vehicleReturnStart, vehicleHome)

        requestSimulationOsrmRoute(
            from = vehicleReturnStart,
            to = vehicleHome,
            generation = generation
        ) { points ->
            simulationVehicleReturnPoints = points
        }

        simulationTargetsSnapshot.forEach { person ->
            val personHome = simulationPersonStartPoints[person.idPersonal] ?: vehicleHome
            simulationPersonReturnRoutes[person.idPersonal] =
                fallbackSimulationRoute(vehicleHome, personHome)
            requestSimulationOsrmRoute(
                from = vehicleHome,
                to = personHome,
                generation = generation
            ) { points ->
                simulationPersonReturnRoutes[person.idPersonal] = points
            }
        }
    }

    private fun requestSimulationOsrmRoute(
        from: SimulationRoutePoint,
        to: SimulationRoutePoint,
        generation: Int,
        onRoute: (List<SimulationRoutePoint>) -> Unit
    ) {
        val fallback = fallbackSimulationRoute(from, to)
        val url = "https://router.project-osrm.org/route/v1/driving/" +
            "${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson"
        val request = Request.Builder().url(url).get().build()

        httpClient.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                Log.w("SIMULATION", "OSRM no disponible para simulacion: ${e.message}")
                mainHandler.post {
                    if (simulationActive && generation == simulationRoutePlanGeneration) {
                        onRoute(fallback)
                    }
                }
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    val body = it.body?.string().orEmpty()
                    val points = if (it.isSuccessful) {
                        try {
                            parseOsrmRoutePoints(body)
                        } catch (e: Exception) {
                            Log.w("SIMULATION", "Respuesta OSRM invalida: ${e.message}")
                            emptyList()
                        }
                    } else {
                        Log.w("SIMULATION", "OSRM rechazo ruta de simulacion: ${it.code}")
                        emptyList()
                    }
                    val route = normalizeSimulationRoute(from, to, points)
                    mainHandler.post {
                        if (simulationActive && generation == simulationRoutePlanGeneration) {
                            onRoute(route)
                        }
                    }
                }
            }
        })
    }

    private fun parseOsrmRoutePoints(body: String): List<SimulationRoutePoint> {
        if (body.isBlank()) return emptyList()
        val routes = JSONObject(body).optJSONArray("routes") ?: return emptyList()
        val geometry = routes.optJSONObject(0)?.optJSONObject("geometry") ?: return emptyList()
        val coordinates = geometry.optJSONArray("coordinates") ?: return emptyList()
        val points = mutableListOf<SimulationRoutePoint>()
        for (i in 0 until coordinates.length()) {
            val coord = coordinates.optJSONArray(i) ?: continue
            if (coord.length() < 2) continue
            val lon = coord.optDouble(0)
            val lat = coord.optDouble(1)
            if (lat.isNaN() || lon.isNaN()) continue
            points.add(SimulationRoutePoint(lat = lat, lon = lon))
        }
        return points
    }

    private fun showToast(message: String) {
        Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
    }
}
