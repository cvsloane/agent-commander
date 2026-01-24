package providers

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/agent-command/agentd/internal/config"
	"github.com/google/uuid"
)

type ClaudeHookPayload struct {
	Hook json.RawMessage `json:"hook"`
	Meta struct {
		TmuxPane    string `json:"tmux_pane"`
		PWD         string `json:"pwd"`
		ACSessionID string `json:"ac_session_id"`
		HookPID     int    `json:"hook_pid"`
	} `json:"meta"`
	ApprovalID string `json:"-"`
}

type ApprovalDecision struct {
	Decision     string `json:"decision"`      // "allow" or "deny"
	Mode         string `json:"mode"`          // "hook", "keystroke", "both"
	UpdatedInput any    `json:"updated_input"` // optional
}

type ClaudeHookHandler func(payload ClaudeHookPayload) (*ApprovalDecision, error)

type ClaudeProvider struct {
	cfg          *config.ClaudeConfig
	server       *http.Server
	handler      ClaudeHookHandler
	codexHandler ClaudeHookHandler

	// Pending approval requests waiting for decisions
	pendingApprovals map[string]chan *ApprovalDecision
	mu               sync.Mutex
}

func NewClaudeProvider(cfg *config.ClaudeConfig) *ClaudeProvider {
	return &ClaudeProvider{
		cfg:              cfg,
		pendingApprovals: make(map[string]chan *ApprovalDecision),
	}
}

func (p *ClaudeProvider) SetHookHandler(handler ClaudeHookHandler) {
	p.handler = handler
}

func (p *ClaudeProvider) SetCodexHookHandler(handler ClaudeHookHandler) {
	p.codexHandler = handler
}

func (p *ClaudeProvider) Start() error {
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/hooks/claude", p.handleHook)
	mux.HandleFunc("/v1/hooks/codex", p.handleCodexHook)

	p.server = &http.Server{
		Addr:    p.cfg.HooksHTTPListen,
		Handler: mux,
	}

	go func() {
		log.Printf("Claude hooks HTTP server listening on %s", p.cfg.HooksHTTPListen)
		if err := p.server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("Claude hooks server error: %v", err)
		}
	}()

	return nil
}

func (p *ClaudeProvider) Stop() error {
	if p.server != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return p.server.Shutdown(ctx)
	}
	return nil
}

func (p *ClaudeProvider) handleHook(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read body", http.StatusBadRequest)
		return
	}

	var payload ClaudeHookPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// Check if this is a permission request that needs to wait
	var hookData map[string]any
	if err := json.Unmarshal(payload.Hook, &hookData); err == nil {
		hookName, _ := hookData["hook_name"].(string)

		if hookName == "PermissionRequest" {
			// Generate approval ID
			approvalID := uuid.New().String()
			payload.ApprovalID = approvalID

			// Create channel for decision
			decisionCh := make(chan *ApprovalDecision, 1)
			p.mu.Lock()
			p.pendingApprovals[approvalID] = decisionCh
			p.mu.Unlock()

			// Call handler (async, will send approval to control plane)
			if p.handler != nil {
				go func() {
					decision, _ := p.handler(payload)
					if decision != nil {
						p.DeliverDecision(approvalID, decision)
					}
				}()
			}

			// Wait for decision (with timeout)
			select {
			case decision := <-decisionCh:
				p.mu.Lock()
				delete(p.pendingApprovals, approvalID)
				p.mu.Unlock()

				if decision != nil {
					// Return Claude-compatible decision JSON
					claudeDecision := map[string]any{
						"hookSpecificOutput": map[string]any{
							"hookEventName": "PermissionRequest",
							"decision": map[string]any{
								"behavior": decision.Decision,
							},
						},
					}
					if decision.UpdatedInput != nil {
						claudeDecision["hookSpecificOutput"].(map[string]any)["decision"].(map[string]any)["updatedInput"] = decision.UpdatedInput
					}
					w.Header().Set("Content-Type", "application/json")
					json.NewEncoder(w).Encode(claudeDecision)
					return
				}

			case <-time.After(10 * time.Minute):
				p.mu.Lock()
				delete(p.pendingApprovals, approvalID)
				p.mu.Unlock()
			}

			// No decision - return empty (Claude will show dialog)
			w.WriteHeader(http.StatusNoContent)
			return
		}
	}

	// For non-permission requests, just call handler and return
	if p.handler != nil {
		p.handler(payload)
	}

	w.WriteHeader(http.StatusOK)
}

func (p *ClaudeProvider) handleCodexHook(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read body", http.StatusBadRequest)
		return
	}

	var payload ClaudeHookPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if p.codexHandler != nil {
		go p.codexHandler(payload)
	}

	w.WriteHeader(http.StatusNoContent)
}

// DeliverDecision delivers an approval decision to a waiting hook
func (p *ClaudeProvider) DeliverDecision(approvalID string, decision *ApprovalDecision) bool {
	p.mu.Lock()
	ch, ok := p.pendingApprovals[approvalID]
	p.mu.Unlock()

	if !ok {
		return false
	}

	select {
	case ch <- decision:
		return true
	default:
		return false
	}
}

// MapHookToStatus maps Claude hook events to normalized session status
func MapHookToStatus(hookName string, hookData map[string]any) string {
	switch hookName {
	case "PreToolUse":
		return "RUNNING"
	case "PostToolUse":
		// Check if there was an error
		if result, ok := hookData["tool_result"].(map[string]any); ok {
			if errField, ok := result["error"]; ok && errField != nil {
				return "ERROR"
			}
		}
		return "RUNNING"
	case "Notification":
		if notifType, ok := hookData["notification"].(map[string]any); ok {
			if t, ok := notifType["type"].(string); ok {
				switch t {
				case "idle_prompt":
					return "WAITING_FOR_INPUT"
				case "permission_prompt":
					return "WAITING_FOR_APPROVAL"
				default:
					lower := strings.ToLower(t)
					if strings.Contains(lower, "plan") || strings.Contains(lower, "approval") || strings.Contains(lower, "permission") {
						return "WAITING_FOR_APPROVAL"
					}
				}
			}
		}
		return ""
	case "PermissionRequest":
		return "WAITING_FOR_APPROVAL"
	case "Stop":
		return "IDLE"
	case "SessionEnd":
		return "DONE"
	case "SessionStart":
		return "STARTING"
	}
	return ""
}

// GetApprovalKeys returns the keys to send for approval/denial
func (p *ClaudeProvider) GetApprovalKeys(allow bool) []string {
	if allow {
		return p.cfg.ApprovalAllowKeys
	}
	return p.cfg.ApprovalDenyKeys
}
