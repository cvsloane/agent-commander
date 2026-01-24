package queue

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

type Message struct {
	Seq     int64           `json:"seq"`
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

type Queue struct {
	path     string
	maxSize  int
	messages []Message
	mu       sync.Mutex
}

func NewQueue(stateDir string, maxSize int) (*Queue, error) {
	path := filepath.Join(stateDir, "outbound-queue.jsonl")

	// Ensure directory exists
	if err := os.MkdirAll(stateDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create state directory: %w", err)
	}

	q := &Queue{
		path:    path,
		maxSize: maxSize,
	}

	// Load existing messages
	if err := q.load(); err != nil {
		return nil, err
	}

	return q, nil
}

func (q *Queue) load() error {
	file, err := os.Open(q.path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("failed to open queue file: %w", err)
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		var msg Message
		if err := json.Unmarshal(scanner.Bytes(), &msg); err != nil {
			continue // Skip invalid lines
		}
		q.messages = append(q.messages, msg)
	}

	return scanner.Err()
}

func (q *Queue) save() error {
	file, err := os.Create(q.path)
	if err != nil {
		return fmt.Errorf("failed to create queue file: %w", err)
	}
	defer file.Close()

	for _, msg := range q.messages {
		data, err := json.Marshal(msg)
		if err != nil {
			continue
		}
		file.Write(data)
		file.WriteString("\n")
	}

	return nil
}

func (q *Queue) Push(msg Message) error {
	q.mu.Lock()
	defer q.mu.Unlock()

	// Check size limit
	if len(q.messages) >= q.maxSize {
		// Remove oldest message
		q.messages = q.messages[1:]
	}

	q.messages = append(q.messages, msg)
	return q.save()
}

func (q *Queue) AckUpto(seq int64) error {
	q.mu.Lock()
	defer q.mu.Unlock()

	// Remove all messages with seq <= provided seq
	newMessages := make([]Message, 0)
	for _, msg := range q.messages {
		if msg.Seq > seq {
			newMessages = append(newMessages, msg)
		}
	}

	q.messages = newMessages
	return q.save()
}

func (q *Queue) GetUnacked() []Message {
	q.mu.Lock()
	defer q.mu.Unlock()

	result := make([]Message, len(q.messages))
	copy(result, q.messages)
	return result
}

func (q *Queue) Len() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.messages)
}

// LoadAckedSeq loads the last acked sequence number
func LoadAckedSeq(stateDir string) (int64, error) {
	path := filepath.Join(stateDir, "acked-seq")
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}

	var seq int64
	if _, err := fmt.Sscanf(string(data), "%d", &seq); err != nil {
		return 0, nil
	}
	return seq, nil
}

// SaveAckedSeq saves the last acked sequence number
func SaveAckedSeq(stateDir string, seq int64) error {
	path := filepath.Join(stateDir, "acked-seq")
	return os.WriteFile(path, []byte(fmt.Sprintf("%d", seq)), 0644)
}
