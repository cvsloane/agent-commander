package preview

import (
	"strings"
	"testing"
)

// Real /proc/net/tcp layout. Rows: a dev server on 0.0.0.0:8080 (reachable),
// one on 127.0.0.1:3000 (loopback only), an established connection that must be
// ignored, and sshd on :22.
const procNetTCPFixture = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 100001 1 0000000000000000 100 0 0 10 0
   1: 0100007F:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 100002 1 0000000000000000 100 0 0 10 0
   2: 0100007F:8AE2 0100007F:1F90 01 00000000:00000000 00:00000000 00000000  1000        0 100003 1 0000000000000000 100 0 0 10 0
   3: 00000000:0016 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 100004 1 0000000000000000 100 0 0 10 0
`

// IPv6: :: (wildcard, reachable) and ::1 (loopback only).
const procNetTCP6Fixture = `  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 00000000000000000000000000000000:1F91 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 100005 1 0000000000000000 100 0 0 10 0
   1: 00000000000000000000000001000000:1F92 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 100006 1 0000000000000000 100 0 0 10 0
`

func parseAll(t *testing.T, fixture string) []rawListener {
	t.Helper()
	got, err := parseProcNetTCP(strings.NewReader(fixture))
	if err != nil {
		t.Fatalf("parseProcNetTCP: %v", err)
	}
	return got
}

func TestParseProcNetTCPFindsOnlyListeners(t *testing.T) {
	got := parseAll(t, procNetTCPFixture)
	if len(got) != 3 {
		t.Fatalf("expected 3 listeners (established connection excluded), got %d: %+v", len(got), got)
	}

	byPort := map[int]rawListener{}
	for _, l := range got {
		byPort[l.Port] = l
	}

	if _, ok := byPort[35554]; ok {
		t.Error("established connection was reported as a listener")
	}

	server, ok := byPort[8080]
	if !ok {
		t.Fatal("missing listener on 8080")
	}
	if server.Address != "0.0.0.0" {
		t.Errorf("8080 address = %q, want 0.0.0.0", server.Address)
	}
	if server.Loopback {
		t.Error("8080 bound to 0.0.0.0 must not be flagged loopback")
	}
	if server.inode != "100001" {
		t.Errorf("8080 inode = %q, want 100001", server.inode)
	}
}

// The loopback flag is the whole point: a link to a 127.0.0.1 listener would
// fail from any other device, and the UI must be able to say why.
func TestParseProcNetTCPFlagsLoopback(t *testing.T) {
	byPort := map[int]rawListener{}
	for _, l := range parseAll(t, procNetTCPFixture) {
		byPort[l.Port] = l
	}

	local, ok := byPort[3000]
	if !ok {
		t.Fatal("missing listener on 3000")
	}
	if local.Address != "127.0.0.1" {
		t.Errorf("3000 address = %q, want 127.0.0.1", local.Address)
	}
	if !local.Loopback {
		t.Error("3000 bound to 127.0.0.1 must be flagged loopback")
	}
}

func TestParseProcNetTCP6(t *testing.T) {
	byPort := map[int]rawListener{}
	for _, l := range parseAll(t, procNetTCP6Fixture) {
		byPort[l.Port] = l
	}

	wildcard, ok := byPort[8081]
	if !ok {
		t.Fatal("missing IPv6 listener on 8081")
	}
	if wildcard.Loopback {
		t.Errorf("8081 bound to :: must not be loopback (address=%q)", wildcard.Address)
	}

	local, ok := byPort[8082]
	if !ok {
		t.Fatal("missing IPv6 listener on 8082")
	}
	if !local.Loopback {
		t.Errorf("8082 bound to ::1 must be loopback (address=%q)", local.Address)
	}
}

// A service on both 0.0.0.0 and :: is one service. If any binding is reachable,
// the service is reachable -- reporting it as loopback would hide a working link.
func TestDedupePrefersReachableBinding(t *testing.T) {
	merged := dedupe([]rawListener{
		{Listener: Listener{Port: 3000, Address: "127.0.0.1", Loopback: true, PID: 42, Process: "node"}},
		{Listener: Listener{Port: 3000, Address: "0.0.0.0", Loopback: false}},
		{Listener: Listener{Port: 22, Address: "0.0.0.0", Loopback: false, PID: 7, Process: "sshd"}},
	})

	if len(merged) != 2 {
		t.Fatalf("expected 2 unique ports, got %d: %+v", len(merged), merged)
	}
	if merged[0].Port != 22 || merged[1].Port != 3000 {
		t.Errorf("expected ports sorted ascending, got %d then %d", merged[0].Port, merged[1].Port)
	}

	svc := merged[1]
	if svc.Loopback {
		t.Error("port bound on both loopback and wildcard must be reported reachable")
	}
	if svc.Process != "node" || svc.PID != 42 {
		t.Errorf("owner info lost during merge: %+v", svc)
	}
}

func TestParseHexAddress(t *testing.T) {
	for _, tc := range []struct {
		field    string
		wantIP   string
		wantPort int
	}{
		{"00000000:1F90", "0.0.0.0", 8080},
		{"0100007F:0BB8", "127.0.0.1", 3000},
		{"00000000000000000000000000000000:0050", "::", 80},
		{"00000000000000000000000001000000:0050", "::1", 80},
	} {
		ip, port, err := parseHexAddress(tc.field)
		if err != nil {
			t.Errorf("parseHexAddress(%q): %v", tc.field, err)
			continue
		}
		if ip.String() != tc.wantIP || port != tc.wantPort {
			t.Errorf("parseHexAddress(%q) = %s:%d, want %s:%d", tc.field, ip, port, tc.wantIP, tc.wantPort)
		}
	}

	if _, _, err := parseHexAddress("garbage"); err == nil {
		t.Error("expected an error for a malformed address")
	}
}
