package providers

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/agent-command/agentd/internal/config"
)

const promptPlaceholder = "{{prompt}}"

var environmentNamePattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

type LaunchSpec struct {
	Argv     []string
	Env      map[string]string
	Preamble []string
}

type LaunchTemplates struct {
	templates map[string]config.ProviderLaunchTemplate
}

func NewLaunchTemplates(cfg *config.Config) *LaunchTemplates {
	codexPath := "codex"
	if cfg != nil && strings.TrimSpace(cfg.Providers.Codex.ExecPath) != "" {
		codexPath = cfg.Providers.Codex.ExecPath
	}
	shellPath := "/bin/bash"
	if cfg != nil && strings.TrimSpace(cfg.Spawn.DefaultShell) != "" {
		shellPath = cfg.Spawn.DefaultShell
	}
	templates := map[string]config.ProviderLaunchTemplate{
		"claude_code": {
			Argv:         []string{"claude"},
			HeadlessArgv: []string{"claude", "-p", "--output-format", "stream-json", "--verbose", promptPlaceholder},
		},
		"codex": {
			Argv:         []string{codexPath},
			HeadlessArgv: []string{codexPath, "exec", "--json", promptPlaceholder},
		},
		"gemini_cli": {Argv: []string{"gemini"}},
		"opencode":   {Argv: []string{"opencode"}},
		"aider":      {Argv: []string{"aider"}},
		"cursor":     {Argv: []string{"cursor"}},
		"continue":   {Argv: []string{"continue"}},
		"shell":      {Argv: []string{shellPath, "-i"}},
	}
	if cfg != nil {
		for provider, override := range cfg.Providers.LaunchTemplates {
			normalized := normalizeLaunchProvider(provider)
			if normalized == "" {
				continue
			}
			templates[normalized] = mergeTemplate(templates[normalized], override)
		}
	}
	return &LaunchTemplates{templates: templates}
}

func (t *LaunchTemplates) Interactive(provider string, flags []string, requestEnv map[string]string) (LaunchSpec, error) {
	normalizedProvider := normalizeLaunchProvider(provider)
	template, ok := t.templates[normalizedProvider]
	if !ok {
		return LaunchSpec{}, fmt.Errorf("unsupported provider %q", provider)
	}
	argv := append([]string(nil), template.Argv...)
	if len(argv) > 0 {
		argv = append(argv, flags...)
	}
	env := mergeEnv(template.Env, requestEnv)
	var preamble []string
	if normalizedProvider == "shell" && len(argv) > 0 && filepath.Base(argv[0]) == "bash" {
		env = mergeEnv(env, bashCommandMarkEnv(env))
		preamble = []string{"tmux set-option -s allow-passthrough on >/dev/null 2>&1 || true"}
	}
	return LaunchSpec{Argv: argv, Env: env, Preamble: preamble}, nil
}

func bashCommandMarkEnv(existing map[string]string) map[string]string {
	const passthroughStart = "\x1bPtmux;\x1b"
	const passthroughEnd = "\x1b\\"
	promptCommand := "__ac_status=$?; printf '\\033Ptmux;\\033\\033]133;D;%s\\007\\033\\\\' \"$__ac_status\"; printf '\\033Ptmux;\\033\\033]133;A\\007\\033\\\\'"
	if previous := strings.TrimSpace(existing["PROMPT_COMMAND"]); previous != "" {
		promptCommand += "; " + previous
	}
	return map[string]string{
		"AC_COMMAND_MARKS": "osc133",
		"PROMPT_COMMAND":   promptCommand,
		"PS0":              passthroughStart + "\x1b]133;C\a" + passthroughEnd,
	}
}

func (t *LaunchTemplates) Headless(provider, prompt string, requestEnv map[string]string) (LaunchSpec, error) {
	template, ok := t.templates[normalizeLaunchProvider(provider)]
	if !ok {
		return LaunchSpec{}, fmt.Errorf("unsupported provider %q", provider)
	}
	if len(template.HeadlessArgv) == 0 {
		return LaunchSpec{}, fmt.Errorf("provider %q does not define a headless launch", provider)
	}
	argv := make([]string, len(template.HeadlessArgv))
	placeholderFound := false
	for i, arg := range template.HeadlessArgv {
		argv[i] = strings.ReplaceAll(arg, promptPlaceholder, prompt)
		placeholderFound = placeholderFound || strings.Contains(arg, promptPlaceholder)
	}
	if !placeholderFound {
		argv = append(argv, prompt)
	}
	return LaunchSpec{Argv: argv, Env: mergeEnv(template.Env, template.HeadlessEnv, requestEnv)}, nil
}

func (s LaunchSpec) ShellCommand() (string, error) {
	keys := make([]string, 0, len(s.Env))
	for key := range s.Env {
		if !environmentNamePattern.MatchString(key) {
			return "", fmt.Errorf("invalid environment variable name %q", key)
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)

	parts := make([]string, 0, len(s.Preamble)+2)
	for _, command := range s.Preamble {
		if strings.TrimSpace(command) != "" {
			parts = append(parts, "("+command+")")
		}
	}
	if len(keys) > 0 {
		exports := make([]string, 0, len(keys))
		for _, key := range keys {
			exports = append(exports, key+"="+quoteShellWord(s.Env[key]))
		}
		parts = append(parts, "export "+strings.Join(exports, " "))
	}
	if len(s.Argv) > 0 {
		argv := make([]string, len(s.Argv))
		for i, arg := range s.Argv {
			argv[i] = quoteShellWord(arg)
		}
		parts = append(parts, "exec "+strings.Join(argv, " "))
	}
	return strings.Join(parts, " && "), nil
}

func (s LaunchSpec) ExecCommand(cwd string) (*exec.Cmd, error) {
	if len(s.Argv) == 0 || strings.TrimSpace(s.Argv[0]) == "" {
		return nil, fmt.Errorf("launch argv is empty")
	}
	for key := range s.Env {
		if !environmentNamePattern.MatchString(key) {
			return nil, fmt.Errorf("invalid environment variable name %q", key)
		}
	}
	cmd := exec.Command(s.Argv[0], s.Argv[1:]...)
	cmd.Dir = cwd
	cmd.Env = append(os.Environ(), sortedEnv(s.Env)...)
	return cmd, nil
}

func quoteShellWord(value string) string {
	if value == "" {
		return "''"
	}
	return "'" + strings.ReplaceAll(value, "'", `'"'"'`) + "'"
}

func mergeEnv(envs ...map[string]string) map[string]string {
	merged := make(map[string]string)
	for _, env := range envs {
		for key, value := range env {
			merged[key] = value
		}
	}
	return merged
}

func sortedEnv(env map[string]string) []string {
	keys := make([]string, 0, len(env))
	for key := range env {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	items := make([]string, 0, len(keys))
	for _, key := range keys {
		items = append(items, key+"="+env[key])
	}
	return items
}

func normalizeLaunchProvider(provider string) string {
	provider = strings.ToLower(strings.TrimSpace(provider))
	switch provider {
	case "claude", "claude_code":
		return "claude_code"
	case "gemini", "gemini_cli":
		return "gemini_cli"
	case "codex", "opencode", "aider", "cursor", "continue", "shell":
		return provider
	default:
		return ""
	}
}

func mergeTemplate(base, override config.ProviderLaunchTemplate) config.ProviderLaunchTemplate {
	merged := config.ProviderLaunchTemplate{
		Argv:         append([]string(nil), base.Argv...),
		Env:          mergeEnv(base.Env, override.Env),
		HeadlessArgv: append([]string(nil), base.HeadlessArgv...),
		HeadlessEnv:  mergeEnv(base.HeadlessEnv, override.HeadlessEnv),
	}
	if override.Argv != nil {
		merged.Argv = append([]string(nil), override.Argv...)
	}
	if override.HeadlessArgv != nil {
		merged.HeadlessArgv = append([]string(nil), override.HeadlessArgv...)
	}
	return merged
}
