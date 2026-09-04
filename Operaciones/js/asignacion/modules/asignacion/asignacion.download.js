import { state } from "../../core/state.js";
import { collectOperacionActual } from "../operacion/operacion.service.js";
import { saveAsignacionActual } from "./asignacion.service.js";
import { getGrupoDeCelula } from "../personal/personal.helpers.js";

function clean(value) {
  return String(value ?? "").trim();
}

function personName(person) {
  if (typeof person === "string") return clean(person);
  return [person?.nombre, person?.apellido].filter(Boolean).join(" ").trim() ||
    clean(person?.name || person?.nombre_completo || person?.apodo);
}

function personId(name, fallback) {
  return fallback || state.personalMap[name] || null;
}

function vehicleNameById(idVehiculo) {
  const vehicle = state.vehiclesList.find((v) => v.id === idVehiculo);
  return vehicle?.name || vehicle?.alias || vehicle?.serialNumber || "";
}

function assignedVehicleForPerson(idPersonal) {
  const assignment = state.asignacionVehiculos.find((a) =>
    a.tipo_destino === "personal" && String(a.id_personal) === String(idPersonal)
  );
  return assignment ? vehicleNameById(assignment.id_vehiculo) : "";
}

function equipmentLabel(eq) {
  return [
    eq?.nombre || "Equipo",
    eq?.numeroSerie ? `Serie ${eq.numeroSerie}` : ""
  ].filter(Boolean).join(" - ");
}

function deviceLabel(device) {
  const name = [device?.tipo, device?.marca, device?.modelo].filter(Boolean).join(" ") || "Dispositivo";
  const meta = [
    device?.numeroSerie ? `Serie ${device.numeroSerie}` : "",
    device?.imei ? `IMEI ${device.imei}` : "",
    device?.numeroTelefono ? `Tel ${device.numeroTelefono}` : ""
  ].filter(Boolean).join(" - ");
  return [name, meta].filter(Boolean).join(" - ");
}

function assignedEquipmentForPerson(idPersonal) {
  const allEquipment = [
    ...state.communicationEquipmentList,
    ...state.tacticalEquipmentList
  ];

  return state.asignacionEquipos
    .filter((assignment) =>
      assignment.tipo_destino === "personal" &&
      String(assignment.id_personal) === String(idPersonal)
    )
    .map((assignment) => allEquipment.find((eq) => eq.id === assignment.id_equipo))
    .filter(Boolean)
    .map(equipmentLabel);
}

function assignedDevicesForPerson(idPersonal) {
  return state.asignacionDispositivos
    .filter((assignment) => String(assignment.id_personal) === String(idPersonal))
    .map((assignment) => state.dispositivosList.find((device) => device.id === assignment.id_dispositivo))
    .filter(Boolean)
    .map(deviceLabel);
}

function buildPeopleRows() {
  const rows = [];
  const addPerson = ({ name, id, cargo, cet = "", flotilla = "", grupo = "" }) => {
    if (!name) return;
    const resolvedId = personId(name, id);
    rows.push({
      persona: name,
      cargo,
      cet,
      flotilla,
      grupo,
      vehiculo: resolvedId ? assignedVehicleForPerson(resolvedId) : "",
      equipos: resolvedId ? assignedEquipmentForPerson(resolvedId).join("; ") : "",
      dispositivos: resolvedId ? assignedDevicesForPerson(resolvedId).join("; ") : ""
    });
  };

  const cutName = personName(state.cutSeleccionado);
  addPerson({
    name: cutName,
    id: state.personalMap[state.cutSeleccionado],
    cargo: "CUT"
  });

  state.cetSeleccionados.forEach((cet) => {
    const cetName = personName(cet);
    const flotilla = state.flotillaByCet[cetName] || "";
    addPerson({
      name: cetName,
      cargo: "CET",
      cet: cetName,
      flotilla
    });

    (state.asignacionCelulas[cetName] || []).forEach((cell) => {
      const name = personName(cell);
      addPerson({
        name,
        id: cell?.id,
        cargo: "Celula",
        cet: cetName,
        flotilla,
        grupo: getGrupoDeCelula(cetName, name) || ""
      });
    });
  });

  return rows;
}

function csvValue(value) {
  return `"${clean(value).replace(/"/g, '""')}"`;
}

function downloadText(filename, text) {
  const blob = new Blob(["\uFEFF", text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function downloadAssignmentList() {
  saveAsignacionActual();

  const headers = [
    "Persona",
    "Cargo",
    "CET",
    "Flotilla",
    "Grupo",
    "Vehiculo",
    "Equipos asignados",
    "Dispositivos asignados"
  ];
  const rows = buildPeopleRows();
  const csv = [
    headers.map(csvValue).join(","),
    ...rows.map((row) => [
      row.persona,
      row.cargo,
      row.cet,
      row.flotilla,
      row.grupo,
      row.vehiculo,
      row.equipos,
      row.dispositivos
    ].map(csvValue).join(","))
  ].join("\r\n");

  const operation = collectOperacionActual();
  const safeName = clean(operation.nombre || operation.titulo || operation.title || "operacion")
    .replace(/[^\w.-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "operacion";
  downloadText(`lista_asignacion_${safeName}.csv`, csv);
}
