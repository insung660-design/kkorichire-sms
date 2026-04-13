package com.kkorichire.sms

import android.content.Intent
import android.os.Bundle
import android.webkit.*
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject

class LoginActivity : AppCompatActivity() {

    private lateinit var webView: WebView

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
        if (!token.isNullOrEmpty()) {
            goToMain()
            return
        }

        setContentView(R.layout.activity_login)
        webView = findViewById(R.id.loginWebView)

        setupWebView()
        loadLoginPage()
    }

    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            setSupportMultipleWindows(false)
        }

        webView.addJavascriptInterface(object {
            @JavascriptInterface
            fun onLoginSuccess(token: String, userName: String, userEmail: String) {
                runOnUiThread {
                    // 토큰 저장
                    getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                        .edit()
                        .putString(KEY_TOKEN, token)
                        .putString(KEY_USER_NAME, userName)
                        .putString(KEY_USER_EMAIL, userEmail)
                        .apply()

                    Toast.makeText(this@LoginActivity, "로그인 성공!", Toast.LENGTH_SHORT).show()
                    goToMain()
                }
            }
        }, "Android")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                return false
            }
        }
    }

    private fun loadLoginPage() {
        val serverUrl = getSharedPreferences(MainActivity.PREFS_NAME, MODE_PRIVATE)
            .getString(MainActivity.KEY_SERVER_URL, "") ?: ""

        if (serverUrl.isEmpty()) {
            // 서버 주소 미설정 → 기본 로그인 페이지 표시
            webView.loadData(getOfflineLoginHtml(), "text/html", "UTF-8")
        } else {
            webView.loadUrl("$serverUrl/login.html")
        }
    }

    private fun getOfflineLoginHtml(): String {
        return """
        <!DOCTYPE html>
        <html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <style>
            body{font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;
            min-height:100vh;margin:0;background:#f5f5f5;color:#333}
            h1{color:#2d6a4f;font-size:28px}
            p{color:#888;font-size:14px}
            input{width:80%;max-width:300px;padding:14px;border:2px solid #ddd;border-radius:10px;font-size:16px;margin:8px 0}
            button{width:80%;max-width:300px;padding:14px;border:none;border-radius:10px;background:#2d6a4f;color:#fff;
            font-size:16px;font-weight:bold;cursor:pointer;margin-top:12px}
        </style></head><body>
            <h1>리뷰집사</h1>
            <p>서버 주소를 먼저 설정해주세요</p>
            <input id="url" type="url" placeholder="https://kkorichire-sms.onrender.com" />
            <button onclick="save()">서버 연결</button>
            <script>
                function save(){
                    var url=document.getElementById('url').value.trim();
                    if(url) window.location.href=url+'/login.html?app=true';
                }
            </script>
        </body></html>
        """.trimIndent()
    }

    private fun goToMain() {
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }
}
