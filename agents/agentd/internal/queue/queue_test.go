package queue

import (
	"encoding/json"
	"reflect"
	"testing"
)

func testMessage(seq int64, msgType string) Message {
	return Message{Seq: seq, Type: msgType, Payload: json.RawMessage(`{"ok":true}`)}
}

func messageSeqs(messages []Message) []int64 {
	seqs := make([]int64, 0, len(messages))
	for _, message := range messages {
		seqs = append(seqs, message.Seq)
	}
	return seqs
}

func TestQueuePushAckPruneCompactAndReload(t *testing.T) {
	dir := t.TempDir()
	q, err := NewQueue(dir, 10)
	if err != nil {
		t.Fatal(err)
	}
	for seq := int64(2); seq <= 5; seq++ {
		if err := q.Push(testMessage(seq, "events.append")); err != nil {
			t.Fatalf("push %d: %v", seq, err)
		}
	}
	if q.Len() != 4 || q.MaxSeq() != 5 {
		t.Fatalf("unexpected queue state: len=%d max=%d", q.Len(), q.MaxSeq())
	}

	if err := q.AckUpto(2); err != nil {
		t.Fatalf("ack: %v", err)
	}
	if got := messageSeqs(q.GetUnacked()); !reflect.DeepEqual(got, []int64{3, 4, 5}) {
		t.Fatalf("after ack seqs=%v", got)
	}
	if err := q.PruneAcked(3); err != nil {
		t.Fatalf("prune: %v", err)
	}
	if err := q.compact(); err != nil {
		t.Fatalf("compact: %v", err)
	}
	if err := q.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	reloaded, err := NewQueue(dir, 10)
	if err != nil {
		t.Fatal(err)
	}
	defer reloaded.Close()
	if got := messageSeqs(reloaded.GetUnacked()); !reflect.DeepEqual(got, []int64{4, 5}) {
		t.Fatalf("reloaded seqs=%v", got)
	}
}

func TestQueueCapacityCompactionSurvivesReload(t *testing.T) {
	dir := t.TempDir()
	q, err := NewQueue(dir, 2)
	if err != nil {
		t.Fatal(err)
	}
	for seq := int64(1); seq <= 3; seq++ {
		if err := q.Push(testMessage(seq, "sessions.upsert")); err != nil {
			t.Fatalf("push %d: %v", seq, err)
		}
	}
	if err := q.Close(); err != nil {
		t.Fatal(err)
	}

	reloaded, err := NewQueue(dir, 2)
	if err != nil {
		t.Fatal(err)
	}
	defer reloaded.Close()
	if got := messageSeqs(reloaded.GetUnacked()); !reflect.DeepEqual(got, []int64{2, 3}) {
		t.Fatalf("reloaded seqs=%v", got)
	}
}

func TestQueueRebaseAvoidsRestartSequenceCollision(t *testing.T) {
	dir := t.TempDir()
	q, err := NewQueue(dir, 10)
	if err != nil {
		t.Fatal(err)
	}
	for seq := int64(1); seq <= 3; seq++ {
		if err := q.Push(testMessage(seq, "commands.result")); err != nil {
			t.Fatal(err)
		}
	}

	maxSeq, err := q.RebaseAbove(1)
	if err != nil {
		t.Fatal(err)
	}
	if maxSeq != 4 {
		t.Fatalf("max seq=%d, want 4", maxSeq)
	}
	if got := messageSeqs(q.GetUnacked()); !reflect.DeepEqual(got, []int64{2, 3, 4}) {
		t.Fatalf("rebased seqs=%v", got)
	}
	if err := q.Close(); err != nil {
		t.Fatal(err)
	}

	reloaded, err := NewQueue(dir, 10)
	if err != nil {
		t.Fatal(err)
	}
	defer reloaded.Close()
	if got := messageSeqs(reloaded.GetUnacked()); !reflect.DeepEqual(got, []int64{2, 3, 4}) {
		t.Fatalf("reloaded rebased seqs=%v", got)
	}
}

func TestAckedSequenceRoundTrip(t *testing.T) {
	dir := t.TempDir()
	if err := SaveAckedSeq(dir, 42); err != nil {
		t.Fatal(err)
	}
	got, err := LoadAckedSeq(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got != 42 {
		t.Fatalf("acked seq=%d, want 42", got)
	}
}
