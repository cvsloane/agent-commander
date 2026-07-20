package main

import (
	"reflect"
	"testing"

	"github.com/agent-command/agentd/internal/protocol"
	"github.com/agent-command/agentd/internal/tmux"
)

func TestTerminalOutputHandlerDoesNotReencodeFanoutChunk(t *testing.T) {
	var gotType string
	var gotPayload any
	agent := &Agent{sendMessage: func(msgType string, payload any) error {
		gotType = msgType
		gotPayload = payload
		return nil
	}}

	agent.handleTerminalOutput("channel-1", "YWxyZWFkeS1lbmNvZGVk")

	want := protocol.TerminalOutputPayload{
		ChannelID: "channel-1",
		Encoding:  "base64",
		Data:      "YWxyZWFkeS1lbmNvZGVk",
	}
	if gotType != "terminal.output" || !reflect.DeepEqual(gotPayload, want) {
		t.Fatalf("message=(%q, %#v), want=(terminal.output, %#v)", gotType, gotPayload, want)
	}
}

func TestTerminalAuditHandlerEmitsAdditiveAuditEvent(t *testing.T) {
	var gotType string
	var gotPayload any
	agent := &Agent{sendMessage: func(msgType string, payload any) error {
		gotType = msgType
		gotPayload = payload
		return nil
	}}

	agent.handleTerminalAudit(tmux.TerminalAuditEvent{
		Action:                      "control_transfer",
		ChannelID:                   "channel-2",
		SessionID:                   "session-1",
		PaneID:                      "%7",
		PreviousControllerChannelID: "channel-1",
	})

	want := protocol.TerminalAuditPayload{
		EventType:                   "terminal.audit",
		Action:                      "control_transfer",
		ChannelID:                   "channel-2",
		SessionID:                   "session-1",
		PaneID:                      "%7",
		PreviousControllerChannelID: "channel-1",
	}
	if gotType != "terminal.audit" || !reflect.DeepEqual(gotPayload, want) {
		t.Fatalf("message=(%q, %#v), want=(terminal.audit, %#v)", gotType, gotPayload, want)
	}
}
