package com.operaciones.operaciones_android

import android.app.Application
import com.operaciones.operaciones_android.config.ApiConfig

class SedamApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        ApiConfig.load(this)
    }
}
