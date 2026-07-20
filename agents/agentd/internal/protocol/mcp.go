package protocol

type MCPEnablement struct {
	Enabled bool   `json:"enabled"`
	Scope   string `json:"scope,omitempty"`
}

type MCPServer struct {
	Name        string            `json:"name"`
	DisplayName string            `json:"display_name,omitempty"`
	Description string            `json:"description,omitempty"`
	Transport   string            `json:"transport"`
	Command     string            `json:"command,omitempty"`
	Args        []string          `json:"args,omitempty"`
	URL         string            `json:"url,omitempty"`
	Env         map[string]string `json:"env,omitempty"`
	HasSecrets  bool              `json:"has_secrets"`
	Poolable    bool              `json:"poolable"`
}

type MCPPoolConfig struct {
	Enabled     bool     `json:"enabled"`
	PoolAll     bool     `json:"pool_all"`
	ExcludeMCPs []string `json:"exclude_mcps,omitempty"`
}

type MCPListServersPayload struct {
	CmdID  string `json:"cmd_id"`
	HostID string `json:"host_id"`
}

type MCPGetConfigPayload struct {
	CmdID     string `json:"cmd_id"`
	SessionID string `json:"session_id"`
}

type MCPUpdateConfigPayload struct {
	CmdID      string                   `json:"cmd_id"`
	SessionID  string                   `json:"session_id"`
	Enablement map[string]MCPEnablement `json:"enablement"`
}

type MCPGetProjectConfigPayload struct {
	CmdID    string `json:"cmd_id"`
	RepoRoot string `json:"repo_root"`
}

type MCPUpdateProjectConfigPayload struct {
	CmdID      string                   `json:"cmd_id"`
	RepoRoot   string                   `json:"repo_root"`
	Enablement map[string]MCPEnablement `json:"enablement"`
}

type MCPServersPayload struct {
	CmdID      string        `json:"cmd_id"`
	Servers    []MCPServer   `json:"servers"`
	PoolConfig MCPPoolConfig `json:"pool_config,omitempty"`
}

type MCPConfigPayload struct {
	CmdID           string                   `json:"cmd_id"`
	SessionID       string                   `json:"session_id"`
	Servers         []MCPServer              `json:"servers"`
	Enablement      map[string]MCPEnablement `json:"enablement"`
	RestartRequired bool                     `json:"restart_required"`
}

type MCPProjectConfigPayload struct {
	CmdID      string                   `json:"cmd_id"`
	Enablement map[string]MCPEnablement `json:"enablement"`
}

type MCPUpdateResultPayload struct {
	CmdID           string `json:"cmd_id"`
	Success         bool   `json:"success"`
	RestartRequired bool   `json:"restart_required"`
	Error           string `json:"error,omitempty"`
}
