package ws

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

type fixtureEnvelope struct {
	V       int             `json:"v"`
	Type    string          `json:"type"`
	Ts      string          `json:"ts"`
	Seq     int             `json:"seq,omitempty"`
	Payload json.RawMessage `json:"payload"`
}

func readProtocolFixture(t *testing.T, name string) fixtureEnvelope {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..", "tests", "fixtures", "protocol", name)
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	var envelope fixtureEnvelope
	if err := json.Unmarshal(data, &envelope); err != nil {
		t.Fatalf("unmarshal fixture %s: %v", name, err)
	}
	if envelope.V != 1 {
		t.Fatalf("fixture %s has unexpected version %d", name, envelope.V)
	}
	if envelope.Type == "" {
		t.Fatalf("fixture %s is missing type", name)
	}
	if len(envelope.Payload) == 0 {
		t.Fatalf("fixture %s is missing payload", name)
	}
	return envelope
}

func TestProtocolFixturesForServerMessages(t *testing.T) {
	tests := []struct {
		name     string
		wantType string
	}{
		{"terminal-attach.json", "terminal.attach"},
		{"terminal-input.json", "terminal.input"},
		{"commands-dispatch-send-input.json", "commands.dispatch"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			envelope := readProtocolFixture(t, tc.name)
			if envelope.Type != tc.wantType {
				t.Fatalf("type = %s, want %s", envelope.Type, tc.wantType)
			}
		})
	}
}

func TestCommandDispatchFixtureMatchesAgentShape(t *testing.T) {
	envelope := readProtocolFixture(t, "commands-dispatch-send-input.json")
	var payload struct {
		CmdID     string `json:"cmd_id"`
		SessionID string `json:"session_id"`
		Command   struct {
			Type    string          `json:"type"`
			Payload json.RawMessage `json:"payload"`
		} `json:"command"`
	}
	if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
		t.Fatalf("unmarshal command dispatch payload: %v", err)
	}
	if payload.CmdID == "" || payload.SessionID == "" {
		t.Fatalf("command dispatch fixture missing ids: %+v", payload)
	}
	if payload.Command.Type != "send_input" {
		t.Fatalf("command type = %s, want send_input", payload.Command.Type)
	}
	var sendInput struct {
		Text  string `json:"text"`
		Enter bool   `json:"enter"`
	}
	if err := json.Unmarshal(payload.Command.Payload, &sendInput); err != nil {
		t.Fatalf("unmarshal send_input payload: %v", err)
	}
	if sendInput.Text != "continue" || !sendInput.Enter {
		t.Fatalf("unexpected send_input payload: %+v", sendInput)
	}
}

func TestTerminalFixturesMatchAgentShape(t *testing.T) {
	attach := readProtocolFixture(t, "terminal-attach.json")
	var attachPayload struct {
		ChannelID string `json:"channel_id"`
		PaneID    string `json:"pane_id"`
		SessionID string `json:"session_id"`
	}
	if err := json.Unmarshal(attach.Payload, &attachPayload); err != nil {
		t.Fatalf("unmarshal terminal attach payload: %v", err)
	}
	if attachPayload.ChannelID == "" || attachPayload.PaneID == "" || attachPayload.SessionID == "" {
		t.Fatalf("terminal attach fixture missing fields: %+v", attachPayload)
	}

	input := readProtocolFixture(t, "terminal-input.json")
	var inputPayload struct {
		ChannelID string `json:"channel_id"`
		Data      string `json:"data"`
	}
	if err := json.Unmarshal(input.Payload, &inputPayload); err != nil {
		t.Fatalf("unmarshal terminal input payload: %v", err)
	}
	if inputPayload.ChannelID != attachPayload.ChannelID || inputPayload.Data != "ls\n" {
		t.Fatalf("unexpected terminal input payload: %+v", inputPayload)
	}
}
