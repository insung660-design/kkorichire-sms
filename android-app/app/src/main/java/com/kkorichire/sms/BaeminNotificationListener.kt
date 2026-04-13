package com.kkorichire.sms

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class BaeminNotificationListener : NotificationListenerService() {

    companion object {
        const val TAG = "BaeminListener"

        // 배달의민족 사장님 앱 패키지명
        val BAEMIN_PACKAGES = setOf(
            "com.baemin.ceo",              // 배민사장님
            "com.woowahan.ceo",            // 배민사장님 (구버전)
            "com.baemin.owner",            // 배민사장님 (다른 버전)
            "com.woowahan.baemin.ceo"      // 배민사장님 (또 다른 버전)
        )

        // 전화번호 패턴 (010, 050 등)
        val PHONE_PATTERN = Regex("""(01[0-9][-\s]?\d{3,4}[-\s]?\d{4}|050[-\s]?\d{3,4}[-\s]?\d{4})""")
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    private val executor = Executors.newSingleThreadExecutor()

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        sbn ?: return

        val packageName = sbn.packageName

        // 배민사장님 앱의 알림인지 확인
        if (packageName !in BAEMIN_PACKAGES) return

        val notification = sbn.notification
        val extras = notification.extras

        // 알림 내용 추출
        val title = extras.getCharSequence("android.title")?.toString() ?: ""
        val text = extras.getCharSequence("android.text")?.toString() ?: ""
        val bigText = extras.getCharSequence("android.bigText")?.toString() ?: ""

        val fullText = "$title $text $bigText"
        Log.i(TAG, "배민 알림 감지: $fullText")

        // 전화번호 추출
        val phoneMatch = PHONE_PATTERN.find(fullText)
        if (phoneMatch != null) {
            val phone = phoneMatch.value.replace(Regex("[-\\s]"), "")
            Log.i(TAG, "전화번호 추출: $phone")

            // 서버에 자동 등록
            registerOrder(phone)
        } else {
            Log.i(TAG, "전화번호를 찾을 수 없음: $fullText")
        }
    }

    private fun registerOrder(phone: String) {
        executor.execute {
            try {
                val prefs = getSharedPreferences(MainActivity.PREFS_NAME, MODE_PRIVATE)
                val serverUrl = prefs.getString(MainActivity.KEY_SERVER_URL, "") ?: ""

                if (serverUrl.isEmpty()) {
                    Log.w(TAG, "서버 URL 미설정")
                    return@execute
                }

                val json = JSONObject().apply {
                    put("phone", phone)
                }

                val request = Request.Builder()
                    .url("$serverUrl/api/order")
                    .post(json.toString().toRequestBody("application/json".toMediaType()))
                    .build()

                client.newCall(request).execute().use { response ->
                    if (response.isSuccessful) {
                        Log.i(TAG, "주문 자동 등록 성공: $phone")

                        // 로그 저장
                        val time = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.KOREA)
                            .format(java.util.Date())
                        val existingLog = prefs.getString("recent_log", "") ?: ""
                        val lines = existingLog.split("\n").takeLast(19)
                        val newLog = (lines + "[$time] 배민 주문 자동 등록: $phone").joinToString("\n")
                        prefs.edit().putString("recent_log", newLog).apply()
                    } else {
                        Log.e(TAG, "주문 등록 실패: ${response.code}")
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "주문 등록 오류: ${e.message}")
            }
        }
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        // 무시
    }
}
