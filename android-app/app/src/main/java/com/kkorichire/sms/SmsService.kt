package com.kkorichire.sms

import android.app.*
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.telephony.SmsManager
import android.util.Log
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

class SmsService : Service() {

    companion object {
        const val TAG = "KkorichireSMS"
        const val CHANNEL_ID = "kkorichire_sms_channel"
        const val NOTIFICATION_ID = 1
        const val POLL_INTERVAL_SECONDS = 30L
        var isRunning = false
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    private val scheduler = Executors.newSingleThreadScheduledExecutor()
    private var pollTask: ScheduledFuture<*>? = null
    private var serverUrl = ""
    private var authToken = ""

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        serverUrl = intent?.getStringExtra("server_url") ?: ""
        val prefs = getSharedPreferences(LoginActivity.PREFS_NAME, MODE_PRIVATE)
        authToken = prefs.getString(LoginActivity.KEY_TOKEN, "") ?: ""

        if (serverUrl.isEmpty()) {
            stopSelf()
            return START_NOT_STICKY
        }

        // 포그라운드 서비스 시작
        val notification = buildNotification("서버 연결 중...")
        startForeground(NOTIFICATION_ID, notification)

        isRunning = true

        // 주기적으로 서버에서 대기 메시지 확인
        pollTask = scheduler.scheduleWithFixedDelay(
            { pollAndSend() },
            0,
            POLL_INTERVAL_SECONDS,
            TimeUnit.SECONDS
        )

        // heartbeat 전송 (1분마다)
        scheduler.scheduleWithFixedDelay(
            { sendHeartbeat() },
            0,
            60,
            TimeUnit.SECONDS
        )

        return START_STICKY
    }

    override fun onDestroy() {
        isRunning = false
        pollTask?.cancel(false)
        scheduler.shutdownNow()
        super.onDestroy()
    }

    private fun pollAndSend() {
        try {
            val request = Request.Builder()
                .url("$serverUrl/api/phone/pending")
                .addHeader("Authorization", "Bearer $authToken")
                .build()

            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    Log.w(TAG, "서버 응답 오류: ${response.code}")
                    return
                }

                val body = response.body?.string() ?: return
                val messages = JSONArray(body)

                if (messages.length() > 0) {
                    Log.i(TAG, "대기 메시지 ${messages.length()}건 발견")
                    updateNotification("${messages.length()}건 발송 중...")
                }

                for (i in 0 until messages.length()) {
                    val msg = messages.getJSONObject(i)
                    val id = msg.getInt("id")
                    val phone = msg.getString("phone")
                    val message = msg.getString("message")

                    sendSmsAndReport(id, phone, message)

                    // 연속 발송 시 간격 두기
                    if (i < messages.length() - 1) {
                        Thread.sleep(3000)
                    }
                }

                if (messages.length() > 0) {
                    updateNotification("대기 중")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "폴링 오류: ${e.message}")
        }
    }

    private fun sendSmsAndReport(id: Int, phone: String, message: String) {
        try {
            // SMS 발송
            val smsManager = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                getSystemService(SmsManager::class.java)
            } else {
                @Suppress("DEPRECATION")
                SmsManager.getDefault()
            }

            // 긴 메시지는 분할 발송
            val parts = smsManager.divideMessage(message)
            if (parts.size > 1) {
                smsManager.sendMultipartTextMessage(phone, null, parts, null, null)
            } else {
                smsManager.sendTextMessage(phone, null, message, null, null)
            }

            Log.i(TAG, "SMS 발송 성공: $phone")
            addLog("발송 성공: $phone")

            // 서버에 성공 보고
            reportToServer(id, true, null)

        } catch (e: Exception) {
            Log.e(TAG, "SMS 발송 실패: $phone - ${e.message}")
            addLog("발송 실패: $phone - ${e.message}")

            // 서버에 실패 보고
            reportToServer(id, false, e.message)
        }
    }

    private fun reportToServer(id: Int, success: Boolean, error: String?) {
        try {
            val json = JSONObject().apply {
                put("id", id)
                put("success", success)
                if (error != null) put("error", error)
            }

            val request = Request.Builder()
                .url("$serverUrl/api/phone/report")
                .addHeader("Authorization", "Bearer $authToken")
                .post(json.toString().toRequestBody("application/json".toMediaType()))
                .build()

            client.newCall(request).execute().close()
        } catch (e: Exception) {
            Log.e(TAG, "서버 보고 실패: ${e.message}")
        }
    }

    private fun sendHeartbeat() {
        try {
            val request = Request.Builder()
                .url("$serverUrl/api/phone/heartbeat")
                .addHeader("Authorization", "Bearer $authToken")
                .post("{}".toRequestBody("application/json".toMediaType()))
                .build()

            client.newCall(request).execute().close()
        } catch (e: Exception) {
            Log.w(TAG, "Heartbeat 실패: ${e.message}")
        }
    }

    private fun addLog(text: String) {
        val time = SimpleDateFormat("HH:mm:ss", Locale.KOREA).format(Date())
        val logEntry = "[$time] $text"

        val prefs = getSharedPreferences(MainActivity.PREFS_NAME, MODE_PRIVATE)
        val existingLog = prefs.getString("recent_log", "") ?: ""
        val lines = existingLog.split("\n").takeLast(19) // 최근 20줄 유지
        val newLog = (lines + logEntry).joinToString("\n")
        prefs.edit().putString("recent_log", newLog).apply()
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "리뷰집사 문자 발송",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "자동 문자 발송 서비스"
        }
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(text: String): Notification {
        val intent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, intent, PendingIntent.FLAG_IMMUTABLE
        )

        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("리뷰집사")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    }

    private fun updateNotification(text: String) {
        val notification = buildNotification(text)
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(NOTIFICATION_ID, notification)
    }
}
