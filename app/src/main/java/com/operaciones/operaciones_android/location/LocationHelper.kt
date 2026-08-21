package com.operaciones.operaciones_android.location

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.util.Log
import android.view.Surface
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

class LocationHelper(
    private val activity: Activity,
    private val onLocationUpdate: (latitude: Double, longitude: Double) -> Unit,
    private val onEmitLocation: ((
        latitude: Double,
        longitude: Double,
        speedKmh: Double?,
        headingDegrees: Double?,
        accuracyMeters: Float?
    ) -> Unit)? = null
) {

    companion object {
        const val LOCATION_PERM = 101
    }

    private var locationManager: LocationManager? = null
    private var locationListener: LocationListener? = null
    private var lastEmittedLocation: Location? = null
    private var sensorManager: SensorManager? = null
    private var headingSensor: Sensor? = null
    private var headingSensorListener: SensorEventListener? = null
    @Volatile private var lastSensorHeadingDegrees: Double? = null

    private fun speedKmh(location: Location): Double? =
        if (location.hasSpeed()) (location.speed * 3.6).toDouble() else null

    private fun bearingDegrees(location: Location): Double? =
        if (location.hasBearing()) location.bearing.toDouble() else null

    private fun movementBearingDegrees(location: Location): Double? {
        bearingDegrees(location)?.let { return it }

        val previous = lastEmittedLocation ?: return null
        if (previous.distanceTo(location) < 2f) return null
        return previous.bearingTo(location).let { bearing ->
            ((bearing % 360f) + 360f) % 360f
        }.toDouble()
    }

    private fun emittedHeadingDegrees(location: Location): Double? =
        lastSensorHeadingDegrees ?: movementBearingDegrees(location)

    private fun startHeadingUpdates() {
        if (headingSensorListener != null) return

        val manager = activity.getSystemService(Context.SENSOR_SERVICE) as? SensorManager ?: return
        val sensor = manager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
            ?: manager.getDefaultSensor(Sensor.TYPE_GEOMAGNETIC_ROTATION_VECTOR)
            ?: return

        sensorManager = manager
        headingSensor = sensor
        headingSensorListener = object : SensorEventListener {
            private val rotationMatrix = FloatArray(9)
            private val adjustedMatrix = FloatArray(9)
            private val orientation = FloatArray(3)

            override fun onSensorChanged(event: SensorEvent) {
                if (event.sensor.type != Sensor.TYPE_ROTATION_VECTOR &&
                    event.sensor.type != Sensor.TYPE_GEOMAGNETIC_ROTATION_VECTOR
                ) {
                    return
                }

                SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values)
                val (axisX, axisY) = when (activity.windowManager.defaultDisplay.rotation) {
                    Surface.ROTATION_90 -> SensorManager.AXIS_Y to SensorManager.AXIS_MINUS_X
                    Surface.ROTATION_180 -> SensorManager.AXIS_MINUS_X to SensorManager.AXIS_MINUS_Y
                    Surface.ROTATION_270 -> SensorManager.AXIS_MINUS_Y to SensorManager.AXIS_X
                    else -> SensorManager.AXIS_X to SensorManager.AXIS_Y
                }
                SensorManager.remapCoordinateSystem(rotationMatrix, axisX, axisY, adjustedMatrix)
                SensorManager.getOrientation(adjustedMatrix, orientation)
                val azimuth = Math.toDegrees(orientation[0].toDouble())
                lastSensorHeadingDegrees = ((azimuth % 360.0) + 360.0) % 360.0
            }

            override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
        }
        manager.registerListener(headingSensorListener, sensor, SensorManager.SENSOR_DELAY_UI)
    }

    private fun stopHeadingUpdates() {
        headingSensorListener?.let { listener ->
            sensorManager?.unregisterListener(listener)
        }
        headingSensorListener = null
        headingSensor = null
        lastSensorHeadingDegrees = null
    }

    @SuppressLint("MissingPermission")
    private fun emitLastKnownLocation() {
        val manager = locationManager ?: return
        val providers = listOf(
            LocationManager.GPS_PROVIDER,
            LocationManager.NETWORK_PROVIDER,
            LocationManager.PASSIVE_PROVIDER
        )

        val bestLocation = providers
            .mapNotNull { provider ->
                try {
                    manager.getLastKnownLocation(provider)
                } catch (_: Exception) {
                    null
                }
            }
            .maxByOrNull { it.time }

        bestLocation?.let { loc ->
            Log.d("TrackingPersonal", "lastKnown lat=${loc.latitude} lon=${loc.longitude}")
            onLocationUpdate(loc.latitude, loc.longitude)
            emitLocation(loc)
        } ?: Log.w("TrackingPersonal", "Sin lastKnownLocation disponible")
    }

    fun requestLocationPermissionOrStart() {
        val fineOk = ContextCompat.checkSelfPermission(
            activity,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        val coarseOk = ContextCompat.checkSelfPermission(
            activity,
            Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        if (fineOk || coarseOk) {
            Log.d("TrackingPersonal", "Permiso de ubicacion OK. Iniciando updates")
            startLocationUpdates()
        } else {
            Log.w("TrackingPersonal", "Pidiendo permiso de ubicacion")
            ActivityCompat.requestPermissions(
                activity,
                arrayOf(
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION
                ),
                LOCATION_PERM
            )
        }
    }

    fun handlePermissionsResult(
        requestCode: Int,
        grantResults: IntArray
    ) {
        if (requestCode == LOCATION_PERM &&
            grantResults.isNotEmpty() &&
            grantResults.any { it == PackageManager.PERMISSION_GRANTED }
        ) {
            Log.d("TrackingPersonal", "Permiso concedido. Iniciando updates")
            startLocationUpdates()
        } else if (requestCode == LOCATION_PERM) {
            Log.w("TrackingPersonal", "Permiso de ubicacion denegado")
        }
    }

    @SuppressLint("MissingPermission")
    private fun startLocationUpdates() {
        locationManager = activity.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        startHeadingUpdates()

        locationListener = LocationListener { loc ->
            Log.d("TrackingPersonal", "location update lat=${loc.latitude} lon=${loc.longitude}")
            onLocationUpdate(loc.latitude, loc.longitude)
            emitLocation(loc)
        }

        try {
            locationManager?.requestLocationUpdates(
                LocationManager.GPS_PROVIDER,
                5000L,
                0f,
                locationListener!!
            )
        } catch (_: Exception) {
        }

        try {
            locationManager?.requestLocationUpdates(
                LocationManager.NETWORK_PROVIDER,
                5000L,
                0f,
                locationListener!!
            )
        } catch (_: Exception) {
        }

        emitLastKnownLocation()
    }

    private fun emitLocation(loc: Location) {
        val speedKmh = speedKmh(loc)
        val headingDegrees = emittedHeadingDegrees(loc)
        val accuracyMeters = if (loc.hasAccuracy()) loc.accuracy else null
        onEmitLocation?.invoke(
            loc.latitude,
            loc.longitude,
            speedKmh,
            headingDegrees,
            accuracyMeters
        )
        lastEmittedLocation = Location(loc)
    }

    fun stopLocationUpdates() {
        locationListener?.let {
            try {
                locationManager?.removeUpdates(it)
            } catch (_: Exception) {
            }
        }
        locationListener = null
        stopHeadingUpdates()
    }
}
