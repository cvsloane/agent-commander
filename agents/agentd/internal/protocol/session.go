package protocol

import "encoding/json"

// NullableString preserves the three wire states for an optional string:
// omitted (zero value), a JSON string, or explicit null.
type NullableString []byte

func String(value string) NullableString {
	data, _ := json.Marshal(value)
	return data
}

func NullString() NullableString { return NullableString("null") }

func (value NullableString) MarshalJSON() ([]byte, error) {
	if len(value) == 0 {
		return []byte("null"), nil
	}
	return value, nil
}

func (value *NullableString) UnmarshalJSON(data []byte) error {
	*value = append((*value)[:0], data...)
	return nil
}

// TmuxPaneIdentity is the stable tmux identity carried in session metadata.
// PaneID and Target are additive; older messages use the top-level upsert fields.
type TmuxPaneIdentity struct {
	PaneID             string `json:"pane_id,omitempty"`
	Target             string `json:"target,omitempty"`
	SessionName        string `json:"session_name,omitempty"`
	WindowName         string `json:"window_name,omitempty"`
	WindowIndex        int    `json:"window_index,omitempty"`
	PaneIndex          int    `json:"pane_index,omitempty"`
	PanePID            int    `json:"pane_pid,omitempty"`
	CurrentCommand     string `json:"current_command,omitempty"`
	PaneActive         bool   `json:"pane_active"`
	WindowActive       bool   `json:"window_active"`
	WindowZoomedFlag   bool   `json:"window_zoomed_flag"`
	WindowLayout       string `json:"window_layout,omitempty"`
	PaneWidth          int    `json:"pane_width"`
	PaneHeight         int    `json:"pane_height"`
	WindowBellFlag     bool   `json:"window_bell_flag"`
	WindowActivityFlag bool   `json:"window_activity_flag"`
}

type GitStatusMetadata struct {
	Branch    string `json:"branch,omitempty"`
	Upstream  string `json:"upstream,omitempty"`
	Ahead     int    `json:"ahead,omitempty"`
	Behind    int    `json:"behind,omitempty"`
	Staged    int    `json:"staged,omitempty"`
	Unstaged  int    `json:"unstaged,omitempty"`
	Untracked int    `json:"untracked,omitempty"`
	Unmerged  int    `json:"unmerged,omitempty"`
	UpdatedAt string `json:"updated_at,omitempty"`
}

type ApprovalMetadata struct {
	ID      string `json:"id,omitempty"`
	Reason  string `json:"reason,omitempty"`
	Tool    string `json:"tool,omitempty"`
	Summary string `json:"summary,omitempty"`
}

// SessionMetadata exposes the typed identity and hierarchy fields while retaining
// the exact JSON representation for additive metadata owned by other features.
type SessionMetadata struct {
	Tmux              *TmuxPaneIdentity  `json:"tmux,omitempty"`
	ParentSessionID   string             `json:"parent_session_id,omitempty"`
	ChildStatusRollup map[string]int     `json:"child_status_rollup,omitempty"`
	Unmanaged         *bool              `json:"unmanaged,omitempty"`
	GitStatus         *GitStatusMetadata `json:"git_status,omitempty"`
	Approval          *ApprovalMetadata  `json:"approval,omitempty"`
	StatusDetail      *string            `json:"status_detail,omitempty"`
	raw               json.RawMessage
}

func NewSessionMetadata(value map[string]any) *SessionMetadata {
	if value == nil {
		return &SessionMetadata{raw: json.RawMessage("null")}
	}
	data, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	var metadata SessionMetadata
	if err := json.Unmarshal(data, &metadata); err != nil {
		return nil
	}
	return &metadata
}

func (metadata SessionMetadata) MarshalJSON() ([]byte, error) {
	if len(metadata.raw) > 0 {
		return metadata.raw, nil
	}
	type wire SessionMetadata
	return json.Marshal(wire(metadata))
}

func (metadata *SessionMetadata) UnmarshalJSON(data []byte) error {
	type wire SessionMetadata
	var decoded wire
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*metadata = SessionMetadata(decoded)
	metadata.raw = append(metadata.raw[:0], data...)
	return nil
}

type SessionUpsert struct {
	ID             string           `json:"id"`
	HostID         string           `json:"host_id,omitempty"`
	UserID         NullableString   `json:"user_id,omitempty"`
	RepoID         NullableString   `json:"repo_id,omitempty"`
	Kind           string           `json:"kind"`
	Provider       string           `json:"provider"`
	Status         string           `json:"status"`
	Role           string           `json:"role,omitempty"`
	Title          NullableString   `json:"title,omitempty"`
	CWD            NullableString   `json:"cwd,omitempty"`
	RepoRoot       NullableString   `json:"repo_root,omitempty"`
	GitBranch      NullableString   `json:"git_branch,omitempty"`
	GitRemote      NullableString   `json:"git_remote,omitempty"`
	TmuxPaneID     NullableString   `json:"tmux_pane_id,omitempty"`
	TmuxTarget     NullableString   `json:"tmux_target,omitempty"`
	Metadata       *SessionMetadata `json:"metadata,omitempty"`
	GroupID        NullableString   `json:"group_id,omitempty"`
	ForkedFrom     NullableString   `json:"forked_from,omitempty"`
	ForkDepth      int              `json:"fork_depth,omitempty"`
	LastActivityAt string           `json:"last_activity_at,omitempty"`
	IdledAt        NullableString   `json:"idled_at,omitempty"`
	ArchivedAt     NullableString   `json:"archived_at,omitempty"`
}
