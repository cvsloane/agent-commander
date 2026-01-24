package console

import (
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type StreamHandler func(subscriptionID, sessionID string, data []byte, offset int64)

type Streamer struct {
	logDir  string
	streams map[string]*streamState
	mu      sync.Mutex
	handler StreamHandler
}

type streamState struct {
	subscriptionID string
	sessionID      string
	paneID         string
	logPath        string
	file           *os.File
	offset         int64
	done           chan struct{}
}

func NewStreamer(logDir string) (*Streamer, error) {
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return nil, err
	}
	return &Streamer{
		logDir:  logDir,
		streams: make(map[string]*streamState),
	}, nil
}

func (s *Streamer) SetHandler(handler StreamHandler) {
	s.handler = handler
}

func (s *Streamer) StartStream(subscriptionID, sessionID, paneID string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Check if already streaming
	if _, exists := s.streams[subscriptionID]; exists {
		return s.GetLogPath(paneID), nil
	}

	logPath := filepath.Join(s.logDir, paneID+".log")

	// Create or open log file
	file, err := os.OpenFile(logPath, os.O_RDONLY|os.O_CREATE, 0644)
	if err != nil {
		return "", err
	}

	// Get current file size as starting offset
	stat, _ := file.Stat()
	offset := stat.Size()

	state := &streamState{
		subscriptionID: subscriptionID,
		sessionID:      sessionID,
		paneID:         paneID,
		logPath:        logPath,
		file:           file,
		offset:         offset,
		done:           make(chan struct{}),
	}

	s.streams[subscriptionID] = state

	// Start tailing
	go s.tailFile(state)

	return logPath, nil
}

func (s *Streamer) StopStream(subscriptionID string) (string, bool) {
	s.mu.Lock()
	state, exists := s.streams[subscriptionID]
	if exists {
		delete(s.streams, subscriptionID)
	}
	s.mu.Unlock()

	if exists && state != nil {
		close(state.done)
		if state.file != nil {
			state.file.Close()
		}
		return state.paneID, true
	}
	return "", false
}

func (s *Streamer) tailFile(state *streamState) {
	buf := make([]byte, 4096)

	for {
		select {
		case <-state.done:
			return
		default:
		}

		// Try to read from current position
		n, err := state.file.ReadAt(buf, state.offset)
		if n > 0 {
			// Send data
			if s.handler != nil {
				s.handler(state.subscriptionID, state.sessionID, buf[:n], state.offset)
			}
			state.offset += int64(n)
		}

		if err != nil && err != io.EOF {
			return
		}

		// Wait a bit before checking again
		time.Sleep(100 * time.Millisecond)
	}
}

func (s *Streamer) GetLogPath(paneID string) string {
	return filepath.Join(s.logDir, paneID+".log")
}

func (s *Streamer) HasSubscribers(paneID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, state := range s.streams {
		if state.paneID == paneID {
			return true
		}
	}
	return false
}
