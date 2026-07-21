package commands

import (
	"errors"
	"fmt"
	"sync"

	"github.com/agent-command/agentd/internal/protocol"
)

var (
	ErrClosed             = errors.New("command executor is closed")
	ErrDuplicateCommand   = errors.New("duplicate command id")
	ErrInvalidCommandID   = errors.New("command id is required")
	ErrInvalidCommandType = errors.New("command type is required")
)

type Command = protocol.Command
type Dispatch = protocol.CommandDispatchPayload
type ResultError = protocol.CommandResultError
type Result = protocol.CommandResultPayload

type Handler func(Dispatch) (map[string]any, error)
type ResultHandler func(Result)

type commandResultError struct {
	code    string
	message string
}

func (e *commandResultError) Error() string             { return e.message }
func (e *commandResultError) CommandResultCode() string { return e.code }

func NewResultError(code, message string) error {
	return &commandResultError{code: code, message: message}
}

// Executor runs commands on a fixed worker pool while allowing at most one
// in-flight command for each session key.
type Executor struct {
	mu        sync.Mutex
	cond      *sync.Cond
	queues    map[string][]Dispatch
	readyKeys []string
	scheduled map[string]bool
	accepted  map[string]struct{}
	closed    bool
	handler   Handler
	onResult  ResultHandler
	workers   sync.WaitGroup
}

func NewExecutor(workerCount int, handler Handler, onResult ResultHandler) *Executor {
	if workerCount < 1 {
		workerCount = 1
	}
	e := &Executor{
		queues:    make(map[string][]Dispatch),
		scheduled: make(map[string]bool),
		accepted:  make(map[string]struct{}),
		handler:   handler,
		onResult:  onResult,
	}
	e.cond = sync.NewCond(&e.mu)
	e.workers.Add(workerCount)
	for i := 0; i < workerCount; i++ {
		go e.worker()
	}
	return e
}

// Submit adds a command without waiting for an available worker. Duplicate
// command IDs are rejected so each accepted cmd_id produces exactly one result.
func (e *Executor) Submit(dispatch Dispatch) error {
	if dispatch.CmdID == "" {
		return ErrInvalidCommandID
	}
	if dispatch.Command.Type == "" {
		return ErrInvalidCommandType
	}

	e.mu.Lock()
	defer e.mu.Unlock()
	if e.closed {
		return ErrClosed
	}
	if _, exists := e.accepted[dispatch.CmdID]; exists {
		return ErrDuplicateCommand
	}
	e.accepted[dispatch.CmdID] = struct{}{}

	key := dispatch.SessionID
	if key == "" {
		key = "cmd:" + dispatch.CmdID
	}
	e.queues[key] = append(e.queues[key], dispatch)
	if !e.scheduled[key] {
		e.scheduled[key] = true
		e.readyKeys = append(e.readyKeys, key)
		e.cond.Signal()
	}
	return nil
}

// Close stops accepting work and waits for every accepted command to finish.
func (e *Executor) Close() {
	e.mu.Lock()
	e.closed = true
	e.cond.Broadcast()
	e.mu.Unlock()
	e.workers.Wait()
}

func (e *Executor) worker() {
	defer e.workers.Done()
	for {
		key, dispatch, ok := e.next()
		if !ok {
			return
		}
		result := e.execute(dispatch)
		if e.onResult != nil {
			e.onResult(result)
		}
		e.complete(key)
	}
}

func (e *Executor) next() (string, Dispatch, bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	for len(e.readyKeys) == 0 && !e.closed {
		e.cond.Wait()
	}
	if len(e.readyKeys) == 0 {
		return "", Dispatch{}, false
	}
	key := e.readyKeys[0]
	e.readyKeys = e.readyKeys[1:]
	return key, e.queues[key][0], true
}

func (e *Executor) complete(key string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	queue := e.queues[key][1:]
	if len(queue) == 0 {
		delete(e.queues, key)
		delete(e.scheduled, key)
		return
	}
	e.queues[key] = queue
	e.readyKeys = append(e.readyKeys, key)
	e.cond.Signal()
}

func (e *Executor) execute(dispatch Dispatch) (result Result) {
	result.CmdID = dispatch.CmdID
	result.SessionID = dispatch.SessionID
	defer func() {
		if recovered := recover(); recovered != nil {
			result.OK = false
			result.Result = nil
			result.Error = &ResultError{Code: "COMMAND_FAILED", Message: fmt.Sprintf("command panicked: %v", recovered)}
		}
	}()

	payload, err := e.handler(dispatch)
	if err != nil {
		code := "COMMAND_FAILED"
		var coded interface{ CommandResultCode() string }
		if errors.As(err, &coded) && coded.CommandResultCode() != "" {
			code = coded.CommandResultCode()
		}
		result.Error = &ResultError{Code: code, Message: err.Error()}
		return result
	}
	result.OK = true
	result.Result = payload
	return result
}
