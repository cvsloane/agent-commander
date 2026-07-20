package orchestrator

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

type stubBackend struct {
	tracked map[string]bool
}

func (b *stubBackend) HasSession(sessionID string) bool {
	return b.tracked[sessionID]
}

func (b *stubBackend) Spawn(context.Context, string, SpawnRequest) (SpawnResponse, error) {
	return SpawnResponse{}, nil
}

func (b *stubBackend) ListSessions(context.Context, string) ([]Session, error) {
	return nil, nil
}

func (b *stubBackend) Send(context.Context, string, SendRequest) error { return nil }

func (b *stubBackend) Kill(context.Context, string, KillRequest) (KillResponse, error) {
	return KillResponse{}, nil
}

func (b *stubBackend) Wait(context.Context, string, WaitRequest) (WaitResponse, error) {
	return WaitResponse{}, nil
}

func (b *stubBackend) Report(context.Context, string, ReportRequest) error { return nil }

func TestAPIRejectsRequestsWithoutTrackedLoopbackSession(t *testing.T) {
	handler := NewHandler(&stubBackend{tracked: map[string]bool{"session-1": true}})

	tests := []struct {
		name       string
		header     string
		remoteAddr string
		wantStatus int
	}{
		{name: "missing session header", remoteAddr: "127.0.0.1:4000", wantStatus: http.StatusUnauthorized},
		{name: "unknown session", header: "not-tracked", remoteAddr: "127.0.0.1:4000", wantStatus: http.StatusUnauthorized},
		{name: "non-loopback caller", header: "session-1", remoteAddr: "192.0.2.10:4000", wantStatus: http.StatusForbidden},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/v1/agent/sessions", nil)
			req.RemoteAddr = tt.remoteAddr
			if tt.header != "" {
				req.Header.Set(SessionHeader, tt.header)
			}
			res := httptest.NewRecorder()

			handler.ServeHTTP(res, req)

			if res.Code != tt.wantStatus {
				t.Fatalf("status=%d, want=%d; body=%s", res.Code, tt.wantStatus, res.Body.String())
			}
		})
	}
}

func TestAPIAcceptsTrackedLoopbackSession(t *testing.T) {
	handler := NewHandler(&stubBackend{tracked: map[string]bool{"session-1": true}})
	req := httptest.NewRequest(http.MethodGet, "/v1/agent/sessions", nil)
	req.RemoteAddr = "127.0.0.1:4000"
	req.Header.Set(SessionHeader, "session-1")
	res := httptest.NewRecorder()

	handler.ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("status=%d, want=%d; body=%s", res.Code, http.StatusOK, res.Body.String())
	}
}
