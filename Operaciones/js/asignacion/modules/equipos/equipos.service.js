import { state } from "../../core/state.js";
import { saveAsignacionActual } from "../asignacion/asignacion.service.js";

// BACKEND: asignarEquipo() se vuelve async con POST /ops/:id/equipos
// Recibe id_equipo, tipo_destino ('personal' o 'vehiculo'), id_personal o id_vehiculo, categoria
export function asignarEquipo(idEquipo, tipoDestino, idPersonal = null, idVehiculo = null, categoria) {
  // Verificar si ya está asignado
  const existing = state.asignacionEquipos.find(a =>
    a.id_equipo === idEquipo &&
    a.tipo_destino === tipoDestino &&
    ((tipoDestino === 'personal' && a.id_personal === idPersonal) ||
     (tipoDestino === 'vehiculo' && a.id_vehiculo === idVehiculo))
  );
  if (existing) throw new Error("Equipo ya asignado");

  // Agregar asignación
  state.asignacionEquipos.push({
    id_equipo: idEquipo,
    tipo_destino: tipoDestino,
    id_personal: idPersonal,
    id_vehiculo: idVehiculo,
    categoria: categoria
  });

  console.log("[EQUIPOS] asignacionEquipos →", JSON.stringify(state.asignacionEquipos, null, 2));
  saveAsignacionActual();
}

// BACKEND: removerAsignacionEquipo() se vuelve async con DELETE /ops/:id/equipos/:asignacionId
export function removerAsignacionEquipo(idEquipo, tipoDestino, idPersonal = null, idVehiculo = null) {
  const index = state.asignacionEquipos.findIndex(a =>
    a.id_equipo === idEquipo &&
    a.tipo_destino === tipoDestino &&
    ((tipoDestino === 'personal' && a.id_personal === idPersonal) ||
     (tipoDestino === 'vehiculo' && a.id_vehiculo === idVehiculo))
  );

  if (index > -1) {
    state.asignacionEquipos.splice(index, 1);
    console.log("[EQUIPOS] asignacionEquipos (tras remover) →", JSON.stringify(state.asignacionEquipos, null, 2));
    saveAsignacionActual();
  }
}

// Obtener asignaciones por equipo (para compatibilidad)
export function getAsignacionEquipo(idEquipo) {
  return state.asignacionEquipos.find(a => a.id_equipo === idEquipo);
}

// Obtener equipos asignados por categoria
export function getEquiposAsignadosPorCategoria(categoria) {
  return state.asignacionEquipos.filter(a => a.categoria === categoria);
}

// Obtener destino formateado (para compatibilidad)
export function getDestinoFormateado(asignacion) {
  if (!asignacion) return "Disponible";
  
  if (asignacion.tipo_destino === 'personal') {
    // 1. Obtener el nombre de la persona (la CELULA) a partir del ID
    let personaNombre = null;
    for (const [nombre, id] of Object.entries(state.personalMap)) {
      if (id === asignacion.id_personal) {
        personaNombre = nombre;
        break;
      }
    }

    if (!personaNombre) return "Personal desconocido";

    // Si la persona es CUT
    if (state.cutSeleccionado === personaNombre) return personaNombre;

    // Si la persona es un CET
    if (state.cetSeleccionados.includes(personaNombre)) return personaNombre;

    // Buscar el CET responsable de esa célula
    for (const cet of state.cetSeleccionados) {
      const celulas = state.asignacionCelulas[cet] || [];
      if (celulas.includes(personaNombre)) {
        return personaNombre;
      }
    }

    return personaNombre;

  } else if (asignacion.tipo_destino === 'vehiculo') {
    const veh = state.vehiclesList.find(v => v.id === asignacion.id_vehiculo);
    return veh ? `Vehículo: ${veh.name}` : "Vehículo desconocido";
  }
  
  return "Asignado";
}
