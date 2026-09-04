import { btnBack, btnVolver, btnDashboardGo, btnDownloadList } from "../../core/dom.js";
import { state } from "../../core/state.js";
import {
  flushPersistOperacionActualEnBackend,
  saveOperacionActual,
  syncOperacionCompleta
} from "../operacion/operacion.service.js";
import { saveOperacionYAsignacion } from "../asignacion/asignacion.service.js";
import { removeStorage, readObjectStorage } from "../../core/storage.js";
import { STORAGE_OPERACION_ACTUAL, STORAGE_ASIGNACION_ACTUAL } from "../../core/constants.js";
import { renderHome } from "../../views/home.view.js";
import { renderCUT, renderCET, renderCelulas } from "../personal/personal.views.js";
import { releaseAsignacionPresence } from "../operacion/operacion.presence.js";
import { downloadAssignmentList } from "../asignacion/asignacion.download.js";

export function bindNavigation() {
  btnBack.addEventListener("click", () => {
    if (state.categoria === "personal") {
      if (state.pasoPersonal === "vehiculos") {
        state.pasoPersonal = "celulas";
        renderCelulas();
        return;
      }

      if (state.pasoPersonal === "celulas") {
        state.pasoPersonal = "cet";
        renderCET();
        return;
      }

      if (state.pasoPersonal === "cet") {
        state.pasoPersonal = "cut";
        renderCUT();
        return;
      }

      if (state.pasoPersonal === "cut") {
        renderHome();
        return;
      }
    }

    if (state.categoria !== "personal") {
      renderHome();
      return;
    }
  });

  btnVolver.addEventListener("click", async () => {
    await releaseAsignacionPresence();
    removeStorage(STORAGE_OPERACION_ACTUAL);
    removeStorage(STORAGE_ASIGNACION_ACTUAL);
    window.location.href = "menu_inicial.html";
  });

  btnDownloadList?.addEventListener("click", () => {
    downloadAssignmentList();
  });

  btnDashboardGo?.addEventListener("click", async () => {
    btnDashboardGo.disabled = true;

    try {
      await flushPersistOperacionActualEnBackend();
      await saveOperacionYAsignacion(saveOperacionActual);
      const storedOp = readObjectStorage(STORAGE_OPERACION_ACTUAL, {});
      const opId = storedOp.id || storedOp.id_operacion || localStorage.getItem("active_operation_id");

      if (!opId) {
        throw new Error("La operacion no se guardo. Intenta nuevamente.");
      }

      if (opId) {
        const syncResult = await syncOperacionCompleta(opId);
        if (syncResult?.ok === false) {
          throw new Error(syncResult.error || "No se pudo sincronizar la asignación.");
        }
      }

      await releaseAsignacionPresence(opId);
      window.location.href = "dashboard.html?v=20260629-restore-tactical-fix";
    } catch (error) {
      console.error("No se pudo guardar la operacion antes de volver al dashboard:", error);
      alert(error?.message || "No se pudo guardar la operacion. Revisa los datos e intenta nuevamente.");
    } finally {
      btnDashboardGo.disabled = false;
    }
  });
}
