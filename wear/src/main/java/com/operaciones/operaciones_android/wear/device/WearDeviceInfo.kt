package com.operaciones.operaciones_android.wear.device

import android.content.Context
import android.os.Build
import android.provider.Settings
import org.json.JSONObject

object WearDeviceInfo {
    fun toJson(context: Context): JSONObject {
        val androidId = Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ANDROID_ID
        ).orEmpty()

        return JSONObject().apply {
            put("plataforma", "SMARTWATCH")
            put("tipo", "SMARTWATCH")
            put("identificador_app", androidId)
            put("android_id", androidId)
            put("fabricante", Build.MANUFACTURER.orEmpty())
            put("marca", Build.BRAND.orEmpty())
            put("modelo", Build.MODEL.orEmpty())
            put("dispositivo", Build.DEVICE.orEmpty())
            put("producto", Build.PRODUCT.orEmpty())
            put("sdk_int", Build.VERSION.SDK_INT)
        }
    }
}
