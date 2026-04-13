package com.kkorichire.sms

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

class LoginActivity : AppCompatActivity() {

    private lateinit var serverUrlInput: EditText
    private lateinit var emailInput: EditText
    private lateinit var loginButton: Button

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    companion object {
        const val PREFS_NAME = "kkorichire_prefs"
        const val KEY_TOKEN = "auth_token"
        const val KEY_USER_NAME = "user_name"
        const val KEY_USER_EMAIL = "user_email"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 이미 로그인되어 있으면 메인으로
        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        val token = prefs.getString(KEY_TOKEN, "")
        val serverUrl = prefs.getString(MainActivity.KEY_SERVER_URL, "")
        if (!token.isNullOrEmpty() && !serverUrl.isNullOrEmpty()) {
            goToMain()
            return
        }

        setContentView(R.layout.activity_login)

        serverUrlInput = findViewById(R.id.loginServerUrl)
        emailInput = findViewById(R.id.loginEmail)
        loginButton = findViewById(R.id.loginButton)

        // 저장된 서버 URL 복원
        if (!serverUrl.isNullOrEmpty()) {
            serverUrlInput.setText(serverUrl)
        }

        loginButton.setOnClickListener { login() }
    }

    private fun login() {
        val serverUrl = serverUrlInput.text.toString().trim()
        val email = emailInput.text.toString().trim()

        if (serverUrl.isEmpty()) {
            Toast.makeText(this, "서버 주소를 입력해주세요", Toast.LENGTH_SHORT).show()
            return
        }

        if (email.isEmpty()) {
            Toast.makeText(this, "이메일을 입력해주세요", Toast.LENGTH_SHORT).show()
            return
        }

        loginButton.isEnabled = false
        loginButton.text = "연결 중..."

        // 간편 로그인: 이메일로 자동 가입/로그인
        val json = JSONObject().apply {
            put("email", email)
        }

        val request = Request.Builder()
            .url("$serverUrl/auth/simple")
            .post(json.toString().toRequestBody("application/json".toMediaType()))
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                runOnUiThread {
                    loginButton.isEnabled = true
                    loginButton.text = "시작하기"
                    Toast.makeText(this@LoginActivity, "서버 연결 실패. 주소를 확인해주세요.", Toast.LENGTH_LONG).show()
                }
            }

            override fun onResponse(call: Call, response: Response) {
                val body = response.body?.string() ?: ""
                runOnUiThread {
                    try {
                        val data = JSONObject(body)
                        if (data.optBoolean("success")) {
                            val token = data.getString("token")
                            val user = data.getJSONObject("user")

                            getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                                .edit()
                                .putString(KEY_TOKEN, token)
                                .putString(KEY_USER_NAME, user.optString("name", email))
                                .putString(KEY_USER_EMAIL, user.optString("email", email))
                                .putString(MainActivity.KEY_SERVER_URL, serverUrl)
                                .apply()

                            Toast.makeText(this@LoginActivity, "로그인 성공!", Toast.LENGTH_SHORT).show()
                            goToMain()
                        } else {
                            loginButton.isEnabled = true
                            loginButton.text = "시작하기"
                            Toast.makeText(this@LoginActivity, data.optString("error", "로그인 실패"), Toast.LENGTH_LONG).show()
                        }
                    } catch (e: Exception) {
                        loginButton.isEnabled = true
                        loginButton.text = "시작하기"
                        Toast.makeText(this@LoginActivity, "서버 응답 오류", Toast.LENGTH_LONG).show()
                    }
                }
            }
        })
    }

    private fun goToMain() {
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }
}
