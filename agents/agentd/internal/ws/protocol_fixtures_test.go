package ws

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/agent-command/agentd/internal/protocol"
)

func protocolFixtureDir() string {
	return filepath.Join("..", "..", "..", "..", "tests", "fixtures", "protocol")
}

func TestProtocolFixtureMatrixRoundTripsProductionTypes(t *testing.T) {
	paths, err := filepath.Glob(filepath.Join(protocolFixtureDir(), "*.json"))
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(paths)
	if len(paths) < 40 {
		t.Fatalf("fixture matrix has %d files, want at least 40", len(paths))
	}

	seenTypes := make(map[string]bool)
	seenCommands := make(map[string]bool)
	for _, path := range paths {
		if strings.HasPrefix(filepath.Base(path), "ui-") {
			continue
		}
		path := path
		t.Run(filepath.Base(path), func(t *testing.T) {
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			var envelope protocol.EnvelopeHeader
			if err := json.Unmarshal(data, &envelope); err != nil {
				t.Fatal(err)
			}
			if envelope.V != protocol.Version || envelope.Type == "" || len(envelope.Payload) == 0 {
				t.Fatalf("invalid envelope header: %+v", envelope)
			}
			seenTypes[envelope.Type] = true

			target := fixtureMessageTarget(t, envelope.Type, envelope.Seq != nil)
			assertJSONRoundTrip(t, data, target)

			if envelope.Type == protocol.TypeCommandsDispatch {
				var dispatch protocol.CommandDispatchPayload
				if err := json.Unmarshal(envelope.Payload, &dispatch); err != nil {
					t.Fatal(err)
				}
				seenCommands[dispatch.Command.Type] = true
				assertJSONRoundTrip(t, dispatch.Command.Payload, commandPayloadTarget(t, dispatch.Command.Type))
			}
		})
	}

	wantTypes := []string{
		protocol.TypeAgentHello, protocol.TypeAgentAck,
		protocol.TypeSessionsUpsert, protocol.TypeSessionsPrune, protocol.TypeSessionsSnapshot,
		protocol.TypeEventsAppend, protocol.TypeCommandsDispatch, protocol.TypeCommandsResult,
		protocol.TypeConsoleChunk, protocol.TypeToolEventStarted, protocol.TypeToolEventCompleted,
		protocol.TypeProviderUsage, protocol.TypeSessionUsage, protocol.TypeApprovalsDecision,
		protocol.TypeMCPListServers, protocol.TypeMCPGetConfig, protocol.TypeMCPUpdateConfig,
		protocol.TypeMCPGetProjectConfig, protocol.TypeMCPUpdateProject, protocol.TypeMCPServers,
		protocol.TypeMCPConfig, protocol.TypeMCPProjectConfig, protocol.TypeMCPUpdateResult,
		protocol.TypeTerminalAttach, protocol.TypeTerminalInput, protocol.TypeTerminalResize,
		protocol.TypeTerminalNavigate,
		protocol.TypeTerminalDetach, protocol.TypeTerminalControl, protocol.TypeTerminalOutput,
		protocol.TypeTerminalNavigationResult,
		protocol.TypeTerminalAttached, protocol.TypeTerminalDetached, protocol.TypeTerminalError,
		protocol.TypeTerminalReadOnly, protocol.TypeTerminalLag, protocol.TypeTerminalAudit,
		protocol.TypeTmuxTopology,
	}
	for _, messageType := range wantTypes {
		if !seenTypes[messageType] {
			t.Errorf("message type %q has no fixture", messageType)
		}
	}

	wantCommands := []string{
		"send_input", "send_keys", "interrupt", "kill_session", "adopt_pane", "rename_session",
		"spawn_session", "spawn_job", "fork", "console.subscribe", "console.unsubscribe",
		"capture_pane", "capture_transcript", "copy_to_session", "list_directory",
		"new_window", "kill_window", "rename_window", "split_pane",
		"select_window", "select_pane", "resize_pane", "zoom_pane",
	}
	for _, commandType := range wantCommands {
		if !seenCommands[commandType] {
			t.Errorf("command type %q has no fixture", commandType)
		}
	}
}

func fixtureMessageTarget(t *testing.T, messageType string, agentMessage bool) any {
	t.Helper()
	switch messageType {
	case protocol.TypeAgentHello:
		return &protocol.AgentMessage[protocol.AgentHelloPayload]{}
	case protocol.TypeAgentAck:
		return &protocol.ServerMessage[protocol.AgentAckPayload]{}
	case protocol.TypeSessionsUpsert:
		return &protocol.AgentMessage[protocol.SessionsUpsertPayload]{}
	case protocol.TypeSessionsPrune:
		return &protocol.AgentMessage[protocol.SessionsPrunePayload]{}
	case protocol.TypeSessionsSnapshot:
		return &protocol.AgentMessage[protocol.SessionSnapshotPayload]{}
	case protocol.TypeEventsAppend:
		return &protocol.AgentMessage[protocol.EventsAppendPayload]{}
	case protocol.TypeCommandsDispatch:
		return &protocol.ServerMessage[protocol.CommandDispatchPayload]{}
	case protocol.TypeCommandsResult:
		return &protocol.AgentMessage[protocol.CommandResultPayload]{}
	case protocol.TypeConsoleChunk:
		return &protocol.AgentMessage[protocol.ConsoleChunkPayload]{}
	case protocol.TypeToolEventStarted:
		return &protocol.AgentMessage[protocol.ToolEventStartedPayload]{}
	case protocol.TypeToolEventCompleted:
		return &protocol.AgentMessage[protocol.ToolEventCompletedPayload]{}
	case protocol.TypeProviderUsage:
		return &protocol.AgentMessage[protocol.ProviderUsagePayload]{}
	case protocol.TypeSessionUsage:
		return &protocol.AgentMessage[protocol.SessionUsagePayload]{}
	case protocol.TypeApprovalsDecision:
		return &protocol.ServerMessage[protocol.ApprovalDecisionPayload]{}
	case protocol.TypeMCPListServers:
		return &protocol.ServerMessage[protocol.MCPListServersPayload]{}
	case protocol.TypeMCPGetConfig:
		return &protocol.ServerMessage[protocol.MCPGetConfigPayload]{}
	case protocol.TypeMCPUpdateConfig:
		return &protocol.ServerMessage[protocol.MCPUpdateConfigPayload]{}
	case protocol.TypeMCPGetProjectConfig:
		return &protocol.ServerMessage[protocol.MCPGetProjectConfigPayload]{}
	case protocol.TypeMCPUpdateProject:
		return &protocol.ServerMessage[protocol.MCPUpdateProjectConfigPayload]{}
	case protocol.TypeMCPServers:
		return &protocol.AgentMessage[protocol.MCPServersPayload]{}
	case protocol.TypeMCPConfig:
		return &protocol.AgentMessage[protocol.MCPConfigPayload]{}
	case protocol.TypeMCPProjectConfig:
		return &protocol.AgentMessage[protocol.MCPProjectConfigPayload]{}
	case protocol.TypeMCPUpdateResult:
		return &protocol.AgentMessage[protocol.MCPUpdateResultPayload]{}
	case protocol.TypeTerminalAttach:
		return &protocol.ServerMessage[protocol.TerminalAttachPayload]{}
	case protocol.TypeTerminalInput:
		return &protocol.ServerMessage[protocol.TerminalInputPayload]{}
	case protocol.TypeTerminalResize:
		return &protocol.ServerMessage[protocol.TerminalResizePayload]{}
	case protocol.TypeTerminalNavigate:
		return &protocol.ServerMessage[protocol.TerminalNavigatePayload]{}
	case protocol.TypeTerminalDetach:
		return &protocol.ServerMessage[protocol.TerminalChannelPayload]{}
	case protocol.TypeTerminalOutput:
		return &protocol.AgentMessage[protocol.TerminalOutputPayload]{}
	case protocol.TypeTerminalNavigationResult:
		return &protocol.ServerMessage[protocol.TerminalNavigationResultPayload]{}
	case protocol.TypeTerminalAudit:
		return &protocol.AgentMessage[protocol.TerminalAuditPayload]{}
	case protocol.TypeTmuxTopology:
		return &protocol.AgentMessage[protocol.TmuxTopologyPayload]{}
	case protocol.TypeTerminalAttached, protocol.TypeTerminalDetached, protocol.TypeTerminalError,
		protocol.TypeTerminalReadOnly, protocol.TypeTerminalLag:
		return &protocol.AgentMessage[protocol.TerminalStatusPayload]{}
	case protocol.TypeTerminalControl:
		if agentMessage {
			return &protocol.AgentMessage[protocol.TerminalStatusPayload]{}
		}
		return &protocol.ServerMessage[protocol.TerminalChannelPayload]{}
	default:
		t.Fatalf("fixture uses unregistered message type %q", messageType)
		return nil
	}
}

func commandPayloadTarget(t *testing.T, commandType string) any {
	t.Helper()
	switch commandType {
	case "send_input":
		return &protocol.SendInputPayload{}
	case "send_keys":
		return &protocol.SendKeysPayload{}
	case "interrupt", "kill_session":
		return &protocol.EmptyCommandPayload{}
	case "adopt_pane":
		return &protocol.AdoptPanePayload{}
	case "rename_session":
		return &protocol.RenameSessionPayload{}
	case "new_window":
		return &protocol.NewWindowPayload{}
	case "kill_window":
		return &protocol.KillWindowPayload{}
	case "rename_window":
		return &protocol.RenameWindowPayload{}
	case "split_pane":
		return &protocol.SplitPanePayload{}
	case "select_window":
		return &protocol.SelectWindowPayload{}
	case "select_pane":
		return &protocol.SelectPanePayload{}
	case "resize_pane":
		return &protocol.ResizePanePayload{}
	case "zoom_pane":
		return &protocol.ZoomPanePayload{}
	case "spawn_session":
		return &protocol.SpawnSessionPayload{}
	case "spawn_job":
		return &protocol.SpawnJobPayload{}
	case "fork":
		return &protocol.ForkPayload{}
	case "console.subscribe":
		return &protocol.ConsoleSubscribePayload{}
	case "console.unsubscribe":
		return &protocol.ConsoleUnsubscribePayload{}
	case "capture_pane":
		return &protocol.CapturePanePayload{}
	case "capture_transcript":
		return &protocol.CaptureTranscriptPayload{}
	case "copy_to_session":
		return &protocol.CopyToSessionPayload{}
	case "list_directory":
		return &protocol.ListDirectoryPayload{}
	default:
		t.Fatalf("fixture uses unregistered command type %q", commandType)
		return nil
	}
}

func assertJSONRoundTrip(t *testing.T, data []byte, target any) {
	t.Helper()
	if err := json.Unmarshal(data, target); err != nil {
		t.Fatalf("decode production type: %v", err)
	}
	roundTripped, err := json.Marshal(target)
	if err != nil {
		t.Fatalf("encode production type: %v", err)
	}
	var want any
	var got any
	if err := json.Unmarshal(data, &want); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(roundTripped, &got); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("round trip changed JSON\nwant: %s\n got: %s", data, roundTripped)
	}
}
