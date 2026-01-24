package config

import (
	"os"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Host         HostConfig         `yaml:"host"`
	ControlPlane ControlPlaneConfig `yaml:"control_plane"`
	Tmux         TmuxConfig         `yaml:"tmux"`
	Spawn        SpawnConfig        `yaml:"spawn"`
	Security     SecurityConfig     `yaml:"security"`
	Providers    ProvidersConfig    `yaml:"providers"`
	Storage      StorageConfig      `yaml:"storage"`
}

type HostConfig struct {
	ID   string `yaml:"id"`
	Name string `yaml:"name"`
}

type ControlPlaneConfig struct {
	WSURL              string `yaml:"ws_url"`
	Token              string `yaml:"token"`
	ReconnectBackoffMs []int  `yaml:"reconnect_backoff_ms"`
}

type TmuxConfig struct {
	Bin                string `yaml:"bin"`
	Socket             string `yaml:"socket"`
	PollIntervalMs     int    `yaml:"poll_interval_ms"`
	SnapshotLines      int    `yaml:"snapshot_lines"`
	SnapshotIntervalMs int    `yaml:"snapshot_interval_ms"`
	SnapshotMaxBytes   int    `yaml:"snapshot_max_bytes"`
	OptionSessionID    string `yaml:"option_session_id"`
}

type SpawnConfig struct {
	TmuxSessionName string `yaml:"tmux_session_name"`
	DefaultShell    string `yaml:"default_shell"`
	WorktreesRoot   string `yaml:"worktrees_root"`
}

type SecurityConfig struct {
	AllowSendInput     bool `yaml:"allow_send_input"`
	AllowKill          bool `yaml:"allow_kill"`
	AllowSpawn         bool `yaml:"allow_spawn"`
	AllowConsoleStream bool `yaml:"allow_console_stream"`
}

type ProvidersConfig struct {
	Claude ClaudeConfig `yaml:"claude"`
	Codex  CodexConfig  `yaml:"codex"`
	Gemini GeminiConfig `yaml:"gemini"`
}

type ClaudeConfig struct {
	HooksHTTPListen    string   `yaml:"hooks_http_listen"`
	PermissionStrategy string   `yaml:"permission_strategy"`
	ApprovalAllowKeys  []string `yaml:"approval_allow_keys"`
	ApprovalDenyKeys   []string `yaml:"approval_deny_keys"`
	UsageCommand       string   `yaml:"usage_command"`
	UsageIntervalMs    int      `yaml:"usage_interval_ms"`
	UsageParseJSON     bool     `yaml:"usage_parse_json"`
	UsageSessionName   string   `yaml:"usage_session_name"`
	UsageIdleMs        int      `yaml:"usage_idle_ms"`
}

type CodexConfig struct {
	ExecPath          string   `yaml:"exec_path"`
	JobTmpRoot        string   `yaml:"job_tmp_root"`
	ApprovalAllowKeys []string `yaml:"approval_allow_keys"`
	ApprovalDenyKeys  []string `yaml:"approval_deny_keys"`
	UsageCommand      string   `yaml:"usage_command"`
	UsageIntervalMs   int      `yaml:"usage_interval_ms"`
	UsageParseJSON    bool     `yaml:"usage_parse_json"`
}

type GeminiConfig struct {
	UsageCommand     string `yaml:"usage_command"`
	UsageIntervalMs  int    `yaml:"usage_interval_ms"`
	UsageParseJSON   bool   `yaml:"usage_parse_json"`
	StatsCommand     string `yaml:"stats_command"`
	StatsIntervalMs  int    `yaml:"stats_interval_ms"`
	StatsIdleMs      int    `yaml:"stats_idle_ms"`
	StatsSessionName string `yaml:"stats_session_name"`
}

type StorageConfig struct {
	StateDir         string `yaml:"state_dir"`
	OutboundQueueMax int    `yaml:"outbound_queue_max"`
}

func LoadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}

	// Set defaults
	if cfg.Tmux.Bin == "" {
		cfg.Tmux.Bin = "/usr/bin/tmux"
	}
	if cfg.Tmux.PollIntervalMs == 0 {
		cfg.Tmux.PollIntervalMs = 2000
	}
	if cfg.Tmux.SnapshotLines == 0 {
		cfg.Tmux.SnapshotLines = 200
	}
	if cfg.Tmux.SnapshotIntervalMs == 0 {
		cfg.Tmux.SnapshotIntervalMs = 2000
	}
	if cfg.Tmux.SnapshotMaxBytes == 0 {
		cfg.Tmux.SnapshotMaxBytes = 65536
	}
	if cfg.Tmux.OptionSessionID == "" {
		cfg.Tmux.OptionSessionID = "@ac_session_id"
	}
	if cfg.Spawn.TmuxSessionName == "" {
		cfg.Spawn.TmuxSessionName = "agents"
	}
	if cfg.Spawn.DefaultShell == "" {
		cfg.Spawn.DefaultShell = "/bin/bash"
	}
	if cfg.Storage.StateDir == "" {
		cfg.Storage.StateDir = "/var/lib/agentd"
	}
	if cfg.Storage.OutboundQueueMax == 0 {
		cfg.Storage.OutboundQueueMax = 50000
	}
	if cfg.Providers.Claude.HooksHTTPListen == "" {
		cfg.Providers.Claude.HooksHTTPListen = "127.0.0.1:7777"
	}
	if cfg.Providers.Claude.PermissionStrategy == "" {
		cfg.Providers.Claude.PermissionStrategy = "both"
	}
	if len(cfg.Providers.Claude.ApprovalAllowKeys) == 0 {
		cfg.Providers.Claude.ApprovalAllowKeys = []string{"y", "Enter"}
	}
	if len(cfg.Providers.Claude.ApprovalDenyKeys) == 0 {
		cfg.Providers.Claude.ApprovalDenyKeys = []string{"n", "Enter"}
	}
	if cfg.Providers.Claude.UsageIntervalMs == 0 && cfg.Providers.Claude.UsageCommand != "" {
		cfg.Providers.Claude.UsageIntervalMs = 300000
	}
	if cfg.Providers.Claude.UsageIdleMs == 0 && cfg.Providers.Claude.UsageSessionName != "" {
		cfg.Providers.Claude.UsageIdleMs = 15000
	}
	if len(cfg.Providers.Codex.ApprovalAllowKeys) == 0 {
		cfg.Providers.Codex.ApprovalAllowKeys = []string{"y", "Enter"}
	}
	if len(cfg.Providers.Codex.ApprovalDenyKeys) == 0 {
		cfg.Providers.Codex.ApprovalDenyKeys = []string{"n", "Enter"}
	}
	if cfg.Providers.Codex.UsageIntervalMs == 0 && cfg.Providers.Codex.UsageCommand != "" {
		cfg.Providers.Codex.UsageIntervalMs = 300000
	}
	if cfg.Providers.Gemini.UsageIntervalMs == 0 && cfg.Providers.Gemini.UsageCommand != "" {
		cfg.Providers.Gemini.UsageIntervalMs = 300000
	}
	if cfg.Providers.Gemini.StatsIntervalMs == 0 && cfg.Providers.Gemini.StatsCommand != "" {
		cfg.Providers.Gemini.StatsIntervalMs = 300000
	}
	if cfg.Providers.Gemini.StatsIdleMs == 0 && cfg.Providers.Gemini.StatsCommand != "" {
		cfg.Providers.Gemini.StatsIdleMs = 15000
	}
	if len(cfg.ControlPlane.ReconnectBackoffMs) == 0 {
		cfg.ControlPlane.ReconnectBackoffMs = []int{250, 500, 1000, 2000, 5000}
	}

	// Optional environment overrides for secrets.
	if envToken := os.Getenv("AGENTD_CONTROL_PLANE_TOKEN"); envToken != "" {
		cfg.ControlPlane.Token = envToken
	}

	return &cfg, nil
}
