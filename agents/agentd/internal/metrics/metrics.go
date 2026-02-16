package metrics

import (
	"net/http"
	"sync"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

var once sync.Once

var (
	wsConnected = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "agentd_ws_connected",
		Help: "Whether agentd is currently connected to the control plane (1=yes, 0=no).",
	})

	wsReconnecting = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "agentd_ws_reconnecting",
		Help: "Whether agentd is currently in a reconnect loop (1=yes, 0=no).",
	})

	wsReconnectAttemptsTotal = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "agentd_ws_reconnect_attempts_total",
		Help: "Total WebSocket reconnect attempts to the control plane.",
	})

	wsReconnectFailuresTotal = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "agentd_ws_reconnect_failures_total",
		Help: "Total WebSocket reconnect failures to the control plane.",
	})

	wsReconnectSuccessTotal = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "agentd_ws_reconnect_success_total",
		Help: "Total WebSocket reconnect successes to the control plane.",
	})

	wsReconnectBackoffSeconds = prometheus.NewHistogram(prometheus.HistogramOpts{
		Name:    "agentd_ws_reconnect_backoff_seconds",
		Help:    "Backoff delay (sleep) used before each reconnect attempt.",
		Buckets: []float64{0.25, 0.5, 1, 2, 5, 10, 30, 60},
	})
)

func initOnce() {
	once.Do(func() {
		prometheus.MustRegister(
			wsConnected,
			wsReconnecting,
			wsReconnectAttemptsTotal,
			wsReconnectFailuresTotal,
			wsReconnectSuccessTotal,
			wsReconnectBackoffSeconds,
		)
	})
}

func Handler() http.Handler {
	initOnce()
	return promhttp.Handler()
}

func SetWSConnected(connected bool) {
	initOnce()
	if connected {
		wsConnected.Set(1)
		return
	}
	wsConnected.Set(0)
}

func SetWSReconnecting(reconnecting bool) {
	initOnce()
	if reconnecting {
		wsReconnecting.Set(1)
		return
	}
	wsReconnecting.Set(0)
}

func RecordWSReconnectAttempt(delayMs int) {
	initOnce()
	wsReconnectAttemptsTotal.Inc()
	if delayMs > 0 {
		wsReconnectBackoffSeconds.Observe(float64(delayMs) / 1000.0)
	}
}

func RecordWSReconnectFailure() {
	initOnce()
	wsReconnectFailuresTotal.Inc()
}

func RecordWSReconnectSuccess() {
	initOnce()
	wsReconnectSuccessTotal.Inc()
}
