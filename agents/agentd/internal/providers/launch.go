package providers

import (
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"sort"
	"strings"

	"github.com/agent-command/agentd/internal/config"
)

const promptPlaceholder = "{{prompt}}"

var environmentNamePattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

type LaunchSpec struct {
	Argv []string
	Env  map[string]string
}

type LaunchTemplates struct {
	templates map[string]config.ProviderLaunchTemplate
}

func NewLaunchTemplates(cfg *config.Config) *LaunchTemplates {
	codexPath := "codex"
	if cfg != nil && strings.TrimSpace(cfg.Providers.Codex.ExecPath) != "" {
		codexPath = cfg.Providers.Codex.ExecPath
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
		"shell":      {},
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
	template, ok := t.templates[normalizeLaunchProvider(provider)]
	if !ok {
		return LaunchSpec{}, fmt.Errorf("unsupported provider %q", provider)
	}
	argv := append([]string(nil), template.Argv...)
	if len(argv) > 0 {
		argv = append(argv, flags...)
	}
	return LaunchSpec{Argv: argv, Env: mergeEnv(template.Env, requestEnv)}, nil
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

	parts := make([]string, 0, 2)
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
