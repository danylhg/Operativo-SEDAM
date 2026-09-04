import { state } from "../../core/state.js";
import { saveAsignacionActual } from "../asignacion/asignacion.service.js";

// BACKEND: asignarVehiculo() se vuelve async con POST /ops/:id/vehiculos
// Recibe id_vehiculo, tipo_destino ('personal' o 'grupo'), id_personal o id_grupo_operacion
export function asignarVehiculo(idVehiculo, tipoDestino, idPersonal = null, idGrupoOperacion = null) {
  // Validar capacidad
  const vehObj = state.vehiclesList.find(v => v.id === idVehiculo);
  if (!vehObj) throw new Error("Vehículo no encontrado");

  // Si es asignación a grupo y no viene idPersonal, intentamos buscar el responsable (CET)
  if (tipoDestino === 'grupo' && !idPersonal && idGrupoOperacion) {
    // Intentar encontrar el CET asociado a este grupo
    // En el estado actual, esto es complejo de forma directa, pero
    // por ahora el backend hace el fallback al id_cet si enviamos null.
    // Sin embargo, para consistencia lo dejamos explícito si podemos.
  }

  const used = state.asignacionVehiculos.filter(a => a.id_vehiculo === idVehiculo).length;
  const cap = Number(vehObj.capacity || 0);
  if (cap > 0 && used >= cap) throw new Error("Capacidad insuficiente");

  // Verificar si ya está asignado
  const existing = state.asignacionVehiculos.find(a =>
    a.tipo_destino === tipoDestino &&
    ((tipoDestino === 'personal' && a.id_personal === idPersonal) ||
     (tipoDestino === 'grupo' && a.id_grupo_operacion === idGrupoOperacion))
  );
  if (existing) throw new Error("Ya tiene vehículo asignado");

  // Agregar asignación
  state.asignacionVehiculos.push({
    id_vehiculo: idVehiculo,
    tipo_destino: tipoDestino,
    id_personal: idPersonal, // Puede ser null si el backend hace el fallback
    id_grupo_operacion: idGrupoOperacion
  });

  console.log("[VEHÍCULOS] asignacionVehiculos →", JSON.stringify(state.asignacionVehiculos, null, 2));
  saveAsignacionActual();
}

// BACKEND: removerAsignacionVehiculo() se vuelve async con DELETE /ops/:id/vehiculos/:asignacionId
export function removerAsignacionVehiculo(idVehiculo, tipoDestino, idPersonal = null, idGrupoOperacion = null) {
  const index = state.asignacionVehiculos.findIndex(a =>
    a.id_vehiculo === idVehiculo &&
    a.tipo_destino === tipoDestino &&
    ((tipoDestino === 'personal' && a.id_personal === idPersonal) ||
     (tipoDestino === 'grupo' && a.id_grupo_operacion === idGrupoOperacion))
  );

  if (index > -1) {
    state.asignacionVehiculos.splice(index, 1);
    console.log("[VEHÍCULOS] asignacionVehiculos (tras remover) →", JSON.stringify(state.asignacionVehiculos, null, 2));
    saveAsignacionActual();
  }
}

// Obtener asignaciones por CET o célula
// key formato: "NOMBRE_CET" (para el CET) o "NOMBRE_CET-NOMBRE_CELULA"
export function getAsignacionVehiculoPorKey(key) {
  const separador = key.indexOf('-');
  const cet    = separador === -1 ? key : key.slice(0, separador);
  const celula = separador === -1 ? null : key.slice(separador + 1);

  const nombre  = celula || cet;
  const idPersonal = state.personalMap[nombre];
  if (!idPersonal) return null;

  return state.asignacionVehiculos.find(a =>
    a.tipo_destino === 'personal' && a.id_personal === idPersonal
  );
}

// Obtener nombre del vehículo asignado (para compatibilidad)
export function getNombreVehiculoAsignado(key) {
  const asignacion = getAsignacionVehiculoPorKey(key);
  if (!asignacion) return null;
  const veh = state.vehiclesList.find(v => v.id === asignacion.id_vehiculo);
  return veh?.name || null;
}