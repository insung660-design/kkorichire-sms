package com.kkorichire.sms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            val prefs = context.getSharedPreferences(MainActivity.PREFS_NAME, Context.MODE_PRIVATE)
            val serverUrl = prefs.getString(MainActivity.KEY_SERVER_URL, "") ?: ""

            if (serverUrl.isNotEmpty()) {
                val serviceIntent = Intent(context, SmsService::class.java).apply {
                    putExtra("server_url", serverUrl)
                }
                ContextCompat.startForegroundService(context, serviceIntent)
            }
        }
    }
}
