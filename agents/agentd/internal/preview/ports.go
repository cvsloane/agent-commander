// Package preview discovers TCP services listening on the host so the UI can
// offer a one-tap link to them over the tailnet.
//
// There is no tunnel here by design: the phone and the host are already
// Tailscale peers, so a listener on 0.0.0.0 is directly reachable at the host's
// tailnet address. The job of this package is only to find the listeners and,
// critically, to report whether each one is bound to loopback -- a dev server on
// 127.0.0.1 is invisible to every other device, and silently offering a link to
// it would produce a connection error the user cannot diagnose.
package preview

import (
	"bufio"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// tcpStateListen is the value of the `st` column in /proc/net/tcp for LISTEN.
const tcpStateListen = "0A"

// Listener is a TCP socket accepting connections on this host.
type Listener struct {
	Port int `json:"port"`
	// Address is the bind address in presentation form ("0.0.0.0", "127.0.0.1", "::").
	Address string `json:"address"`
	// Loopback reports that this listener is bound to a loopback address only and
	// is therefore NOT reachable from another device on the tailnet.
	Loopback bool   `json:"loopback"`
	PID      int    `json:"pid,omitempty"`
	Process  string `json:"process,omitempty"`
}

// parseHexAddress decodes the little-endian hex address form used by
// /proc/net/tcp ("0100007F:1F90" -> 127.0.0.1:8080).
func parseHexAddress(field string) (net.IP, int, error) {
	parts := strings.Split(field, ":")
	if len(parts) != 2 {
		return nil, 0, fmt.Errorf("malformed address %q", field)
	}

	port64, err := strconv.ParseUint(parts[1], 16, 32)
	if err != nil {
		return nil, 0, fmt.Errorf("malformed port in %q: %w", field, err)
	}

	raw, err := hex.DecodeString(parts[0])
	if err != nil {
		return nil, 0, fmt.Errorf("malformed host in %q: %w", field, err)
	}

	// Each 4-byte group is written in host byte order (little-endian on the
	// platforms we support), so reverse per group rather than over the whole
	// address -- getting this wrong silently mislabels IPv6 addresses.
	if len(raw)%4 != 0 {
		return nil, 0, fmt.Errorf("unexpected address width in %q", field)
	}
	ip := make(net.IP, len(raw))
	for offset := 0; offset < len(raw); offset += 4 {
		group := binary.LittleEndian.Uint32(raw[offset : offset+4])
		binary.BigEndian.PutUint32(ip[offset:offset+4], group)
	}

	return ip, int(port64), nil
}

// ParseProcNetTCP extracts listening sockets from a /proc/net/tcp[6] stream.
// Returned listeners carry the socket inode in PID until it is resolved.
type rawListener struct {
	Listener
	inode string
}

func parseProcNetTCP(r io.Reader) ([]rawListener, error) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	var out []rawListener
	first := true
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if first {
			first = false // header row
			continue
		}
		if line == "" {
			continue
		}

		fields := strings.Fields(line)
		// sl local_address rem_address st ... uid timeout inode
		if len(fields) < 10 || fields[3] != tcpStateListen {
			continue
		}

		ip, port, err := parseHexAddress(fields[1])
		if err != nil || port == 0 {
			continue
		}

		out = append(out, rawListener{
			Listener: Listener{
				Port:     port,
				Address:  ip.String(),
				Loopback: ip.IsLoopback(),
			},
			inode: fields[9],
		})
	}
	return out, scanner.Err()
}

// resolveOwners maps socket inodes to the owning process. Only processes owned
// by this user are visible without elevation, which is exactly the scope we
// want: dev servers the operator started, not system daemons.
func resolveOwners(listeners []rawListener) {
	wanted := make(map[string]int, len(listeners))
	for i, l := range listeners {
		if l.inode != "" {
			wanted[l.inode] = i
		}
	}
	if len(wanted) == 0 {
		return
	}

	procs, err := os.ReadDir("/proc")
	if err != nil {
		return
	}

	for _, entry := range procs {
		if !entry.IsDir() {
			continue
		}
		pid, err := strconv.Atoi(entry.Name())
		if err != nil {
			continue
		}

		fdDir := filepath.Join("/proc", entry.Name(), "fd")
		fds, err := os.ReadDir(fdDir)
		if err != nil {
			continue // another user's process, or it exited mid-scan
		}

		var comm string
		for _, fd := range fds {
			link, err := os.Readlink(filepath.Join(fdDir, fd.Name()))
			if err != nil {
				continue
			}
			if !strings.HasPrefix(link, "socket:[") {
				continue
			}
			inode := strings.TrimSuffix(strings.TrimPrefix(link, "socket:["), "]")
			idx, ok := wanted[inode]
			if !ok {
				continue
			}
			if comm == "" {
				comm = readComm(entry.Name())
			}
			listeners[idx].PID = pid
			listeners[idx].Process = comm
		}
	}
}

func readComm(pid string) string {
	data, err := os.ReadFile(filepath.Join("/proc", pid, "comm"))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

// dedupe collapses the same port bound on several addresses into one entry.
// A server listening on both 0.0.0.0 and :: is one service; and if any binding
// is non-loopback the service IS reachable, so the reachable binding wins.
func dedupe(listeners []rawListener) []Listener {
	byPort := make(map[int]Listener, len(listeners))
	for _, l := range listeners {
		existing, seen := byPort[l.Port]
		if !seen {
			byPort[l.Port] = l.Listener
			continue
		}
		if existing.Loopback && !l.Loopback {
			// Prefer the reachable binding, but keep owner info if we only
			// resolved it on the loopback row.
			merged := l.Listener
			if merged.PID == 0 {
				merged.PID, merged.Process = existing.PID, existing.Process
			}
			byPort[l.Port] = merged
			continue
		}
		if existing.PID == 0 && l.PID != 0 {
			existing.PID, existing.Process = l.PID, l.Process
			byPort[l.Port] = existing
		}
	}

	out := make([]Listener, 0, len(byPort))
	for _, l := range byPort {
		out = append(out, l)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Port < out[j].Port })
	return out
}

// ListListeners returns the TCP ports currently accepting connections.
func ListListeners() ([]Listener, error) {
	var all []rawListener
	var lastErr error
	found := false

	for _, path := range []string{"/proc/net/tcp", "/proc/net/tcp6"} {
		f, err := os.Open(path)
		if err != nil {
			lastErr = err
			continue
		}
		parsed, err := parseProcNetTCP(f)
		f.Close()
		if err != nil {
			lastErr = err
			continue
		}
		found = true
		all = append(all, parsed...)
	}

	if !found {
		if lastErr != nil {
			return nil, fmt.Errorf("failed to read listening sockets: %w", lastErr)
		}
		return nil, fmt.Errorf("failed to read listening sockets")
	}

	resolveOwners(all)
	return dedupe(all), nil
}
