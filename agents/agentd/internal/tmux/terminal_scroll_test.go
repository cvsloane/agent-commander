package tmux

import "testing"

func TestAccumulateWheelEvents(t *testing.T) {
	cases := []struct {
		name        string
		residue     int
		lines       int
		wantEvents  int
		wantResidue int
	}{
		{"slow drag first frame", 0, 1, 0, 1},
		{"slow drag accumulates", 2, 1, 1, 0},
		{"single big frame", 0, 10, 3, 1},
		{"downward accumulates", -2, -1, -1, 0},
		{"direction flip drains residue", 2, -3, 0, -1},
		{"zero passthrough", 1, 0, 0, 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			events, residue := accumulateWheelEvents(tc.residue, tc.lines)
			if events != tc.wantEvents || residue != tc.wantResidue {
				t.Fatalf("accumulateWheelEvents(%d, %d) = (%d, %d), want (%d, %d)",
					tc.residue, tc.lines, events, residue, tc.wantEvents, tc.wantResidue)
			}
		})
	}
}
