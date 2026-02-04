package main

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode/utf8"

	"github.com/agent-command/agentd/internal/config"
	"github.com/agent-command/agentd/internal/console"
	"github.com/agent-command/agentd/internal/proc"
	"github.com/agent-command/agentd/internal/providers"
	"github.com/agent-command/agentd/internal/queue"
	"github.com/agent-command/agentd/internal/tmux"
	"github.com/agent-command/agentd/internal/usage"
	"github.com/agent-command/agentd/internal/ws"
	"github.com/google/uuid"
)

type Agent struct {
	cfg             *config.Config
	wsClient        *ws.Client
	tmuxClient      *tmux.Client
	gitCache        *tmux.GitCache
	gitStatusCache  *tmux.GitStatusCache
	claudeProvider  *providers.ClaudeProvider
	streamer        *console.Streamer
	terminalManager *tmux.TerminalManager
	pipeMux         *tmux.PipeMux
	lastPruneAt     time.Time

	// Session state
	sessions          map[string]*SessionState
	sessionsMu        sync.RWMutex
	snapshotHash      map[string]string
	toolEventsMu      sync.Mutex
	pendingToolEvents map[string][]toolEventPending

	// Approval lifecycle - TTL cache to prevent race conditions
	recentDecisions   map[string]time.Time
	recentDecisionsMu sync.RWMutex

	// Session usage tracking (parsed from console output)
	usageTracker *usage.UsageTracker

	// Snapshot-derived provider usage (avoid duplicate emits)
	providerUsageHash map[string]string
}

type toolEventPending struct {
	ID        string
	StartedAt time.Time
}

type SessionState struct {
	ID           string
	PaneID       string
	Kind         string
	Provider     string
	Status       string
	Title        string
	CWD          string
	RepoRoot     string
	GitBranch    string
	GitRemote    string
	TmuxTarget   string
	GroupID      string
	ForkedFrom   string
	ForkDepth    int
	Metadata     map[string]any
	LastActivity time.Time
	LastOutput   time.Time
	LastStatsAt  time.Time
	LastUsageAt  time.Time
	Unmanaged    bool
	LastCWD      string // Track CWD changes
}

func main() {
	// Check for subcommands first
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "status":
			runStatusCommand(os.Args[2:])
			return
		case "sessions":
			runSessionsCommand(os.Args[2:])
			return
		case "version":
			runVersionCommand()
			return
		case "help", "-h", "--help":
			printHelp()
			return
		}
	}

	// Default: run as daemon
	runDaemon()
}

// Version information
const Version = "0.1.0"

func printHelp() {
	fmt.Println(`agentd - Agent Command daemon for tmux management

Usage:
  agentd [command] [options]

Commands:
  (none)       Run as daemon (default)
  status       Show agent status
  sessions     List tmux sessions
  version      Show version information
  help         Show this help

Daemon Options:
  -config string  Path to config file (default "/etc/agentd/config.yaml")

Subcommand Options:
  -json         Output in JSON format
  -config       Path to config file`)
}

func runVersionCommand() {
	fmt.Printf("agentd version %s\n", Version)
}

func runStatusCommand(args []string) {
	fs := flag.NewFlagSet("status", flag.ExitOnError)
	jsonOutput := fs.Bool("json", false, "Output in JSON format")
	configPath := fs.String("config", "/etc/agentd/config.yaml", "Path to config file")
	fs.Parse(args)

	cfg, err := config.LoadConfig(*configPath)
	if err != nil {
		if *jsonOutput {
			outputJSON(map[string]any{"error": err.Error()})
		} else {
			log.Fatalf("Failed to load config: %v", err)
		}
		return
	}

	tmuxClient := tmux.NewClient(&cfg.Tmux)
	panes, err := tmuxClient.ListPanes()

	status := map[string]any{
		"host_id":         cfg.Host.ID,
		"host_name":       cfg.Host.Name,
		"version":         Version,
		"control_plane":   cfg.ControlPlane.WSURL,
		"tmux_socket":     cfg.Tmux.Socket,
		"tmux_connected":  err == nil,
		"pane_count":      len(panes),
		"hooks_listen":    cfg.Providers.Claude.HooksHTTPListen,
		"spawn_enabled":   cfg.Security.AllowSpawn,
		"kill_enabled":    cfg.Security.AllowKill,
		"console_enabled": cfg.Security.AllowConsoleStream,
	}

	if err != nil {
		status["tmux_error"] = err.Error()
	}

	if *jsonOutput {
		outputJSON(status)
	} else {
		fmt.Printf("Agent Status\n")
		fmt.Printf("============\n")
		fmt.Printf("Host ID:        %s\n", cfg.Host.ID)
		fmt.Printf("Host Name:      %s\n", cfg.Host.Name)
		fmt.Printf("Version:        %s\n", Version)
		fmt.Printf("Control Plane:  %s\n", cfg.ControlPlane.WSURL)
		fmt.Printf("Tmux Socket:    %s\n", cfg.Tmux.Socket)
		fmt.Printf("Tmux Connected: %v\n", err == nil)
		if err != nil {
			fmt.Printf("Tmux Error:     %s\n", err.Error())
		}
		fmt.Printf("Pane Count:     %d\n", len(panes))
		fmt.Printf("Hooks Listen:   %s\n", cfg.Providers.Claude.HooksHTTPListen)
		fmt.Printf("\nCapabilities:\n")
		fmt.Printf("  Spawn:          %v\n", cfg.Security.AllowSpawn)
		fmt.Printf("  Kill:           %v\n", cfg.Security.AllowKill)
		fmt.Printf("  Console Stream: %v\n", cfg.Security.AllowConsoleStream)
	}
}

func runSessionsCommand(args []string) {
	fs := flag.NewFlagSet("sessions", flag.ExitOnError)
	jsonOutput := fs.Bool("json", false, "Output in JSON format")
	configPath := fs.String("config", "/etc/agentd/config.yaml", "Path to config file")
	orphansOnly := fs.Bool("orphans", false, "Show only orphan (unmanaged) panes")
	fs.Parse(args)

	cfg, err := config.LoadConfig(*configPath)
	if err != nil {
		if *jsonOutput {
			outputJSON(map[string]any{"error": err.Error()})
		} else {
			log.Fatalf("Failed to load config: %v", err)
		}
		return
	}

	tmuxClient := tmux.NewClient(&cfg.Tmux)
	panes, err := tmuxClient.ListPanes()
	if err != nil {
		if *jsonOutput {
			outputJSON(map[string]any{"error": err.Error()})
		} else {
			log.Fatalf("Failed to list panes: %v", err)
		}
		return
	}

	gitCache := tmux.NewGitCache(10 * time.Second)
	sessions := make([]map[string]any, 0, len(panes))
	procSnap := proc.TakeSnapshot()

	for _, pane := range panes {
		// Get session ID from tmux option
		sessionID, _ := tmuxClient.GetPaneOption(pane.PaneID, cfg.Tmux.OptionSessionID)
		isOrphan := sessionID == ""

		if *orphansOnly && !isOrphan {
			continue
		}

		provider := detectProviderForPane(pane, procSnap)

		// Get git info
		var repoRoot, gitBranch, gitRemote string
		if gitInfo, ok := gitCache.Get(pane.CurrentPath); ok {
			repoRoot = gitInfo.RepoRoot
			gitBranch = gitInfo.Branch
			gitRemote = gitInfo.Remote
		} else if gitInfo := tmux.ResolveGitInfo(pane.CurrentPath); gitInfo != nil {
			gitCache.Set(pane.CurrentPath, gitInfo)
			repoRoot = gitInfo.RepoRoot
			gitBranch = gitInfo.Branch
			gitRemote = gitInfo.Remote
		}

		session := map[string]any{
			"pane_id":         pane.PaneID,
			"tmux_target":     pane.GetTmuxTarget(),
			"session_name":    pane.SessionName,
			"window_index":    pane.WindowIndex,
			"pane_index":      pane.PaneIndex,
			"cwd":             pane.CurrentPath,
			"current_command": pane.CurrentCommand,
			"provider":        provider,
			"pane_pid":        pane.PanePID,
			"is_orphan":       isOrphan,
		}

		if sessionID != "" {
			session["session_id"] = sessionID
		}
		if repoRoot != "" {
			session["repo_root"] = repoRoot
		}
		if gitBranch != "" {
			session["git_branch"] = gitBranch
		}
		if gitRemote != "" {
			session["git_remote"] = gitRemote
		}

		sessions = append(sessions, session)
	}

	if *jsonOutput {
		outputJSON(map[string]any{
			"sessions":    sessions,
			"total_count": len(sessions),
		})
	} else {
		if len(sessions) == 0 {
			fmt.Println("No sessions found")
			return
		}

		fmt.Printf("Sessions (%d total)\n", len(sessions))
		fmt.Println(strings.Repeat("=", 60))

		for _, s := range sessions {
			orphanMarker := ""
			if s["is_orphan"].(bool) {
				orphanMarker = " [ORPHAN]"
			}

			fmt.Printf("\n%s%s\n", s["tmux_target"], orphanMarker)
			fmt.Printf("  Pane ID:  %s\n", s["pane_id"])
			fmt.Printf("  Provider: %s\n", s["provider"])
			fmt.Printf("  Command:  %s\n", s["current_command"])
			fmt.Printf("  CWD:      %s\n", s["cwd"])
			if branch, ok := s["git_branch"].(string); ok && branch != "" {
				fmt.Printf("  Branch:   %s\n", branch)
			}
			if sid, ok := s["session_id"].(string); ok {
				fmt.Printf("  Session:  %s\n", sid)
			}
		}
	}
}

func outputJSON(data any) {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	enc.Encode(data)
}

func runDaemon() {
	configPath := flag.String("config", "/etc/agentd/config.yaml", "Path to config file")
	flag.Parse()

	cfg, err := config.LoadConfig(*configPath)
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	agent := &Agent{
		cfg:               cfg,
		sessions:          make(map[string]*SessionState),
		snapshotHash:      make(map[string]string),
		providerUsageHash: make(map[string]string),
		pendingToolEvents: make(map[string][]toolEventPending),
		recentDecisions:   make(map[string]time.Time),
		gitCache:          tmux.NewGitCache(10 * time.Second),
		gitStatusCache:    tmux.NewGitStatusCache(10 * time.Second),
		usageTracker:      usage.NewUsageTracker(),
	}

	if err := agent.Run(); err != nil {
		log.Fatalf("Agent error: %v", err)
	}
}

func (a *Agent) Run() error {
	// Initialize tmux client
	a.tmuxClient = tmux.NewClient(&a.cfg.Tmux)

	// Initialize WebSocket client
	a.wsClient = ws.NewClient(
		a.cfg.ControlPlane.WSURL,
		a.cfg.ControlPlane.Token,
		a.cfg.Host.ID,
		a.cfg.ControlPlane.ReconnectBackoffMs,
	)
	a.wsClient.SetMessageHandler(a.handleMessage)
	a.wsClient.SetOnConnect(func() {
		a.wsClient.ResendQueued()
		if err := a.sendHello(); err != nil {
			log.Printf("Failed to send hello: %v", err)
		}
	})

	// Initialize outbound queue
	outboundQueue, err := queue.NewQueue(a.cfg.Storage.StateDir, a.cfg.Storage.OutboundQueueMax)
	if err == nil {
		a.wsClient.SetQueue(outboundQueue, a.cfg.Storage.StateDir)
		if lastAcked, err := queue.LoadAckedSeq(a.cfg.Storage.StateDir); err == nil {
			_ = outboundQueue.PruneAcked(lastAcked)
			a.wsClient.SetLastAckedSeq(lastAcked)
		}
	}

	// Initialize Claude provider
	a.claudeProvider = providers.NewClaudeProvider(&a.cfg.Providers.Claude)
	a.claudeProvider.SetHookHandler(a.handleClaudeHook)
	a.claudeProvider.SetCodexHookHandler(a.handleCodexHook)

	// Initialize console streamer
	a.streamer, err = console.NewStreamer(a.cfg.Storage.StateDir + "/console")
	if err != nil {
		return fmt.Errorf("failed to create console streamer: %w", err)
	}
	a.streamer.SetHandler(a.handleConsoleChunk)

	// Initialize terminal manager
	a.terminalManager = tmux.NewTerminalManager(a.tmuxClient, a.cfg.Storage.StateDir)
	a.terminalManager.SetOutputHandler(a.handleTerminalOutput)
	a.terminalManager.SetStatusHandler(a.handleTerminalStatus)

	// Initialize pipe mux for console + terminal output
	a.pipeMux = tmux.NewPipeMux(a.tmuxClient, a.cfg.Storage.StateDir+"/console")

	// Connect to control plane
	if err := a.wsClient.Connect(); err != nil {
		return fmt.Errorf("failed to connect to control plane: %w", err)
	}

	// Start Claude hooks server
	if err := a.claudeProvider.Start(); err != nil {
		return fmt.Errorf("failed to start Claude hooks server: %w", err)
	}

	// Start tmux poller
	go a.pollTmux()

	// Start snapshot capture
	go a.captureSnapshots()

	// Start provider usage polling (if configured)
	go a.pollProviderUsage()
	// Start Gemini stats polling via tmux (if configured)
	go a.pollGeminiStats()

	// Wait for shutdown signal
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	log.Println("Shutting down...")
	if a.terminalManager != nil {
		a.terminalManager.Close()
	}
	a.claudeProvider.Stop()
	a.wsClient.Close()

	return nil
}

func (a *Agent) pollProviderUsage() {
	if a.cfg == nil {
		return
	}

	if a.cfg.Providers.Claude.UsageCommand != "" && a.cfg.Providers.Claude.UsageIntervalMs > 0 {
		if strings.TrimSpace(a.cfg.Providers.Claude.UsageSessionName) != "" {
			go a.pollClaudeUsageSession()
		} else {
			go a.pollProviderUsageCommand(
				"claude_code",
				a.cfg.Providers.Claude.UsageCommand,
				time.Duration(a.cfg.Providers.Claude.UsageIntervalMs)*time.Millisecond,
				a.cfg.Providers.Claude.UsageParseJSON,
			)
		}
	}

	if a.cfg.Providers.Codex.UsageCommand != "" && a.cfg.Providers.Codex.UsageIntervalMs > 0 {
		go a.pollProviderUsageCommand(
			"codex",
			a.cfg.Providers.Codex.UsageCommand,
			time.Duration(a.cfg.Providers.Codex.UsageIntervalMs)*time.Millisecond,
			a.cfg.Providers.Codex.UsageParseJSON,
		)
	}

	if a.cfg.Providers.OpenCode.UsageCommand != "" && a.cfg.Providers.OpenCode.UsageIntervalMs > 0 {
		go a.pollProviderUsageCommand(
			"opencode",
			a.cfg.Providers.OpenCode.UsageCommand,
			time.Duration(a.cfg.Providers.OpenCode.UsageIntervalMs)*time.Millisecond,
			a.cfg.Providers.OpenCode.UsageParseJSON,
		)
	}

	if a.cfg.Providers.Gemini.UsageCommand != "" && a.cfg.Providers.Gemini.UsageIntervalMs > 0 {
		go a.pollProviderUsageCommand(
			"gemini_cli",
			a.cfg.Providers.Gemini.UsageCommand,
			time.Duration(a.cfg.Providers.Gemini.UsageIntervalMs)*time.Millisecond,
			a.cfg.Providers.Gemini.UsageParseJSON,
		)
	}
}

func (a *Agent) pollClaudeUsageSession() {
	if a.cfg == nil {
		return
	}

	command := strings.TrimSpace(a.cfg.Providers.Claude.UsageCommand)
	if command == "" || a.cfg.Providers.Claude.UsageIntervalMs <= 0 {
		return
	}

	interval := time.Duration(a.cfg.Providers.Claude.UsageIntervalMs) * time.Millisecond
	idle := time.Duration(a.cfg.Providers.Claude.UsageIdleMs) * time.Millisecond

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	// Run immediately on start
	a.sendClaudeUsage(command, interval, idle)

	for range ticker.C {
		a.sendClaudeUsage(command, interval, idle)
	}
}

type claudeUsageTarget struct {
	sessionID    string
	paneID       string
	status       string
	lastOutput   time.Time
	lastActivity time.Time
	lastUsageAt  time.Time
}

func (a *Agent) sendClaudeUsage(command string, interval, idle time.Duration) {
	usageName := strings.TrimSpace(a.cfg.Providers.Claude.UsageSessionName)
	if usageName == "" {
		return
	}
	usageNameLower := strings.ToLower(usageName)

	now := time.Now().UTC()
	var targets []claudeUsageTarget

	a.sessionsMu.RLock()
	for _, session := range a.sessions {
		if session.Kind != "tmux_pane" || session.Provider != "claude_code" || session.Status == "DONE" {
			continue
		}
		if session.PaneID == "" {
			continue
		}
		sessionTitle := strings.ToLower(strings.TrimSpace(session.Title))
		if !strings.Contains(sessionTitle, usageNameLower) {
			continue
		}
		targets = append(targets, claudeUsageTarget{
			sessionID:    session.ID,
			paneID:       session.PaneID,
			status:       session.Status,
			lastOutput:   session.LastOutput,
			lastActivity: session.LastActivity,
			lastUsageAt:  session.LastUsageAt,
		})
	}
	a.sessionsMu.RUnlock()

	for _, target := range targets {
		if target.status != "WAITING_FOR_INPUT" && target.status != "IDLE" {
			continue
		}
		lastSeen := target.lastOutput
		if lastSeen.IsZero() {
			lastSeen = target.lastActivity
		}
		if idle > 0 && now.Sub(lastSeen) < idle {
			continue
		}
		if !target.lastUsageAt.IsZero() && now.Sub(target.lastUsageAt) < interval {
			continue
		}

		if err := a.tmuxClient.SendKeys(target.paneID, []string{command, "Enter"}); err != nil {
			log.Printf("Failed to send Claude usage command to %s: %v", target.paneID, err)
			continue
		}

		a.sessionsMu.Lock()
		if session, ok := a.sessions[target.sessionID]; ok {
			session.LastUsageAt = now
		}
		a.sessionsMu.Unlock()
	}
}

func (a *Agent) pollGeminiStats() {
	if a.cfg == nil {
		return
	}

	command := strings.TrimSpace(a.cfg.Providers.Gemini.StatsCommand)
	if command == "" || a.cfg.Providers.Gemini.StatsIntervalMs <= 0 {
		return
	}

	interval := time.Duration(a.cfg.Providers.Gemini.StatsIntervalMs) * time.Millisecond
	idle := time.Duration(a.cfg.Providers.Gemini.StatsIdleMs) * time.Millisecond

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	// Run immediately on start
	a.sendGeminiStats(command, interval, idle)

	for range ticker.C {
		a.sendGeminiStats(command, interval, idle)
	}
}

type geminiStatsTarget struct {
	sessionID    string
	paneID       string
	status       string
	lastOutput   time.Time
	lastActivity time.Time
	lastStatsAt  time.Time
}

func (a *Agent) sendGeminiStats(command string, interval, idle time.Duration) {
	// Only send stats to a dedicated session if configured
	statsName := strings.TrimSpace(a.cfg.Providers.Gemini.StatsSessionName)
	if statsName == "" {
		return // No dedicated session configured, skip stats collection
	}
	statsNameLower := strings.ToLower(statsName)

	now := time.Now().UTC()
	var targets []geminiStatsTarget

	a.sessionsMu.RLock()
	for _, session := range a.sessions {
		if session.Kind != "tmux_pane" || session.Provider != "gemini_cli" || session.Status == "DONE" {
			continue
		}
		if session.PaneID == "" {
			continue
		}
		// Only target session with matching name
		sessionTitle := strings.ToLower(strings.TrimSpace(session.Title))
		if !strings.Contains(sessionTitle, statsNameLower) {
			continue
		}
		targets = append(targets, geminiStatsTarget{
			sessionID:    session.ID,
			paneID:       session.PaneID,
			status:       session.Status,
			lastOutput:   session.LastOutput,
			lastActivity: session.LastActivity,
			lastStatsAt:  session.LastStatsAt,
		})
	}
	a.sessionsMu.RUnlock()

	for _, target := range targets {
		if target.status != "WAITING_FOR_INPUT" && target.status != "IDLE" {
			continue
		}
		lastSeen := target.lastOutput
		if lastSeen.IsZero() {
			lastSeen = target.lastActivity
		}
		if idle > 0 && now.Sub(lastSeen) < idle {
			continue
		}
		if !target.lastStatsAt.IsZero() && now.Sub(target.lastStatsAt) < interval {
			continue
		}

		if err := a.tmuxClient.SendKeys(target.paneID, []string{command, "Enter"}); err != nil {
			log.Printf("Failed to send Gemini stats command to %s: %v", target.paneID, err)
			continue
		}

		a.sessionsMu.Lock()
		if session, ok := a.sessions[target.sessionID]; ok {
			session.LastStatsAt = now
		}
		a.sessionsMu.Unlock()
	}
}

func (a *Agent) pollProviderUsageCommand(provider, command string, interval time.Duration, parseJSON bool) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	// Run immediately on start
	a.reportProviderUsage(provider, command, parseJSON)

	for range ticker.C {
		a.reportProviderUsage(provider, command, parseJSON)
	}
}

func (a *Agent) reportProviderUsage(provider, command string, parseJSON bool) {
	if command == "" {
		return
	}

	output, err := runUsageCommand(command)
	if err != nil {
		log.Printf("Provider usage command failed (%s): %v", provider, err)
	}

	raw := strings.TrimSpace(string(output))
	if provider == "claude_code" {
		raw = strings.TrimSpace(maybeRetryClaudeUsage(command, raw))
	}
	if raw == "" {
		return
	}

	cleanedText := stripANSI(raw)

	var rawJSON map[string]any
	if parseJSON || looksLikeJSON(raw) {
		var decoded any
		if err := json.Unmarshal([]byte(raw), &decoded); err == nil {
			if obj, ok := decoded.(map[string]any); ok {
				rawJSON = obj
			} else {
				rawJSON = map[string]any{"data": decoded}
			}
		}
	}

	fields := extractUsageFields(rawJSON, cleanedText)
	scope := "account"

	payload := map[string]any{
		"provider":    provider,
		"scope":       scope,
		"host_id":     a.cfg.Host.ID,
		"reported_at": time.Now().UTC().Format(time.RFC3339),
		"raw_text":    raw,
	}
	parsed := parseProviderUsageText(provider, cleanedText)
	if len(parsed) > 0 {
		if rawJSON == nil {
			rawJSON = map[string]any{
				"source":  "text",
				"entries": parsed,
			}
		} else {
			rawJSON["_parsed"] = map[string]any{
				"source":  "text",
				"entries": parsed,
			}
		}
	}
	if rawJSON != nil {
		payload["raw_json"] = rawJSON
	}
	for k, v := range fields {
		payload[k] = v
	}

	_ = a.wsClient.Send("provider.usage", payload)
}

func runUsageCommand(command string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "/bin/sh", "-lc", command)
	return cmd.CombinedOutput()
}

func maybeRetryClaudeUsage(command, raw string) string {
	cleaned := strings.ToLower(stripANSI(raw))
	if cleaned == "" {
		return raw
	}
	if strings.Contains(cleaned, "current session") || strings.Contains(cleaned, "extra usage") {
		return raw
	}

	scriptPath, err := exec.LookPath("script")
	if err != nil || scriptPath == "" {
		return raw
	}

	ttyCommand := fmt.Sprintf("%s -q /dev/null -c %q", scriptPath, command)
	output, err := runUsageCommand(ttyCommand)
	if err != nil {
		return raw
	}
	retryRaw := strings.TrimSpace(string(output))
	if retryRaw == "" {
		return raw
	}
	return retryRaw
}

func looksLikeJSON(raw string) bool {
	trimmed := strings.TrimSpace(raw)
	return strings.HasPrefix(trimmed, "{") || strings.HasPrefix(trimmed, "[")
}

func extractUsageFields(rawJSON map[string]any, rawText string) map[string]any {
	fields := map[string]any{}
	if rawJSON != nil {
		flattened := map[string]any{}
		flattenMap("", rawJSON, flattened)

		if val := findNumber(flattened, []string{
			"weekly_remaining_tokens", "weekly_remaining", "remaining_weekly_tokens", "remaining_weekly", "weeklyRemainingTokens", "weeklyRemaining",
		}); val != nil {
			fields["weekly_remaining_tokens"] = *val
		}
		if val := findNumber(flattened, []string{
			"weekly_limit_tokens", "weekly_limit", "weekly_quota_tokens", "weekly_quota", "weeklyLimitTokens", "weeklyQuota",
		}); val != nil {
			fields["weekly_limit_tokens"] = *val
		}
		if val := findNumber(flattened, []string{
			"remaining_tokens", "tokens_remaining", "remaining", "remainingTokens", "tokensRemaining", "token_remaining",
		}); val != nil {
			fields["remaining_tokens"] = *val
		}
		if val := findNumber(flattened, []string{
			"remaining_requests", "requests_remaining", "remainingRequests", "requestsRemaining",
		}); val != nil {
			fields["remaining_requests"] = *val
		}
		if val := findNumber(flattened, []string{
			"weekly_remaining_cost_cents", "weekly_remaining_cost", "weeklyRemainingCostCents",
		}); val != nil {
			fields["weekly_remaining_cost_cents"] = *val
		}
		if resetAt := findTime(flattened, []string{
			"reset_at", "resetAt", "resets_at", "resetsAt", "weekly_reset_at", "quota_reset_at",
		}); resetAt != "" {
			fields["reset_at"] = resetAt
		}

		// Extract utilization percentages (Claude and Codex APIs)
		if val := findFloat(flattened, []string{
			"five_hour.utilization", "five_hour_utilization", "fiveHourUtilization",
		}); val != nil {
			fields["five_hour_utilization"] = normalizeUtilization(*val)
		}
		if resetAt := findTime(flattened, []string{
			"five_hour.resets_at", "five_hour.reset_at", "five_hour_reset_at", "fiveHourResetsAt",
		}); resetAt != "" {
			fields["five_hour_reset_at"] = resetAt
		}
		if val := findFloat(flattened, []string{
			"seven_day.utilization", "weekly.utilization", "weekly_utilization", "weeklyUtilization",
		}); val != nil {
			fields["weekly_utilization"] = normalizeUtilization(*val)
		}
		if resetAt := findTime(flattened, []string{
			"seven_day.resets_at", "weekly.resets_at", "weekly_reset_at", "weeklyResetsAt",
		}); resetAt != "" {
			fields["weekly_reset_at"] = resetAt
		}
		if val := findFloat(flattened, []string{
			"seven_day_opus.utilization", "weekly_opus_utilization", "weeklyOpusUtilization",
		}); val != nil {
			fields["weekly_opus_utilization"] = normalizeUtilization(*val)
		}
		if resetAt := findTime(flattened, []string{
			"seven_day_opus.resets_at", "weekly_opus_reset_at",
		}); resetAt != "" {
			fields["weekly_opus_reset_at"] = resetAt
		}
		if val := findFloat(flattened, []string{
			"seven_day_sonnet.utilization", "weekly_sonnet_utilization", "weeklySonnetUtilization",
		}); val != nil {
			fields["weekly_sonnet_utilization"] = normalizeUtilization(*val)
		}
		if resetAt := findTime(flattened, []string{
			"seven_day_sonnet.resets_at", "weekly_sonnet_reset_at",
		}); resetAt != "" {
			fields["weekly_sonnet_reset_at"] = resetAt
		}

		applyParsedUsageEntries(fields, rawJSON)
	}

	if len(fields) == 0 && rawText != "" {
		textFields := extractUsageFieldsFromText(rawText)
		for k, v := range textFields {
			fields[k] = v
		}
	}

	return fields
}

func parseProviderUsageText(provider, raw string) []map[string]any {
	switch provider {
	case "claude_code":
		return parseClaudeUsageText(raw)
	case "codex":
		return parseCodexStatusText(raw)
	case "gemini_cli":
		return parseGeminiStatusText(raw)
	default:
		return nil
	}
}

func parseClaudeUsageText(raw string) []map[string]any {
	lines := strings.Split(raw, "\n")
	var entries []map[string]any
	var current map[string]any
	var extraPending map[string]any

	flush := func() {
		if current != nil {
			entries = append(entries, current)
			current = nil
		}
	}

	usedRe := regexp.MustCompile(`(?i)(\d{1,3})%\\s*used`)
	extraUsageCostRe := regexp.MustCompile(`(?i)\\$([0-9][0-9,]*(?:\\.[0-9]{1,2})?)\\s*/\\s*\\$([0-9][0-9,]*(?:\\.[0-9]{1,2})?)\\s*spent`)

	applyExtraUsage := func(target map[string]any, line, lower string, match []string) {
		if spent, ok := parseUSDToCents(match[1]); ok {
			target["spent_cents"] = spent
		}
		if limit, ok := parseUSDToCents(match[2]); ok {
			target["limit_cents"] = limit
		}
		if resetIdx := strings.Index(lower, "resets"); resetIdx >= 0 {
			resetText := strings.TrimSpace(line[resetIdx:])
			if resetText != "" {
				target["reset_text"] = resetText
			}
		}
	}

	for _, line := range lines {
		trimmed := strings.TrimSpace(stripBoxChars(line))
		if trimmed == "" {
			continue
		}

		lower := strings.ToLower(trimmed)
		switch {
		case strings.HasPrefix(lower, "current session"):
			flush()
			current = map[string]any{"label": "current_session"}
			continue
		case strings.HasPrefix(lower, "current week (all models)"):
			flush()
			current = map[string]any{"label": "weekly_all_models"}
			continue
		case strings.HasPrefix(lower, "current week (opus"):
			flush()
			current = map[string]any{"label": "weekly_opus"}
			continue
		case strings.HasPrefix(lower, "current week (sonnet"):
			flush()
			current = map[string]any{"label": "weekly_sonnet"}
			continue
		case strings.Contains(lower, "extra usage"):
			flush()
			current = map[string]any{"label": "extra_usage"}
			continue
		}

		if current == nil {
			if match := extraUsageCostRe.FindStringSubmatch(trimmed); len(match) > 2 {
				if extraPending == nil {
					extraPending = map[string]any{"label": "extra_usage"}
				}
				applyExtraUsage(extraPending, trimmed, lower, match)
			}
			continue
		}

		if match := usedRe.FindStringSubmatch(trimmed); len(match) > 1 {
			if percent, err := strconv.Atoi(match[1]); err == nil {
				current["used_percent"] = percent
			}
		}

		if match := extraUsageCostRe.FindStringSubmatch(trimmed); len(match) > 2 {
			label, _ := current["label"].(string)
			if label == "extra_usage" {
				applyExtraUsage(current, trimmed, lower, match)
			} else {
				if extraPending == nil {
					extraPending = map[string]any{"label": "extra_usage"}
				}
				applyExtraUsage(extraPending, trimmed, lower, match)
			}
			continue
		}

		if resetIdx := strings.Index(lower, "resets"); resetIdx >= 0 {
			resetText := strings.TrimSpace(trimmed[resetIdx:])
			if resetText != "" {
				current["reset_text"] = resetText
			}
		}
	}

	flush()
	if extraPending != nil {
		foundExtra := false
		for _, entry := range entries {
			label, _ := entry["label"].(string)
			if label == "extra_usage" {
				foundExtra = true
				break
			}
		}
		if !foundExtra {
			entries = append(entries, extraPending)
		}
	}
	return entries
}

func parseCodexStatusText(raw string) []map[string]any {
	lines := strings.Split(raw, "\n")
	var entries []map[string]any

	contextRe := regexp.MustCompile(`(?i)context window:\\s*([0-9]{1,3})%\\s*left\\s*\\(([^\\)]+)\\)`)
	limitRe := regexp.MustCompile(`(?i)^(5h limit|weekly limit):.*?([0-9]{1,3})%\\s*left\\s*\\(resets\\s*([^\\)]+)\\)`)
	creditsRe := regexp.MustCompile(`(?i)credits:\\s*([0-9,]+)`)
	sessionRe := regexp.MustCompile(`(?i)session:\\s*([A-Za-z0-9\\-]+)`)
	usedTotalRe := regexp.MustCompile(`(?i)([0-9.]+\\s*[KMB]?)\\s*used\\s*/\\s*([0-9.]+\\s*[KMB]?)`)

	for _, line := range lines {
		trimmed := strings.TrimSpace(stripBoxChars(line))
		if trimmed == "" {
			continue
		}

		if match := sessionRe.FindStringSubmatch(trimmed); len(match) > 1 {
			entries = append(entries, map[string]any{
				"label":        "session_ref",
				"session_ref":  match[1],
				"display_text": match[1],
			})
			continue
		}

		if match := contextRe.FindStringSubmatch(trimmed); len(match) > 2 {
			entry := map[string]any{"label": "context_window"}
			if percent, err := strconv.Atoi(match[1]); err == nil {
				entry["remaining_percent"] = percent
			}
			if totals := usedTotalRe.FindStringSubmatch(match[2]); len(totals) > 2 {
				if usedTokens, ok := parseScaledNumber(totals[1]); ok {
					entry["used_tokens"] = usedTokens
				}
				if totalTokens, ok := parseScaledNumber(totals[2]); ok {
					entry["total_tokens"] = totalTokens
					if usedTokens, ok := entry["used_tokens"].(int64); ok {
						entry["remaining_tokens"] = totalTokens - usedTokens
					}
				}
			}
			entries = append(entries, entry)
			continue
		}

		if match := limitRe.FindStringSubmatch(trimmed); len(match) > 3 {
			label := strings.ToLower(strings.TrimSpace(match[1]))
			entry := map[string]any{"label": label}
			if percent, err := strconv.Atoi(match[2]); err == nil {
				entry["remaining_percent"] = percent
			}
			entry["reset_text"] = strings.TrimSpace(match[3])
			entries = append(entries, entry)
			continue
		}

		if match := creditsRe.FindStringSubmatch(trimmed); len(match) > 1 {
			clean := strings.ReplaceAll(match[1], ",", "")
			if credits, err := strconv.ParseInt(clean, 10, 64); err == nil {
				entries = append(entries, map[string]any{
					"label":   "credits",
					"credits": credits,
				})
			}
			continue
		}
	}

	return entries
}

func parseGeminiStatusText(raw string) []map[string]any {
	// Gemini CLI /stats outputs JSON with model usage info
	// Expected format:
	// {
	//   "models": {
	//     "gemini-2.5-flash": { "usage_left": 100, "reset_period": "24h" },
	//     "gemini-2.5-pro": { "usage_left": 85, "reset_period": "24h" }
	//   }
	// }
	// This function handles the case where raw_json parsing already happened,
	// but we still want to return parsed entries for the text output case.
	var entries []map[string]any

	// Try to parse as JSON first
	var data map[string]any
	if err := json.Unmarshal([]byte(raw), &data); err != nil {
		// Not JSON, try parsing text output
		return parseGeminiTextOutput(raw)
	}

	// Extract models from JSON
	models, ok := data["models"].(map[string]any)
	if !ok {
		return entries
	}

	for modelName, modelData := range models {
		if m, ok := modelData.(map[string]any); ok {
			entry := map[string]any{
				"label": modelName,
			}
			if usageLeft, ok := m["usage_left"].(float64); ok {
				entry["usage_left"] = usageLeft
				entry["utilization"] = 100 - usageLeft
			}
			if resetPeriod, ok := m["reset_period"].(string); ok {
				entry["reset_period"] = resetPeriod
			}
			entries = append(entries, entry)
		}
	}

	return entries
}

func parseGeminiTextOutput(raw string) []map[string]any {
	// Parse Gemini CLI text output if it's not JSON
	// Look for patterns like "Model: gemini-2.5-flash, Usage: 85% left"
	var entries []map[string]any
	lines := strings.Split(raw, "\n")

	modelUsageRe := regexp.MustCompile(`(?i)(\S*gemini[^\s:,]*)[:\s]+.*?(\d+)%\s*(left|used)`)
	usageLeftRe := regexp.MustCompile(`(?i)(\d+)%\s*left`)
	usageUsedRe := regexp.MustCompile(`(?i)(\d+)%\s*used`)

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}

		if match := modelUsageRe.FindStringSubmatch(trimmed); len(match) > 3 {
			modelName := match[1]
			percent, _ := strconv.Atoi(match[2])
			direction := strings.ToLower(match[3])

			entry := map[string]any{
				"label": modelName,
			}
			if direction == "left" {
				entry["usage_left"] = float64(percent)
				entry["utilization"] = float64(100 - percent)
			} else {
				entry["utilization"] = float64(percent)
				entry["usage_left"] = float64(100 - percent)
			}
			entries = append(entries, entry)
			continue
		}

		// Generic usage patterns
		if match := usageLeftRe.FindStringSubmatch(trimmed); len(match) > 1 {
			percent, _ := strconv.Atoi(match[1])
			entries = append(entries, map[string]any{
				"label":       "daily",
				"usage_left":  float64(percent),
				"utilization": float64(100 - percent),
			})
		} else if match := usageUsedRe.FindStringSubmatch(trimmed); len(match) > 1 {
			percent, _ := strconv.Atoi(match[1])
			entries = append(entries, map[string]any{
				"label":       "daily",
				"utilization": float64(percent),
				"usage_left":  float64(100 - percent),
			})
		}
	}

	return entries
}

var ansiPattern = regexp.MustCompile(`\x1b\[[0-9;?]*[ -/]*[@-~]`)

func stripANSI(value string) string {
	if value == "" {
		return value
	}
	return ansiPattern.ReplaceAllString(value, "")
}

func stripBoxChars(line string) string {
	return strings.Trim(stripANSI(line), " │╭╰╮╯─")
}

func parseScaledNumber(value string) (int64, bool) {
	trimmed := strings.TrimSpace(value)
	re := regexp.MustCompile(`(?i)^([0-9]+(?:\\.[0-9]+)?)\\s*([KMB]?)$`)
	match := re.FindStringSubmatch(trimmed)
	if len(match) < 3 {
		return 0, false
	}
	num, err := strconv.ParseFloat(match[1], 64)
	if err != nil {
		return 0, false
	}
	switch strings.ToUpper(match[2]) {
	case "K":
		num *= 1000
	case "M":
		num *= 1000000
	case "B":
		num *= 1000000000
	}
	return int64(num), true
}

func parseUSDToCents(value string) (int, bool) {
	clean := strings.ReplaceAll(strings.TrimSpace(value), ",", "")
	if clean == "" {
		return 0, false
	}
	parts := strings.SplitN(clean, ".", 3)
	dollars, err := strconv.Atoi(parts[0])
	if err != nil {
		return 0, false
	}
	cents := 0
	if len(parts) > 1 {
		fraction := parts[1]
		if len(fraction) == 1 {
			fraction += "0"
		} else if len(fraction) > 2 {
			fraction = fraction[:2]
		}
		if fraction != "" {
			parsed, err := strconv.Atoi(fraction)
			if err != nil {
				return 0, false
			}
			cents = parsed
		}
	}
	return dollars*100 + cents, true
}

func flattenMap(prefix string, value map[string]any, out map[string]any) {
	for key, val := range value {
		lowerKey := strings.ToLower(key)
		fullKey := lowerKey
		if prefix != "" {
			fullKey = prefix + "." + lowerKey
		}
		out[fullKey] = val
		switch nested := val.(type) {
		case map[string]any:
			flattenMap(fullKey, nested, out)
		}
	}
}

func findNumber(flattened map[string]any, keys []string) *int64 {
	for _, key := range keys {
		lowerKey := strings.ToLower(key)
		for candidate, val := range flattened {
			if candidate == lowerKey || strings.HasSuffix(candidate, "."+lowerKey) {
				if num := parseNumber(val); num != nil {
					return num
				}
			}
		}
	}
	return nil
}

func findTime(flattened map[string]any, keys []string) string {
	for _, key := range keys {
		lowerKey := strings.ToLower(key)
		for candidate, val := range flattened {
			if candidate == lowerKey || strings.HasSuffix(candidate, "."+lowerKey) {
				if ts := parseTime(val); ts != "" {
					return ts
				}
			}
		}
	}
	return ""
}

func parseNumber(value any) *int64 {
	switch v := value.(type) {
	case float64:
		n := int64(v)
		return &n
	case float32:
		n := int64(v)
		return &n
	case int:
		n := int64(v)
		return &n
	case int64:
		return &v
	case json.Number:
		if i, err := v.Int64(); err == nil {
			return &i
		}
	case string:
		clean := strings.ReplaceAll(v, ",", "")
		if clean == "" {
			return nil
		}
		if i, err := strconv.ParseInt(clean, 10, 64); err == nil {
			return &i
		}
	}
	return nil
}

func parseTime(value any) string {
	switch v := value.(type) {
	case string:
		// Accept RFC3339 or RFC3339Nano strings
		if ts, err := time.Parse(time.RFC3339, v); err == nil {
			return ts.UTC().Format(time.RFC3339)
		}
		if ts, err := time.Parse(time.RFC3339Nano, v); err == nil {
			return ts.UTC().Format(time.RFC3339)
		}
	}
	return ""
}

func extractUsageFieldsFromText(raw string) map[string]any {
	fields := map[string]any{}
	cleaned := stripANSI(raw)
	remainingTokensRe := regexp.MustCompile(`(?i)(weekly\\s+)?(remaining|left)[^0-9]{0,10}([0-9][0-9,]*)\\s*(tokens?)`)
	matches := remainingTokensRe.FindAllStringSubmatch(cleaned, -1)
	for _, match := range matches {
		value := match[3]
		clean := strings.ReplaceAll(value, ",", "")
		if num, err := strconv.ParseInt(clean, 10, 64); err == nil {
			if strings.TrimSpace(strings.ToLower(match[1])) != "" {
				fields["weekly_remaining_tokens"] = num
			} else if _, ok := fields["remaining_tokens"]; !ok {
				fields["remaining_tokens"] = num
			}
		}
	}

	resetRe := regexp.MustCompile(`(?i)reset[^0-9]*(\\d{4}-\\d{2}-\\d{2}[^\\s]*)`)
	if match := resetRe.FindStringSubmatch(cleaned); len(match) > 1 {
		if ts, err := time.Parse(time.RFC3339, match[1]); err == nil {
			fields["reset_at"] = ts.UTC().Format(time.RFC3339)
		}
	}

	// Claude /usage and Codex /status text parsing
	if parsed := parseProviderUsageText("claude_code", cleaned); len(parsed) > 0 {
		applyParsedUsageEntries(fields, map[string]any{"entries": parsed})
	}
	if parsed := parseProviderUsageText("codex", cleaned); len(parsed) > 0 {
		applyParsedUsageEntries(fields, map[string]any{"entries": parsed})
	}

	return fields
}

func findFloat(flattened map[string]any, keys []string) *float64 {
	for _, key := range keys {
		lowerKey := strings.ToLower(key)
		for candidate, val := range flattened {
			if candidate == lowerKey || strings.HasSuffix(candidate, "."+lowerKey) {
				if f := parseFloat(val); f != nil {
					return f
				}
			}
		}
	}
	return nil
}

func parseFloat(value any) *float64 {
	switch v := value.(type) {
	case float64:
		return &v
	case float32:
		f := float64(v)
		return &f
	case int:
		f := float64(v)
		return &f
	case int64:
		f := float64(v)
		return &f
	case json.Number:
		if f, err := v.Float64(); err == nil {
			return &f
		}
	case string:
		clean := strings.TrimSpace(strings.TrimSuffix(v, "%"))
		clean = strings.ReplaceAll(clean, ",", "")
		if clean == "" {
			return nil
		}
		if f, err := strconv.ParseFloat(clean, 64); err == nil {
			return &f
		}
	}
	return nil
}

func normalizeUtilization(value float64) float64 {
	if value <= 1.0 && value > 0 {
		value *= 100
	}
	if value < 0 {
		return 0
	}
	if value > 100 {
		return 100
	}
	return value
}

func applyParsedUsageEntries(fields map[string]any, rawJSON map[string]any) {
	entriesAny, ok := rawJSON["entries"]
	if !ok {
		if parsed, ok := rawJSON["_parsed"].(map[string]any); ok {
			entriesAny = parsed["entries"]
		}
	}
	var entries []map[string]any
	switch typed := entriesAny.(type) {
	case []any:
		for _, entryAny := range typed {
			entry, ok := entryAny.(map[string]any)
			if !ok {
				continue
			}
			entries = append(entries, entry)
		}
	case []map[string]any:
		entries = typed
	default:
		return
	}

	for _, entry := range entries {
		label, _ := entry["label"].(string)
		label = strings.ToLower(strings.TrimSpace(label))

		var utilization float64
		var hasUtilization bool
		if used := parseFloat(entry["used_percent"]); used != nil {
			utilization = normalizeUtilization(*used)
			hasUtilization = true
		} else if remaining := parseFloat(entry["remaining_percent"]); remaining != nil {
			utilization = 100 - normalizeUtilization(*remaining)
			hasUtilization = true
		}

		if !hasUtilization {
			continue
		}

		switch {
		case label == "current_session" || strings.Contains(label, "5h"):
			if _, exists := fields["five_hour_utilization"]; !exists {
				fields["five_hour_utilization"] = utilization
			}
		case label == "weekly_all_models" || label == "weekly limit" || label == "weekly":
			if _, exists := fields["weekly_utilization"]; !exists {
				fields["weekly_utilization"] = utilization
			}
		case label == "weekly_opus":
			if _, exists := fields["weekly_opus_utilization"]; !exists {
				fields["weekly_opus_utilization"] = utilization
			}
		case label == "weekly_sonnet":
			if _, exists := fields["weekly_sonnet_utilization"]; !exists {
				fields["weekly_sonnet_utilization"] = utilization
			}
		}
	}
}

func (a *Agent) sendHello() error {
	payload := map[string]any{
		"host": map[string]any{
			"id":            a.cfg.Host.ID,
			"name":          a.cfg.Host.Name,
			"agent_version": "0.1.0",
			"capabilities": map[string]bool{
				"tmux":            true,
				"spawn":           a.cfg.Security.AllowSpawn,
				"kill":            a.cfg.Security.AllowKill,
				"console_stream":  a.cfg.Security.AllowConsoleStream,
				"terminal":        true,
				"claude_hooks":    true,
				"codex_exec_json": true,
			},
		},
		"resume": map[string]any{
			"last_acked_seq": a.wsClient.GetLastAckedSeq(),
		},
	}

	return a.wsClient.Send("agent.hello", payload)
}

func (a *Agent) handleMessage(msgType string, payload json.RawMessage) {
	switch msgType {
	case "commands.dispatch":
		a.handleCommandDispatch(payload)
	case "approvals.decision":
		a.handleApprovalDecision(payload)
	case "mcp.list_servers":
		a.handleMCPList(payload)
	case "mcp.get_config":
		a.handleMCPGetConfig(payload)
	case "mcp.update_config":
		a.handleMCPUpdateConfig(payload)
	case "mcp.get_project_config":
		a.handleMCPGetProjectConfig(payload)
	case "mcp.update_project_config":
		a.handleMCPUpdateProjectConfig(payload)
	case "terminal.attach":
		a.handleTerminalAttach(payload)
	case "terminal.input":
		a.handleTerminalInput(payload)
	case "terminal.resize":
		a.handleTerminalResize(payload)
	case "terminal.control":
		a.handleTerminalControl(payload)
	case "terminal.detach":
		a.handleTerminalDetach(payload)
	}
}

func (a *Agent) handleCommandDispatch(payload json.RawMessage) {
	var cmd struct {
		CmdID     string `json:"cmd_id"`
		SessionID string `json:"session_id"`
		Command   struct {
			Type    string          `json:"type"`
			Payload json.RawMessage `json:"payload"`
		} `json:"command"`
	}
	if err := json.Unmarshal(payload, &cmd); err != nil {
		log.Printf("Failed to parse command: %v", err)
		return
	}

	var result struct {
		CmdID     string         `json:"cmd_id"`
		SessionID string         `json:"session_id"`
		OK        bool           `json:"ok"`
		Result    map[string]any `json:"result,omitempty"`
		Error     *struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error,omitempty"`
	}
	result.CmdID = cmd.CmdID
	result.SessionID = cmd.SessionID

	// Get session when required
	var session *SessionState
	a.sessionsMu.RLock()
	session, exists := a.sessions[cmd.SessionID]
	a.sessionsMu.RUnlock()

	// Execute command
	var err error
	var resultPayload map[string]any
	switch cmd.Command.Type {
	case "send_input":
		if !exists {
			err = fmt.Errorf("session not found")
			break
		}
		err = a.executeSendInput(session, cmd.Command.Payload)
	case "send_keys":
		if !exists {
			err = fmt.Errorf("session not found")
			break
		}
		err = a.executeSendKeys(session, cmd.Command.Payload)
	case "interrupt":
		if !exists {
			err = fmt.Errorf("session not found")
			break
		}
		err = a.tmuxClient.SendInterrupt(session.PaneID)
	case "kill_session":
		if !exists {
			err = fmt.Errorf("session not found")
			break
		}
		err = a.executeKillSession(session)
	case "adopt_pane":
		err = a.executeAdoptPane(cmd.Command.Payload)
	case "rename_session":
		if !exists {
			err = fmt.Errorf("session not found")
			break
		}
		err = a.executeRenameSession(session, cmd.Command.Payload)
	case "spawn_session":
		err = a.executeSpawnSession(cmd.SessionID, cmd.Command.Payload)
	case "spawn_job":
		err = a.executeSpawnJob(cmd.SessionID, cmd.Command.Payload)
	case "fork":
		if !exists {
			err = fmt.Errorf("session not found")
			break
		}
		err = a.executeFork(session, cmd.Command.Payload)
	case "console.subscribe":
		if !exists {
			err = fmt.Errorf("session not found")
			break
		}
		err = a.executeConsoleSubscribe(session, cmd.Command.Payload)
	case "console.unsubscribe":
		err = a.executeConsoleUnsubscribe(cmd.Command.Payload)
	case "capture_pane":
		if !exists {
			err = fmt.Errorf("session not found")
			break
		}
		err = a.executeCapturePaneCommand(session, cmd.CmdID, cmd.Command.Payload)
	case "copy_to_session":
		if !exists {
			err = fmt.Errorf("session not found")
			break
		}
		err = a.executeCopyToSession(session, cmd.Command.Payload)
	case "list_directory":
		resultPayload, err = a.executeListDirectory(cmd.Command.Payload)
	default:
		err = fmt.Errorf("unknown command type: %s", cmd.Command.Type)
	}

	if err != nil {
		result.Error = &struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}{"COMMAND_FAILED", err.Error()}
	} else {
		result.OK = true
		if resultPayload != nil {
			result.Result = resultPayload
		}
	}

	a.wsClient.Send("commands.result", result)
}

func (a *Agent) handleMCPList(payload json.RawMessage) {
	var req struct {
		CmdID  string `json:"cmd_id"`
		HostID string `json:"host_id"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		log.Printf("Failed to parse mcp.list_servers: %v", err)
		return
	}

	a.wsClient.Send("mcp.servers", map[string]any{
		"cmd_id":  req.CmdID,
		"servers": []any{},
		"pool_config": map[string]any{
			"enabled":  false,
			"pool_all": false,
		},
	})
}

func (a *Agent) handleMCPGetConfig(payload json.RawMessage) {
	var req struct {
		CmdID     string `json:"cmd_id"`
		SessionID string `json:"session_id"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		log.Printf("Failed to parse mcp.get_config: %v", err)
		return
	}

	a.wsClient.Send("mcp.config", map[string]any{
		"cmd_id":           req.CmdID,
		"session_id":       req.SessionID,
		"servers":          []any{},
		"enablement":       map[string]any{},
		"restart_required": false,
	})
}

func (a *Agent) handleMCPUpdateConfig(payload json.RawMessage) {
	var req struct {
		CmdID      string         `json:"cmd_id"`
		SessionID  string         `json:"session_id"`
		Enablement map[string]any `json:"enablement"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		log.Printf("Failed to parse mcp.update_config: %v", err)
		return
	}

	a.wsClient.Send("mcp.update_result", map[string]any{
		"cmd_id":           req.CmdID,
		"success":          false,
		"restart_required": false,
		"error":            "MCP configuration not supported on this agent",
	})
}

func (a *Agent) handleMCPGetProjectConfig(payload json.RawMessage) {
	var req struct {
		CmdID    string `json:"cmd_id"`
		RepoRoot string `json:"repo_root"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		log.Printf("Failed to parse mcp.get_project_config: %v", err)
		return
	}

	a.wsClient.Send("mcp.project_config", map[string]any{
		"cmd_id":     req.CmdID,
		"enablement": map[string]any{},
	})
}

func (a *Agent) handleMCPUpdateProjectConfig(payload json.RawMessage) {
	var req struct {
		CmdID      string         `json:"cmd_id"`
		RepoRoot   string         `json:"repo_root"`
		Enablement map[string]any `json:"enablement"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		log.Printf("Failed to parse mcp.update_project_config: %v", err)
		return
	}

	a.wsClient.Send("mcp.update_result", map[string]any{
		"cmd_id":           req.CmdID,
		"success":          false,
		"restart_required": false,
		"error":            "MCP configuration not supported on this agent",
	})
}

func (a *Agent) executeSendInput(session *SessionState, payload json.RawMessage) error {
	if !a.cfg.Security.AllowSendInput {
		return fmt.Errorf("send_input not allowed by policy")
	}

	var p struct {
		Text  string `json:"text"`
		Enter bool   `json:"enter"`
	}
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}

	return a.sendInputSmart(session.PaneID, p.Text, p.Enter)
}

func (a *Agent) executeSendKeys(session *SessionState, payload json.RawMessage) error {
	if !a.cfg.Security.AllowSendInput {
		return fmt.Errorf("send_keys not allowed by policy")
	}

	var p struct {
		Keys []string `json:"keys"`
	}
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}

	return a.tmuxClient.SendKeys(session.PaneID, p.Keys)
}

func (a *Agent) executeKillSession(session *SessionState) error {
	if !a.cfg.Security.AllowKill {
		return fmt.Errorf("kill not allowed by policy")
	}

	return a.tmuxClient.KillPane(session.PaneID)
}

func (a *Agent) executeConsoleSubscribe(session *SessionState, payload json.RawMessage) error {
	if !a.cfg.Security.AllowConsoleStream {
		return fmt.Errorf("console_stream not allowed by policy")
	}

	var p struct {
		SubscriptionID string `json:"subscription_id"`
		PaneID         string `json:"pane_id"`
	}
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}

	paneID := session.PaneID
	if paneID == "" {
		paneID = p.PaneID
	}
	if paneID == "" {
		return fmt.Errorf("pane_id is required for console stream")
	}

	if _, err := a.streamer.StartStream(p.SubscriptionID, session.ID, paneID); err != nil {
		return err
	}

	// Ensure pipe-pane writes to console log (and terminal FIFO if attached)
	return a.pipeMux.SetConsole(paneID, true)
}

func (a *Agent) executeConsoleUnsubscribe(payload json.RawMessage) error {
	var p struct {
		SubscriptionID string `json:"subscription_id"`
	}
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}

	paneID, ok := a.streamer.StopStream(p.SubscriptionID)
	if ok && paneID != "" {
		if !a.streamer.HasSubscribers(paneID) {
			_ = a.pipeMux.SetConsole(paneID, false)
		}
	}
	return nil
}

func (a *Agent) executeCapturePaneCommand(session *SessionState, cmdID string, payload json.RawMessage) error {
	var p struct {
		Mode       string `json:"mode"`
		LineStart  int    `json:"line_start"`
		LineEnd    int    `json:"line_end"`
		LastNLines int    `json:"last_n_lines"`
		StripANSI  bool   `json:"strip_ansi"`
	}
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}

	mode := tmux.CaptureModeVisible
	switch p.Mode {
	case "visible":
		mode = tmux.CaptureModeVisible
	case "last_n":
		mode = tmux.CaptureModeLastN
	case "range":
		mode = tmux.CaptureModeRange
	case "full":
		mode = tmux.CaptureModeFull
	}

	opts := tmux.CapturePaneOptions{
		Mode:       mode,
		LineStart:  p.LineStart,
		LineEnd:    p.LineEnd,
		LastNLines: p.LastNLines,
		StripANSI:  p.StripANSI,
	}

	content, err := a.tmuxClient.CapturePaneRange(session.PaneID, opts)
	if err != nil {
		return fmt.Errorf("capture failed: %w", err)
	}

	// Send capture result back as a command result with content
	lineCount := strings.Count(content, "\n")
	a.wsClient.Send("commands.result", map[string]any{
		"cmd_id":     cmdID,
		"session_id": session.ID,
		"ok":         true,
		"result": map[string]any{
			"content":      content,
			"line_count":   lineCount,
			"capture_mode": p.Mode,
		},
	})

	return nil
}

func (a *Agent) executeCopyToSession(sourceSession *SessionState, payload json.RawMessage) error {
	var p struct {
		TargetSessionID string `json:"target_session_id"`
		Mode            string `json:"mode"`
		LineStart       int    `json:"line_start"`
		LineEnd         int    `json:"line_end"`
		LastNLines      int    `json:"last_n_lines"`
		PrependText     string `json:"prepend_text"`
		AppendText      string `json:"append_text"`
		StripANSI       bool   `json:"strip_ansi"`
	}
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}

	if p.TargetSessionID == "" {
		return fmt.Errorf("target_session_id is required")
	}

	// Get target session (must be on this host for copy_to_session)
	a.sessionsMu.RLock()
	targetSession, exists := a.sessions[p.TargetSessionID]
	a.sessionsMu.RUnlock()
	if !exists {
		return fmt.Errorf("target session not found on this host")
	}
	if targetSession.PaneID == "" {
		return fmt.Errorf("target session has no pane_id")
	}

	// Capture content from source
	mode := tmux.CaptureModeVisible
	switch p.Mode {
	case "visible":
		mode = tmux.CaptureModeVisible
	case "last_n":
		mode = tmux.CaptureModeLastN
	case "range":
		mode = tmux.CaptureModeRange
	case "full":
		mode = tmux.CaptureModeFull
	}

	opts := tmux.CapturePaneOptions{
		Mode:       mode,
		LineStart:  p.LineStart,
		LineEnd:    p.LineEnd,
		LastNLines: p.LastNLines,
		StripANSI:  p.StripANSI,
	}

	content, err := a.tmuxClient.CapturePaneRange(sourceSession.PaneID, opts)
	if err != nil {
		return fmt.Errorf("capture failed: %w", err)
	}

	// Build combined prompt with prepend/append
	var combined strings.Builder
	if p.PrependText != "" {
		combined.WriteString(p.PrependText)
		combined.WriteString("\n\n---\n\n")
	}
	combined.WriteString(content)
	if p.AppendText != "" {
		combined.WriteString("\n\n---\n\n")
		combined.WriteString(p.AppendText)
	}

	// Send to target pane (no enter - let user review first)
	if err := a.sendInputSmart(targetSession.PaneID, combined.String(), false); err != nil {
		return fmt.Errorf("send to target failed: %w", err)
	}

	log.Printf("Copied %d lines from session %s to session %s",
		strings.Count(content, "\n"), sourceSession.ID, targetSession.ID)

	return nil
}

func (a *Agent) executeListDirectory(payload json.RawMessage) (map[string]any, error) {
	var p struct {
		Path       string `json:"path"`
		ShowHidden bool   `json:"show_hidden"`
	}
	if err := json.Unmarshal(payload, &p); err != nil {
		return nil, err
	}

	displayPath, resolvedPath, err := normalizeListDirectoryPath(p.Path)
	if err != nil {
		return nil, err
	}

	entries, err := os.ReadDir(resolvedPath)
	if err != nil {
		return nil, err
	}

	results := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		if name == "" {
			continue
		}
		if !p.ShowHidden && strings.HasPrefix(name, ".") {
			continue
		}

		entryResolvedPath := filepath.Join(resolvedPath, name)
		entryDisplayPath := joinListDirectoryPath(displayPath, name)

		isDir := entry.IsDir()
		isRepo := false
		gitBranch := ""
		if isDir && isGitRepoDir(entryResolvedPath) {
			isRepo = true
			if gitInfo, ok := a.gitCache.Get(entryResolvedPath); ok {
				gitBranch = gitInfo.Branch
			} else if gitInfo := tmux.ResolveGitInfo(entryResolvedPath); gitInfo != nil {
				a.gitCache.Set(entryResolvedPath, gitInfo)
				gitBranch = gitInfo.Branch
			}
		}

		var lastModified any
		if info, err := entry.Info(); err == nil {
			lastModified = info.ModTime().UTC().UnixMilli()
		}

		entryMap := map[string]any{
			"name":         name,
			"path":         entryDisplayPath,
			"is_directory": isDir,
			"is_git_repo":  isRepo,
		}
		if gitBranch != "" {
			entryMap["git_branch"] = gitBranch
		}
		if lastModified != nil {
			entryMap["last_modified"] = lastModified
		}

		results = append(results, entryMap)
	}

	return map[string]any{
		"entries":      results,
		"current_path": displayPath,
	}, nil
}

func normalizeListDirectoryPath(rawPath string) (string, string, error) {
	trimmed := strings.TrimSpace(rawPath)
	if trimmed == "" {
		return "", "", fmt.Errorf("path is required")
	}

	if strings.HasPrefix(trimmed, "~") {
		suffix := strings.TrimPrefix(trimmed, "~")
		if suffix != "" && !strings.HasPrefix(suffix, "/") {
			return "", "", fmt.Errorf("unsupported path: %s", trimmed)
		}

		home, err := os.UserHomeDir()
		if err != nil {
			return "", "", fmt.Errorf("failed to resolve home directory: %w", err)
		}

		const sentinel = "/__home__"
		normalized := path.Clean(sentinel + suffix)
		if !strings.HasPrefix(normalized, sentinel) {
			return "", "", fmt.Errorf("path escapes home directory")
		}

		restored := strings.TrimPrefix(normalized, sentinel)
		displayPath := "~"
		if restored != "" && restored != "/" {
			displayPath = "~" + restored
		}

		if restored == "" || restored == "/" {
			return displayPath, home, nil
		}
		return displayPath, filepath.Join(home, strings.TrimPrefix(restored, "/")), nil
	}

	cleaned := filepath.Clean(trimmed)
	if !filepath.IsAbs(cleaned) {
		return "", "", fmt.Errorf("path must be absolute or start with ~")
	}

	return cleaned, cleaned, nil
}

func joinListDirectoryPath(base, name string) string {
	if base == "/" {
		return "/" + name
	}
	if base == "~" {
		return "~/" + name
	}
	return base + "/" + name
}

func isGitRepoDir(path string) bool {
	stat, err := os.Stat(filepath.Join(path, ".git"))
	if err != nil {
		return false
	}
	return stat.IsDir() || stat.Mode().IsRegular()
}

const (
	sendInputChunkThreshold = 1200
	sendInputChunkSize      = 800
	sendInputChunkDelay     = 60 * time.Millisecond
)

func (a *Agent) sendInputSmart(paneID, text string, enter bool) error {
	sendEnter := enter
	if sendEnter {
		text = strings.TrimRight(text, "\r\n")
	}

	if text == "" {
		if sendEnter {
			return a.tmuxClient.SendKeys(paneID, []string{"Enter"})
		}
		return nil
	}

	hasNewline := strings.Contains(text, "\n")
	if !hasNewline && utf8.RuneCountInString(text) < sendInputChunkThreshold {
		if err := a.tmuxClient.SendKeysRaw(paneID, text); err != nil {
			return err
		}
		if sendEnter {
			return a.tmuxClient.SendKeys(paneID, []string{"Enter"})
		}
		return nil
	}

	if utf8.RuneCountInString(text) >= sendInputChunkThreshold {
		if err := a.tmuxClient.SendInputChunked(paneID, text, false, sendInputChunkSize, sendInputChunkDelay); err != nil {
			return err
		}
		if sendEnter {
			return a.tmuxClient.SendKeys(paneID, []string{"Enter"})
		}
		return nil
	}

	if err := a.tmuxClient.SendInput(paneID, text, false); err != nil {
		return err
	}
	if sendEnter {
		return a.tmuxClient.SendKeys(paneID, []string{"Enter"})
	}
	return nil
}

func (a *Agent) executeAdoptPane(payload json.RawMessage) error {
	if !a.cfg.Security.AllowSpawn {
		return fmt.Errorf("adopt_pane not allowed by policy")
	}

	var p struct {
		TmuxPaneID string `json:"tmux_pane_id"`
		Title      string `json:"title"`
	}
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	if p.TmuxPaneID == "" {
		return fmt.Errorf("tmux_pane_id is required")
	}

	// Find existing unmanaged session for this pane
	a.sessionsMu.Lock()
	defer a.sessionsMu.Unlock()

	var session *SessionState
	for _, s := range a.sessions {
		if s.PaneID == p.TmuxPaneID {
			session = s
			break
		}
	}

	if session == nil {
		// Create new session state
		now := time.Now().UTC()
		session = &SessionState{
			ID:           uuid.New().String(),
			PaneID:       p.TmuxPaneID,
			Kind:         "tmux_pane",
			Status:       "IDLE",
			Provider:     "shell",
			LastActivity: now,
			LastOutput:   now,
		}
		a.sessions[session.ID] = session
	}

	session.Unmanaged = false
	session.LastActivity = time.Now().UTC()
	session.LastOutput = session.LastActivity
	if p.Title != "" {
		session.Title = p.Title
	}

	// Persist session ID on the pane
	if err := a.tmuxClient.SetPaneOption(p.TmuxPaneID, a.cfg.Tmux.OptionSessionID, session.ID); err != nil {
		return err
	}

	// Send upsert
	update := map[string]any{
		"id":               session.ID,
		"kind":             session.Kind,
		"provider":         session.Provider,
		"status":           session.Status,
		"title":            session.Title,
		"tmux_pane_id":     session.PaneID,
		"tmux_target":      session.TmuxTarget,
		"metadata":         session.Metadata,
		"last_activity_at": session.LastActivity.UTC().Format(time.RFC3339),
	}
	a.wsClient.Send("sessions.upsert", map[string]any{"sessions": []map[string]any{update}})
	return nil
}

func (a *Agent) executeRenameSession(session *SessionState, payload json.RawMessage) error {
	var p struct {
		Title string `json:"title"`
	}
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	if p.Title == "" {
		return fmt.Errorf("title is required")
	}

	a.sessionsMu.Lock()
	session.Title = p.Title
	session.LastActivity = time.Now().UTC()
	a.sessionsMu.Unlock()

	update := map[string]any{
		"id":               session.ID,
		"kind":             session.Kind,
		"provider":         session.Provider,
		"status":           session.Status,
		"title":            session.Title,
		"last_activity_at": session.LastActivity.UTC().Format(time.RFC3339),
	}
	a.wsClient.Send("sessions.upsert", map[string]any{"sessions": []map[string]any{update}})
	return nil
}

func (a *Agent) executeSpawnSession(sessionID string, payload json.RawMessage) error {
	if !a.cfg.Security.AllowSpawn {
		return fmt.Errorf("spawn_session not allowed by policy")
	}

	var raw map[string]any
	if err := json.Unmarshal(payload, &raw); err != nil {
		return err
	}

	if _, ok := raw["working_directory"]; ok {
		return a.executeSpawnSessionInteractive(sessionID, payload)
	}

	return a.executeSpawnSessionWorktree(sessionID, payload)
}

func (a *Agent) executeSpawnSessionWorktree(sessionID string, payload json.RawMessage) error {
	var p struct {
		Provider    string `json:"provider"`
		RepoRoot    string `json:"repo_root"`
		BaseBranch  string `json:"base_branch"`
		BranchName  string `json:"branch_name"`
		WorktreeDir string `json:"worktree_dir"`
		Title       string `json:"title"`
		Tmux        struct {
			TargetSession string `json:"target_session"`
			WindowName    string `json:"window_name"`
			Command       string `json:"command"`
		} `json:"tmux"`
		Env map[string]string `json:"env"`
	}
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	if p.RepoRoot == "" || p.BranchName == "" || p.WorktreeDir == "" {
		return fmt.Errorf("repo_root, branch_name, and worktree_dir are required")
	}
	if p.BaseBranch == "" {
		p.BaseBranch = "main"
	}
	if p.Provider == "" {
		p.Provider = "claude_code"
	}
	if p.Tmux.TargetSession == "" {
		p.Tmux.TargetSession = a.cfg.Spawn.TmuxSessionName
	}
	p.Tmux.TargetSession = deriveSpawnTmuxSessionName(p.Tmux.TargetSession, p.RepoRoot, p.WorktreeDir)
	if p.Tmux.WindowName == "" {
		p.Tmux.WindowName = p.BranchName
	}
	if sessionID == "" {
		sessionID = uuid.New().String()
	}

	if err := os.MkdirAll(filepath.Dir(p.WorktreeDir), 0755); err != nil {
		return err
	}

	// Create worktree
	if err := tmux.RunGitCommand(p.RepoRoot, "fetch", "--all", "--prune"); err != nil {
		return err
	}
	if err := tmux.RunGitCommand(p.RepoRoot, "worktree", "add", p.WorktreeDir, "-b", p.BranchName, p.BaseBranch); err != nil {
		return err
	}

	// Ensure tmux session exists
	if !a.tmuxClient.HasSession(p.Tmux.TargetSession) {
		if err := a.tmuxClient.NewSession(p.Tmux.TargetSession); err != nil {
			return err
		}
	}

	// Create window
	paneID, err := a.tmuxClient.NewWindow(p.Tmux.TargetSession, p.Tmux.WindowName, p.WorktreeDir)
	if err != nil {
		return err
	}

	// Build command with env
	envParts := []string{fmt.Sprintf("AC_SESSION_ID=%s", sessionID)}
	for k, v := range p.Env {
		envParts = append(envParts, fmt.Sprintf("%s=%s", k, v))
	}
	command := fmt.Sprintf("export %s && cd %s && %s", strings.Join(envParts, " "), p.WorktreeDir, p.Tmux.Command)
	_ = a.tmuxClient.SendKeys(paneID, []string{command, "Enter"})

	// Persist session ID on the pane
	if err := a.tmuxClient.SetPaneOption(paneID, a.cfg.Tmux.OptionSessionID, sessionID); err != nil {
		return err
	}

	// Register session
	now := time.Now().UTC()
	a.sessionsMu.Lock()
	a.sessions[sessionID] = &SessionState{
		ID:           sessionID,
		PaneID:       paneID,
		Kind:         "tmux_pane",
		Provider:     p.Provider,
		Status:       "STARTING",
		Title:        p.Title,
		CWD:          p.WorktreeDir,
		RepoRoot:     p.RepoRoot,
		GitBranch:    p.BranchName,
		LastActivity: now,
		LastOutput:   now,
	}
	a.sessionsMu.Unlock()

	a.wsClient.Send("sessions.upsert", map[string]any{
		"sessions": []map[string]any{
			{
				"id":               sessionID,
				"kind":             "tmux_pane",
				"provider":         p.Provider,
				"status":           "STARTING",
				"title":            p.Title,
				"cwd":              p.WorktreeDir,
				"repo_root":        p.RepoRoot,
				"git_branch":       p.BranchName,
				"tmux_pane_id":     paneID,
				"last_activity_at": time.Now().UTC().Format(time.RFC3339),
			},
		},
	})

	return nil
}

func deriveSpawnTmuxSessionName(configured, repoRoot, cwd string) string {
	tmuxSession := strings.TrimSpace(configured)
	if tmuxSession == "" || tmuxSession == "agents" {
		candidate := strings.TrimSpace(repoRoot)
		if candidate == "" {
			candidate = strings.TrimSpace(cwd)
		}
		if candidate != "" {
			tmuxSession = filepath.Base(candidate)
		}
	}
	if tmuxSession == "" {
		tmuxSession = "agents"
	}
	return tmuxSession
}

func (a *Agent) executeSpawnSessionInteractive(sessionID string, payload json.RawMessage) error {
	var p struct {
		Provider         string   `json:"provider"`
		WorkingDirectory string   `json:"working_directory"`
		Title            string   `json:"title"`
		Flags            []string `json:"flags"`
		GroupID          string   `json:"group_id"`
		Tmux             struct {
			TargetSession string `json:"target_session"`
			WindowName    string `json:"window_name"`
		} `json:"tmux"`
	}
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	if p.WorkingDirectory == "" {
		return fmt.Errorf("working_directory is required")
	}
	_, resolvedWorkingDir, err := normalizeListDirectoryPath(p.WorkingDirectory)
	if err != nil {
		return err
	}
	if p.Provider == "" {
		p.Provider = "shell"
	}
	if sessionID == "" {
		sessionID = uuid.New().String()
	}

	gitInfo := tmux.ResolveGitInfo(resolvedWorkingDir)

	// Ensure tmux session exists
	tmuxSession := strings.TrimSpace(p.Tmux.TargetSession)
	if tmuxSession == "" {
		tmuxSession = a.cfg.Spawn.TmuxSessionName
	}
	tmuxSession = deriveSpawnTmuxSessionName(tmuxSession, func() string {
		if gitInfo != nil {
			return gitInfo.RepoRoot
		}
		return ""
	}(), resolvedWorkingDir)
	if !a.tmuxClient.HasSession(tmuxSession) {
		if err := a.tmuxClient.NewSession(tmuxSession); err != nil {
			return err
		}
	}

	windowName := strings.TrimSpace(p.Tmux.WindowName)
	if windowName == "" {
		windowName = p.Title
	}
	if strings.TrimSpace(windowName) == "" {
		windowName = p.Provider
	}
	displayTitle := strings.TrimSpace(p.Title)
	if displayTitle == "" {
		displayTitle = windowName
	}

	paneID, err := a.tmuxClient.NewWindow(tmuxSession, windowName, resolvedWorkingDir)
	if err != nil {
		return err
	}

	if err := a.tmuxClient.SetPaneOption(paneID, a.cfg.Tmux.OptionSessionID, sessionID); err != nil {
		return err
	}

	launchCommand := a.buildProviderCommand(p.Provider, p.Flags)
	commandParts := []string{
		fmt.Sprintf("export AC_SESSION_ID=%s", sessionID),
		fmt.Sprintf("cd %s", resolvedWorkingDir),
	}
	if launchCommand != "" {
		commandParts = append(commandParts, launchCommand)
	}
	_ = a.tmuxClient.SendKeys(paneID, []string{strings.Join(commandParts, " && "), "Enter"})

	status := "IDLE"
	if launchCommand != "" {
		status = "STARTING"
	}

	var repoRoot, gitBranch, gitRemote string
	if gitInfo != nil {
		repoRoot = gitInfo.RepoRoot
		gitBranch = gitInfo.Branch
		gitRemote = gitInfo.Remote
	}

	now := time.Now().UTC()
	a.sessionsMu.Lock()
	a.sessions[sessionID] = &SessionState{
		ID:           sessionID,
		PaneID:       paneID,
		Kind:         "tmux_pane",
		Provider:     p.Provider,
		Status:       status,
		Title:        displayTitle,
		CWD:          resolvedWorkingDir,
		RepoRoot:     repoRoot,
		GitBranch:    gitBranch,
		GitRemote:    gitRemote,
		GroupID:      p.GroupID,
		LastActivity: now,
		LastOutput:   now,
	}
	a.sessionsMu.Unlock()

	update := map[string]any{
		"id":               sessionID,
		"kind":             "tmux_pane",
		"provider":         p.Provider,
		"status":           status,
		"title":            displayTitle,
		"cwd":              resolvedWorkingDir,
		"repo_root":        repoRoot,
		"git_branch":       gitBranch,
		"git_remote":       gitRemote,
		"tmux_pane_id":     paneID,
		"last_activity_at": time.Now().UTC().Format(time.RFC3339),
	}
	if p.GroupID != "" {
		update["group_id"] = p.GroupID
	}

	a.wsClient.Send("sessions.upsert", map[string]any{
		"sessions": []map[string]any{update},
	})

	return nil
}

func (a *Agent) executeSpawnJob(sessionID string, payload json.RawMessage) error {
	if !a.cfg.Security.AllowSpawn {
		return fmt.Errorf("spawn_job not allowed by policy")
	}

	var p struct {
		Provider string            `json:"provider"`
		Cwd      string            `json:"cwd"`
		Prompt   string            `json:"prompt"`
		Env      map[string]string `json:"env"`
	}
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	if p.Provider == "" {
		p.Provider = "codex"
	}
	if p.Cwd == "" || p.Prompt == "" {
		return fmt.Errorf("cwd and prompt are required")
	}

	if sessionID == "" {
		sessionID = uuid.New().String()
	}

	// Register job session
	now := time.Now().UTC()
	a.sessionsMu.Lock()
	a.sessions[sessionID] = &SessionState{
		ID:           sessionID,
		Kind:         "job",
		Provider:     p.Provider,
		Status:       "STARTING",
		CWD:          p.Cwd,
		LastActivity: now,
		LastOutput:   now,
	}
	a.sessionsMu.Unlock()

	a.wsClient.Send("sessions.upsert", map[string]any{
		"sessions": []map[string]any{
			{
				"id":               sessionID,
				"kind":             "job",
				"provider":         p.Provider,
				"status":           "STARTING",
				"cwd":              p.Cwd,
				"last_activity_at": time.Now().UTC().Format(time.RFC3339),
			},
		},
	})

	go a.runCodexJob(sessionID, p.Cwd, p.Prompt, p.Env)
	return nil
}

func (a *Agent) executeFork(parentSession *SessionState, payload json.RawMessage) error {
	if !a.cfg.Security.AllowSpawn {
		return fmt.Errorf("fork not allowed by policy")
	}

	var p struct {
		Branch   string `json:"branch"`
		Cwd      string `json:"cwd"`
		Provider string `json:"provider"`
		Note     string `json:"note"`
		GroupID  string `json:"group_id"`
	}
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}

	newSessionID := uuid.New().String()
	newCwd := p.Cwd
	if newCwd == "" {
		newCwd = parentSession.CWD
	}

	provider := p.Provider
	if provider == "" {
		provider = parentSession.Provider
	}
	groupID := strings.TrimSpace(p.GroupID)

	// Determine window name
	windowName := "fork"
	if p.Branch != "" {
		windowName = p.Branch
	} else if p.Note != "" {
		windowName = p.Note
	}

	// If branch specified and we're in a git repo, optionally create a new branch
	if p.Branch != "" && parentSession.RepoRoot != "" {
		// Fetch and create worktree for branch
		worktreeDir := filepath.Join(a.cfg.Spawn.WorktreesRoot, p.Branch)
		if err := os.MkdirAll(filepath.Dir(worktreeDir), 0755); err != nil {
			return err
		}

		_ = tmux.RunGitCommand(parentSession.RepoRoot, "fetch", "--all", "--prune")

		// Try to create worktree - if branch exists checkout, otherwise create
		if err := tmux.RunGitCommand(parentSession.RepoRoot, "worktree", "add", worktreeDir, p.Branch); err != nil {
			// Branch might not exist, try creating it from current branch
			baseBranch := parentSession.GitBranch
			if baseBranch == "" {
				baseBranch = "main"
			}
			if err := tmux.RunGitCommand(parentSession.RepoRoot, "worktree", "add", worktreeDir, "-b", p.Branch, baseBranch); err != nil {
				log.Printf("Failed to create worktree for branch %s: %v", p.Branch, err)
				// Fall back to using parent CWD
			} else {
				newCwd = worktreeDir
			}
		} else {
			newCwd = worktreeDir
		}
	}

	// Ensure tmux session exists
	tmuxSession := a.cfg.Spawn.TmuxSessionName
	if !a.tmuxClient.HasSession(tmuxSession) {
		if err := a.tmuxClient.NewSession(tmuxSession); err != nil {
			return err
		}
	}

	// Create new window in the tmux session
	paneID, err := a.tmuxClient.NewWindow(tmuxSession, windowName, newCwd)
	if err != nil {
		return fmt.Errorf("failed to create window for fork: %w", err)
	}

	// Set session ID on the pane
	if err := a.tmuxClient.SetPaneOption(paneID, a.cfg.Tmux.OptionSessionID, newSessionID); err != nil {
		return err
	}

	// Start provider command (if applicable) and set env
	launchCommand := a.forkLaunchCommand(parentSession, provider)
	commandParts := []string{
		fmt.Sprintf("export AC_SESSION_ID=%s", newSessionID),
		fmt.Sprintf("cd %s", newCwd),
	}
	if launchCommand != "" {
		commandParts = append(commandParts, launchCommand)
	}
	_ = a.tmuxClient.SendKeys(paneID, []string{strings.Join(commandParts, " && "), "Enter"})

	// Calculate fork depth
	forkDepth := parentSession.ForkDepth + 1

	// Build title
	title := parentSession.Title
	if title == "" {
		title = windowName
	}
	if p.Note != "" {
		title = p.Note
	}
	title = title + " (fork)"

	// Get git info for new cwd
	var repoRoot, gitBranch, gitRemote string
	if gitInfo := tmux.ResolveGitInfo(newCwd); gitInfo != nil {
		repoRoot = gitInfo.RepoRoot
		gitBranch = gitInfo.Branch
		gitRemote = gitInfo.Remote
	} else {
		repoRoot = parentSession.RepoRoot
		gitBranch = p.Branch
		gitRemote = parentSession.GitRemote
	}

	// Determine initial status
	status := "IDLE"
	if launchCommand != "" {
		status = "STARTING"
	}

	// Create new session state
	now := time.Now().UTC()
	a.sessionsMu.Lock()
	a.sessions[newSessionID] = &SessionState{
		ID:           newSessionID,
		PaneID:       paneID,
		Kind:         "tmux_pane",
		Provider:     provider,
		Status:       status,
		Title:        title,
		CWD:          newCwd,
		RepoRoot:     repoRoot,
		GitBranch:    gitBranch,
		GitRemote:    gitRemote,
		TmuxTarget:   fmt.Sprintf("%s:%s", tmuxSession, windowName),
		LastActivity: now,
		LastOutput:   now,
		GroupID:      groupID,
		ForkedFrom:   parentSession.ID,
		ForkDepth:    forkDepth,
		Metadata: map[string]any{
			"forked_from": parentSession.ID,
			"fork_depth":  forkDepth,
		},
	}
	a.sessionsMu.Unlock()

	// Send session upsert
	update := map[string]any{
		"id":               newSessionID,
		"kind":             "tmux_pane",
		"provider":         provider,
		"status":           status,
		"title":            title,
		"cwd":              newCwd,
		"repo_root":        repoRoot,
		"git_branch":       gitBranch,
		"git_remote":       gitRemote,
		"tmux_pane_id":     paneID,
		"forked_from":      parentSession.ID,
		"fork_depth":       forkDepth,
		"last_activity_at": time.Now().UTC().Format(time.RFC3339),
	}
	if groupID != "" {
		update["group_id"] = groupID
	}
	a.wsClient.Send("sessions.upsert", map[string]any{
		"sessions": []map[string]any{
			update,
		},
	})

	return nil
}

func (a *Agent) forkLaunchCommand(parentSession *SessionState, provider string) string {
	if parentSession != nil && parentSession.Metadata != nil {
		if tmuxMeta, ok := parentSession.Metadata["tmux"].(map[string]any); ok {
			if cmd, ok := tmuxMeta["current_command"].(string); ok {
				cmd = strings.TrimSpace(cmd)
				if cmd != "" && !isShellCommand(cmd) {
					return cmd
				}
			}
		}
	}

	return a.buildProviderCommand(provider, nil)
}

func (a *Agent) buildProviderCommand(provider string, flags []string) string {
	var base string
	switch provider {
	case "claude_code":
		base = "claude"
	case "codex":
		base = "codex"
	case "gemini_cli":
		base = "gemini"
	case "aider":
		base = "aider"
	case "opencode":
		base = "opencode"
	case "cursor":
		base = "cursor"
	case "continue":
		base = "continue"
	case "shell":
		return ""
	}

	if base == "" {
		return ""
	}
	if len(flags) == 0 {
		return base
	}
	return base + " " + strings.Join(flags, " ")
}

func isShellCommand(command string) bool {
	base := strings.ToLower(filepath.Base(strings.TrimSpace(command)))
	switch base {
	case "bash", "zsh", "fish", "sh", "dash", "ksh", "csh", "tcsh":
		return true
	default:
		return false
	}
}

func normalizeProviderOverride(value string) string {
	override := strings.ToLower(strings.TrimSpace(value))
	switch override {
	case "claude", "claude_code":
		return "claude_code"
	case "codex":
		return "codex"
	case "gemini", "gemini_cli":
		return "gemini_cli"
	case "opencode":
		return "opencode"
	case "cursor":
		return "cursor"
	case "aider":
		return "aider"
	case "continue":
		return "continue"
	case "shell":
		return "shell"
	case "unknown":
		return "unknown"
	default:
		return ""
	}
}

func detectProviderForPane(pane tmux.Pane, procSnap *proc.Snapshot) string {
	if override := normalizeProviderOverride(pane.ProviderOverride); override != "" {
		return override
	}

	cmd := strings.ToLower(strings.TrimSpace(pane.CurrentCommand))
	switch {
	case strings.Contains(cmd, "claude"):
		return "claude_code"
	case strings.Contains(cmd, "codex"):
		return "codex"
	case strings.Contains(cmd, "gemini"):
		return "gemini_cli"
	case strings.Contains(cmd, "opencode"):
		return "opencode"
	case strings.Contains(cmd, "cursor"):
		return "cursor"
	case strings.Contains(cmd, "aider"):
		return "aider"
	case strings.Contains(cmd, "continue"):
		return "continue"
	}

	title := strings.ToLower(strings.TrimSpace(pane.PaneTitle))
	windowName := strings.ToLower(strings.TrimSpace(pane.WindowName))
	if strings.Contains(title, "gemini") || strings.Contains(windowName, "gemini") {
		return "gemini_cli"
	}

	if procSnap != nil && procSnap.HasDescendantCmd(pane.PanePID, []string{"gemini"}) {
		return "gemini_cli"
	}

	if cmd != "" && !isShellCommand(cmd) {
		return "unknown"
	}
	return "shell"
}

func isInteractiveProvider(provider string) bool {
	switch provider {
	case "claude_code", "codex", "gemini_cli", "opencode", "cursor", "aider", "continue", "unknown":
		return true
	default:
		return false
	}
}

func (a *Agent) deriveStatus(session *SessionState, pane tmux.Pane) string {
	// Preserve terminal states
	switch session.Status {
	case "ERROR", "DONE", "WAITING_FOR_APPROVAL":
		return session.Status
	}

	now := time.Now().UTC()
	lastOutput := session.LastOutput
	if lastOutput.IsZero() {
		lastOutput = session.LastActivity
	}
	if lastOutput.IsZero() {
		lastOutput = now
	}

	// Consider output changes within this window as active
	activeWindow := 10 * time.Second
	active := now.Sub(lastOutput) <= activeWindow

	cmd := strings.ToLower(strings.TrimSpace(pane.CurrentCommand))
	isShell := isShellCommand(cmd)
	interactive := !isShell || isInteractiveProvider(session.Provider)

	if interactive {
		if active {
			return "RUNNING"
		}
		// Keep STARTING briefly before flipping to waiting
		if session.Status == "STARTING" && now.Sub(session.LastActivity) < 15*time.Second {
			return "STARTING"
		}
		return "WAITING_FOR_INPUT"
	}

	// Shell-like sessions are idle by default unless actively producing output
	if active && session.Status == "STARTING" {
		return "RUNNING"
	}
	return "IDLE"
}

func (a *Agent) runCodexJob(sessionID, cwd, prompt string, env map[string]string) {
	cmd := exec.Command(a.cfg.Providers.Codex.ExecPath, "exec", "--json", prompt)
	cmd.Dir = cwd
	if len(env) > 0 {
		cmd.Env = append(os.Environ(), formatEnv(env)...)
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		a.updateJobStatus(sessionID, "ERROR")
		return
	}
	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		a.updateJobStatus(sessionID, "ERROR")
		return
	}

	scanner := bufio.NewScanner(stdout)
	buf := make([]byte, 0, 1024*1024)
	scanner.Buffer(buf, 1024*1024)

	for scanner.Scan() {
		line := scanner.Bytes()
		var evt map[string]any
		if err := json.Unmarshal(line, &evt); err != nil {
			continue
		}

		a.wsClient.Send("events.append", map[string]any{
			"session_id": sessionID,
			"event_type": "codex.event",
			"payload":    evt,
		})

		if t, ok := evt["event_type"].(string); ok {
			switch t {
			case "turn.started", "thread.started":
				a.updateJobStatus(sessionID, "RUNNING")
			case "turn.completed":
				// wait for process exit to mark DONE
			case "error":
				a.updateJobStatus(sessionID, "ERROR")
			}
		}
	}

	if err := cmd.Wait(); err != nil {
		a.updateJobStatus(sessionID, "ERROR")
		return
	}
	a.updateJobStatus(sessionID, "DONE")
}

func (a *Agent) updateJobStatus(sessionID, status string) {
	provider := "codex"
	a.sessionsMu.Lock()
	if session, ok := a.sessions[sessionID]; ok {
		session.Status = status
		session.LastActivity = time.Now().UTC()
		if session.Provider != "" {
			provider = session.Provider
		}
	}
	a.sessionsMu.Unlock()

	a.wsClient.Send("sessions.upsert", map[string]any{
		"sessions": []map[string]any{
			{
				"id":               sessionID,
				"kind":             "job",
				"provider":         provider,
				"status":           status,
				"last_activity_at": time.Now().UTC().Format(time.RFC3339),
			},
		},
	})
}

func formatEnv(env map[string]string) []string {
	items := make([]string, 0, len(env))
	for k, v := range env {
		items = append(items, fmt.Sprintf("%s=%s", k, v))
	}
	return items
}

func (a *Agent) handleApprovalDecision(payload json.RawMessage) {
	var decision struct {
		ApprovalID   string `json:"approval_id"`
		SessionID    string `json:"session_id"`
		Decision     string `json:"decision"`
		Mode         string `json:"mode"`
		UpdatedInput any    `json:"updated_input"`
	}
	if err := json.Unmarshal(payload, &decision); err != nil {
		log.Printf("Failed to parse approval decision: %v", err)
		return
	}

	// Get session for keystroke fallback
	a.sessionsMu.RLock()
	session, exists := a.sessions[decision.SessionID]
	a.sessionsMu.RUnlock()

	provider := ""
	if exists {
		provider = session.Provider
	}

	// Apply decision based on mode
	switch decision.Mode {
	case "hook":
		if provider == "claude_code" {
			a.claudeProvider.DeliverDecision(decision.ApprovalID, &providers.ApprovalDecision{
				Decision:     decision.Decision,
				Mode:         decision.Mode,
				UpdatedInput: decision.UpdatedInput,
			})
		} else if exists {
			keys := a.getApprovalKeys(provider, decision.Decision == "allow")
			a.tmuxClient.SendKeys(session.PaneID, keys)
		}
	case "keystroke":
		if exists {
			keys := a.getApprovalKeys(provider, decision.Decision == "allow")
			a.tmuxClient.SendKeys(session.PaneID, keys)
		}
	case "both":
		// Try hook first
		if provider == "claude_code" {
			a.claudeProvider.DeliverDecision(decision.ApprovalID, &providers.ApprovalDecision{
				Decision:     decision.Decision,
				Mode:         decision.Mode,
				UpdatedInput: decision.UpdatedInput,
			})
		}
		// Also send keystrokes as fallback
		if exists {
			keys := a.getApprovalKeys(provider, decision.Decision == "allow")
			a.tmuxClient.SendKeys(session.PaneID, keys)
		}
	}

	// Clear approval metadata and add to recent decisions cache
	// This prevents race conditions where a new approval arrives before
	// the session status update is processed
	a.clearApprovalMetadata(decision.SessionID)
}

func (a *Agent) getApprovalKeys(provider string, allow bool) []string {
	switch provider {
	case "codex":
		if allow && len(a.cfg.Providers.Codex.ApprovalAllowKeys) > 0 {
			return a.cfg.Providers.Codex.ApprovalAllowKeys
		}
		if !allow && len(a.cfg.Providers.Codex.ApprovalDenyKeys) > 0 {
			return a.cfg.Providers.Codex.ApprovalDenyKeys
		}
	}

	return a.claudeProvider.GetApprovalKeys(allow)
}

func (a *Agent) handleClaudeHook(payload providers.ClaudeHookPayload) (*providers.ApprovalDecision, error) {
	// Parse hook data
	var hookData map[string]any
	if err := json.Unmarshal(payload.Hook, &hookData); err != nil {
		return nil, err
	}

	hookName := extractHookName(hookData)

	// Find or create session
	sessionID := payload.Meta.ACSessionID
	if sessionID == "" {
		// Try to find session by pane
		a.sessionsMu.RLock()
		for _, s := range a.sessions {
			if s.PaneID == payload.Meta.TmuxPane {
				sessionID = s.ID
				break
			}
		}
		a.sessionsMu.RUnlock()
	}

	if sessionID == "" {
		// No matching session found
		log.Printf("Claude hook received but no matching session found for pane %s", payload.Meta.TmuxPane)
		return nil, nil
	}

	// Update session status based on hook
	newStatus := providers.MapHookToStatus(hookName, hookData)
	approvalRequested := isApprovalHook(hookName, hookData)
	if approvalRequested && a.sessionHasPendingApproval(sessionID) {
		approvalRequested = false
	}
	if approvalRequested && newStatus == "" {
		newStatus = "WAITING_FOR_APPROVAL"
	}

	toolName := extractToolName(hookData)
	a.handleToolHookEvent(sessionID, "claude_code", hookName, hookData, toolName)
	fallbackCwd := ""
	a.sessionsMu.RLock()
	if session, ok := a.sessions[sessionID]; ok {
		fallbackCwd = session.CWD
	}
	a.sessionsMu.RUnlock()
	a.handleWorkshopHookEvent(sessionID, "claude_code", hookName, hookData, fallbackCwd)
	eventPayload := map[string]any{
		"session_id": sessionID,
		"event_type": "claude.hook",
		"payload": map[string]any{
			"hook_name": hookName,
			"hook_data": hookData,
		},
	}
	if toolName != "" {
		eventPayload["payload"].(map[string]any)["tool_name"] = toolName
	}
	if usage := extractUsageFromHook(hookData); usage != nil {
		eventPayload["payload"].(map[string]any)["usage"] = usage
	}
	a.wsClient.Send("events.append", eventPayload)

	var approvalID string
	if approvalRequested {
		approvalID = payload.ApprovalID
		if approvalID == "" {
			approvalID = extractApprovalID(hookData)
		}
		if approvalID == "" {
			approvalID = uuid.New().String()
		}
	}

	if newStatus != "" || approvalRequested {
		a.updateSessionFromHook(sessionID, newStatus, buildStatusDetail(newStatus, hookName, hookData, approvalRequested), buildApprovalMetadata(approvalID, hookName, hookData, approvalRequested))
	}

	if approvalRequested {
		approvalType, inputSchema := detectApprovalType(hookName, hookData)
		payloadData := map[string]any{
			"approval_id":   approvalID,
			"provider":      "claude_code",
			"reason":        approvalReason(hookName, hookData),
			"details":       buildApprovalDetails(hookName, hookData),
			"approval_type": approvalType,
		}
		if inputSchema != nil {
			payloadData["input_schema"] = inputSchema
		}
		eventPayload := map[string]any{
			"session_id": sessionID,
			"event_type": "approval.requested",
			"payload":    payloadData,
		}
		a.wsClient.Send("events.append", eventPayload)
	}

	return nil, nil
}

func (a *Agent) handleCodexHook(payload providers.ClaudeHookPayload) (*providers.ApprovalDecision, error) {
	var hookData map[string]any
	if err := json.Unmarshal(payload.Hook, &hookData); err != nil {
		return nil, err
	}

	hookName := extractHookName(hookData)

	// Find session by ID or pane
	sessionID := payload.Meta.ACSessionID
	if sessionID == "" {
		a.sessionsMu.RLock()
		for _, s := range a.sessions {
			if s.PaneID == payload.Meta.TmuxPane {
				sessionID = s.ID
				break
			}
		}
		a.sessionsMu.RUnlock()
	}

	if sessionID == "" {
		log.Printf("Codex hook received but no matching session found for pane %s", payload.Meta.TmuxPane)
		return nil, nil
	}

	approvalRequested := isApprovalHook(hookName, hookData)
	if approvalRequested && a.sessionHasPendingApproval(sessionID) {
		approvalRequested = false
	}
	newStatus := mapCodexHookToStatus(hookName, hookData)
	if approvalRequested && newStatus == "" {
		newStatus = "WAITING_FOR_APPROVAL"
	}

	toolName := extractToolName(hookData)
	a.handleToolHookEvent(sessionID, "codex", hookName, hookData, toolName)
	fallbackCwd := ""
	a.sessionsMu.RLock()
	if session, ok := a.sessions[sessionID]; ok {
		fallbackCwd = session.CWD
	}
	a.sessionsMu.RUnlock()
	a.handleWorkshopHookEvent(sessionID, "codex", hookName, hookData, fallbackCwd)
	eventPayload := map[string]any{
		"session_id": sessionID,
		"event_type": "codex.hook",
		"payload": map[string]any{
			"hook_name": hookName,
			"hook_data": hookData,
		},
	}
	if toolName != "" {
		eventPayload["payload"].(map[string]any)["tool_name"] = toolName
	}
	if usage := extractUsageFromHook(hookData); usage != nil {
		eventPayload["payload"].(map[string]any)["usage"] = usage
	}
	a.wsClient.Send("events.append", eventPayload)

	var approvalID string
	if approvalRequested {
		approvalID = payload.ApprovalID
		if approvalID == "" {
			approvalID = extractApprovalID(hookData)
		}
		if approvalID == "" {
			approvalID = uuid.New().String()
		}
	}

	if newStatus != "" || approvalRequested {
		a.updateSessionFromHook(sessionID, newStatus, buildStatusDetail(newStatus, hookName, hookData, approvalRequested), buildApprovalMetadata(approvalID, hookName, hookData, approvalRequested))
	}

	if approvalRequested {
		approvalType, inputSchema := detectApprovalType(hookName, hookData)
		codexPayload := map[string]any{
			"approval_id":   approvalID,
			"provider":      "codex",
			"reason":        approvalReason(hookName, hookData),
			"details":       buildApprovalDetails(hookName, hookData),
			"approval_type": approvalType,
		}
		if inputSchema != nil {
			codexPayload["input_schema"] = inputSchema
		}
		a.wsClient.Send("events.append", map[string]any{
			"session_id": sessionID,
			"event_type": "approval.requested",
			"payload":    codexPayload,
		})
	}

	return nil, nil
}

func extractHookName(hookData map[string]any) string {
	for _, key := range []string{"hook_event_name", "hookEventName", "hook_name", "event_type", "type", "name"} {
		if val, ok := hookData[key].(string); ok {
			return val
		}
	}
	return ""
}

func extractToolName(hookData map[string]any) string {
	if val, ok := hookData["tool_name"].(string); ok {
		return val
	}
	if val, ok := hookData["tool"].(string); ok {
		return val
	}
	if tool, ok := hookData["tool"].(map[string]any); ok {
		if name, ok := tool["name"].(string); ok {
			return name
		}
	}
	if val, ok := hookData["command"].(string); ok {
		return val
	}
	if val, ok := hookData["action"].(string); ok {
		return val
	}
	return ""
}

func (a *Agent) handleToolHookEvent(sessionID, provider, hookName string, hookData map[string]any, toolName string) {
	if sessionID == "" {
		return
	}

	if toolName == "" {
		toolName = "unknown"
	}
	toolName = strings.TrimSpace(toolName)
	if toolName == "" {
		toolName = "unknown"
	}

	if isToolStartHook(hookName, hookData) {
		input := extractToolInput(hookData)
		a.recordToolEventStart(sessionID, provider, toolName, input)
	}

	if isToolCompleteHook(hookName, hookData) {
		output := extractToolOutput(hookData)
		success := extractToolSuccess(hookData)
		a.recordToolEventComplete(sessionID, provider, toolName, output, success)
	}
}

func isToolStartHook(hookName string, hookData map[string]any) bool {
	lower := strings.ToLower(hookName)
	if strings.Contains(lower, "pretool") || strings.Contains(lower, "tool_start") || strings.Contains(lower, "tool.started") {
		return true
	}
	if val, ok := hookData["event_type"].(string); ok {
		lower = strings.ToLower(val)
		if strings.Contains(lower, "pretool") || strings.Contains(lower, "tool_start") || strings.Contains(lower, "tool.started") {
			return true
		}
	}
	return false
}

func isToolCompleteHook(hookName string, hookData map[string]any) bool {
	lower := strings.ToLower(hookName)
	if strings.Contains(lower, "posttool") || strings.Contains(lower, "tool_complete") || strings.Contains(lower, "tool.completed") {
		return true
	}
	if val, ok := hookData["event_type"].(string); ok {
		lower = strings.ToLower(val)
		if strings.Contains(lower, "posttool") || strings.Contains(lower, "tool_complete") || strings.Contains(lower, "tool.completed") {
			return true
		}
	}
	return false
}

func extractToolInput(hookData map[string]any) map[string]any {
	if val, ok := hookData["tool_input"].(map[string]any); ok {
		return val
	}
	if val, ok := hookData["input"].(map[string]any); ok {
		return val
	}
	if val, ok := hookData["args"].(map[string]any); ok {
		return val
	}
	if val, ok := hookData["prompt"].(string); ok && val != "" {
		return map[string]any{"prompt": val}
	}
	if val, ok := hookData["command"].(string); ok && val != "" {
		return map[string]any{"command": val}
	}
	return nil
}

func extractToolOutput(hookData map[string]any) map[string]any {
	if val, ok := hookData["tool_result"].(map[string]any); ok {
		return val
	}
	if val, ok := hookData["result"].(map[string]any); ok {
		return val
	}
	if val, ok := hookData["output"].(string); ok && val != "" {
		return map[string]any{"output": val}
	}
	return nil
}

func extractToolSuccess(hookData map[string]any) bool {
	if result, ok := hookData["tool_result"].(map[string]any); ok {
		if val, ok := result["success"].(bool); ok {
			return val
		}
		if val, ok := result["is_error"].(bool); ok {
			return !val
		}
		if val, ok := result["error"]; ok && val != nil {
			return false
		}
	}
	if result, ok := hookData["result"].(map[string]any); ok {
		if val, ok := result["success"].(bool); ok {
			return val
		}
		if val, ok := result["is_error"].(bool); ok {
			return !val
		}
		if val, ok := result["error"]; ok && val != nil {
			return false
		}
	}
	return true
}

func extractHookString(hookData map[string]any, keys ...string) string {
	for _, key := range keys {
		if val, ok := hookData[key]; ok {
			if s, ok := val.(string); ok {
				s = strings.TrimSpace(s)
				if s != "" {
					return s
				}
			}
		}
	}
	return ""
}

func extractToolUseID(hookData map[string]any) string {
	return extractHookString(hookData, "tool_use_id", "toolUseId", "tool_use_id", "toolUseID", "tool_use", "toolUse")
}

func extractCWD(hookData map[string]any, fallback string) string {
	if cwd := extractHookString(hookData, "cwd", "workdir", "working_directory"); cwd != "" {
		return cwd
	}
	return fallback
}

func extractUserPrompt(hookData map[string]any) string {
	return extractHookString(hookData, "prompt", "message", "text")
}

func extractStopResponse(hookData map[string]any) string {
	if response := extractHookString(hookData, "response", "assistant_response", "assistant_text", "output"); response != "" {
		return response
	}
	return extractAssistantText(hookData)
}

func extractNotificationDetails(hookData map[string]any) (string, string) {
	if notif, ok := hookData["notification"].(map[string]any); ok {
		ntype := ""
		if val, ok := notif["type"].(string); ok {
			ntype = val
		}
		msg := ""
		if val, ok := notif["message"].(string); ok {
			msg = val
		}
		return ntype, msg
	}
	return "", ""
}

func extractAssistantText(hookData map[string]any) string {
	if text := extractHookString(hookData, "assistant_text", "assistantText", "assistant"); text != "" {
		return text
	}
	transcriptPath := extractHookString(hookData, "transcript_path", "transcriptPath")
	if transcriptPath == "" {
		return ""
	}

	file, err := os.Open(transcriptPath)
	if err != nil {
		return ""
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	lines := make([]string, 0, 128)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line != "" {
			lines = append(lines, line)
		}
	}
	if len(lines) == 0 {
		return ""
	}
	if len(lines) > 120 {
		lines = lines[len(lines)-120:]
	}

	parsed := make([]map[string]any, 0, len(lines))
	for _, line := range lines {
		var entry map[string]any
		if err := json.Unmarshal([]byte(line), &entry); err == nil {
			parsed = append(parsed, entry)
		}
	}
	if len(parsed) == 0 {
		return ""
	}

	lastUser := -1
	for i, entry := range parsed {
		if t, ok := entry["type"].(string); ok && t == "user" {
			lastUser = i
		}
	}
	if lastUser == -1 {
		return ""
	}

	parts := make([]string, 0, 8)
	for i := lastUser + 1; i < len(parsed); i++ {
		entry := parsed[i]
		if t, ok := entry["type"].(string); !ok || t != "assistant" {
			continue
		}
		msg, ok := entry["message"].(map[string]any)
		if !ok {
			continue
		}
		content, ok := msg["content"].([]any)
		if !ok {
			continue
		}
		for _, item := range content {
			entryMap, ok := item.(map[string]any)
			if !ok {
				continue
			}
			if entryMap["type"] != "text" {
				continue
			}
			if text, ok := entryMap["text"].(string); ok {
				text = strings.TrimSpace(text)
				if text != "" {
					parts = append(parts, text)
				}
			}
		}
	}

	return strings.TrimSpace(strings.Join(parts, "\n"))
}

func mapHookToWorkshopEventType(hookName string) string {
	lower := strings.ToLower(strings.TrimSpace(hookName))
	switch {
	case strings.Contains(lower, "pretool"):
		return "pre_tool_use"
	case strings.Contains(lower, "posttool"):
		return "post_tool_use"
	case strings.Contains(lower, "userprompt") || strings.Contains(lower, "promptsubmit"):
		return "user_prompt_submit"
	case lower == "stop":
		return "stop"
	case lower == "notification":
		return "notification"
	case lower == "sessionstart":
		return "session_start"
	case lower == "sessionend":
		return "session_end"
	case lower == "subagentstop":
		return "subagent_stop"
	case lower == "precompact":
		return "pre_compact"
	default:
		return ""
	}
}

func (a *Agent) emitWorkshopEvent(sessionID, eventType string, payload map[string]any) {
	if sessionID == "" || eventType == "" {
		return
	}
	if payload == nil {
		payload = map[string]any{}
	}
	if _, ok := payload["timestamp"]; !ok {
		payload["timestamp"] = time.Now().UnixMilli()
	}
	if _, ok := payload["sessionId"]; !ok {
		payload["sessionId"] = sessionID
	}
	a.wsClient.Send("events.append", map[string]any{
		"session_id": sessionID,
		"event_type": "workshop." + eventType,
		"payload":    payload,
	})
}

func (a *Agent) handleWorkshopHookEvent(sessionID, provider, hookName string, hookData map[string]any, fallbackCwd string) {
	eventType := mapHookToWorkshopEventType(hookName)
	if eventType == "" {
		return
	}

	base := map[string]any{
		"sessionId": sessionID,
		"provider":  provider,
		"cwd":       extractCWD(hookData, fallbackCwd),
		"timestamp": time.Now().UnixMilli(),
	}

	switch eventType {
	case "pre_tool_use":
		toolName := extractToolName(hookData)
		if toolName != "" {
			base["tool"] = toolName
		}
		if input := extractToolInput(hookData); input != nil {
			base["toolInput"] = input
		}
		if toolUseID := extractToolUseID(hookData); toolUseID != "" {
			base["toolUseId"] = toolUseID
		}
		if assistantText := extractAssistantText(hookData); assistantText != "" {
			base["assistantText"] = assistantText
		}
	case "post_tool_use":
		toolName := extractToolName(hookData)
		if toolName != "" {
			base["tool"] = toolName
		}
		if input := extractToolInput(hookData); input != nil {
			base["toolInput"] = input
		}
		if output := extractToolOutput(hookData); output != nil {
			base["toolResponse"] = output
		}
		base["success"] = extractToolSuccess(hookData)
		if toolUseID := extractToolUseID(hookData); toolUseID != "" {
			base["toolUseId"] = toolUseID
		}
	case "user_prompt_submit":
		if prompt := extractUserPrompt(hookData); prompt != "" {
			base["prompt"] = prompt
		}
	case "stop":
		if response := extractStopResponse(hookData); response != "" {
			base["response"] = response
		}
	case "notification":
		ntype, msg := extractNotificationDetails(hookData)
		if ntype != "" {
			base["notificationType"] = ntype
		}
		if msg != "" {
			base["message"] = msg
		}
	case "session_start":
		if source := extractHookString(hookData, "source"); source != "" {
			base["source"] = source
		}
	case "session_end":
		if reason := extractHookString(hookData, "reason"); reason != "" {
			base["reason"] = reason
		}
	case "pre_compact":
		if trigger := extractHookString(hookData, "trigger"); trigger != "" {
			base["trigger"] = trigger
		}
		if instructions := extractHookString(hookData, "custom_instructions"); instructions != "" {
			base["customInstructions"] = instructions
		}
	}

	a.emitWorkshopEvent(sessionID, eventType, base)
}

func (a *Agent) recordToolEventStart(sessionID, provider, toolName string, toolInput map[string]any) {
	eventID := uuid.New().String()
	startedAt := time.Now().UTC()

	key := sessionID + "|" + toolName
	a.toolEventsMu.Lock()
	a.pendingToolEvents[key] = append(a.pendingToolEvents[key], toolEventPending{
		ID:        eventID,
		StartedAt: startedAt,
	})
	a.toolEventsMu.Unlock()

	payload := map[string]any{
		"event_id":   eventID,
		"session_id": sessionID,
		"provider":   provider,
		"tool_name":  toolName,
		"started_at": startedAt.Format(time.RFC3339),
	}
	if toolInput != nil {
		payload["tool_input"] = toolInput
	}
	a.wsClient.Send("tool.event.started", payload)
}

func (a *Agent) recordToolEventComplete(sessionID, provider, toolName string, toolOutput map[string]any, success bool) {
	key := sessionID + "|" + toolName
	var pending toolEventPending
	var ok bool

	a.toolEventsMu.Lock()
	if queue, exists := a.pendingToolEvents[key]; exists && len(queue) > 0 {
		pending = queue[0]
		queue = queue[1:]
		if len(queue) == 0 {
			delete(a.pendingToolEvents, key)
		} else {
			a.pendingToolEvents[key] = queue
		}
		ok = true
	}
	a.toolEventsMu.Unlock()

	completedAt := time.Now().UTC()
	if !ok {
		// Create a synthetic start so the completion has a row to update
		eventID := uuid.New().String()
		payload := map[string]any{
			"event_id":   eventID,
			"session_id": sessionID,
			"provider":   provider,
			"tool_name":  toolName,
			"started_at": completedAt.Format(time.RFC3339),
		}
		a.wsClient.Send("tool.event.started", payload)
		pending = toolEventPending{ID: eventID, StartedAt: completedAt}
	}

	durationMs := completedAt.Sub(pending.StartedAt).Milliseconds()
	if durationMs < 0 {
		durationMs = 0
	}

	payload := map[string]any{
		"event_id":     pending.ID,
		"completed_at": completedAt.Format(time.RFC3339),
		"success":      success,
		"duration_ms":  int(durationMs),
	}
	if toolOutput != nil {
		payload["tool_output"] = toolOutput
	}
	a.wsClient.Send("tool.event.completed", payload)
}

func extractUsageFromHook(hookData map[string]any) map[string]any {
	if usage, ok := hookData["usage"].(map[string]any); ok {
		return usage
	}
	if usage, ok := hookData["token_usage"].(map[string]any); ok {
		return usage
	}
	if result, ok := hookData["tool_result"].(map[string]any); ok {
		if usage, ok := result["usage"].(map[string]any); ok {
			return usage
		}
	}
	if result, ok := hookData["result"].(map[string]any); ok {
		if usage, ok := result["usage"].(map[string]any); ok {
			return usage
		}
	}
	if usage := findUsageMap(hookData); usage != nil {
		return usage
	}
	return nil
}

func findUsageMap(value any) map[string]any {
	switch v := value.(type) {
	case map[string]any:
		if looksLikeUsageMap(v) {
			return v
		}
		for _, child := range v {
			if found := findUsageMap(child); found != nil {
				return found
			}
		}
	case []any:
		for _, child := range v {
			if found := findUsageMap(child); found != nil {
				return found
			}
		}
	}
	return nil
}

func looksLikeUsageMap(m map[string]any) bool {
	for key := range m {
		lower := strings.ToLower(key)
		if strings.Contains(lower, "tokens") || strings.Contains(lower, "token") {
			return true
		}
		if strings.Contains(lower, "cache") {
			return true
		}
	}
	return false
}

func isApprovalHook(hookName string, hookData map[string]any) bool {
	lower := strings.ToLower(hookName)
	if strings.Contains(lower, "permission") || strings.Contains(lower, "approval") || strings.Contains(lower, "plan") {
		return true
	}
	if tool := extractToolName(hookData); tool != "" {
		if strings.Contains(strings.ToLower(tool), "plan") {
			return true
		}
	}
	if notif, ok := hookData["notification"].(map[string]any); ok {
		if t, ok := notif["type"].(string); ok {
			nt := strings.ToLower(t)
			if strings.Contains(nt, "permission") || strings.Contains(nt, "approval") || strings.Contains(nt, "plan") {
				return true
			}
		}
	}
	if val, ok := hookData["permission_request"].(bool); ok && val {
		return true
	}
	if val, ok := hookData["requires_permission"].(bool); ok && val {
		return true
	}
	if val, ok := hookData["requires_approval"].(bool); ok && val {
		return true
	}
	if val, ok := hookData["awaiting_approval"].(bool); ok && val {
		return true
	}
	return false
}

func approvalReason(hookName string, hookData map[string]any) string {
	if reason, ok := hookData["reason"].(string); ok && reason != "" {
		return reason
	}
	if notif, ok := hookData["notification"].(map[string]any); ok {
		if t, ok := notif["type"].(string); ok && t != "" {
			return t
		}
	}
	lower := strings.ToLower(hookName)
	if strings.Contains(lower, "plan") {
		return "Plan Approval"
	}
	if tool := extractToolName(hookData); strings.Contains(strings.ToLower(tool), "plan") {
		return "Plan Approval"
	}
	if strings.Contains(lower, "permission") || strings.Contains(lower, "approval") {
		return "Permission Request"
	}
	if hookName == "" {
		return "Approval Requested"
	}
	return hookName
}

func buildApprovalDetails(hookName string, hookData map[string]any) map[string]any {
	details := map[string]any{
		"hook_name": hookName,
	}
	if tool := extractToolName(hookData); tool != "" {
		details["tool"] = tool
	}
	if input, ok := hookData["input"].(map[string]any); ok {
		details["input"] = input
	}
	if input, ok := hookData["tool_input"].(map[string]any); ok {
		details["input"] = input
	}
	if args, ok := hookData["args"].(map[string]any); ok {
		details["input"] = args
	}
	if notif, ok := hookData["notification"].(map[string]any); ok {
		details["notification"] = notif
	}
	if prompt, ok := hookData["prompt"].(string); ok && prompt != "" {
		details["summary"] = truncateSummary(prompt)
	}
	return details
}

func extractApprovalID(hookData map[string]any) string {
	if val, ok := hookData["approval_id"].(string); ok && val != "" {
		return val
	}
	if val, ok := hookData["approvalId"].(string); ok && val != "" {
		return val
	}
	if approval, ok := hookData["approval"].(map[string]any); ok {
		if id, ok := approval["id"].(string); ok && id != "" {
			return id
		}
	}
	return ""
}

// detectApprovalType determines the approval type and input schema from hook data.
// Returns approval type (binary, text_input, multi_choice, plan_review) and optional input schema.
func detectApprovalType(hookName string, hookData map[string]any) (string, map[string]any) {
	lower := strings.ToLower(hookName)

	// Check for explicit approval_type in hook data
	if at, ok := hookData["approval_type"].(string); ok {
		var schema map[string]any
		if is, ok := hookData["input_schema"].(map[string]any); ok {
			schema = is
		}
		return at, schema
	}

	// Detect plan review type
	if strings.Contains(lower, "plan") || strings.Contains(lower, "planreview") {
		if tabs, ok := hookData["tabs"].([]any); ok && len(tabs) > 0 {
			return "plan_review", map[string]any{
				"type": "plan_review",
				"tabs": tabs,
			}
		}
		// Check for plan content in details
		if content, ok := hookData["plan"].(string); ok && content != "" {
			return "plan_review", map[string]any{
				"type": "plan_review",
				"tabs": []map[string]any{{
					"title":   "Plan",
					"content": content,
				}},
			}
		}
		return "binary", nil
	}

	// Detect text input type
	if strings.Contains(lower, "textinput") || strings.Contains(lower, "text_input") {
		prompt := "Enter your response"
		if p, ok := hookData["prompt"].(string); ok && p != "" {
			prompt = p
		}
		placeholder := ""
		if ph, ok := hookData["placeholder"].(string); ok {
			placeholder = ph
		}
		multiline := false
		if ml, ok := hookData["multiline"].(bool); ok {
			multiline = ml
		}
		return "text_input", map[string]any{
			"type":        "text_input",
			"prompt":      prompt,
			"placeholder": placeholder,
			"multiline":   multiline,
		}
	}

	// Detect multi-choice type
	if options, ok := hookData["options"].([]any); ok && len(options) > 0 {
		var formattedOptions []map[string]any
		for _, opt := range options {
			if optMap, ok := opt.(map[string]any); ok {
				label := ""
				value := ""
				if l, ok := optMap["label"].(string); ok {
					label = l
				}
				if v, ok := optMap["value"].(string); ok {
					value = v
				} else {
					value = label
				}
				if label != "" {
					formattedOptions = append(formattedOptions, map[string]any{
						"label": label,
						"value": value,
					})
				}
			} else if optStr, ok := opt.(string); ok {
				formattedOptions = append(formattedOptions, map[string]any{
					"label": optStr,
					"value": optStr,
				})
			}
		}
		if len(formattedOptions) > 0 {
			allowCustom := false
			if ac, ok := hookData["allow_custom"].(bool); ok {
				allowCustom = ac
			}
			return "multi_choice", map[string]any{
				"type":         "multi_choice",
				"options":      formattedOptions,
				"allow_custom": allowCustom,
			}
		}
	}

	// Default to binary
	return "binary", nil
}

func buildStatusDetail(status, hookName string, hookData map[string]any, approvalRequested bool) string {
	if approvalRequested {
		reason := approvalReason(hookName, hookData)
		tool := extractToolName(hookData)
		if tool != "" {
			return fmt.Sprintf("%s: %s", reason, tool)
		}
		return reason
	}
	if status == "WAITING_FOR_INPUT" {
		if notif, ok := hookData["notification"].(map[string]any); ok {
			if t, ok := notif["type"].(string); ok && t != "" {
				return t
			}
		}
		if hookName != "" {
			return hookName
		}
		return "Input requested"
	}
	return ""
}

func buildApprovalMetadata(approvalID string, hookName string, hookData map[string]any, approvalRequested bool) map[string]any {
	if !approvalRequested {
		return nil
	}
	meta := map[string]any{
		"reason": approvalReason(hookName, hookData),
	}
	if approvalID != "" {
		meta["id"] = approvalID
	}
	if tool := extractToolName(hookData); tool != "" {
		meta["tool"] = tool
	}
	if summary, ok := hookData["summary"].(string); ok && summary != "" {
		meta["summary"] = truncateSummary(summary)
	} else if msg, ok := hookData["message"].(string); ok && msg != "" {
		meta["summary"] = truncateSummary(msg)
	}
	return meta
}

func truncateSummary(value string) string {
	const max = 200
	if len(value) <= max {
		return value
	}
	return value[:max] + "..."
}

func (a *Agent) updateSessionFromHook(sessionID, status, statusDetail string, approvalMeta map[string]any) {
	now := time.Now().UTC()
	var update map[string]any

	a.sessionsMu.Lock()
	if session, ok := a.sessions[sessionID]; ok {
		if status != "" {
			session.Status = status
		}
		if session.Metadata == nil {
			session.Metadata = map[string]any{}
		}
		if status != "" && status != "WAITING_FOR_APPROVAL" && status != "WAITING_FOR_INPUT" {
			session.Metadata["approval"] = nil
			session.Metadata["status_detail"] = nil
		}
		if statusDetail != "" {
			session.Metadata["status_detail"] = statusDetail
		}
		if approvalMeta != nil {
			session.Metadata["approval"] = approvalMeta
		}
		session.LastActivity = now

		update = map[string]any{
			"id":               session.ID,
			"kind":             session.Kind,
			"provider":         session.Provider,
			"status":           session.Status,
			"metadata":         session.Metadata,
			"last_activity_at": now.Format(time.RFC3339),
		}
	}
	a.sessionsMu.Unlock()

	if update != nil {
		a.wsClient.Send("sessions.upsert", map[string]any{
			"sessions": []map[string]any{update},
		})
	}
}

func (a *Agent) sessionHasPendingApproval(sessionID string) bool {
	// Check TTL cache first - if we recently processed a decision for this session,
	// allow new approvals through (prevents race condition where new approval
	// arrives before session metadata is cleared)
	a.recentDecisionsMu.RLock()
	if decisionTime, ok := a.recentDecisions[sessionID]; ok {
		if time.Since(decisionTime) < 5*time.Second {
			a.recentDecisionsMu.RUnlock()
			return false // Recent decision = no pending approval
		}
		// Expired entry will be cleaned up lazily
	}
	a.recentDecisionsMu.RUnlock()

	a.sessionsMu.RLock()
	defer a.sessionsMu.RUnlock()

	session, ok := a.sessions[sessionID]
	if !ok || session.Metadata == nil {
		return false
	}
	if approval, ok := session.Metadata["approval"].(map[string]any); ok {
		if id, ok := approval["id"].(string); ok && id != "" {
			return true
		}
	}
	return false
}

// clearApprovalMetadata clears the approval metadata from a session and adds
// it to the recent decisions cache to prevent race conditions
func (a *Agent) clearApprovalMetadata(sessionID string) {
	now := time.Now()

	// Add to recent decisions cache
	a.recentDecisionsMu.Lock()
	a.recentDecisions[sessionID] = now
	// Clean up old entries while we have the lock
	for id, t := range a.recentDecisions {
		if time.Since(t) > 10*time.Second {
			delete(a.recentDecisions, id)
		}
	}
	a.recentDecisionsMu.Unlock()

	// Clear session metadata and send upsert
	a.sessionsMu.Lock()
	session, exists := a.sessions[sessionID]
	if exists && session.Metadata != nil {
		delete(session.Metadata, "approval")
		if session.Status == "WAITING_FOR_APPROVAL" {
			delete(session.Metadata, "status_detail")
		}
		session.LastActivity = now

		// Send session upsert so control plane clears its copy too
		update := map[string]any{
			"id":               session.ID,
			"kind":             session.Kind,
			"provider":         session.Provider,
			"status":           session.Status,
			"metadata":         session.Metadata,
			"last_activity_at": now.Format(time.RFC3339),
		}
		a.sessionsMu.Unlock()

		a.wsClient.Send("sessions.upsert", map[string]any{
			"sessions": []map[string]any{update},
		})
	} else {
		a.sessionsMu.Unlock()
	}
}

func mapCodexHookToStatus(hookName string, hookData map[string]any) string {
	lower := strings.ToLower(hookName)
	if isApprovalHook(hookName, hookData) {
		return "WAITING_FOR_APPROVAL"
	}
	if strings.Contains(lower, "input") {
		return "WAITING_FOR_INPUT"
	}
	if strings.Contains(lower, "error") || strings.Contains(lower, "failed") {
		return "ERROR"
	}
	if strings.Contains(lower, "start") {
		return "RUNNING"
	}
	if strings.Contains(lower, "complete") || strings.Contains(lower, "finish") {
		return "IDLE"
	}
	return ""
}

func (a *Agent) handleConsoleChunk(subscriptionID, sessionID string, data []byte, offset int64) {
	payload := map[string]any{
		"subscription_id": subscriptionID,
		"session_id":      sessionID,
		"data":            string(data),
		"offset":          offset,
	}
	a.wsClient.Send("console.chunk", payload)
}

func (a *Agent) pollTmux() {
	ticker := time.NewTicker(time.Duration(a.cfg.Tmux.PollIntervalMs) * time.Millisecond)
	defer ticker.Stop()

	for range ticker.C {
		panes, err := a.tmuxClient.ListPanes()
		if err != nil {
			log.Printf("Failed to list tmux panes: %v", err)
			continue
		}

		procSnap := proc.TakeSnapshot()
		a.syncPanes(panes, procSnap)
	}
}

func (a *Agent) syncPanes(panes []tmux.Pane, procSnap *proc.Snapshot) {
	a.sessionsMu.Lock()
	defer a.sessionsMu.Unlock()

	// Track seen pane IDs
	seenPanes := make(map[string]bool)

	var updatedSessions []map[string]any
	var activeSessionIDs []string

	for _, pane := range panes {
		seenPanes[pane.PaneID] = true

		// Get session ID from tmux option
		sessionID, _ := a.tmuxClient.GetPaneOption(pane.PaneID, a.cfg.Tmux.OptionSessionID)
		needsSetOption := false
		unmanaged := false

		if sessionID == "" {
			// Check if we already have an unmanaged session for this pane
			for id, s := range a.sessions {
				if s.PaneID == pane.PaneID && s.Unmanaged {
					sessionID = id
					break
				}
			}

			// Create new unmanaged session
			if sessionID == "" {
				sessionID = uuid.New().String()
				unmanaged = true
			}
			needsSetOption = true
		}

		if needsSetOption {
			if err := a.tmuxClient.SetPaneOption(pane.PaneID, a.cfg.Tmux.OptionSessionID, sessionID); err != nil {
				log.Printf("Failed to set pane session id: %v", err)
			}
		}

		if sessionID != "" {
			activeSessionIDs = append(activeSessionIDs, sessionID)
		}

		provider := detectProviderForPane(pane, procSnap)

		// Get or create session state
		session, exists := a.sessions[sessionID]
		if !exists {
			now := time.Now().UTC()
			session = &SessionState{
				ID:           sessionID,
				PaneID:       pane.PaneID,
				Kind:         "tmux_pane",
				Status:       "IDLE",
				Unmanaged:    unmanaged,
				LastActivity: now,
				LastOutput:   now,
			}
			a.sessions[sessionID] = session
		}

		// Update session state
		session.PaneID = pane.PaneID
		session.Provider = provider
		session.CWD = pane.CurrentPath
		session.TmuxTarget = pane.GetTmuxTarget()
		if session.Metadata == nil {
			session.Metadata = map[string]any{}
		}
		session.Metadata["tmux"] = map[string]any{
			"pane_pid":        pane.PanePID,
			"current_command": pane.CurrentCommand,
			"session_name":    pane.SessionName,
			"window_name":     pane.WindowName,
			"window_index":    pane.WindowIndex,
			"pane_index":      pane.PaneIndex,
		}
		session.Metadata["unmanaged"] = session.Unmanaged

		// Update git info if CWD changed or cache expired
		if session.LastCWD != session.CWD {
			old := session.LastCWD
			session.LastCWD = session.CWD
			if old != "" {
				a.gitCache.Delete(old)
				a.gitStatusCache.Delete(old)
			}
		}
		if gitInfo, ok := a.gitCache.Get(session.CWD); ok {
			session.RepoRoot = gitInfo.RepoRoot
			session.GitBranch = gitInfo.Branch
			session.GitRemote = gitInfo.Remote
		} else if gitInfo := tmux.ResolveGitInfo(session.CWD); gitInfo != nil {
			a.gitCache.Set(session.CWD, gitInfo)
			session.RepoRoot = gitInfo.RepoRoot
			session.GitBranch = gitInfo.Branch
			session.GitRemote = gitInfo.Remote
		} else {
			session.RepoRoot = ""
			session.GitBranch = ""
			session.GitRemote = ""
		}

		// Update git status (porcelain v2) and attach to metadata
		var gitStatus *tmux.GitStatus
		if session.CWD != "" {
			if status, ok := a.gitStatusCache.Get(session.CWD); ok {
				gitStatus = status
			} else if status := tmux.ResolveGitStatus(session.CWD); status != nil {
				a.gitStatusCache.Set(session.CWD, status)
				gitStatus = status
			}
		}
		if gitStatus != nil {
			session.Metadata["git_status"] = map[string]any{
				"branch":     gitStatus.Branch,
				"upstream":   gitStatus.Upstream,
				"ahead":      gitStatus.Ahead,
				"behind":     gitStatus.Behind,
				"staged":     gitStatus.Staged,
				"unstaged":   gitStatus.Unstaged,
				"untracked":  gitStatus.Untracked,
				"unmerged":   gitStatus.Unmerged,
				"updated_at": gitStatus.UpdatedAt.UTC().Format(time.RFC3339),
			}
		} else {
			delete(session.Metadata, "git_status")
		}

		// Derive status for non-hook providers (don't override approvals/errors)
		session.Status = a.deriveStatus(session, pane)

		// Build session update
		update := map[string]any{
			"id":           session.ID,
			"kind":         session.Kind,
			"provider":     session.Provider,
			"status":       session.Status,
			"cwd":          session.CWD,
			"repo_root":    session.RepoRoot,
			"git_branch":   session.GitBranch,
			"git_remote":   session.GitRemote,
			"tmux_pane_id": session.PaneID,
			"tmux_target":  session.TmuxTarget,
			"metadata":     session.Metadata,
		}
		if session.GroupID != "" {
			update["group_id"] = session.GroupID
		}
		if session.ForkedFrom != "" {
			update["forked_from"] = session.ForkedFrom
			update["fork_depth"] = session.ForkDepth
		}
		if !session.LastActivity.IsZero() {
			update["last_activity_at"] = session.LastActivity.UTC().Format(time.RFC3339)
		}

		if session.Title != "" {
			update["title"] = session.Title
		}

		updatedSessions = append(updatedSessions, update)
	}

	// Mark sessions for panes that disappeared as DONE
	var staleIDs []string
	for id, session := range a.sessions {
		if session.Kind == "tmux_pane" && !seenPanes[session.PaneID] {
			session.Status = "DONE"
			session.LastActivity = time.Now().UTC()
			session.PaneID = ""
			session.TmuxTarget = ""
			updatedSessions = append(updatedSessions, map[string]any{
				"id":               id,
				"status":           "DONE",
				"kind":             session.Kind,
				"provider":         session.Provider,
				"tmux_pane_id":     nil,
				"tmux_target":      nil,
				"archived_at":      session.LastActivity.UTC().Format(time.RFC3339),
				"last_activity_at": session.LastActivity.UTC().Format(time.RFC3339),
			})
			staleIDs = append(staleIDs, id)
		}
	}

	// Send sessions upsert
	if len(updatedSessions) > 0 {
		a.wsClient.Send("sessions.upsert", map[string]any{
			"sessions": updatedSessions,
		})
	}

	// Remove stale sessions from memory
	for _, id := range staleIDs {
		delete(a.sessions, id)
		delete(a.snapshotHash, id)
		delete(a.providerUsageHash, id)
		a.usageTracker.RemoveSession(id)
	}

	// Periodically prune sessions on control plane
	if time.Since(a.lastPruneAt) > 5*time.Minute {
		a.lastPruneAt = time.Now().UTC()
		a.wsClient.Send("sessions.prune", map[string]any{
			"session_ids": activeSessionIDs,
		})
	}
}

func (a *Agent) captureSnapshots() {
	ticker := time.NewTicker(time.Duration(a.cfg.Tmux.SnapshotIntervalMs) * time.Millisecond)
	defer ticker.Stop()

	for range ticker.C {
		a.sessionsMu.RLock()
		sessions := make([]*SessionState, 0, len(a.sessions))
		for _, s := range a.sessions {
			if s.Kind == "tmux_pane" && s.Status != "DONE" {
				sessions = append(sessions, s)
			}
		}
		a.sessionsMu.RUnlock()

		for _, session := range sessions {
			text, hash, err := a.tmuxClient.CapturePane(session.PaneID, a.cfg.Tmux.SnapshotLines)
			if err != nil {
				continue
			}

			// Check if hash changed
			if a.snapshotHash[session.ID] == hash {
				continue
			}
			a.snapshotHash[session.ID] = hash
			now := time.Now().UTC()
			a.sessionsMu.Lock()
			if s, ok := a.sessions[session.ID]; ok {
				s.LastOutput = now
				s.LastActivity = now
			}
			a.sessionsMu.Unlock()

			// Send snapshot
			a.wsClient.Send("sessions.snapshot", map[string]any{
				"session_id":   session.ID,
				"capture_hash": hash,
				"capture_text": text,
			})

			// Emit provider usage snapshots for Claude/Codex when /usage output appears.
			a.maybeEmitProviderUsageSnapshot(session, text)

			// Parse and emit session usage if changed
			if sessionUsage := a.usageTracker.ParseAndCheckChanged(session.ID, session.Provider, text); sessionUsage != nil {
				payload := map[string]any{
					"session_id":  session.ID,
					"provider":    sessionUsage.Provider,
					"reported_at": sessionUsage.ReportedAt.Format(time.RFC3339),
				}
				if sessionUsage.InputTokens != nil {
					payload["input_tokens"] = *sessionUsage.InputTokens
				}
				if sessionUsage.OutputTokens != nil {
					payload["output_tokens"] = *sessionUsage.OutputTokens
				}
				if sessionUsage.TotalTokens != nil {
					payload["total_tokens"] = *sessionUsage.TotalTokens
				}
				if sessionUsage.CacheReadTokens != nil {
					payload["cache_read_tokens"] = *sessionUsage.CacheReadTokens
				}
				if sessionUsage.CacheWriteTokens != nil {
					payload["cache_write_tokens"] = *sessionUsage.CacheWriteTokens
				}
				if sessionUsage.CostCents != nil {
					payload["estimated_cost_cents"] = *sessionUsage.CostCents
				}
				if sessionUsage.SessionUtilizationPercent != nil {
					payload["session_utilization_percent"] = *sessionUsage.SessionUtilizationPercent
				}
				if sessionUsage.SessionLeftPercent != nil {
					payload["session_left_percent"] = *sessionUsage.SessionLeftPercent
				}
				if sessionUsage.SessionResetText != nil {
					payload["session_reset_text"] = *sessionUsage.SessionResetText
				}
				if sessionUsage.WeeklyUtilizationPercent != nil {
					payload["weekly_utilization_percent"] = *sessionUsage.WeeklyUtilizationPercent
				}
				if sessionUsage.WeeklyLeftPercent != nil {
					payload["weekly_left_percent"] = *sessionUsage.WeeklyLeftPercent
				}
				if sessionUsage.WeeklyResetText != nil {
					payload["weekly_reset_text"] = *sessionUsage.WeeklyResetText
				}
				if sessionUsage.WeeklySonnetUtilizationPercent != nil {
					payload["weekly_sonnet_utilization_percent"] = *sessionUsage.WeeklySonnetUtilizationPercent
				}
				if sessionUsage.WeeklySonnetResetText != nil {
					payload["weekly_sonnet_reset_text"] = *sessionUsage.WeeklySonnetResetText
				}
				if sessionUsage.WeeklyOpusUtilizationPercent != nil {
					payload["weekly_opus_utilization_percent"] = *sessionUsage.WeeklyOpusUtilizationPercent
				}
				if sessionUsage.WeeklyOpusResetText != nil {
					payload["weekly_opus_reset_text"] = *sessionUsage.WeeklyOpusResetText
				}
				if sessionUsage.ContextUsedTokens != nil {
					payload["context_used_tokens"] = *sessionUsage.ContextUsedTokens
				}
				if sessionUsage.ContextTotalTokens != nil {
					payload["context_total_tokens"] = *sessionUsage.ContextTotalTokens
				}
				if sessionUsage.ContextLeftPercent != nil {
					payload["context_left_percent"] = *sessionUsage.ContextLeftPercent
				}
				if sessionUsage.FiveHourLeftPercent != nil {
					payload["five_hour_left_percent"] = *sessionUsage.FiveHourLeftPercent
				}
				if sessionUsage.FiveHourResetText != nil {
					payload["five_hour_reset_text"] = *sessionUsage.FiveHourResetText
				}
				if sessionUsage.DailyUtilizationPercent != nil {
					payload["daily_utilization_percent"] = *sessionUsage.DailyUtilizationPercent
				}
				if sessionUsage.DailyLeftPercent != nil {
					payload["daily_left_percent"] = *sessionUsage.DailyLeftPercent
				}
				if sessionUsage.DailyResetHours != nil {
					payload["daily_reset_hours"] = *sessionUsage.DailyResetHours
				}
				if sessionUsage.RawLine != "" {
					payload["raw_usage_line"] = sessionUsage.RawLine
				}
				a.wsClient.Send("session.usage", payload)

				// Gemini: also emit provider usage with model details (account scope).
				if sessionUsage.Provider == "gemini_cli" {
					models := usage.ParseGeminiModels(text)
					modelPayload := map[string]any{}
					minResetHours := 0
					for name, model := range models {
						modelPayload[name] = map[string]any{
							"usage_left":  model.UsageLeft,
							"reset_hours": model.ResetHours,
						}
						if minResetHours == 0 || model.ResetHours < minResetHours {
							minResetHours = model.ResetHours
						}
					}

					providerPayload := map[string]any{
						"provider":    sessionUsage.Provider,
						"scope":       "account",
						"host_id":     a.cfg.Host.ID,
						"reported_at": sessionUsage.ReportedAt.Format(time.RFC3339),
					}

					if len(modelPayload) > 0 {
						providerPayload["raw_json"] = map[string]any{
							"models": modelPayload,
						}
					}

					if sessionUsage.DailyUtilizationPercent != nil {
						providerPayload["daily_utilization"] = *sessionUsage.DailyUtilizationPercent
					}

					resetHours := minResetHours
					if sessionUsage.DailyResetHours != nil {
						resetHours = *sessionUsage.DailyResetHours
					}
					if resetHours > 0 {
						resetAt := sessionUsage.ReportedAt.Add(time.Duration(resetHours) * time.Hour).UTC().Format(time.RFC3339)
						providerPayload["daily_reset_at"] = resetAt
					}

					_ = a.wsClient.Send("provider.usage", providerPayload)
				}
			}
		}
	}
}

func (a *Agent) maybeEmitProviderUsageSnapshot(session *SessionState, text string) {
	if session.Provider != "claude_code" && session.Provider != "codex" {
		return
	}
	normalized := extractUsageSnapshot(text)
	if normalized == "" {
		return
	}

	parsed := parseProviderUsageText(session.Provider, normalized)
	if len(parsed) == 0 {
		return
	}

	usageHash := hashString(normalized)
	if last, ok := a.providerUsageHash[session.ID]; ok && last == usageHash {
		return
	}
	a.providerUsageHash[session.ID] = usageHash

	providerPayload := map[string]any{
		"provider":    session.Provider,
		"scope":       "account",
		"host_id":     a.cfg.Host.ID,
		"reported_at": time.Now().UTC().Format(time.RFC3339),
		"raw_text":    normalized,
		"raw_json": map[string]any{
			"source":  "snapshot",
			"entries": parsed,
		},
	}

	fields := extractUsageFields(nil, normalized)
	for k, v := range fields {
		providerPayload[k] = v
	}

	_ = a.wsClient.Send("provider.usage", providerPayload)
}

func extractUsageSnapshot(text string) string {
	cleaned := stripANSI(text)
	lower := strings.ToLower(cleaned)
	start := strings.Index(lower, "current session")
	if start < 0 {
		start = strings.Index(lower, "current week")
	}
	if start < 0 {
		start = strings.Index(lower, "extra usage")
	}
	if start < 0 {
		return ""
	}
	end := strings.Index(lower[start:], "esc to cancel")
	if end >= 0 {
		end = start + end
	} else {
		end = len(cleaned)
	}
	return strings.TrimSpace(cleaned[start:end])
}

func hashString(value string) string {
	if value == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(value))
	return fmt.Sprintf("%x", sum)
}

// Terminal handlers

func (a *Agent) handleTerminalAttach(payload json.RawMessage) {
	var req struct {
		ChannelID string `json:"channel_id"`
		PaneID    string `json:"pane_id"`
		SessionID string `json:"session_id"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		log.Printf("Failed to parse terminal.attach: %v", err)
		return
	}

	fifoPath, first, err := a.terminalManager.Attach(req.ChannelID, req.PaneID, req.SessionID)
	if err != nil {
		log.Printf("Failed to attach terminal: %v", err)
		a.wsClient.Send("terminal.error", map[string]any{
			"channel_id": req.ChannelID,
			"message":    err.Error(),
		})
		return
	}

	// Check if using PTY mode (fifoPath is empty in PTY mode)
	isPTYMode := fifoPath == ""

	// If using FIFO mode and this is the first viewer, enable terminal output in pipe mux
	if !isPTYMode && first {
		if err := a.pipeMux.SetTerminal(req.PaneID, fifoPath, true); err != nil {
			log.Printf("Failed to enable terminal output: %v", err)
			a.wsClient.Send("terminal.error", map[string]any{
				"channel_id": req.ChannelID,
				"message":    err.Error(),
			})
			_, _ = a.terminalManager.Detach(req.ChannelID)
			return
		}
	}

	// For FIFO mode, send initial visible content so the terminal isn't blank on attach.
	// In PTY mode, the tmux attach will provide the terminal content directly.
	if !isPTYMode {
		if text, err := a.tmuxClient.CapturePaneRange(req.PaneID, tmux.CapturePaneOptions{
			Mode: tmux.CaptureModeVisible,
		}); err != nil {
			log.Printf("Failed to capture pane for terminal attach: %v", err)
		} else if text != "" {
			a.handleTerminalOutput(req.ChannelID, []byte(text))
		}
	}

	log.Printf("Terminal attached: channel=%s pane=%s mode=%s", req.ChannelID, req.PaneID, map[bool]string{true: "PTY", false: "FIFO"}[isPTYMode])
}

func (a *Agent) handleTerminalInput(payload json.RawMessage) {
	var req struct {
		ChannelID string `json:"channel_id"`
		Data      string `json:"data"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		log.Printf("Failed to parse terminal.input: %v", err)
		return
	}

	if err := a.terminalManager.SendInput(req.ChannelID, req.Data); err != nil {
		if errors.Is(err, tmux.ErrReadOnly) {
			a.handleTerminalStatus(req.ChannelID, "readonly", "Read-only: another viewer has control")
			return
		}
		log.Printf("Failed to send terminal input: %v", err)
	}
}

func (a *Agent) handleTerminalResize(payload json.RawMessage) {
	var req struct {
		ChannelID string `json:"channel_id"`
		Cols      int    `json:"cols"`
		Rows      int    `json:"rows"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		log.Printf("Failed to parse terminal.resize: %v", err)
		return
	}

	if err := a.terminalManager.Resize(req.ChannelID, req.Cols, req.Rows); err != nil {
		log.Printf("Failed to resize terminal: %v", err)
	}
}

func (a *Agent) handleTerminalControl(payload json.RawMessage) {
	var req struct {
		ChannelID string `json:"channel_id"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		log.Printf("Failed to parse terminal.control: %v", err)
		return
	}

	if err := a.terminalManager.TakeControl(req.ChannelID); err != nil {
		log.Printf("Failed to take terminal control: %v", err)
		a.handleTerminalStatus(req.ChannelID, "error", err.Error())
	}
}

func (a *Agent) handleTerminalDetach(payload json.RawMessage) {
	var req struct {
		ChannelID string `json:"channel_id"`
	}
	if err := json.Unmarshal(payload, &req); err != nil {
		log.Printf("Failed to parse terminal.detach: %v", err)
		return
	}

	// Check if using PTY mode before detaching
	isPTYMode := a.terminalManager.IsPTYMode(req.ChannelID)

	paneID, last := a.terminalManager.Detach(req.ChannelID)

	// Only disable pipe-pane for FIFO mode
	if !isPTYMode && last && paneID != "" {
		_ = a.pipeMux.SetTerminal(paneID, "", false)
	}
}

func (a *Agent) handleTerminalOutput(channelID string, data []byte) {
	a.wsClient.Send("terminal.output", map[string]any{
		"channel_id": channelID,
		"encoding":   "base64",
		"data":       base64.StdEncoding.EncodeToString(data),
	})
}

func (a *Agent) handleTerminalStatus(channelID, status, message string) {
	msgType := "terminal." + status
	payload := map[string]any{
		"channel_id": channelID,
	}
	if message != "" {
		payload["message"] = message
	}
	a.wsClient.Send(msgType, payload)
}
