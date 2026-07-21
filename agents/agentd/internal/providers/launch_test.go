package providers

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/agent-command/agentd/internal/config"
)

func TestLaunchSpecShellCommandKeepsInjectionStringsInert(t *testing.T) {
	sentinel := filepath.Join(t.TempDir(), "injected")
	dangerous := "$(touch " + sentinel + "); quote ' and ; touch " + sentinel
	spec := LaunchSpec{
		Argv: []string{"/usr/bin/printf", "%s\\n", dangerous},
		Env:  map[string]string{"DANGEROUS": dangerous},
	}

	command, err := spec.ShellCommand()
	if err != nil {
		t.Fatal(err)
	}
	output, err := exec.Command("/bin/sh", "-c", command).CombinedOutput()
	if err != nil {
		t.Fatalf("execute quoted command: %v; output=%s; command=%s", err, output, command)
	}
	if !strings.Contains(string(output), dangerous) {
		t.Fatalf("dangerous argv was not preserved literally: %q", output)
	}
	if _, err := os.Stat(sentinel); !os.IsNotExist(err) {
		t.Fatalf("injection string executed; sentinel stat error=%v", err)
	}
}

func TestLaunchTemplatesAreConfigOverridableAndSupportHeadless(t *testing.T) {
	cfg := &config.Config{Providers: config.ProvidersConfig{
		LaunchTemplates: map[string]config.ProviderLaunchTemplate{
			"claude_code": {
				Argv:         []string{"custom-claude", "interactive"},
				Env:          map[string]string{"FROM_TEMPLATE": "yes"},
				HeadlessArgv: []string{"custom-claude", "headless", "{{prompt}}"},
			},
		},
	}}
	templates := NewLaunchTemplates(cfg)

	interactive, err := templates.Interactive("claude_code", []string{"--flag"}, map[string]string{"REQUEST": "yes"})
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(interactive.Argv, "|"); got != "custom-claude|interactive|--flag" {
		t.Fatalf("interactive argv=%q", got)
	}
	if interactive.Env["FROM_TEMPLATE"] != "yes" || interactive.Env["REQUEST"] != "yes" {
		t.Fatalf("interactive env=%v", interactive.Env)
	}

	headless, err := templates.Headless("claude_code", "do the work", nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(headless.Argv, "|"); got != "custom-claude|headless|do the work" {
		t.Fatalf("headless argv=%q", got)
	}
}

func TestOwnedBashShellLaunchEnablesOSC133Passthrough(t *testing.T) {
	templates := NewLaunchTemplates(&config.Config{
		Spawn: config.SpawnConfig{DefaultShell: "/bin/bash"},
	})
	spec, err := templates.Interactive("shell", nil, map[string]string{
		"PROMPT_COMMAND": "history -a",
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(spec.Argv, "|"); got != "/bin/bash|-i" {
		t.Fatalf("shell argv=%q", got)
	}
	if spec.Env["AC_COMMAND_MARKS"] != "osc133" {
		t.Fatalf("command mark env=%v", spec.Env)
	}
	if !strings.Contains(spec.Env["PROMPT_COMMAND"], "]133;A") || !strings.Contains(spec.Env["PROMPT_COMMAND"], "history -a") {
		t.Fatalf("prompt command=%q", spec.Env["PROMPT_COMMAND"])
	}
	command, err := spec.ShellCommand()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(command, "allow-passthrough on") {
		t.Fatalf("shell command did not enable tmux passthrough: %q", command)
	}
}

func TestCustomNonBashShellDoesNotInjectBashCommandMarks(t *testing.T) {
	templates := NewLaunchTemplates(&config.Config{
		Spawn: config.SpawnConfig{DefaultShell: "/bin/zsh"},
	})
	spec, err := templates.Interactive("shell", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := spec.Env["AC_COMMAND_MARKS"]; ok || len(spec.Preamble) != 0 {
		t.Fatalf("non-bash shell received bash integration: %+v", spec)
	}
}
