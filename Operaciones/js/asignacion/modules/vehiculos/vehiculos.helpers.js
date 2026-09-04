import { state } from "../../core/state.js";
import { getGrupoDeCelula } from "../personal/personal.helpers.js";

// Mapa inverso ID -> nombre (calculado una vez por llamada)
function buildInversePersonalMap() {
  const inv = {};
  for (const [nombre, id] of Object.entries(state.personalMap)) {
    inv[id] = nombre;
  }
  return inv;
}

export function getResumenVehiculoDetallado(idVehiculo) {
  const asignaciones = state.asignacionVehiculos.filter(a => a.id_vehiculo === idVehiculo);

  const cets = new Set();
  const grupos = new Set();
  let totalPersonas = 0;

  const idToNombre = buildInversePersonalMap();

  asignaciones.forEach(asig => {
    if (asig.tipo_destino === 'personal') {
      const nombrePersona = idToNombre[asig.id_personal];
      if (!nombrePersona) return;

      for (const cet of state.cetSeleccionados) {
        const celulas = state.asignacionCelulas[cet] || [];
        // asignacionCelulas almacena strings de nombres
        if (celulas.includes(nombrePersona) || cet === nombrePersona) {
          cets.add(cet);
          totalPersonas += 1;
          const grupo = getGrupoDeCelula(cet, nombrePersona);
          if (grupo) grupos.add(grupo);
          break;
        }
      }
    } else if (asig.tipo_destino === 'grupo') {
      for (const cet of Object.keys(state.gruposByCet)) {
        const ginfo = state.gruposByCet[cet];
        if (ginfo.names.includes(asig.id_grupo_operacion)) {
          cets.add(cet);
          break;
        }
      }
    }
  });

  const flotillas = Array.from(cets)
    .map(cet => state.flotillaByCet[cet])
    .filter(Boolean);

  return {
    flotilla: flotillas.length ? flotillas.join(", ") : "—",
    grupo: grupos.size ? Array.from(grupos).join(", ") : "—",
    personas: totalPersonas,
    cets: Array.from(cets)
  };
}

export function getVehiclesUsedInAssignments() {
  const usados = new Set(
    state.asignacionVehiculos.map(a => a.id_vehiculo)
  );

  return state.vehiclesList.filter(v => usados.has(v.id));
}
