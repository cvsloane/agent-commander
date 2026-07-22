package protocol

type TerminalAttachPayload struct {
	ChannelID   string `json:"channel_id"`
	PaneID      string `json:"pane_id"`
	SessionID   string `json:"session_id"`
	Cols        int    `json:"cols,omitempty"`
	Rows        int    `json:"rows,omitempty"`
	ResumeToken string `json:"resume_token,omitempty"`
	Letterbox   bool   `json:"letterbox,omitempty"`
}

type TerminalInputPayload struct {
	ChannelID string `json:"channel_id"`
	Data      string `json:"data"`
}

type TerminalResizePayload struct {
	ChannelID string `json:"channel_id"`
	Cols      int    `json:"cols"`
	Rows      int    `json:"rows"`
}

type TerminalNavigatePayload struct {
	ChannelID   string `json:"channel_id"`
	Op          string `json:"op"`
	RequestID   string `json:"request_id,omitempty"`
	WindowIndex *int   `json:"window_index,omitempty"`
	PaneID      string `json:"pane_id,omitempty"`
	On          *bool  `json:"on,omitempty"`
	Zoom        *bool  `json:"zoom,omitempty"`
	Lines       *int   `json:"lines,omitempty"`
}

type TerminalNavigationResultPayload struct {
	ChannelID   string `json:"channel_id"`
	RequestID   string `json:"request_id"`
	OK          bool   `json:"ok"`
	PaneID      string `json:"pane_id,omitempty"`
	WindowIndex int    `json:"window_index"`
	Zoomed      bool   `json:"zoomed"`
	Message     string `json:"message,omitempty"`
}

type TerminalChannelPayload struct {
	ChannelID string `json:"channel_id"`
}

type TerminalOutputPayload struct {
	ChannelID string `json:"channel_id"`
	Data      string `json:"data"`
	Encoding  string `json:"encoding,omitempty"`
}

type TerminalStatusPayload struct {
	ChannelID   string `json:"channel_id"`
	Message     string `json:"message,omitempty"`
	ReadOnly    *bool  `json:"readonly,omitempty"`
	ResumeToken string `json:"resume_token,omitempty"`
	Resumed     *bool  `json:"resumed,omitempty"`
}

type TerminalAuditPayload struct {
	EventType                   string `json:"event_type"`
	Action                      string `json:"action"`
	ChannelID                   string `json:"channel_id"`
	SessionID                   string `json:"session_id"`
	PaneID                      string `json:"pane_id"`
	PreviousControllerChannelID string `json:"previous_controller_channel_id,omitempty"`
}
