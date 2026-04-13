package com.kkorichire.sms

import android.Manifest
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

class MainActivity : AppCompatActivity() {

    private lateinit var serverUrlInput: EditText
    private lateinit var templateInput: EditText
    private lateinit var delayInput: EditText
    private lateinit var statusText: TextView
    private lateinit var baeminStatusText: TextView
    private lateinit var logText: TextView
    private lateinit var startButton: Button
    private lateinit var stopButton: Button
    private lateinit var notificationSettingsButton: Button
    private lateinit var saveSettingsButton: Button

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    companion object {
        const val PREFS_NAME = "kkorichire_prefs"
        const val KEY_SERVER_URL = "server_url"
        const val SMS_PERMISSION_CODE = 100
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        serverUrlInput = findViewById(R.id.serverUrlInput)
        templateInput = findViewById(R.id.templateInput)
        delayInput = findViewById(R.id.delayInput)
        statusText = findViewById(R.id.statusText)
        baeminStatusText = findViewById(R.id.baeminStatusText)
        logText = findViewById(R.id.logText)
        startButton = findViewById(R.id.startButton)
        stopButton = findViewById(R.id.stopButton)
        notificationSettingsButton = findViewById(R.id.notificationSettingsButton)
        saveSettingsButton = findViewById(R.id.saveSettingsButton)

        // 저장된 서버 URL 복원
        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        val savedUrl = prefs.getString(KEY_SERVER_URL, "")
        if (!savedUrl.isNullOrEmpty()) {
            serverUrlInput.setText(savedUrl)
        }

        // 권한 요청
        requestPermissions()

        startButton.setOnClickListener { startService() }
        stopButton.setOnClickListener { stopService() }
        notificationSettingsButton.setOnClickListener { openNotificationSettings() }
        saveSettingsButton.setOnClickListener { saveSettings() }

        updateStatus()
        loadSettings()
    }

    private fun getAuthToken(): String {
        return getSharedPreferences(LoginActivity.PREFS_NAME, MODE_PRIVATE)
            .getString(LoginActivity.KEY_TOKEN, "") ?: ""
    }

    // 서버에서 설정 불러오기
    private fun loadSettings() {
        val serverUrl = serverUrlInput.text.toString().trim()
        if (serverUrl.isEmpty()) return

        val request = Request.Builder()
            .url("$serverUrl/api/settings")
            .addHeader("Authorization", "Bearer ${getAuthToken()}")
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {}

            override fun onResponse(call: Call, response: Response) {
                if (response.isSuccessful) {
                    val body = response.body?.string() ?: return
                    val json = JSONObject(body)
                    val template = json.optString("message_template", "")
                    val delay = json.optString("delay_minutes", "120")

                    runOnUiThread {
                        templateInput.setText(template)
                        delayInput.setText(delay)
                    }
                }
            }
        })
    }

    // 설정 서버에 저장
    private fun saveSettings() {
        val serverUrl = serverUrlInput.text.toString().trim()
        if (serverUrl.isEmpty()) {
            Toast.makeText(this, "서버 주소를 먼저 입력해주세요", Toast.LENGTH_SHORT).show()
            return
        }

        val template = templateInput.text.toString()
        val delay = delayInput.text.toString().toIntOrNull() ?: 120

        val json = JSONObject().apply {
            put("message_template", template)
            put("delay_minutes", delay)
        }

        val request = Request.Builder()
            .url("$serverUrl/api/settings")
            .addHeader("Authorization", "Bearer ${getAuthToken()}")
            .put(json.toString().toRequestBody("application/json".toMediaType()))
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "서버 연결 실패", Toast.LENGTH_SHORT).show()
                }
            }

            override fun onResponse(call: Call, response: Response) {
                runOnUiThread {
                    if (response.isSuccessful) {
                        Toast.makeText(this@MainActivity, "설정 저장 완료!", Toast.LENGTH_SHORT).show()
                    } else {
                        Toast.makeText(this@MainActivity, "저장 실패", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        })
    }

    private fun requestPermissions() {
        val permissions = mutableListOf<String>()

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.SEND_SMS)
            != PackageManager.PERMISSION_GRANTED) {
            permissions.add(Manifest.permission.SEND_SMS)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }

        if (permissions.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, permissions.toTypedArray(), SMS_PERMISSION_CODE)
        }
    }

    private fun openNotificationSettings() {
        val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        startActivity(intent)
        Toast.makeText(this, "리뷰집사를 찾아서 켜주세요!", Toast.LENGTH_LONG).show()
    }

    private fun isNotificationListenerEnabled(): Boolean {
        val cn = ComponentName(this, BaeminNotificationListener::class.java)
        val flat = Settings.Secure.getString(contentResolver, "enabled_notification_listeners")
        return flat != null && flat.contains(cn.flattenToString())
    }

    private fun startService() {
        val serverUrl = serverUrlInput.text.toString().trim()

        if (serverUrl.isEmpty()) {
            Toast.makeText(this, "서버 주소를 입력해주세요", Toast.LENGTH_SHORT).show()
            return
        }

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.SEND_SMS)
            != PackageManager.PERMISSION_GRANTED) {
            Toast.makeText(this, "SMS 권한이 필요합니다", Toast.LENGTH_SHORT).show()
            requestPermissions()
            return
        }

        if (!isNotificationListenerEnabled()) {
            Toast.makeText(this, "알림 접근 권한을 먼저 켜주세요!", Toast.LENGTH_LONG).show()
            openNotificationSettings()
            return
        }

        // 서버 URL 저장
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
            .edit()
            .putString(KEY_SERVER_URL, serverUrl)
            .apply()

        val intent = Intent(this, SmsService::class.java).apply {
            putExtra("server_url", serverUrl)
        }
        ContextCompat.startForegroundService(this, intent)

        Toast.makeText(this, "문자 발송 서비스 시작!", Toast.LENGTH_SHORT).show()
        updateStatus()
    }

    private fun stopService() {
        stopService(Intent(this, SmsService::class.java))
        Toast.makeText(this, "서비스 중지됨", Toast.LENGTH_SHORT).show()
        updateStatus()
    }

    private fun updateStatus() {
        val isRunning = SmsService.isRunning
        statusText.text = if (isRunning) "● 문자 발송 서비스 실행 중" else "○ 문자 발송 서비스 중지됨"
        statusText.setTextColor(
            if (isRunning) 0xFF2D6A4F.toInt() else 0xFF999999.toInt()
        )
        startButton.isEnabled = !isRunning
        stopButton.isEnabled = isRunning

        val notifEnabled = isNotificationListenerEnabled()
        baeminStatusText.text = if (notifEnabled)
            "● 배민 주문 자동 감지 중" else "○ 배민 주문 감지 꺼짐"
        baeminStatusText.setTextColor(
            if (notifEnabled) 0xFF2D6A4F.toInt() else 0xFFD32F2F.toInt()
        )
        notificationSettingsButton.text = if (notifEnabled)
            "알림 감지 설정 변경" else "알림 접근 권한 켜기"
    }

    override fun onResume() {
        super.onResume()
        updateStatus()
        loadSettings()

        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        logText.text = prefs.getString("recent_log", "아직 발송 내역이 없습니다")
    }
}
