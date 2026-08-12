plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "mx.sedam.movil"
    compileSdk = 35

    defaultConfig {
        applicationId = "mx.sedam.movil"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    implementation(libs.androidx.material.icons.extended)
    debugImplementation(libs.androidx.ui.tooling)

    implementation(libs.androidx.security.crypto)
    implementation(libs.kotlinx.coroutines.android)

    // Mapa offline con cache de tiles en SQLite (cache.db integrado)
    implementation(libs.osmdroid.android)

    // Símbolos militares MIL-STD-2525 (renderer oficial armyc2)
    implementation(libs.milsym.android.renderer)

    // socket.io-client trae su propio org.json; Android ya lo incluye → se excluye
    // para evitar "Duplicate class org.json".
    implementation(libs.socketio) {
        exclude(group = "org.json", module = "json")
    }
}
