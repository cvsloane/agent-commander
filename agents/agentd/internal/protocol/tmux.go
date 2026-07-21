package protocol

type TmuxTopologyPayload struct {
	Reason       string                `json:"reason"`
	TmuxSessions []TmuxTopologySession `json:"tmux_sessions"`
}

type TmuxTopologySession struct {
	SessionName     string               `json:"session_name"`
	Attached        bool                 `json:"attached"`
	AttachedClients int                  `json:"attached_clients,omitempty"`
	Windows         []TmuxTopologyWindow `json:"windows"`
}

type TmuxTopologyWindow struct {
	WindowIndex int                `json:"window_index"`
	WindowName  string             `json:"window_name"`
	Active      bool               `json:"active"`
	Zoomed      bool               `json:"zoomed"`
	Layout      string             `json:"layout"`
	Bell        bool               `json:"bell"`
	Activity    bool               `json:"activity"`
	Panes       []TmuxTopologyPane `json:"panes"`
}

type TmuxTopologyPane struct {
	PaneID         string `json:"pane_id"`
	PaneIndex      int    `json:"pane_index"`
	Active         bool   `json:"active"`
	Width          int    `json:"width"`
	Height         int    `json:"height"`
	Title          string `json:"title"`
	CurrentCommand string `json:"current_command"`
	CurrentPath    string `json:"current_path"`
}
