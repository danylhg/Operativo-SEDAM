import { state } from "../../core/state.js";
import { getEquiposAsignadosPorCategoria, getDestinoFormateado } from "./equipos.service.js";

export function getEquipoListByCategoria(categoria) {
  if (categoria === "tactico") return state.tacticalEquipmentList;
  if (categoria === "comunicacion") return state.communicationEquipmentList;
  return [];
}

export function getEquipoAssignmentsBucket(categoria) {
  return getEquiposAsignadosPorCategoria(categoria);
}

export function formatEquipoAsignado(idEquipo) {
  const asignacion = state.asignacionEquipos.find(a => a.id_equipo === idEquipo);
  return getDestinoFormateado(asignacion);
}
