package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestTerminalPerViewerPTYDefaultsOnAndCanBeDisabled(t *testing.T) {
	for _, test := range []struct {
		name string
		yaml string
		want bool
	}{
		{name: "default", yaml: "{}\n", want: true},
		{name: "explicit false", yaml: "terminal:\n  per_viewer_pty: false\n", want: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "config.yaml")
			if err := os.WriteFile(path, []byte(test.yaml), 0600); err != nil {
				t.Fatalf("write config: %v", err)
			}
			cfg, err := LoadConfig(path)
			if err != nil {
				t.Fatalf("LoadConfig: %v", err)
			}
			if cfg.Terminal.PerViewerPTY != test.want {
				t.Fatalf("per_viewer_pty=%v, want=%v", cfg.Terminal.PerViewerPTY, test.want)
			}
		})
	}
}
