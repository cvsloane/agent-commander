package ws

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"github.com/agent-command/agentd/internal/queue"
)

type MessageHandler func(msgType string, payload json.RawMessage)

type Client struct {
	url           string
	token         string
	hostID        string
	backoff       []int
	conn          *websocket.Conn
	mu            sync.Mutex
	seq           atomic.Int64
	lastAckedSeq  int64
	onMessage     MessageHandler
	done          chan struct{}
	reconnecting  bool
	queue         *queue.Queue
	stateDir      string
	onConnect     func()
}

func NewClient(url, token, hostID string, backoff []int) *Client {
	return &Client{
		url:     url,
		token:   token,
		hostID:  hostID,
		backoff: backoff,
		done:    make(chan struct{}),
	}
}

func (c *Client) SetQueue(q *queue.Queue, stateDir string) {
	c.queue = q
	c.stateDir = stateDir
}

func (c *Client) SetLastAckedSeq(seq int64) {
	c.lastAckedSeq = seq
	c.seq.Store(seq)
}

func (c *Client) SetMessageHandler(handler MessageHandler) {
	c.onMessage = handler
}

func (c *Client) SetOnConnect(handler func()) {
	c.onConnect = handler
}

func (c *Client) Connect() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	headers := http.Header{}
	headers.Set("Authorization", "Bearer "+c.token)
	headers.Set("X-Host-Id", c.hostID)

	conn, _, err := websocket.DefaultDialer.Dial(c.url, headers)
	if err != nil {
		return fmt.Errorf("failed to connect: %w", err)
	}

	c.conn = conn
	c.reconnecting = false

	// Start reader goroutine
	go c.reader()

	if c.onConnect != nil {
		go c.onConnect()
	}

	return nil
}

func (c *Client) reader() {
	defer func() {
		c.mu.Lock()
		if c.conn != nil {
			c.conn.Close()
		}
		c.mu.Unlock()

		// Attempt reconnection
		c.reconnect()
	}()

	for {
		select {
		case <-c.done:
			return
		default:
		}

		c.mu.Lock()
		conn := c.conn
		c.mu.Unlock()

		if conn == nil {
			return
		}

		_, message, err := conn.ReadMessage()
		if err != nil {
			log.Printf("WebSocket read error: %v", err)
			return
		}

		// Parse message envelope
		var envelope struct {
			Type    string          `json:"type"`
			Payload json.RawMessage `json:"payload"`
		}
		if err := json.Unmarshal(message, &envelope); err != nil {
			log.Printf("Failed to parse message: %v", err)
			continue
		}

		// Handle acks specially
		if envelope.Type == "agent.ack" {
			var ackPayload struct {
				AckSeq int64  `json:"ack_seq"`
				Status string `json:"status"`
				Error  string `json:"error"`
			}
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

func (c *Client) reconnect() {
	c.mu.Lock()
	if c.reconnecting {
		c.mu.Unlock()
		return
	}
	c.reconnecting = true
	c.mu.Unlock()

	for i, delay := range c.backoff {
		select {
		case <-c.done:
			return
		case <-time.After(time.Duration(delay) * time.Millisecond):
		}

		log.Printf("Reconnection attempt %d/%d", i+1, len(c.backoff))

		if err := c.Connect(); err == nil {
			log.Printf("Reconnected successfully")
			return
		}
	}

	// Keep trying with max backoff
	maxDelay := c.backoff[len(c.backoff)-1]
	for {
		select {
		case <-c.done:
			return
		case <-time.After(time.Duration(maxDelay) * time.Millisecond):
		}

		if err := c.Connect(); err == nil {
			log.Printf("Reconnected successfully")
			return
		}
	}
}

func (c *Client) Send(msgType string, payload any) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.conn == nil {
		return fmt.Errorf("not connected")
	}

	seq := c.seq.Add(1)

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}

	if c.queue != nil {
		_ = c.queue.Push(queue.Message{
			Seq:     seq,
			Type:    msgType,
			Payload: payloadBytes,
		})
	}

	msg := map[string]any{
		"v":       1,
		"type":    msgType,
		"ts":      time.Now().UTC().Format(time.RFC3339Nano),
		"seq":     seq,
		"payload": json.RawMessage(payloadBytes),
	}

	data, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("failed to marshal message: %w", err)
	}

	return c.conn.WriteMessage(websocket.TextMessage, data)
}

func (c *Client) GetLastAckedSeq() int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.lastAckedSeq
}

func (c *Client) Close() {
	close(c.done)
	c.mu.Lock()
	if c.conn != nil {
		c.conn.Close()
		c.conn = nil
	}
	c.mu.Unlock()
}

func (c *Client) ResendQueued() {
	if c.queue == nil {
		return
	}
	unacked := c.queue.GetUnacked()
	sort.Slice(unacked, func(i, j int) bool { return unacked[i].Seq < unacked[j].Seq })

	for _, msg := range unacked {
		envelope := map[string]any{
			"v":       1,
			"type":    msg.Type,
			"ts":      time.Now().UTC().Format(time.RFC3339Nano),
			"seq":     msg.Seq,
			"payload": json.RawMessage(msg.Payload),
		}
		data, err := json.Marshal(envelope)
		if err != nil {
			continue
		}

		c.mu.Lock()
		conn := c.conn
		if conn == nil {
			c.mu.Unlock()
			return
		}
		err = conn.WriteMessage(websocket.TextMessage, data)
		c.mu.Unlock()
		if err != nil {
			return
		}
	}
}
