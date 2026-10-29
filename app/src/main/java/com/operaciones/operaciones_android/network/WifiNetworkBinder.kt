package com.operaciones.operaciones_android.network

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.util.Log

/**
 * Amarra todo el proceso a la red Wi-Fi aunque esta no tenga internet (enlace Ku, router de campo).
 *
 * Sin esto, cuando el Wi-Fi no tiene salida a internet Android lo marca como "no validado" y
 * manda el tráfico de las apps por los datos móviles, por donde no se llega al servidor local
 * (10.x / 192.168.x) y la app muestra "no se puede conectar".
 * Al vincular el proceso, OkHttp, Socket.IO y los WebView (mapa, video) salen siempre por el Wi-Fi.
 * Si se pierde el Wi-Fi se quita el vínculo y la app vuelve a usar la red por defecto.
 */
object WifiNetworkBinder {
    private const val TAG = "WifiNetworkBinder"

    @Volatile
    private var boundNetwork: Network? = null
    private var started = false

    fun start(context: Context) {
        if (started) return
        started = true

        val cm = context.applicationContext.getSystemService(ConnectivityManager::class.java) ?: return
        // Solo se pide transporte Wi-Fi; se quita INTERNET para aceptar redes sin salida a internet.
        val request = NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()

        // requestNetwork (no solo escuchar) para que Android no desconecte el Wi-Fi por "no tener internet".
        cm.requestNetwork(request, object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                if (cm.bindProcessToNetwork(network)) {
                    boundNetwork = network
                    Log.i(TAG, "Proceso vinculado al Wi-Fi $network")
                } else {
                    Log.w(TAG, "No se pudo vincular el proceso al Wi-Fi $network")
                }
            }

            override fun onLost(network: Network) {
                if (boundNetwork == network) {
                    cm.bindProcessToNetwork(null)
                    boundNetwork = null
                    Log.i(TAG, "Wi-Fi perdido, se usa la red por defecto")
                }
            }
        })
    }
}
