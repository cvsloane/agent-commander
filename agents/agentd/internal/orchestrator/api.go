package orchestrator

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

const SessionHeader = "X-AC-Session-Id"

type SpawnRequest struct {
	Provider    string            `json:"provider"`
	CWD         string            `json:"cwd"`
	Prompt      string            `json:"prompt,omitempty"`
	Placement   string            `json:"placement"`
	SplitTarget string            `json:"split_target,omitempty"`
	Name        string            `json:"name,omitempty"`
	Env         map[string]string `json:"env,omitempty"`
	Flags       []string          `json:"flags,omitempty"`
}

type SpawnResponse struct {
	SessionID  string `json:"session_id"`
	TmuxTarget string `json:"tmux_target"`
	PaneID     string `json:"pane_id"`
}

type Session struct {
	SessionID       string   `json:"session_id"`
	PaneID          string   `json:"pane_id,omitempty"`
	TmuxTarget      string   `json:"tmux_target,omitempty"`
	Provider        string   `json:"provider"`
	Status          string   `json:"status"`
	Title           string   `json:"name,omitempty"`
	CWD             string   `json:"cwd,omitempty"`
	ParentSessionID string   `json:"parent_session_id,omitempty"`
	ChildSessionIDs []string `json:"child_session_ids"`
}

type SendRequest struct {
	SessionID string `json:"session_id"`
	Input     string `json:"input"`
	Enter     *bool  `json:"enter,omitempty"`
}

func (r SendRequest) ShouldEnter() bool {
	return r.Enter == nil || *r.Enter
}

type KillRequest struct {
	SessionID string `json:"session_id"`
	Tree      bool   `json:"tree,omitempty"`
}

type KillResponse struct {
	KilledSessionIDs []string `json:"killed_session_ids"`
}

type WaitRequest struct {
	SessionID string `json:"session_id"`
	Until     string `json:"until"`
	TimeoutMS int    `json:"timeout_ms"`
}

type WaitResponse struct {
	Session Session `json:"session"`
}

type ReportRequest struct {
	Outcome string `json:"outcome"`
	Summary string `json:"summary"`
	Detail  string `json:"detail,omitempty"`
}

type Backend interface {
	HasSession(sessionID string) bool
	Spawn(ctx context.Context, callerSessionID string, request SpawnRequest) (SpawnResponse, error)
	ListSessions(ctx context.Context, callerSessionID string) ([]Session, error)
	Send(ctx context.Context, callerSessionID string, request SendRequest) error
	Kill(ctx context.Context, callerSessionID string, request KillRequest) (KillResponse, error)
	Wait(ctx context.Context, callerSessionID string, request WaitRequest) (WaitResponse, error)
	Report(ctx context.Context, callerSessionID string, request ReportRequest) error
}

type HTTPError struct {
	Status  int
	Message string
}

func (e *HTTPError) Error() string { return e.Message }

func BadRequest(message string) error {
	return &HTTPError{Status: http.StatusBadRequest, Message: message}
}

func NotFound(message string) error {
	return &HTTPError{Status: http.StatusNotFound, Message: message}
}

func Forbidden(message string) error {
	return &HTTPError{Status: http.StatusForbidden, Message: message}
}

func Timeout(message string) error {
	return &HTTPError{Status: http.StatusRequestTimeout, Message: message}
}

func TooManyRequests(message string) error {
	return &HTTPError{Status: http.StatusTooManyRequests, Message: message}
}

func InternalError(message string) error {
	return &HTTPError{Status: http.StatusInternalServerError, Message: message}
}

type handler struct {
	backend Backend
}

func NewHandler(backend Backend) http.Handler {
	return &handler{backend: backend}
}

func (h *handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !isLoopback(r.RemoteAddr) {
		writeError(w, http.StatusForbidden, "orchestrator API is loopback-only")
		return
	}

	callerSessionID := strings.TrimSpace(r.Header.Get(SessionHeader))
	if callerSessionID == "" || !h.backend.HasSession(callerSessionID) {
		writeError(w, http.StatusUnauthorized, "a currently tracked session is required")
		return
	}

	var err error
	switch {
	case r.Method == http.MethodPost && r.URL.Path == "/v1/agent/spawn":
		var request SpawnRequest
		if !decodeRequest(w, r, &request) {
			return
		}
		var response SpawnResponse
		response, err = h.backend.Spawn(r.Context(), callerSessionID, request)
		if err == nil {
			writeJSON(w, http.StatusCreated, response)
			return
		}
	case r.Method == http.MethodGet && r.URL.Path == "/v1/agent/sessions":
		var sessions []Session
		sessions, err = h.backend.ListSessions(r.Context(), callerSessionID)
		if err == nil {
			if sessions == nil {
				sessions = []Session{}
			}
			writeJSON(w, http.StatusOK, map[string]any{"sessions": sessions})
			return
		}
	case r.Method == http.MethodPost && r.URL.Path == "/v1/agent/send":
		var request SendRequest
		if !decodeRequest(w, r, &request) {
			return
		}
		err = h.backend.Send(r.Context(), callerSessionID, request)
		if err == nil {
			writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
			return
		}
	case r.Method == http.MethodPost && r.URL.Path == "/v1/agent/kill":
		var request KillRequest
		if !decodeRequest(w, r, &request) {
			return
		}
		var response KillResponse
		response, err = h.backend.Kill(r.Context(), callerSessionID, request)
		if err == nil {
			writeJSON(w, http.StatusOK, response)
			return
		}
	case r.Method == http.MethodPost && r.URL.Path == "/v1/agent/wait":
		var request WaitRequest
		if !decodeRequest(w, r, &request) {
			return
		}
		var response WaitResponse
		response, err = h.backend.Wait(r.Context(), callerSessionID, request)
		if err == nil {
			writeJSON(w, http.StatusOK, response)
			return
		}
	case r.Method == http.MethodPost && r.URL.Path == "/v1/agent/report":
		var request ReportRequest
		if !decodeRequest(w, r, &request) {
			return
		}
		err = h.backend.Report(r.Context(), callerSessionID, request)
		if err == nil {
			writeJSON(w, http.StatusAccepted, map[string]bool{"ok": true})
			return
		}
	default:
		if strings.HasPrefix(r.URL.Path, "/v1/agent/") {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		} else {
			writeError(w, http.StatusNotFound, "not found")
		}
		return
	}

	writeBackendError(w, err)
}

func isLoopback(remoteAddr string) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	ip := net.ParseIP(strings.Trim(host, "[]"))
	return ip != nil && ip.IsLoopback()
}

func decodeRequest(w http.ResponseWriter, r *http.Request, target any) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid JSON body: %v", err))
		return false
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "request body must contain one JSON object")
		return false
	}
	return true
}

func writeBackendError(w http.ResponseWriter, err error) {
	var httpErr *HTTPError
	if errors.As(err, &httpErr) {
		writeError(w, httpErr.Status, httpErr.Message)
		return
	}
	writeError(w, http.StatusInternalServerError, "internal error")
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func ValidateTimeout(timeoutMS int) (time.Duration, error) {
	if timeoutMS <= 0 {
		return 0, BadRequest("timeout_ms must be positive")
	}
	if timeoutMS > int((10 * time.Minute).Milliseconds()) {
		return 0, BadRequest("timeout_ms must not exceed 600000")
	}
	return time.Duration(timeoutMS) * time.Millisecond, nil
}
