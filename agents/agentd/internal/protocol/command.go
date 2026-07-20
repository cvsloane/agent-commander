package protocol

import "encoding/json"

type Command struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

type CommandDispatchPayload struct {
	CmdID     string  `json:"cmd_id"`
	SessionID string  `json:"session_id"`
	Command   Command `json:"command"`
}

type CommandResultError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type CommandResultPayload struct {
	CmdID     string              `json:"cmd_id"`
	SessionID string              `json:"session_id"`
	OK        bool                `json:"ok"`
	Result    map[string]any      `json:"result,omitempty"`
	Error     *CommandResultError `json:"error,omitempty"`
}

type SendInputPayload struct {
	Text  string `json:"text"`
	Enter bool   `json:"enter"`
}

type SendKeysPayload struct {
	Keys []string `json:"keys"`
}

type EmptyCommandPayload struct{}

type AdoptPanePayload struct {
	TmuxPaneID string `json:"tmux_pane_id"`
	Title      string `json:"title,omitempty"`
}

type RenameSessionPayload struct {
	Title string `json:"title"`
}

type NewWindowPayload struct {
	WindowName string `json:"window_name,omitempty"`
	CWD        string `json:"cwd,omitempty"`
}

type RenameWindowPayload struct {
	WindowIndex *int   `json:"window_index"`
	Name        string `json:"name"`
}

type KillWindowPayload struct {
	WindowIndex *int `json:"window_index"`
}

type SelectWindowPayload struct {
	WindowIndex *int `json:"window_index"`
}

type SplitPanePayload struct {
	Direction string `json:"direction"`
	Percent   *int   `json:"percent,omitempty"`
	CWD       string `json:"cwd,omitempty"`
}

type SelectPanePayload struct {
	PaneID string `json:"pane_id"`
}

type ResizePanePayload struct {
	PaneID string `json:"pane_id"`
	Width  *int   `json:"width,omitempty"`
	Height *int   `json:"height,omitempty"`
}

type ZoomPanePayload struct {
	PaneID string `json:"pane_id"`
}

type SpawnSessionMemoryFile struct {
	BaseDir      string `json:"base_dir"`
	RelativePath string `json:"relative_path"`
	Content      string `json:"content"`
	Scope        string `json:"scope"`
}

type SpawnSessionTmux struct {
	TargetSession string `json:"target_session,omitempty"`
	WindowName    string `json:"window_name,omitempty"`
	Command       string `json:"command,omitempty"`
}

// SpawnSessionPayload covers both interactive and worktree command variants.
type SpawnSessionPayload struct {
	Provider         string                   `json:"provider"`
	WorkingDirectory *string                  `json:"working_directory,omitempty"`
	Title            string                   `json:"title,omitempty"`
	Flags            []string                 `json:"flags,omitempty"`
	MemoryFiles      []SpawnSessionMemoryFile `json:"memory_files,omitempty"`
	GroupID          string                   `json:"group_id,omitempty"`
	ParentSessionID  string                   `json:"parent_session_id,omitempty"`
	Role             string                   `json:"role,omitempty"`
	RepoRoot         string                   `json:"repo_root,omitempty"`
	BaseBranch       string                   `json:"base_branch,omitempty"`
	BranchName       string                   `json:"branch_name,omitempty"`
	WorktreeDir      string                   `json:"worktree_dir,omitempty"`
	Tmux             SpawnSessionTmux         `json:"tmux,omitempty"`
	Env              map[string]string        `json:"env,omitempty"`
}

type SpawnJobPayload struct {
	Provider string            `json:"provider"`
	CWD      string            `json:"cwd"`
	Prompt   string            `json:"prompt"`
	Env      map[string]string `json:"env,omitempty"`
}

type ForkPayload struct {
	Branch   string `json:"branch,omitempty"`
	CWD      string `json:"cwd,omitempty"`
	Provider string `json:"provider,omitempty"`
	Note     string `json:"note,omitempty"`
	GroupID  string `json:"group_id,omitempty"`
}

type ConsoleSubscribePayload struct {
	SubscriptionID string `json:"subscription_id"`
	PaneID         string `json:"pane_id"`
}

type ConsoleUnsubscribePayload struct {
	SubscriptionID string `json:"subscription_id"`
}

type CapturePanePayload struct {
	Mode       string `json:"mode"`
	LineStart  int    `json:"line_start,omitempty"`
	LineEnd    int    `json:"line_end,omitempty"`
	LastNLines int    `json:"last_n_lines,omitempty"`
	StripANSI  bool   `json:"strip_ansi"`
}

type CopyToSessionPayload struct {
	TargetSessionID string `json:"target_session_id"`
	Mode            string `json:"mode"`
	LineStart       int    `json:"line_start,omitempty"`
	LineEnd         int    `json:"line_end,omitempty"`
	LastNLines      int    `json:"last_n_lines,omitempty"`
	PrependText     string `json:"prepend_text,omitempty"`
	AppendText      string `json:"append_text,omitempty"`
	StripANSI       bool   `json:"strip_ansi"`
}

type ListDirectoryPayload struct {
	Path       string `json:"path"`
	ShowHidden bool   `json:"show_hidden"`
}

type CapturePaneResult struct {
	Content     string `json:"content"`
	LineCount   int    `json:"line_count"`
	CaptureMode string `json:"capture_mode"`
}

type DirectoryEntry struct {
	Name         string `json:"name"`
	Path         string `json:"path"`
	IsDirectory  bool   `json:"is_directory"`
	IsGitRepo    bool   `json:"is_git_repo"`
	GitBranch    string `json:"git_branch,omitempty"`
	LastModified any    `json:"last_modified,omitempty"`
}

type ListDirectoryResult struct {
	Entries     []DirectoryEntry `json:"entries"`
	CurrentPath string           `json:"current_path"`
}
