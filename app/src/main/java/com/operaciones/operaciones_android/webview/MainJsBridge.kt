package com.operaciones.operaciones_android.webview

import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import com.operaciones.operaciones_android.model.ChatMessage
import com.operaciones.operaciones_android.model.MessageType
import com.operaciones.operaciones_android.ui.MainActivity
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class MainJsBridge(
    private val activity: MainActivity
) {

    @JavascriptInterface
    fun getCurrentUserLabel(): String = activity.getMapDataCurrentUserLabel()

    @JavascriptInterface
    fun onMapTapped(lat: Double, lon: Double): Boolean {
        // El menú de creación de Waypoints/Blancos solo se muestra al mantener presionado (Long Press)
        return false
    }

    @JavascriptInterface
    fun onMapLongPressed(lat: Double, lon: Double) {
        activity.runOnUiThread { activity.showMapActionDialogFromBridge(lat, lon) }
    }

    @JavascriptInterface
    fun onGeoMsgRequested(lat: Double, lon: Double) {
        activity.runOnUiThread { activity.showGeoMsgDialog(lat, lon) }
    }

    @JavascriptInterface
    fun onMapObjectSelected(payloadJson: String) {
        activity.runOnUiThread {
            activity.onMapObjectSelectedFromBridge(payloadJson)
        }
    }

    @JavascriptInterface
    fun onMapObjectMoved(payloadJson: String) {
        activity.runOnUiThread {
            activity.onMapObjectMovedFromBridge(payloadJson)
        }
    }

    @JavascriptInterface
    fun onMapObjectDeleteRequested(payloadJson: String) {
        activity.runOnUiThread {
            activity.deleteMapObjectFromBridge(payloadJson)
        }
    }

    @JavascriptInterface
    fun onPoiPublishRequested(idPoi: Int) {
        activity.runOnUiThread { activity.publishPoiFromBridge(idPoi) }
    }

    @JavascriptInterface
    fun onPoiVisibilityToggled(poiId: Int, isPublic: Boolean) {
        if (poiId > 0) {
            activity.onPoiVisibilityToggled(poiId, isPublic)
        }
    }

    @JavascriptInterface
    fun onPoiEditRequested(payloadJson: String) {
        activity.runOnUiThread { activity.editPoiFromBridge(payloadJson) }
    }

    @JavascriptInterface
    fun onMapSelectionCleared() {
        activity.runOnUiThread {
            activity.clearSelectedMapObject()
        }
    }

    @JavascriptInterface
    fun sendTrafficAlert(message: String) {
        activity.runOnUiThread {
            if (message == "Mapa listo") {
                activity.applyOperationViewFromBridge()
            } else {
                activity.addMessage(
                    ChatMessage(user = "Sistema", text = message, type = MessageType.SYSTEM)
                )
            }
        }
    }

    @JavascriptInterface
    fun requestLocation() {
        activity.requestLocationPermissionFromBridge()
    }

    @JavascriptInterface
    fun getMyLocation(): String {
        val pair = activity.getLastKnownLocationPair()
        return if (pair != null) {
            "{\"lat\":${pair.first},\"lon\":${pair.second}}"
        } else {
            "{}"
        }
    }

    @JavascriptInterface
    fun getUserRole(): String = activity.getCurrentUserRoleForBridge()

    @JavascriptInterface
    fun getOperationName(): String = activity.getCurrentOperationNameForBridge()

    @JavascriptInterface
    fun getOperationId(): Int = activity.getCurrentOperationIdForBridge()

    @JavascriptInterface
    fun getCurrentUserId(): Int = activity.getCurrentUserIdForBridge()

    @JavascriptInterface
    fun getCurrentUserTable(): String = activity.getCurrentUserTableForBridge()

    @JavascriptInterface
    fun onRouteCreated(payloadJson: String) {
        activity.runOnUiThread {
            activity.onRouteCreatedFromBridge(payloadJson)
        }
    }

    @JavascriptInterface
    fun onNavigateTo(lat: Double, lon: Double, label: String) {
        activity.runOnUiThread {
            activity.createRouteFromMyLocation(lat, lon, label)
        }
    }

    @JavascriptInterface
    fun onDrawingSaved(strokeJson: String) {
        activity.onDrawingSavedFromBridge(strokeJson)
    }

    @JavascriptInterface
    fun onDrawingDeleted(localId: String) {
        activity.onDrawingDeletedFromBridge(localId)
    }

    @JavascriptInterface
    fun onSendMessageToVehicle(idVehiculo: Int) {
        activity.runOnUiThread {
            activity.openChatForVehicle(idVehiculo)
        }
    }
}
