package com.operaciones.operaciones_android.ui
import com.operaciones.operaciones_android.config.ApiConfig
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import com.operaciones.operaciones_android.auth.AuthManager
import com.operaciones.operaciones_android.model.Operation
import com.operaciones.operaciones_android.model.OperationStatus
import com.operaciones.operaciones_android.model.User
import com.operaciones.operaciones_android.model.UserRole
import com.operaciones.operaciones_android.R

class LoginActivity : AppCompatActivity() {
    companion object {
        private const val PHONE_STATE_PERMISSION_REQUEST = 202
    }

    private lateinit var inputUsername: EditText
    private lateinit var inputPassword: EditText
    private lateinit var btnTogglePassword: ImageButton
    private lateinit var btnApiAddress: Button
    private lateinit var btnLogin: Button
    private lateinit var tvError: TextView
    private lateinit var progress: ProgressBar

    // La direccion del servidor se guarda desde el boton del login.
    private val http = OkHttpClient()

    private var currentCall: Call? = null
    private val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private var loadingTextRunnable: Runnable? = null
    private var dotCount = 0
    private var requestedPhoneStatePermission = false
    private var passwordVisible = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ApiConfig.load(this)
        if (openFromWearIfPossible()) return
        setContentView(R.layout.activity_login)

        inputUsername = findViewById(R.id.inputNumControl)
        inputPassword = findViewById(R.id.inputPassword)
        btnTogglePassword = findViewById(R.id.btnTogglePassword)
        btnApiAddress = findViewById(R.id.btnApiAddress)
        btnLogin      = findViewById(R.id.btnLogin)
        tvError       = findViewById(R.id.tvError)
        progress      = findViewById(R.id.loginProgress)

        // Al volver a abrir la aplicación reutilizamos la sesión guardada si
        // su JWT todavía está dentro de las cuatro horas de vigencia.
        AuthManager.getCurrentUser(this)?.let { user ->
            fetchOperacionYNavegar(user)
            return
        }

        inputPassword.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_DONE) { attemptLogin(); true } else false
        }

        btnLogin.setOnTouchListener { _, event ->
            if (event.action == MotionEvent.ACTION_DOWN) hideKeyboard()
            false
        }
        btnLogin.setOnClickListener { attemptLogin() }
        btnTogglePassword.setOnClickListener { togglePasswordVisibility() }
        btnApiAddress.setOnClickListener { showApiAddressDialog() }
    }

    private fun openFromWearIfPossible(): Boolean {
        val data = intent?.data ?: return false
        if (data.scheme != "sedam" || data.host != "open-operation") return false
        val user = AuthManager.getCurrentUser(this) ?: return false
        val target = Intent(this, MainActivity::class.java).apply {
            putExtra("USER_ID", user.id)
            putExtra("OPERATION_ID", data.getQueryParameter("operation_id")?.toIntOrNull() ?: -1)
            putExtra("OP_ESTADO", data.getQueryParameter("op_estado") ?: "ACTIVA")
            putExtra("OP_CODIGO", data.getQueryParameter("op_codigo").orEmpty())
            putExtra("OP_NOMBRE", data.getQueryParameter("op_nombre") ?: "Operación")
            putExtra("OP_DESCRIPCION", "")
            putExtra("OP_PRIORIDAD", data.getQueryParameter("op_prioridad") ?: "MEDIA")
            putExtra("OP_FECHA_INICIO", data.getQueryParameter("op_fecha_inicio").orEmpty())
            putExtra("OP_FECHA_FIN", data.getQueryParameter("op_fecha_fin").orEmpty())
            putExtra("OP_LAT", data.getQueryParameter("op_lat")?.toDoubleOrNull() ?: 0.0)
            putExtra("OP_LON", data.getQueryParameter("op_lon")?.toDoubleOrNull() ?: 0.0)
            putExtra("OP_ZOOM", data.getQueryParameter("op_zoom")?.toIntOrNull() ?: 8000)
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        startActivity(target)
        finish()
        return true
    }

    private fun togglePasswordVisibility() {
        passwordVisible = !passwordVisible
        inputPassword.inputType = if (passwordVisible) {
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
        } else {
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        inputPassword.setSelection(inputPassword.text?.length ?: 0)
        btnTogglePassword.setImageResource(if (passwordVisible) R.drawable.ic_eye_off else R.drawable.ic_eye)
        btnTogglePassword.contentDescription = if (passwordVisible) "Ocultar contraseña" else "Mostrar contraseña"
    }

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        if (event.action == MotionEvent.ACTION_DOWN) {
            hideKeyboardIfTouchOutsideFocusedInput(event)
        }
        return super.dispatchTouchEvent(event)
    }

    // ── Paso 1: autenticar ────────────────────────────────────────────────────

    private fun attemptLogin() {
        hideKeyboard()

        val username = inputUsername.text.toString().trim()
        val password = inputPassword.text.toString()
        tvError.visibility = View.GONE

        if (username.isEmpty() || password.isEmpty()) {
            showError("Ingresa tu usuario y contraseña.")
            return
        }

        if (shouldRequestPhoneStatePermission()) {
            requestedPhoneStatePermission = true
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.READ_PHONE_STATE),
                PHONE_STATE_PERMISSION_REQUEST
            )
            return
        }

        currentCall?.cancel()
        setLoading(true)

        val devicePayload = buildDevicePayload()
        val body = JSONObject().apply {
            put("username", username)
            put("password", password)
            put("device", devicePayload)
        }.toString().toRequestBody("application/json".toMediaType())

        val baseUrl = ApiConfig.load(this)
        val req = try {
            Request.Builder().url("$baseUrl/auth/login").post(body).build()
        } catch (_: IllegalArgumentException) {
            setLoading(false)
            showError("La dirección del servidor no es válida. Corrígela desde el botón de configuración.")
            return
        }

        val call = http.newCall(req)
        currentCall = call

        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                if (call.isCanceled()) return
                runOnUiThread {
                    setLoading(false)
                    showError("No se pudo conectar.")
                }
            }
            override fun onResponse(call: Call, response: Response) {
                if (call.isCanceled()) return
                val bodyStr = response.body?.string() ?: ""
                runOnUiThread {
                    setLoading(false)
                    if (bodyStr.trim().startsWith("<")) {
                        showError("La dirección del servidor devolvió HTML en vez de la API. Verifica el puerto (3001) en la configuración.")
                        return@runOnUiThread
                    }
                    try {
                        val json = JSONObject(bodyStr)
                        when {
                            response.isSuccessful && json.optBoolean("ok") ->
                                handleLoginSuccess(json)
                            else -> {
                                val msg = json.optString("mensaje", "").ifBlank {
                                    if (response.code == 403) "Acceso no autorizado para este dispositivo o usuario."
                                    else "Usuario o contraseña incorrectos."
                                }
                                showError(msg)
                            }
                        }
                    } catch (e: Exception) {
                        android.util.Log.e("LoginActivity", "Error al procesar la respuesta: $bodyStr", e)
                        showError("Error al procesar la respuesta.")
                    }
                }
            }
        })
    }

    private fun shouldRequestPhoneStatePermission(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !requestedPhoneStatePermission &&
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.READ_PHONE_STATE
            ) != PackageManager.PERMISSION_GRANTED

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == PHONE_STATE_PERMISSION_REQUEST) {
            attemptLogin()
        }
    }

    private fun buildDevicePayload(): JSONObject {
        val androidId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID).orEmpty()
        val serialNumber = readDeviceSerial()
        return JSONObject().apply {
            put("plataforma", "ANDROID")
            put("identificador_app", androidId)
            put("android_id", androidId)
            put("numero_serie", serialNumber)
            put("serial", serialNumber)
            put("fabricante", Build.MANUFACTURER.orEmpty())
            put("marca", Build.BRAND.orEmpty())
            put("modelo", Build.MODEL.orEmpty())
            put("dispositivo", Build.DEVICE.orEmpty())
            put("producto", Build.PRODUCT.orEmpty())
            put("sdk_int", Build.VERSION.SDK_INT)
        }
    }

    @Suppress("DEPRECATION")
    private fun readDeviceSerial(): String {
        return try {
            val serial = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val phoneStateGranted = ContextCompat.checkSelfPermission(
                    this,
                    Manifest.permission.READ_PHONE_STATE
                ) == PackageManager.PERMISSION_GRANTED

                if (phoneStateGranted) Build.getSerial() else ""
            } else {
                Build.SERIAL
            }

            serial.takeUnless { it.isNullOrBlank() || it.equals("unknown", ignoreCase = true) }.orEmpty()
        } catch (_: SecurityException) {
            ""
        } catch (_: Exception) {
            ""
        }
    }

    private fun handleLoginSuccess(json: JSONObject) {
        val token = json.optString("token", "")
        val u     = json.optJSONObject("usuario")
        if (token.isEmpty() || u == null) {
            showError("Respuesta de inicio de sesión incompleta.")
            return
        }

        val rolStr = u.optString("rol", "CELL").uppercase()
        val rol = try { UserRole.valueOf(rolStr) } catch (_: Exception) { UserRole.CELL }

        // Solo CET y CELL usan la app móvil
        if (rol == UserRole.ADMIN || rol == UserRole.CUT) {
            showError("Este rol solo tiene acceso a la plataforma web.")
            return
        }

        val tabla = u.optString("tabla", "personal")
        val id = if (tabla == "personal")
            u.optInt("id_personal", 0).takeIf { it > 0 } ?: u.optInt("id_usuario", 0)
        else
            u.optInt("id_usuario", 0)
        val idDispositivo = u.optInt("id_dispositivo", 0).takeIf { it > 0 }

        val user = User(
            id        = id,
            nombre    = u.optString("nombre",   ""),
            apellido  = u.optString("apellido", ""),
            username  = u.optString("username", ""),
            rol       = rol,
            jerarquia = u.optString("puesto",   ""),
            tabla     = tabla,
            idDispositivo = idDispositivo
        )

        AuthManager.saveSession(this, user, token)
        fetchOperacionYNavegar(user)
    }

    // ── Paso 2: consultar operación asignada ──────────────────────────────────

    private fun fetchOperacionYNavegar(user: User) {
        currentCall?.cancel()
        setLoading(true)
        val baseUrl = ApiConfig.BASE_URL

        val req = Request.Builder()
            .url("$baseUrl/ops/personal/${user.id}")
            .get()
            .addHeader("Authorization", "Bearer ${AuthManager.getToken(this)}")
            .build()

        val call = http.newCall(req)
        currentCall = call

        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                if (call.isCanceled()) return
                runOnUiThread {
                    setLoading(false)
                    showError("No se pudo obtener la operación asignada.\nVerifica tu conexión.")
                }
            }
            override fun onResponse(call: Call, response: Response) {
                if (call.isCanceled()) return
                val bodyStr = response.body?.string() ?: ""
                runOnUiThread {
                    setLoading(false)
                    try {
                        when {
                            response.isSuccessful -> {
                                val json   = JSONObject(bodyStr)
                                val opJson = json.optJSONObject("operacion")
                                if (opJson != null) navegarConOperacion(user, parseOperacion(opJson))
                                else                navegarSinOperacion(user)
                            }
                            response.code == 404 -> navegarSinOperacion(user)
                            else -> showError("Error del servidor (${response.code}).\nIntenta de nuevo.")
                        }
                    } catch (_: Exception) {
                        showError("Error al procesar la respuesta del servidor.")
                    }
                }
            }
        })
    }

    private fun parseOperacion(o: JSONObject): Operation {
        val estadoStr = o.optString("estado", "PLANIFICADA").uppercase()
        val status = try { OperationStatus.valueOf(estadoStr) }
        catch (_: Exception) { OperationStatus.PLANIFICADA }
        val zona = o.optJSONObject("zona")

        return Operation(
            id          = o.getInt("id_operacion"),
            codigo      = o.optString("codigo",      ""),
            nombre      = o.optString("nombre",      "Sin nombre"),
            descripcion = o.optString("descripcion", ""),
            prioridad   = o.optString("prioridad",   "MEDIA"),
            status      = status,
            fechaInicio = o.optString("fecha_inicio", ""),
            fechaFin    = o.optString("fecha_fin",    ""),
            zonaLat     = zona?.optDouble("centroide_lat", 0.0) ?: 0.0,
            zonaLon     = zona?.optDouble("centroide_lon", 0.0) ?: 0.0,
            zonaZoom    = zona?.optInt("zoom_inicial",  8000)   ?: 8000
        )
    }

    // ── Navegación ────────────────────────────────────────────────────────────

    private fun navegarConOperacion(user: User, op: Operation) {
        val intent = when (op.status) {
            OperationStatus.ACTIVA -> Intent(this, MainActivity::class.java)
            else                   -> Intent(this, OperationStatusActivity::class.java)
        }

        intent.putExtra("USER_ID",        user.id)
        intent.putExtra("OPERATION_ID",   op.id)
        intent.putExtra("OP_ESTADO",      op.status.name)   // necesario para OperationStatusActivity
        intent.putExtra("OP_CODIGO",      op.codigo)
        intent.putExtra("OP_NOMBRE",      op.nombre)
        intent.putExtra("OP_DESCRIPCION", op.descripcion)
        intent.putExtra("OP_PRIORIDAD",   op.prioridad)
        intent.putExtra("OP_FECHA_INICIO", op.fechaInicio)
        intent.putExtra("OP_FECHA_FIN",    op.fechaFin)
        intent.putExtra("OP_LAT",          op.zonaLat)
        intent.putExtra("OP_LON",          op.zonaLon)
        intent.putExtra("OP_ZOOM",         op.zonaZoom)

        startActivity(intent)
        finish()
    }

    private fun navegarSinOperacion(user: User) {
        startActivity(
            Intent(this, OperationStatusActivity::class.java).apply {
                putExtra("USER_ID",      user.id)
                putExtra("OPERATION_ID", -1)
            }
        )
        finish()
    }

    // ── UI helpers ────────────────────────────────────────────────────────────

    private fun showError(msg: String) {
        tvError.text       = msg
        tvError.visibility = View.VISIBLE
        inputPassword.animate().translationX(10f).setDuration(50).withEndAction {
            inputPassword.animate().translationX(-10f).setDuration(50).withEndAction {
                inputPassword.animate().translationX(0f).setDuration(50).start()
            }.start()
        }.start()
    }

    private fun showApiAddressDialog() {
        hideKeyboard()

        val defaultRtmpBase = ApiConfig.defaultRtmpPublishBaseUrl(ApiConfig.BASE_URL)
        val defaultHlsBase = ApiConfig.defaultHlsPlaybackBaseUrl(ApiConfig.BASE_URL)

        val inputAddress = EditText(this).apply {
            setText(ApiConfig.BASE_URL)
            hint = "192.168.1.20:3001"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            isSingleLine = true
            setSelectAllOnFocus(true)
            styleServerInput()
        }

        val inputRtmpAddress = EditText(this).apply {
            setText(ApiConfig.RTMP_PUBLISH_BASE_URL.takeUnless { it == defaultRtmpBase }.orEmpty())
            hint = defaultRtmpBase
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            isSingleLine = true
            setSelectAllOnFocus(true)
            styleServerInput()
        }

        val inputHlsAddress = EditText(this).apply {
            setText(ApiConfig.HLS_PLAYBACK_BASE_URL.takeUnless { it == defaultHlsBase }.orEmpty())
            hint = defaultHlsBase
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            isSingleLine = true
            setSelectAllOnFocus(true)
            styleServerInput()
        }

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(22), dp(8), dp(22), dp(8))

            addLabeledInput("API", inputAddress)
            addLabeledInput("RTMP opcional", inputRtmpAddress)
            addLabeledInput("HLS opcional", inputHlsAddress)
        }

        val dialog = AlertDialog.Builder(this)
            .setTitle("Direcciones del servidor")
            .setMessage("Configura la conexión con la API. RTMP y HLS son opcionales.")
            .setView(content)
            .setNegativeButton("Cancelar", null)
            .setPositiveButton("Guardar", null)
            .create()

        dialog.setOnShowListener {
            dialog.window?.setBackgroundDrawableResource(R.drawable.bg_server_dialog)
            val alertTitleId = resources.getIdentifier("alertTitle", "id", "android")
            dialog.findViewById<TextView>(alertTitleId)?.apply {
                setTextColor(Color.parseColor("#F3F7FF"))
                textSize = 20f
            }
            dialog.findViewById<TextView>(android.R.id.message)?.apply {
                setTextColor(Color.parseColor("#B8C8DF"))
                textSize = 14f
            }
            dialog.getButton(AlertDialog.BUTTON_NEGATIVE).apply {
                setTextColor(Color.parseColor("#A8B6CF"))
                background = null
            }
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).apply {
                setTextColor(Color.parseColor("#69B4FF"))
                background = null
            }
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val urls = try {
                    ApiConfig.saveServerUrls(
                        this,
                        inputAddress.text.toString(),
                        inputRtmpAddress.text.toString(),
                        inputHlsAddress.text.toString()
                    )
                } catch (e: IllegalArgumentException) {
                    val message = e.message
                    when {
                        message?.contains("RTMP", ignoreCase = true) == true -> inputRtmpAddress.error = message
                        message?.contains("HLS", ignoreCase = true) == true -> inputHlsAddress.error = message
                        else -> inputAddress.error = message
                    }
                    return@setOnClickListener
                }

                currentCall?.cancel()
                setLoading(false)
                tvError.visibility = View.GONE
                Toast.makeText(this, "Servidor guardado: ${urls.apiBaseUrl}", Toast.LENGTH_SHORT).show()
                dialog.dismiss()
            }
        }

        dialog.show()
        dialog.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE)
        inputAddress.requestFocus()
    }

    private fun EditText.styleServerInput() {
        background = ContextCompat.getDrawable(this@LoginActivity, R.drawable.bg_server_input)
        setTextColor(Color.parseColor("#F3F7FF"))
        setHintTextColor(Color.parseColor("#7F9CB8"))
        textSize = 14f
        setPadding(dp(14), 0, dp(14), 0)
        minHeight = dp(48)
    }

    private fun LinearLayout.addLabeledInput(label: String, input: EditText) {
        addView(
            TextView(context).apply {
                text = label
                setTextColor(Color.parseColor("#A8B6CF"))
                textSize = 11f
                setTypeface(typeface, android.graphics.Typeface.BOLD)
            },
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = dp(12)
                bottomMargin = dp(6)
            }
        )
        addView(
            input,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        )
    }

    private fun setLoading(loading: Boolean) {
        progress.visibility = if (loading) View.VISIBLE else View.GONE
        btnLogin.isEnabled  = true
        btnLogin.alpha      = if (loading) 0.8f else 1f
        if (::btnApiAddress.isInitialized) {
            btnApiAddress.isEnabled = !loading
            btnApiAddress.alpha = if (loading) 0.6f else 1f
        }

        loadingTextRunnable?.let { mainHandler.removeCallbacks(it) }
        if (loading) {
            dotCount = 0
            loadingTextRunnable = object : Runnable {
                override fun run() {
                    dotCount = (dotCount + 1) % 4
                    val dots = ".".repeat(dotCount)
                    btnLogin.text = "CONECTANDO$dots"
                    mainHandler.postDelayed(this, 500)
                }
            }
            mainHandler.post(loadingTextRunnable!!)
        } else {
            btnLogin.text = "INICIAR SESIÓN"
        }
    }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()

    private fun hideKeyboard() {
        inputUsername.clearFocus()
        inputPassword.clearFocus()
        btnLogin.requestFocus()

        val imm = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
        val token = currentFocus?.windowToken ?: btnLogin.windowToken
        imm.hideSoftInputFromWindow(token, 0)
    }

    private fun hideKeyboardIfTouchOutsideFocusedInput(event: MotionEvent) {
        val focusedInput = currentFocus as? EditText ?: return
        val inputBounds = Rect()
        focusedInput.getGlobalVisibleRect(inputBounds)

        if (inputBounds.contains(event.rawX.toInt(), event.rawY.toInt())) return

        focusedInput.clearFocus()
        btnLogin.requestFocus()

        val imm = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
        imm.hideSoftInputFromWindow(focusedInput.windowToken, 0)
    }
}
