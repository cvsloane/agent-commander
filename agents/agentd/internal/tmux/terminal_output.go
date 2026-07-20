package tmux

import "sync"

type outputRing struct {
	mu       sync.Mutex
	items    []string
	capacity int
	dropped  int
}

func newOutputRing(capacity int) *outputRing {
	if capacity < 1 {
		capacity = 1
	}
	return &outputRing{capacity: capacity, items: make([]string, 0, capacity)}
}

func (r *outputRing) Push(chunk string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.items) == r.capacity {
		copy(r.items, r.items[1:])
		r.items[len(r.items)-1] = chunk
		r.dropped++
		return
	}
	r.items = append(r.items, chunk)
}

func (r *outputRing) Drain() ([]string, int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	items := append([]string(nil), r.items...)
	dropped := r.dropped
	r.items = r.items[:0]
	r.dropped = 0
	return items, dropped
}

type terminalOutputChannel struct {
	id       string
	ring     *outputRing
	wake     chan struct{}
	done     chan struct{}
	closeOne sync.Once
	onOutput func(channelID, encoded string)
	onLag    func(channelID string, dropped int)
}

func newTerminalOutputChannel(
	id string,
	capacity int,
	onOutput func(channelID, encoded string),
	onLag func(channelID string, dropped int),
) *terminalOutputChannel {
	channel := &terminalOutputChannel{
		id:       id,
		ring:     newOutputRing(capacity),
		wake:     make(chan struct{}, 1),
		done:     make(chan struct{}),
		onOutput: onOutput,
		onLag:    onLag,
	}
	go channel.run()
	return channel
}

func (c *terminalOutputChannel) Enqueue(encoded string) {
	select {
	case <-c.done:
		return
	default:
	}
	c.ring.Push(encoded)
	select {
	case c.wake <- struct{}{}:
	default:
	}
}

func (c *terminalOutputChannel) Close() {
	c.closeOne.Do(func() { close(c.done) })
}

func (c *terminalOutputChannel) run() {
	for {
		select {
		case <-c.done:
			return
		case <-c.wake:
			chunks, dropped := c.ring.Drain()
			if dropped > 0 && c.onLag != nil {
				c.onLag(c.id, dropped)
			}
			for _, chunk := range chunks {
				if c.onOutput != nil {
					c.onOutput(c.id, chunk)
				}
			}
		}
	}
}

type terminalFanout struct {
	mu       sync.RWMutex
	channels map[string]*terminalOutputChannel
	capacity int
	encode   func([]byte) string
	onOutput func(channelID, encoded string)
	onLag    func(channelID string, dropped int)
}

func newTerminalFanout(
	capacity int,
	encode func([]byte) string,
	onOutput func(channelID, encoded string),
	onLag func(channelID string, dropped int),
) *terminalFanout {
	return &terminalFanout{
		channels: make(map[string]*terminalOutputChannel),
		capacity: capacity,
		encode:   encode,
		onOutput: onOutput,
		onLag:    onLag,
	}
}

func (f *terminalFanout) Attach(channelID string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, exists := f.channels[channelID]; exists {
		return
	}
	f.channels[channelID] = newTerminalOutputChannel(channelID, f.capacity, f.onOutput, f.onLag)
}

func (f *terminalFanout) Detach(channelID string) {
	f.mu.Lock()
	channel := f.channels[channelID]
	delete(f.channels, channelID)
	f.mu.Unlock()
	if channel != nil {
		channel.Close()
	}
}

func (f *terminalFanout) Broadcast(data []byte) {
	f.mu.RLock()
	channels := make([]*terminalOutputChannel, 0, len(f.channels))
	for _, channel := range f.channels {
		channels = append(channels, channel)
	}
	f.mu.RUnlock()
	if len(channels) == 0 || f.encode == nil {
		return
	}
	encoded := f.encode(data)
	for _, channel := range channels {
		channel.Enqueue(encoded)
	}
}

func (f *terminalFanout) Close() {
	f.mu.Lock()
	channels := make([]*terminalOutputChannel, 0, len(f.channels))
	for id, channel := range f.channels {
		channels = append(channels, channel)
		delete(f.channels, id)
	}
	f.mu.Unlock()
	for _, channel := range channels {
		channel.Close()
	}
}
