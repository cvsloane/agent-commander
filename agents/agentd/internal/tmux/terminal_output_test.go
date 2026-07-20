package tmux

import (
	"reflect"
	"sync"
	"testing"
	"time"
)

func TestOutputRingDropsOldestChunks(t *testing.T) {
	ring := newOutputRing(2)
	ring.Push("one")
	ring.Push("two")
	ring.Push("three")

	chunks, dropped := ring.Drain()
	if !reflect.DeepEqual(chunks, []string{"two", "three"}) {
		t.Fatalf("chunks=%v, want drop-oldest order", chunks)
	}
	if dropped != 1 {
		t.Fatalf("dropped=%d, want=1", dropped)
	}
}

func TestTerminalFanoutEncodesOnceForEveryChannel(t *testing.T) {
	var mu sync.Mutex
	encodeCalls := 0
	outputs := make(map[string]string)
	done := make(chan struct{}, 2)
	fanout := newTerminalFanout(4, func(data []byte) string {
		mu.Lock()
		encodeCalls++
		mu.Unlock()
		return "encoded:" + string(data)
	}, func(channelID, encoded string) {
		mu.Lock()
		outputs[channelID] = encoded
		mu.Unlock()
		done <- struct{}{}
	}, nil)
	defer fanout.Close()
	fanout.Attach("channel-1")
	fanout.Attach("channel-2")

	fanout.Broadcast([]byte("hello"))
	for range 2 {
		select {
		case <-done:
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for terminal fanout")
		}
	}

	mu.Lock()
	defer mu.Unlock()
	if encodeCalls != 1 {
		t.Fatalf("encode calls=%d, want=1", encodeCalls)
	}
	want := map[string]string{"channel-1": "encoded:hello", "channel-2": "encoded:hello"}
	if !reflect.DeepEqual(outputs, want) {
		t.Fatalf("outputs=%v, want=%v", outputs, want)
	}
}

func TestTerminalOutputChannelReportsLagAfterDropping(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	lag := make(chan int, 1)
	channel := newTerminalOutputChannel("slow", 2, func(_ string, _ string) {
		select {
		case <-started:
		default:
			close(started)
		}
		<-release
	}, func(_ string, dropped int) {
		lag <- dropped
	})
	defer channel.Close()

	channel.Enqueue("one")
	<-started
	channel.Enqueue("two")
	channel.Enqueue("three")
	channel.Enqueue("four")
	close(release)

	select {
	case dropped := <-lag:
		if dropped != 1 {
			t.Fatalf("lag dropped=%d, want=1", dropped)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for lag notification")
	}
}
