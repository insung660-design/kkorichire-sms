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

class MainActivity : AppCompatActivity() {

    private lateinit var serverUrlInput: EditText
    private lateinit var statusText: TextView
    private lateinit var baeminStatusText: TextView
    private lateinit var logText: TextView
    private lateinit var startButton: Button
    private lateinit var stopButton: Button
    private lateinit var notificationSettingsButton: Button

    companion object {
        const val PREFS_NAME = "kkorichire_prefs"
        const val KEY_SERVER_URL = "server_url"
        const val SMS_PERMISSION_CODE = 100
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        serverUrlInput = findViewById(R.id.serverUrlInput)
        statusText = findViewById(R.id.statusText)
        baeminStatusText = findViewById(R.id.baeminStatusText)
        logText = findViewById(R.id.logText)
        startButton = findViewById(R.id.startButton)
        stopButton = findViewById(R.id.stopButton)
        notificationSettingsButton = findViewById(R.id.notificationSettingsButton)

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

        updateStatus()
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

    // 알림 접근 권한 설정 화면 열기
    private fun openNotificationSettings() {
        val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        startActivity(intent)
        Toast.makeText(this, "꼬리치레 SMS를 찾아서 켜주세요!", Toast.LENGTH_LONG).show()
    }

    // 알림 접근 권한 확인
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

        // 서비스 시작
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
        // SMS 서비스 상태
        val isRunning = SmsService.isRunning
        statusText.text = if (isRunning) "● 문자 발송 서비스 실행 중" else "○ 문자 발송 서비스 중지됨"
        statusText.setTextColor(
            if (isRunning) 0xFF2D6A4F.toInt() else 0xFF999999.toInt()
        )
        startButton.isEnabled = !isRunning
        stopButton.isEnabled = isRunning

        // 배민 알림 감지 상태
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

        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        logText.text = prefs.getString("recent_log", "아직 발송 내역이 없습니다")
    }
}
