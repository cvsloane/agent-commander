package commands

import (
	"errors"
	"fmt"
	"reflect"
	"sync"
	"testing"
	"time"
)

func dispatch(id, session string) Dispatch {
	return Dispatch{CmdID: id, SessionID: session, Command: Command{Type: "test"}}
}

func TestExecutorPreservesPerSessionFIFO(t *testing.T) {
	var mu sync.Mutex
	var order []string
	results := make(chan Result, 3)
	executor := NewExecutor(3, func(command Dispatch) (map[string]any, error) {
		mu.Lock()
		order = append(order, command.CmdID)
		mu.Unlock()
		return nil, nil
	}, func(result Result) { results <- result })
	defer executor.Close()

	for i := 1; i <= 3; i++ {
		if err := executor.Submit(dispatch(fmt.Sprintf("cmd-%d", i), "session-a")); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 3; i++ {
		select {
		case <-results:
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for result")
		}
	}
	mu.Lock()
	defer mu.Unlock()
	if !reflect.DeepEqual(order, []string{"cmd-1", "cmd-2", "cmd-3"}) {
		t.Fatalf("execution order=%v", order)
	}
}

func TestSubmitDoesNotBlockReaderWhileCommandRuns(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	results := make(chan Result, 2)
	executor := NewExecutor(2, func(command Dispatch) (map[string]any, error) {
		if command.CmdID == "slow" {
			close(started)
			<-release
		}
		return nil, nil
	}, func(result Result) { results <- result })
	defer executor.Close()

	if err := executor.Submit(dispatch("slow", "session-a")); err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("slow command did not start")
	}

	returned := make(chan error, 1)
	go func() { returned <- executor.Submit(dispatch("next", "session-a")) }()
	select {
	case err := <-returned:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(100 * time.Millisecond):
		t.Fatal("submission blocked behind running command")
	}

	// The WebSocket reader can process its next (for example, terminal.*)
	// message as soon as Submit returns; command execution remains on workers.
	close(release)
	for i := 0; i < 2; i++ {
		select {
		case <-results:
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for results")
		}
	}
}

func TestExecutorEmitsSingleResultPerCommandID(t *testing.T) {
	results := make(chan Result, 2)
	executor := NewExecutor(1, func(command Dispatch) (map[string]any, error) {
		return map[string]any{"content": "capture"}, nil
	}, func(result Result) { results <- result })
	defer executor.Close()

	command := dispatch("capture-1", "session-a")
	if err := executor.Submit(command); err != nil {
		t.Fatal(err)
	}
	if err := executor.Submit(command); !errors.Is(err, ErrDuplicateCommand) {
		t.Fatalf("duplicate submit error=%v", err)
	}

	select {
	case result := <-results:
		if !result.OK || result.Result["content"] != "capture" {
			t.Fatalf("unexpected result: %+v", result)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for result")
	}
	select {
	case result := <-results:
		t.Fatalf("duplicate result emitted: %+v", result)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestExecutorTurnsPanicIntoOneFailureResult(t *testing.T) {
	results := make(chan Result, 1)
	executor := NewExecutor(1, func(Dispatch) (map[string]any, error) {
		panic("boom")
	}, func(result Result) { results <- result })
	defer executor.Close()
	if err := executor.Submit(dispatch("panic-1", "session-a")); err != nil {
		t.Fatal(err)
	}
	select {
	case result := <-results:
		if result.OK || result.Error == nil {
			t.Fatalf("unexpected panic result: %+v", result)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for panic result")
	}
}
