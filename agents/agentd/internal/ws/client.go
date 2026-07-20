package ws

import (
	cryptorand "crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"github.com/agent-command/agentd/internal/metrics"
	"github.com/agent-command/agentd/internal/protocol"
	"github.com/agent-command/agentd/internal/queue"
	"github.com/gorilla/websocket"
)

const (
	writeWait        = 10 * time.Second
	pongWait         = 75 * time.Second
	pingPeriod       = 30 * time.Second
	dialTimeout      = 10 * time.Second
	maxBackoff       = 30 * time.Second
	replayBatchSize  = 100
	replayBatchDelay = 25 * time.Millisecond
)

var ErrNotConnected = errors.New("not connected")

type MessageHandler func(msgType string, payload json.RawMessage)

type Client struct {
	url          string
	token        string
	hostID       string
	backoff      []int
	conn         *websocket.Conn
	mu           sync.Mutex
	sendMu       sync.Mutex
	seq          atomic.Int64
	lastAckedSeq int64
	onMessage    MessageHandler
	done         chan struct{}
	reconnecting bool
	queue        *queue.Queue
	stateDir     string
	onConnect    func()
	dialer       *websocket.Dialer
	jitter       func(time.Duration) time.Duration
	closeOnce    sync.Once
	ready        bool
}

func NewClient(url, token, hostID string, backoff []int) *Client {
	if len(backoff) == 0 {
		backoff = []int{250}
	}
	dialer := *websocket.DefaultDialer
	dialer.HandshakeTimeout = dialTimeout
	c := &Client{
		url:     url,
		token:   token,
		hostID:  hostID,
		backoff: backoff,
		done:    make(chan struct{}),
		dialer:  &dialer,
		jitter:  fullJitter,
	}
	// Sequence 1 is reserved for the first hello so durable traffic starts at 2.
	c.seq.Store(1)
	return c
}

func (c *Client) SetQueue(q *queue.Queue, stateDir string) {
	c.queue = q
	c.stateDir = stateDir
	c.advanceSeq(q.MaxSeq())
}

func (c *Client) SetLastAckedSeq(seq int64) {
	c.mu.Lock()
	c.lastAckedSeq = seq
	c.mu.Unlock()
	c.advanceSeq(seq)
	if c.queue != nil {
		c.advanceSeq(c.queue.MaxSeq())
	}
}

func (c *Client) advanceSeq(seq int64) {
	if seq < 1 {
		seq = 1
	}
	for {
		current := c.seq.Load()
		if current >= seq || c.seq.CompareAndSwap(current, seq) {
			return
		}
	}
}

func (c *Client) SetMessageHandler(handler MessageHandler) {
	c.onMessage = handler
}

func (c *Client) SetOnConnect(handler func()) {
	c.onConnect = handler
}

func (c *Client) Connect() error {
	headers := http.Header{}
	headers.Set("Authorization", "Bearer "+c.token)
	headers.Set("X-Host-Id", c.hostID)

	conn, _, err := c.dialer.Dial(c.url, headers)
	if err != nil {
		return fmt.Errorf("failed to connect: %w", err)
	}

	_ = conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(pongWait))
	})

	c.mu.Lock()
	c.conn = conn
	c.ready = false
	c.reconnecting = false
	c.mu.Unlock()
	metrics.SetWSConnected(true)
	metrics.SetWSReconnecting(false)

	// Start reader goroutine
	go c.reader(conn)
	go c.pinger(conn)

	if c.onConnect != nil {
		go c.onConnect()
	}

	return nil
}

func (c *Client) reader(conn *websocket.Conn) {
	defer func() {
		c.mu.Lock()
		if c.conn == conn {
			c.conn.Close()
			c.conn = nil
			c.ready = false
		}
		c.mu.Unlock()

		metrics.SetWSConnected(false)

		// Attempt reconnection
		c.reconnect()
	}()

	for {
		select {
		case <-c.done:
			return
		default:
		}

		_, message, err := conn.ReadMessage()
		if err != nil {
			log.Printf("WebSocket read error: %v", err)
			return
		}

		// Parse message envelope
		var envelope protocol.ServerEnvelope
		if err := json.Unmarshal(message, &envelope); err != nil {
			log.Printf("Failed to parse message: %v", err)
			continue
		}

		// Handle acks specially
		if envelope.Type == "agent.ack" {
			var ackPayload protocol.AgentAckPayload
			if err := json.Unmarshal(envelope.Payload, &ackPayload); err == nil {
				if ackPayload.Status == "error" {
					log.Printf("Agent ack error (seq=%d): %s", ackPayload.AckSeq, ackPayload.Error)
				}
				c.mu.Lock()
				if ackPayload.AckSeq > c.lastAckedSeq {
					c.lastAckedSeq = ackPayload.AckSeq
				}
				c.mu.Unlock()
				if ackPayload.AckSeq > 0 {
					if c.queue != nil {
						_ = c.queue.AckUpto(ackPayload.AckSeq)
					}
					if c.stateDir != "" {
						_ = queue.SaveAckedSeq(c.stateDir, ackPayload.AckSeq)
					}
				}
			}
			continue
		}

		// Call message handler
		if c.onMessage != nil {
			c.onMessage(envelope.Type, envelope.Payload)
		}
	}
}

func (c *Client) pinger(conn *websocket.Conn) {
	ticker := time.NewTicker(pingPeriod)
	defer ticker.Stop()

	for {
		select {
		case <-c.done:
			return
		case <-ticker.C:
		}

		c.mu.Lock()
		current := c.conn
		c.mu.Unlock()
		if current != conn || conn == nil {
			return
		}

		if err := conn.WriteControl(
			websocket.PingMessage,
			[]byte("keepalive"),
			time.Now().Add(writeWait),
		); err != nil {
			log.Printf("WebSocket ping error: %v", err)
			_ = conn.Close()
			return
		}
	}
}

func (c *Client) reconnect() {
	c.mu.Lock()
	if c.reconnecting {
		c.mu.Unlock()
		return
	}
	c.reconnecting = true
	c.mu.Unlock()

	metrics.SetWSReconnecting(true)
	defer metrics.SetWSReconnecting(false)

	for attempt := 0; ; attempt++ {
		delay := c.reconnectDelay(attempt)
		select {
		case <-c.done:
			return
		case <-time.After(delay):
		}

		metrics.RecordWSReconnectAttempt(int(delay / time.Millisecond))
		log.Printf("Reconnection attempt %d after %s", attempt+1, delay)

		if err := c.Connect(); err == nil {
			metrics.RecordWSReconnectSuccess()
			log.Printf("Reconnected successfully")
			return
		}
		metrics.RecordWSReconnectFailure()
	}
}

func (c *Client) reconnectDelay(attempt int) time.Duration {
	index := attempt
	if index >= len(c.backoff) {
		index = len(c.backoff) - 1
	}
	ceiling := time.Duration(c.backoff[index]) * time.Millisecond
	if ceiling <= 0 {
		ceiling = 250 * time.Millisecond
	}
	for extra := attempt - index; extra > 0 && ceiling < maxBackoff; extra-- {
		ceiling *= 2
	}
	if ceiling > maxBackoff {
		ceiling = maxBackoff
	}
	return c.jitter(ceiling)
}

func fullJitter(ceiling time.Duration) time.Duration {
	if ceiling <= 0 {
		return 0
	}
	n, err := cryptorand.Int(cryptorand.Reader, big.NewInt(int64(ceiling)+1))
	if err != nil {
		return ceiling / 2
	}
	return time.Duration(n.Int64())
}

func (c *Client) Send(msgType string, payload any) error {
	c.sendMu.Lock()
	defer c.sendMu.Unlock()

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}

	seq := c.seq.Add(1)
	durable := !isVolatile(msgType)
	if durable && c.queue != nil {
		if err := c.queue.Push(queue.Message{
			Seq:     seq,
			Type:    msgType,
			Payload: payloadBytes,
		}); err != nil {
			return fmt.Errorf("failed to persist %s: %w", msgType, err)
		}
	}

	msg := protocol.AgentEnvelope{
		V:       protocol.Version,
		Type:    msgType,
		TS:      time.Now().UTC().Format(time.RFC3339Nano),
		Seq:     seq,
		Payload: payloadBytes,
	}

	data, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("failed to marshal message: %w", err)
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn == nil || !c.ready {
		if durable && c.queue != nil {
			return nil
		}
		return ErrNotConnected
	}
	_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
	return c.conn.WriteMessage(websocket.TextMessage, data)
}

// SendHello sends the connection handshake without adding it to the durable
// queue. It reuses the acknowledged cursor (or reserved sequence 1) so the
// control plane can establish resume state before older queued messages replay.
func (c *Client) SendHello(payload any) error {
	c.sendMu.Lock()
	defer c.sendMu.Unlock()

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal hello payload: %w", err)
	}
	c.mu.Lock()
	seq := c.lastAckedSeq
	if seq < 1 {
		seq = 1
	}
	c.mu.Unlock()
	return c.writeEnvelope(seq, "agent.hello", payloadBytes)
}

func isVolatile(msgType string) bool {
	switch msgType {
	case "terminal.output", "terminal.lag", "sessions.snapshot", "console.chunk":
		return true
	default:
		return false
	}
}

func (c *Client) GetLastAckedSeq() int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.lastAckedSeq
}

func (c *Client) Close() {
	c.closeOnce.Do(func() { close(c.done) })
	c.mu.Lock()
	if c.conn != nil {
		c.conn.Close()
		c.conn = nil
	}
	c.mu.Unlock()
}

func (c *Client) ResendQueued() error {
	c.sendMu.Lock()
	defer c.sendMu.Unlock()

	if c.queue == nil {
		c.mu.Lock()
		c.ready = c.conn != nil
		c.mu.Unlock()
		return nil
	}
	unacked := c.queue.GetUnacked()
	sort.Slice(unacked, func(i, j int) bool { return unacked[i].Seq < unacked[j].Seq })

	for i, msg := range unacked {
		if err := c.writeEnvelope(msg.Seq, msg.Type, msg.Payload); err != nil {
			return err
		}
		if (i+1)%replayBatchSize == 0 && i+1 < len(unacked) {
			select {
			case <-c.done:
				return nil
			case <-time.After(replayBatchDelay):
			}
		}
	}
	c.mu.Lock()
	c.ready = c.conn != nil
	c.mu.Unlock()
	return nil
}

func (c *Client) writeEnvelope(seq int64, msgType string, payload json.RawMessage) error {
	envelope := protocol.AgentEnvelope{
		V:       protocol.Version,
		Type:    msgType,
		TS:      time.Now().UTC().Format(time.RFC3339Nano),
		Seq:     seq,
		Payload: payload,
	}
	data, err := json.Marshal(envelope)
	if err != nil {
		return fmt.Errorf("failed to marshal %s envelope: %w", msgType, err)
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn == nil {
		return ErrNotConnected
	}
	_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
	return c.conn.WriteMessage(websocket.TextMessage, data)
}
