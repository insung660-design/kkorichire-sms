package com.kkorichire.sms

import android.content.Intent
import android.net.Uri
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

    private lateinit var emailInput: EditText
    private lateinit var loginButton: Button
    private lateinit var btnGoogle: Button
    private lateinit var btnKakao: Button
    private lateinit var btnNaver: Button

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    companion object {
        const val PREFS_NAME = "kkorichire_prefs"
        const val KEY_TOKEN = "auth_token"
        const val KEY_USER_NAME = "user_name"
        const val KEY_USER_EMAIL = "user_email"
        const val SERVER_URL = "https://kkorichire-sms.onrender.com"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 이미 로그인되어 있으면 메인으로
        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        val token = prefs.getString(KEY_TOKEN, "")
        if (!token.isNullOrEmpty()) {
            goToMain()
            return
        }

        setContentView(R.layout.activity_login)

        emailInput = findViewById(R.id.loginEmail)
        loginButton = findViewById(R.id.loginButton)
        btnGoogle = findViewById(R.id.btnGoogle)
        btnKakao = findViewById(R.id.btnKakao)
        btnNaver = findViewById(R.id.btnNaver)

        loginButton.setOnClickListener { loginWithEmail() }
        btnGoogle.setOnClickListener { loginSocial("google") }
        btnKakao.setOnClickListener { loginSocial("kakao") }
        btnNaver.setOnClickListener { loginSocial("naver") }
    }

    override fun onResume() {
        super.onResume()
        // 소셜 로그인 콜백 처리
        val uri = intent?.data
        if (uri != null && uri.toString().contains("/auth/app/callback")) {
            val token = uri.getQueryParameter("token")
            val name = uri.getQueryParameter("name") ?: ""
            val email = uri.getQueryParameter("email") ?: ""

            if (!token.isNullOrEmpty()) {
                getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                    .edit()
                    .putString(KEY_TOKEN, token)
                    .putString(KEY_USER_NAME, name)
                    .putString(KEY_USER_EMAIL, email)
                    .putString(MainActivity.KEY_SERVER_URL, SERVER_URL)
                    .apply()

                Toast.makeText(this, "로그인 성공!", Toast.LENGTH_SHORT).show()
                goToMain()
            }
        }
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
    }

    private fun loginSocial(provider: String) {
        // 브라우저에서 소셜 로그인 페이지 열기
        val url = "$SERVER_URL/auth/$provider/start?redirect=app"
        val browserIntent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
        startActivity(browserIntent)
    }

    private fun loginWithEmail() {
        val email = emailInput.text.toString().trim()

        if (email.isEmpty()) {
            Toast.makeText(this, "이메일을 입력해주세요", Toast.LENGTH_SHORT).show()
            return
        }

        loginButton.isEnabled = false
        loginButton.text = "연결 중..."

        val json = JSONObject().apply {
            put("email", email)
        }

        val request = Request.Builder()
            .url("$SERVER_URL/auth/simple")
            .post(json.toString().toRequestBody("application/json".toMediaType()))
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                runOnUiThread {
                    loginButton.isEnabled = true
                    loginButton.text = "이메일로 시작하기"
                    Toast.makeText(this@LoginActivity, "서버 연결 실패. 잠시 후 다시 시도해주세요.", Toast.LENGTH_LONG).show()
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
                                .putString(MainActivity.KEY_SERVER_URL, SERVER_URL)
                                .apply()

                            Toast.makeText(this@LoginActivity, "로그인 성공!", Toast.LENGTH_SHORT).show()
                            goToMain()
                        } else {
                            loginButton.isEnabled = true
                            loginButton.text = "이메일로 시작하기"
                            Toast.makeText(this@LoginActivity, data.optString("error", "로그인 실패"), Toast.LENGTH_LONG).show()
                        }
                    } catch (e: Exception) {
                        loginButton.isEnabled = true
                        loginButton.text = "이메일로 시작하기"
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
