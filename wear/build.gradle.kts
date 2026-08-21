plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.operaciones.operaciones_android.wear"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.operaciones.operaciones_android"
        minSdk = 30
        targetSdk = 34
        versionCode = 100001
        versionName = "1.0-wear"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

    kotlinOptions {
        jvmTarget = "11"
    }

    sourceSets {
        getByName("main").assets.srcDir("../app/src/main/assets/img")
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("io.socket:socket.io-client:2.1.0") {
        exclude(group = "org.json", module = "json")
    }
    implementation("com.google.android.gms:play-services-wearable:20.0.1")
    implementation("androidx.wear:wear-remote-interactions:1.2.0")
    implementation("androidx.health:health-services-client:1.0.0")
    implementation("com.google.guava:guava:33.2.1-android")
    implementation("com.caverock:androidsvg-aar:1.4")
    implementation("io.github.webrtc-sdk:android:144.7559.01")
    testImplementation(libs.junit)
    testImplementation("org.json:json:20240303")
}
