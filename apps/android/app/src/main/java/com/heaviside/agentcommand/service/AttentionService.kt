/*
 * SPDX-License-Identifier: GPL-3.0-only
 */
package com.heaviside.agentcommand.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.heaviside.agentcommand.MainActivity
import com.heaviside.agentcommand.R
import com.heaviside.agentcommand.data.AttentionChangedEvent
import com.heaviside.agentcommand.data.UiStreamEvent
import com.heaviside.agentcommand.data.AgentCommandApi
import com.heaviside.agentcommand.data.UiStreamSocket
import com.heaviside.agentcommand.domain.AttentionNotificationPolicy
import com.heaviside.agentcommand.security.SecureStore
import kotlin.concurrent.thread

/**
 * Keeps the control-plane event stream open while the app is backgrounded and
 * raises a notification when an agent becomes blocked on the operator.
 *
 * Why a foreground service rather than push: MainActivity.onStop() closes both
 * sockets, so until now the app was completely blind once backgrounded -- an
 * agent could sit on an approval prompt indefinitely with nothing reaching the
 * phone. A foreground service is the only mechanism that keeps a socket alive
 * without a Firebase project, and it works identically over the tailnet and the
 * public endpoint. FCM remains the right answer for delivery after the process
 * is killed; see docs and BACKLOG.
 */
class AttentionService : Service() {

    private var socket: UiStreamSocket? = null
    private val policy = AttentionNotificationPolicy()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannels()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopSelf()
                return START_NOT_STICKY
            }
        }

        startForeground(ONGOING_NOTIFICATION_ID, buildOngoingNotification())
        connect()
        // Restart if the system reclaims us: an operator who enabled background
        // alerts expects them to survive memory pressure.
        return START_STICKY
    }

    override fun onDestroy() {
        socket?.close()
        socket = null
        super.onDestroy()
    }

    private fun connect() {
        if (socket != null) return
        val credentials = SecureStore(applicationContext).load()
        if (credentials == null) {
            // Nothing to watch until the operator has signed in.
            stopSelf()
            return
        }

        // createUiStreamSocket mints a ticket over HTTP, so it cannot run on the
        // main thread.
        thread(name = "attention-connect") {
            val stream = runCatching {
                AgentCommandApi(credentials).createUiStreamSocket(
                    object : UiStreamSocket.Listener {
                        override fun onConnected() = Unit

                        override fun onEvent(event: UiStreamEvent) {
                            if (event is AttentionChangedEvent) handleAttention(event)
                        }

                        override fun onFailure(message: String) = Unit

                        override fun onClosed() = Unit
                    },
                )
            }.getOrNull()

            if (stream == null) {
                stopSelf()
                return@thread
            }
            socket = stream
            stream.connect()
        }
    }

    private fun handleAttention(event: AttentionChangedEvent) {
        val notification = policy.onAttentionChanged(event) ?: return
        if (!NotificationManagerCompat.from(this).areNotificationsEnabled()) return

        val open = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_SESSION_ID, notification.sessionId)
        }
        val pending = PendingIntent.getActivity(
            this,
            notification.sessionId.hashCode(),
            open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val built = NotificationCompat.Builder(this, ALERT_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_agent)
            .setContentTitle(notification.title)
            .setContentText(notification.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(notification.body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setContentIntent(pending)
            .setAutoCancel(true)
            .build()

        // One notification per session so a blocked agent replaces its own alert
        // rather than stacking a new one on every reason change.
        NotificationManagerCompat.from(this)
            .notify(notification.sessionId.hashCode(), built)
    }

    private fun buildOngoingNotification(): Notification =
        NotificationCompat.Builder(this, ONGOING_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_agent)
            .setContentTitle("Watching agents")
            .setContentText("You will be alerted when an agent needs you.")
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setOngoing(true)
            .setContentIntent(
                PendingIntent.getActivity(
                    this,
                    0,
                    Intent(this, MainActivity::class.java),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                ),
            )
            .build()

    private fun createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java) ?: return

        manager.createNotificationChannel(
            NotificationChannel(
                ONGOING_CHANNEL_ID,
                "Background watcher",
                NotificationManager.IMPORTANCE_MIN,
            ).apply {
                description = "Keeps the connection open so alerts arrive while the app is closed."
            },
        )
        manager.createNotificationChannel(
            NotificationChannel(
                ALERT_CHANNEL_ID,
                "Agent needs attention",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "An agent is waiting for approval or input."
            },
        )
    }

    companion object {
        const val EXTRA_SESSION_ID = "com.heaviside.agentcommand.SESSION_ID"

        private const val ACTION_STOP = "com.heaviside.agentcommand.STOP_ATTENTION"
        private const val ONGOING_CHANNEL_ID = "agent_watcher"
        private const val ALERT_CHANNEL_ID = "agent_attention"
        private const val ONGOING_NOTIFICATION_ID = 1

        fun start(context: Context) {
            val intent = Intent(context, AttentionService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.startService(
                Intent(context, AttentionService::class.java).setAction(ACTION_STOP),
            )
        }
    }
}
