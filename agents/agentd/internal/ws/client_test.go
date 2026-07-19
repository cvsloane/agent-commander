package ws

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/agent-command/agentd/internal/queue"
	"github.com/gorilla/websocket"
)

type receivedEnvelope struct {
	Type string          `json:"type"`
	Seq  int64           `json:"seq"`
	Data json.RawMessage `json:"payload"`
}

func websocketURL(server *httptest.Server) string {
	return "ws" + strings.TrimPrefix(server.URL, "http")
}

func waitEnvelope(t *testing.T, messages <-chan receivedEnvelope) receivedEnvelope {
	t.Helper()
	select {
	case message := <-messages:
		return message
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for websocket message")
		return receivedEnvelope{}
	}
}

func TestDisconnectedDurableAndVolatileLanes(t *testing.T) {
	dir := t.TempDir()
	q, err := queue.NewQueue(dir, 100)
	if err != nil {
		t.Fatal(err)
	}
	defer q.Close()

	client := NewClient("ws://127.0.0.1:1", "token", "host", []int{1})
	client.SetQueue(q, dir)
	client.SetLastAckedSeq(0)

	if err := client.Send("events.append", map[string]any{"event": "queued"}); err != nil {
		t.Fatalf("durable send while disconnected: %v", err)
	}
	if q.Len() != 1 || q.GetUnacked()[0].Seq != 2 {
		t.Fatalf("durable message was not queued with resumed sequence: %+v", q.GetUnacked())
	}

	for _, msgType := range []string{"terminal.output", "sessions.snapshot", "console.chunk"} {
		if err := client.Send(msgType, map[string]any{"data": "drop"}); !errors.Is(err, ErrNotConnected) {
			t.Fatalf("%s error=%v, want ErrNotConnected", msgType, err)
		}
	}
	if q.Len() != 1 {
		t.Fatalf("volatile messages entered disk queue: %+v", q.GetUnacked())
	}
}

func TestSequenceResumesAboveReloadedQueueMaximum(t *testing.T) {
	dir := t.TempDir()
	q, err := queue.NewQueue(dir, 100)
	if err != nil {
		t.Fatal(err)
	}
	defer q.Close()
	if err := q.Push(queue.Message{Seq: 17, Type: "events.append", Payload: json.RawMessage(`{"old":true}`)}); err != nil {
		t.Fatal(err)
	}

	client := NewClient("ws://127.0.0.1:1", "token", "host", []int{1})
	client.SetQueue(q, dir)
	client.SetLastAckedSeq(8)
	if err := client.Send("commands.result", map[string]any{"new": true}); err != nil {
		t.Fatal(err)
	}
	messages := q.GetUnacked()
	if got := messages[len(messages)-1].Seq; got != 18 {
		t.Fatalf("new sequence=%d, want 18 above reloaded max", got)
	}
}

func TestReplayOccursAfterHelloInSequenceOrder(t *testing.T) {
	messages := make(chan receivedEnvelope, 8)
	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		for {
			var message receivedEnvelope
			if err := conn.ReadJSON(&message); err != nil {
				return
			}
			messages <- message
		}
	}))
	defer server.Close()

	dir := t.TempDir()
	q, err := queue.NewQueue(dir, 100)
	if err != nil {
		t.Fatal(err)
	}
	defer q.Close()
	for seq, msgType := range map[int64]string{4: "events.append", 2: "sessions.upsert", 3: "commands.result"} {
		if err := q.Push(queue.Message{Seq: seq, Type: msgType, Payload: json.RawMessage(`{"queued":true}`)}); err != nil {
			t.Fatal(err)
		}
	}

	client := NewClient(websocketURL(server), "token", "host", []int{1})
	client.SetQueue(q, dir)
	client.SetLastAckedSeq(1)
	client.SetOnConnect(func() {
		if err := client.SendHello(map[string]any{"host": map[string]any{"id": "host"}}); err != nil {
			t.Errorf("hello: %v", err)
			return
		}
		if err := client.ResendQueued(); err != nil {
			t.Errorf("replay: %v", err)
		}
	})
	if err := client.Connect(); err != nil {
		t.Fatal(err)
	}
	defer client.Close()

	want := []struct {
		typ string
		seq int64
	}{{"agent.hello", 1}, {"sessions.upsert", 2}, {"commands.result", 3}, {"events.append", 4}}
	for _, expected := range want {
		message := waitEnvelope(t, messages)
		if message.Type != expected.typ || message.Seq != expected.seq {
			t.Fatalf("message=(%s,%d), want=(%s,%d)", message.Type, message.Seq, expected.typ, expected.seq)
		}
	}
	if err := client.Send("terminal.output", map[string]any{"data": "live"}); err != nil {
		t.Fatalf("connected volatile send: %v", err)
	}
	message := waitEnvelope(t, messages)
	if message.Type != "terminal.output" || message.Seq != 5 {
		t.Fatalf("volatile message=(%s,%d), want=(terminal.output,5)", message.Type, message.Seq)
	}
	if q.Len() != 3 {
		t.Fatalf("connected volatile message entered queue: %+v", q.GetUnacked())
	}
}

func TestReconnectQueuesDuringOutageAndReplaysAfterHello(t *testing.T) {
	upgrader := websocket.Upgrader{}
	firstClosed := make(chan struct{})
	reconnected := make(chan []receivedEnvelope, 1)
	var connectionMu sync.Mutex
	connectionCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		connectionMu.Lock()
		connectionCount++
		current := connectionCount
		connectionMu.Unlock()
		if current == 1 {
			var hello receivedEnvelope
			_ = conn.ReadJSON(&hello)
			_ = conn.Close()
			close(firstClosed)
			return
		}
		defer conn.Close()
		got := make([]receivedEnvelope, 0, 2)
		for len(got) < 2 {
			var message receivedEnvelope
			if err := conn.ReadJSON(&message); err != nil {
				return
			}
			got = append(got, message)
		}
		reconnected <- got
	}))
	defer server.Close()

	dir := t.TempDir()
	q, err := queue.NewQueue(dir, 100)
	if err != nil {
		t.Fatal(err)
	}
	defer q.Close()
	client := NewClient(websocketURL(server), "token", "host", []int{50})
	client.jitter = func(ceiling time.Duration) time.Duration { return ceiling }
	client.SetQueue(q, dir)
	client.SetLastAckedSeq(0)
	client.SetOnConnect(func() {
		if err := client.SendHello(map[string]any{"host": map[string]any{"id": "host"}}); err != nil {
			return
		}
		_ = client.ResendQueued()
	})
	if err := client.Connect(); err != nil {
		t.Fatal(err)
	}
	defer client.Close()

	select {
	case <-firstClosed:
	case <-time.After(2 * time.Second):
		t.Fatal("first websocket did not close")
	}
	deadline := time.Now().Add(time.Second)
	for {
		client.mu.Lock()
		ready := client.ready
		client.mu.Unlock()
		if !ready {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("client did not observe disconnected websocket")
		}
		time.Sleep(time.Millisecond)
	}
	if err := client.Send("events.append", map[string]any{"during": "outage"}); err != nil {
		t.Fatalf("queue during outage: %v", err)
	}

	select {
	case messages := <-reconnected:
		if messages[0].Type != "agent.hello" || messages[1].Type != "events.append" {
			t.Fatalf("reconnect order=%v", []string{messages[0].Type, messages[1].Type})
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for reconnect replay")
	}
}

func TestReconnectBackoffUsesFullJitterAndCaps(t *testing.T) {
	client := NewClient("ws://example.invalid", "token", "host", []int{250, 500, 1000, 2000, 5000})
	var ceilings []time.Duration
	client.jitter = func(ceiling time.Duration) time.Duration {
		ceilings = append(ceilings, ceiling)
		return ceiling / 2
	}

	if got := client.reconnectDelay(0); got != 125*time.Millisecond {
		t.Fatalf("first delay=%s", got)
	}
	if got := client.reconnectDelay(8); got != 15*time.Second {
		t.Fatalf("capped jitter delay=%s", got)
	}
	if ceilings[len(ceilings)-1] != maxBackoff {
		t.Fatalf("ceiling=%s, want %s", ceilings[len(ceilings)-1], maxBackoff)
	}
	if client.dialer.HandshakeTimeout != dialTimeout {
		t.Fatalf("dial timeout=%s, want %s", client.dialer.HandshakeTimeout, dialTimeout)
	}
}
