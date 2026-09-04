import { state } from "../../core/state.js";
import { readObjectStorage, writeStorage } from "../../core/storage.js";
import {
  STORAGE_ASIGNACION_ACTUAL,
  STORAGE_OPERACION_ACTUAL
} from "../../core/constants.js";

import { collectOperacionActual } from "../operacion/operacion.service.js";
import { getGrupoDeCelula } from "../personal/personal.helpers.js";
import {
  getResumenVehiculoDetallado,
  getVehiclesUsedInAssignments
} from "../vehiculos/vehiculos.helpers.js";

export function buildAsignacionActual() {
  const personal = [];
  const vehiculos = [];
  const equipos = [];
  const dispositivos = [];

  // Construir personal con asignaciones de vehículos
  if (state.cutSeleccionado) {
    const cutId = state.personalMap[state.cutSeleccionado];
    const vehAsig = state.asignacionVehiculos.find(a => a.tipo_destino === 'personal' && a.id_personal === cutId);
    const vehNombre = vehAsig ? state.vehiclesList.find(v => v.id === vehAsig.id_vehiculo)?.name : "";
    personal.push({
      nombre: state.cutSeleccionado,
      cargo: "CUT",
      grupo: "",
      cet: "",
      flotilla: "",
      vehiculo: vehNombre
    });
  }

  state.cetSeleccionados.forEach((cet) => {
    // CET
    const grupoCet = state.gruposByCet[cet]?.active;
    const vehAsigCet = state.asignacionVehiculos.find(a => a.tipo_destino === 'grupo' && a.id_grupo_operacion === grupoCet);
    const vehNombreCet = vehAsigCet ? state.vehiclesList.find(v => v.id === vehAsigCet.id_vehiculo)?.name : "";
    personal.push({
      nombre: cet,
      cargo: "CET",
      grupo: "",
      cet,
      flotilla: state.flotillaByCet[cet] || "",
      vehiculo: vehNombreCet
    });

    // Células
    const cells = state.asignacionCelulas[cet] || [];
    cells.forEach((celulaNombre) => {
      const id_p = state.personalMap[celulaNombre];
      const vehAsig = id_p ? state.asignacionVehiculos.find(a => a.tipo_destino === 'personal' && a.id_personal === id_p) : null;
      const vehNombre = vehAsig ? state.vehiclesList.find(v => v.id === vehAsig.id_vehiculo)?.name : "";
      
      personal.push({
        nombre: celulaNombre,
        cargo: "Célula",
        grupo: getGrupoDeCelula(cet, celulaNombre),
        cet,
        flotilla: state.flotillaByCet[cet] || "",
        vehiculo: vehNombre
      });
    });
  });

  getVehiclesUsedInAssignments().forEach((v) => {
    const resumen = getResumenVehiculoDetallado(v.id);

    vehiculos.push({
      nombre: v.name,
      unidad: v.name,
      tipo: v.type || "",
      alias: v.alias || "",
      codigoInterno: v.serialNumber || "",
      placas: "",
      estado: v.status || "",
      cet: resumen.cets.join(", "),
      flotilla: resumen.flotilla,
      grupo: resumen.grupo,
      personas: resumen.personas
    });
  });

  const allEquipos = [
    ...state.tacticalEquipmentList.map(eq => ({ ...eq, categoria: "tactico" })),
    ...state.communicationEquipmentList.map(eq => ({ ...eq, categoria: "comunicacion" }))
  ];

  state.asignacionEquipos.forEach(asig => {
    const eq = allEquipos.find(e => e.id === asig.id_equipo);
    if (eq) {
      let destino = "";
      if (asig.tipo_destino === 'personal') {
        // Buscar nombre de persona
        for (const cet of state.cetSeleccionados) {
          const celulas = state.asignacionCelulas[cet] || [];
          const persona = celulas.find(p => state.personalMap[p] === asig.id_personal);
          if (persona) {
            destino = `${cet} - ${persona}`;
            break;
          }
        }
      } else if (asig.tipo_destino === 'vehiculo') {
        const veh = state.vehiclesList.find(v => v.id === asig.id_vehiculo);
        destino = veh?.name || "Vehículo";
      }

      equipos.push({
        nombre: eq.nombre,
        categoria: eq.categoria === "tactico" ? "Táctico" : "Comunicación",
        codigo: eq.numeroSerie || "",
        codigoInterno: eq.numeroSerie || "",
        cantidad: 1,
        vehiculo: destino,
        asignadoA: destino
      });
    }
  });

  state.asignacionDispositivos.forEach(asig => {
    const disp = state.dispositivosList.find(d => d.id === asig.id_dispositivo);
    if (!disp) return;

    let responsable = "";
    for (const [nombre, id] of Object.entries(state.personalMap)) {
      if (id === asig.id_personal) {
        responsable = nombre;
        break;
      }
    }

    dispositivos.push({
      tipo: disp.tipo,
      marca: disp.marca,
      modelo: disp.modelo,
      numeroTelefono: disp.numeroTelefono || "",
      imei: disp.imei || "",
      numeroSerie: disp.numeroSerie || "",
      responsable
    });
  });

  return {
    operacion: collectOperacionActual(),
    cut: state.cutSeleccionado || "",
    cets: [...state.cetSeleccionados],
    flotillaByCet: { ...state.flotillaByCet },
    personal,
    vehiculos,
    equipos,
    dispositivos,
    asignacionCelulas: state.asignacionCelulas,
    asignacionVehiculos: state.asignacionVehiculos,
    asignacionEquipos: state.asignacionEquipos,
    asignacionDispositivos: state.asignacionDispositivos,
    updated_at: new Date().toISOString()
  };
}

export function saveAsignacionActual() {
  const payload = buildAsignacionActual();
  writeStorage(STORAGE_ASIGNACION_ACTUAL, payload);

  const op = readObjectStorage(STORAGE_OPERACION_ACTUAL, {});
  if (op.id) {
    writeStorage(`asignacion_op_${op.id}`, payload);
  }

  return payload;
}

export async function saveOperacionYAsignacion() {
  const op = readObjectStorage(STORAGE_OPERACION_ACTUAL, {});
  if (op.id) {
    writeStorage(`operacion_${op.id}`, op);
  }
  return saveAsignacionActual();
}
