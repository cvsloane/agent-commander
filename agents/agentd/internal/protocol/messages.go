// Package protocol defines the agentd wire contract with the control plane.
package protocol

import "encoding/json"

const Version = 1

const (
	TypeAgentHello          = "agent.hello"
	TypeAgentAck            = "agent.ack"
	TypeSessionsUpsert      = "sessions.upsert"
	TypeSessionsPrune       = "sessions.prune"
	TypeSessionsSnapshot    = "sessions.snapshot"
	TypeEventsAppend        = "events.append"
	TypeCommandsDispatch    = "commands.dispatch"
	TypeCommandsResult      = "commands.result"
	TypeConsoleChunk        = "console.chunk"
	TypeToolEventStarted    = "tool.event.started"
	TypeToolEventCompleted  = "tool.event.completed"
	TypeProviderUsage       = "provider.usage"
	TypeSessionUsage        = "session.usage"
	TypeApprovalsDecision   = "approvals.decision"
	TypeMCPListServers      = "mcp.list_servers"
	TypeMCPGetConfig        = "mcp.get_config"
	TypeMCPUpdateConfig     = "mcp.update_config"
	TypeMCPGetProjectConfig = "mcp.get_project_config"
	TypeMCPUpdateProject    = "mcp.update_project_config"
	TypeMCPServers          = "mcp.servers"
	TypeMCPConfig           = "mcp.config"
	TypeMCPProjectConfig    = "mcp.project_config"
	TypeMCPUpdateResult     = "mcp.update_result"
	TypeTerminalAttach      = "terminal.attach"
	TypeTerminalInput       = "terminal.input"
	TypeTerminalResize      = "terminal.resize"
	TypeTerminalDetach      = "terminal.detach"
	TypeTerminalControl     = "terminal.control"
	TypeTerminalOutput      = "terminal.output"
	TypeTerminalAttached    = "terminal.attached"
	TypeTerminalDetached    = "terminal.detached"
	TypeTerminalError       = "terminal.error"
	TypeTerminalReadOnly    = "terminal.readonly"
	TypeTerminalLag         = "terminal.lag"
	TypeTerminalAudit       = "terminal.audit"
	TypeTmuxTopology        = "tmux.topology"
)

// EnvelopeHeader supports direction-agnostic inspection before decoding a
// concrete production message type.
type EnvelopeHeader struct {
	V       int             `json:"v"`
	Type    string          `json:"type"`
	Seq     *int64          `json:"seq,omitempty"`
	Payload json.RawMessage `json:"payload"`
}

// AgentEnvelope is the sequenced envelope sent from agentd to the control plane.
type AgentEnvelope struct {
	V       int             `json:"v"`
	Type    string          `json:"type"`
	TS      string          `json:"ts"`
	Seq     int64           `json:"seq"`
	Payload json.RawMessage `json:"payload"`
}

// ServerEnvelope is the envelope sent from the control plane to agentd.
type ServerEnvelope struct {
	V       int             `json:"v"`
	Type    string          `json:"type"`
	TS      string          `json:"ts"`
	Payload json.RawMessage `json:"payload"`
}

// AgentMessage is a typed agent-to-control-plane message.
type AgentMessage[P any] struct {
	V       int    `json:"v"`
	Type    string `json:"type"`
	TS      string `json:"ts"`
	Seq     int64  `json:"seq"`
	Payload P      `json:"payload"`
}

// ServerMessage is a typed control-plane-to-agent message.
type ServerMessage[P any] struct {
	V       int    `json:"v"`
	Type    string `json:"type"`
	TS      string `json:"ts"`
	Payload P      `json:"payload"`
}

type HostCapabilities struct {
	Tmux                    bool            `json:"tmux"`
	Spawn                   bool            `json:"spawn"`
	Kill                    bool            `json:"kill"`
	ConsoleStream           bool            `json:"console_stream"`
	Terminal                bool            `json:"terminal"`
	ClaudeHooks             bool            `json:"claude_hooks"`
	CodexExecJSON           bool            `json:"codex_exec_json"`
	ListDirectory           *bool           `json:"list_directory,omitempty"`
	ListDirectoryRoots      []string        `json:"list_directory_roots,omitempty"`
	ListDirectoryShowHidden *bool           `json:"list_directory_show_hidden,omitempty"`
	Providers               map[string]bool `json:"providers"`
}

type AgentHostInfo struct {
	ID            string           `json:"id"`
	Name          string           `json:"name"`
	TailscaleName string           `json:"tailscale_name,omitempty"`
	TailscaleIP   string           `json:"tailscale_ip,omitempty"`
	AgentVersion  string           `json:"agent_version"`
	Capabilities  HostCapabilities `json:"capabilities"`
}

type AgentResume struct {
	LastAckedSeq int64 `json:"last_acked_seq"`
}

type AgentHelloPayload struct {
	Host   AgentHostInfo `json:"host"`
	Resume *AgentResume  `json:"resume,omitempty"`
}

type AgentAckPayload struct {
	AckSeq int64  `json:"ack_seq"`
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
}

type SessionsUpsertPayload struct {
	Sessions []SessionUpsert `json:"sessions"`
}

type SessionsPrunePayload struct {
	SessionIDs []string `json:"session_ids"`
}

type SessionSnapshotPayload struct {
	SessionID   string `json:"session_id"`
	CaptureHash string `json:"capture_hash"`
	CaptureText string `json:"capture_text"`
}

type EventsAppendPayload struct {
	SessionID string         `json:"session_id"`
	EventID   string         `json:"event_id,omitempty"`
	EventType string         `json:"event_type"`
	Payload   map[string]any `json:"payload"`
}

type ConsoleChunkPayload struct {
	SubscriptionID string `json:"subscription_id"`
	SessionID      string `json:"session_id"`
	Data           string `json:"data"`
	Offset         int64  `json:"offset"`
}

type ToolEventStartedPayload struct {
	EventID   string         `json:"event_id"`
	SessionID string         `json:"session_id"`
	Provider  string         `json:"provider"`
	ToolName  string         `json:"tool_name"`
	ToolInput map[string]any `json:"tool_input,omitempty"`
	StartedAt string         `json:"started_at"`
}

type ToolEventCompletedPayload struct {
	EventID     string         `json:"event_id"`
	ToolOutput  map[string]any `json:"tool_output,omitempty"`
	CompletedAt string         `json:"completed_at"`
	Success     bool           `json:"success"`
	DurationMS  int64          `json:"duration_ms"`
}

type ApprovalDecisionPayload struct {
	ApprovalID   string `json:"approval_id"`
	SessionID    string `json:"session_id"`
	Decision     string `json:"decision"`
	Mode         string `json:"mode"`
	UpdatedInput any    `json:"updated_input,omitempty"`
}
