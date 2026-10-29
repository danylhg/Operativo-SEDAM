package com.operaciones.operaciones_android

import android.app.Application
import com.operaciones.operaciones_android.config.ApiConfig
import com.operaciones.operaciones_android.network.WifiNetworkBinder

class SedamApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        ApiConfig.load(this)
        // En redes sin internet (Ku) Android desvía el tráfico a datos móviles; esto lo mantiene en el Wi-Fi.
        WifiNetworkBinder.start(this)
    }
}
