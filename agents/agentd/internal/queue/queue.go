package queue

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type Message struct {
	Seq     int64           `json:"seq"`
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

type Queue struct {
	path        string
	maxSize     int
	messages    []Message
	mu          sync.Mutex
	append      *os.File
	lastCompact time.Time
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

	if err := q.openAppend(); err != nil {
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
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 1024*1024)
	for scanner.Scan() {
		var msg Message
		if err := json.Unmarshal(scanner.Bytes(), &msg); err != nil {
			continue // Skip invalid lines
		}
		q.messages = append(q.messages, msg)
	}

	return scanner.Err()
}

func (q *Queue) openAppend() error {
	if q.append != nil {
		return nil
	}
	file, err := os.OpenFile(q.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return fmt.Errorf("failed to open queue file for append: %w", err)
	}
	q.append = file
	return nil
}

func (q *Queue) appendMessage(msg Message) error {
	if err := q.openAppend(); err != nil {
		return err
	}
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	if _, err := q.append.Write(data); err != nil {
		return err
	}
	if _, err := q.append.WriteString("\n"); err != nil {
		return err
	}
	return nil
}

func (q *Queue) compact() error {
	tmpPath := q.path + ".tmp"
	file, err := os.Create(tmpPath)
	if err != nil {
		return fmt.Errorf("failed to create queue file: %w", err)
	}
	for _, msg := range q.messages {
		data, err := json.Marshal(msg)
		if err != nil {
			continue
		}
		if _, err := file.Write(data); err != nil {
			file.Close()
			return err
		}
		if _, err := file.WriteString("\n"); err != nil {
			file.Close()
			return err
		}
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, q.path); err != nil {
		return err
	}
	if q.append != nil {
		_ = q.append.Close()
		q.append = nil
	}
	q.lastCompact = time.Now()
	return q.openAppend()
}

func (q *Queue) maybeCompact(removed int) error {
	if removed == 0 {
		return nil
	}
	// Avoid compacting too frequently
	if time.Since(q.lastCompact) < 30*time.Second && removed < 100 {
		return nil
	}
	info, err := os.Stat(q.path)
	if err == nil {
		// Skip compaction for small files unless we removed a lot
		if info.Size() < 5*1024*1024 && removed < 100 {
			return nil
		}
	}
	return q.compact()
}

func (q *Queue) pruneLocked(seq int64) int {
	if len(q.messages) == 0 {
		return 0
	}
	removed := 0
	newMessages := make([]Message, 0, len(q.messages))
	for _, msg := range q.messages {
		if msg.Seq > seq {
			newMessages = append(newMessages, msg)
		} else {
			removed++
		}
	}
	q.messages = newMessages
	return removed
}

func (q *Queue) Push(msg Message) error {
	q.mu.Lock()
	defer q.mu.Unlock()

	// Check size limit
	needsCompact := false
	if len(q.messages) >= q.maxSize {
		// Remove oldest message
		q.messages = q.messages[1:]
		needsCompact = true
	}

	q.messages = append(q.messages, msg)
	if err := q.appendMessage(msg); err != nil {
		return err
	}
	if needsCompact {
		return q.compact()
	}
	return nil
}

func (q *Queue) AckUpto(seq int64) error {
	q.mu.Lock()
	defer q.mu.Unlock()

	removed := q.pruneLocked(seq)
	return q.maybeCompact(removed)
}

// PruneAcked removes messages <= seq without forcing a full rewrite.
func (q *Queue) PruneAcked(seq int64) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	removed := q.pruneLocked(seq)
	return q.maybeCompact(removed)
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
