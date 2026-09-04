import { state } from "../../core/state.js";
import { saveAsignacionActual } from "../asignacion/asignacion.service.js";
import { getPersonDisplayName } from "../personal/personal.helpers.js";

export function asignarDispositivo(idDispositivo, idPersonal) {
  const existing = state.asignacionDispositivos.find(a =>
    a.id_dispositivo === idDispositivo &&
    a.id_personal === idPersonal
  );

  if (existing) throw new Error("Dispositivo ya asignado a esa persona");

  state.asignacionDispositivos.push({
    id_dispositivo: idDispositivo,
    id_personal: idPersonal
  });

  saveAsignacionActual();
}

export function removerAsignacionDispositivo(idDispositivo) {
  const index = state.asignacionDispositivos.findIndex(a => a.id_dispositivo === idDispositivo);
  if (index > -1) {
    state.asignacionDispositivos.splice(index, 1);
    saveAsignacionActual();
    return true;
  }
  return false;
}

export function getAsignacionDispositivo(idDispositivo) {
  return state.asignacionDispositivos.find(a => a.id_dispositivo === idDispositivo);
}

export function getNombrePersonalById(idPersonal) {
  for (const [nombre, id] of Object.entries(state.personalMap)) {
    if (id === idPersonal) return nombre;
  }
  return "";
}

export function getDestinoDispositivo(asignacion) {
  if (!asignacion) return "Disponible";
  const personaNombre = getNombrePersonalById(asignacion.id_personal);
  return personaNombre ? getPersonDisplayName(personaNombre) : "Personal desconocido";
}
