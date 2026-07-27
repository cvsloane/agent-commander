package main

import (
	"bufio"
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
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode/utf8"

	"github.com/agent-command/agentd/internal/commands"
	"github.com/agent-command/agentd/internal/config"
	"github.com/agent-command/agentd/internal/console"
	"github.com/agent-command/agentd/internal/metrics"
	"github.com/agent-command/agentd/internal/orchestrator"
	"github.com/agent-command/agentd/internal/proc"
	"github.com/agent-command/agentd/internal/protocol"
	"github.com/agent-command/agentd/internal/providers"
	"github.com/agent-command/agentd/internal/providerusage"
	"github.com/agent-command/agentd/internal/queue"
	"github.com/agent-command/agentd/internal/tmux"
	"github.com/agent-command/agentd/internal/usage"
	"github.com/agent-command/agentd/internal/ws"
	"github.com/google/uuid"
)

type Agent struct {
	cfg              *config.Config
	wsClient         *ws.Client
	tmuxClient       *tmux.Client
	gitCache         *tmux.GitCache
	gitStatusCache   *tmux.GitStatusCache
	claudeProvider   *providers.ClaudeProvider
	streamer         *console.Streamer
	terminalManager  *tmux.TerminalManager
	pipeMux          *tmux.PipeMux
	tmuxHooks        *tmux.HookManager
	lastPruneAt      time.Time
	orchestratorTmux TmuxRunner
	sendMessage      func(string, any) error
	topologyMu       sync.Mutex

	// Session state
	sessions             map[string]*SessionState
	sessionsMu           sync.RWMutex
	transcriptPaths      map[string]string
	claudeProjectsRoot   string
	snapshotHash         map[string]string
	toolEventsMu         sync.Mutex
	pendingToolEvents    map[string][]toolEventPending
	bufferedHooksMu      sync.Mutex
	bufferedHooks        []bufferedHook
	capturePaneSnapshots capturePaneSnapshotCache

	// Approval lifecycle - TTL cache to prevent race conditions
	recentDecisions   map[string]time.Time
	recentDecisionsMu sync.RWMutex

	// Session usage tracking (parsed from console output)
	usageTracker *usage.UsageTracker

	// Snapshot-derived provider usage (avoid duplicate emits)
	providerUsageHash map[string]string
	launchTemplates   *providers.LaunchTemplates

	commandExecutor *commands.Executor

	tmuxTopologyMu          sync.Mutex
	tmuxTopologyTimer       *time.Timer
	pendingTmuxTopology     *protocol.TmuxTopologyPayload
	pendingTmuxTopologyHash string
	lastTmuxTopologyHash    string
	tmuxTopologyGeneration  uint64
	tmuxTopologyStopped     bool
}

type toolEventPending struct {
	ID        string
	StartedAt time.Time
}

type bufferedHook struct {
	Provider   string
	Payload    providers.ClaudeHookPayload
	BufferedAt time.Time
}

type memoryFileSpec = protocol.SpawnSessionMemoryFile

type SessionState struct {
	ID              string
	PaneID          string
	Kind            string
	Provider        string
	Status          string
	Title           string
	CWD             string
	RepoRoot        string
	GitBranch       string
	GitRemote       string
	TmuxTarget      string
	GroupID         string
	ForkedFrom      string
	ForkDepth       int
	ParentSessionID string
	Ready           bool
	Metadata        map[string]any
	LastActivity    time.Time
	LastOutput      time.Time
	LastStatsAt     time.Time
	LastUsageAt     time.Time
	Unmanaged       bool
	LastCWD         string // Track CWD changes
}

func cloneJSONMap(value map[string]any) map[string]any {
	if value == nil {
		return nil
	}
	data, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	var clone map[string]any
	if err := json.Unmarshal(data, &clone); err != nil {
		return nil
	}
	return clone
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

// Version is overridden at build time with -ldflags "-X main.Version=<version>".
var Version = "dev"

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
		// Session identity is included in the list-panes format.
		sessionID := pane.SessionID
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
		transcriptPaths:   make(map[string]string),
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
	a.wsClient.SetOnDisconnect(func() {
		if a.terminalManager != nil {
			a.terminalManager.MarkChannelsStale()
		}
	})
	a.wsClient.SetOnConnect(func() {
		if err := a.sendHello(); err != nil {
			log.Printf("Failed to send hello: %v", err)
			return
		}
		if err := a.wsClient.ResendQueued(); err != nil {
			log.Printf("Failed to replay outbound queue: %v", err)
		}
	})

	// Initialize outbound queue
	outboundQueue, err := queue.NewQueue(a.cfg.Storage.StateDir, a.cfg.Storage.OutboundQueueMax)
	if err != nil {
		return fmt.Errorf("failed to initialize outbound queue: %w", err)
	}
	defer outboundQueue.Close()
	a.wsClient.SetQueue(outboundQueue, a.cfg.Storage.StateDir)
	lastAcked, err := queue.LoadAckedSeq(a.cfg.Storage.StateDir)
	if err != nil {
		return fmt.Errorf("failed to load acknowledged sequence: %w", err)
	}
	if err := outboundQueue.PruneAcked(lastAcked); err != nil {
		return fmt.Errorf("failed to prune acknowledged queue entries: %w", err)
	}
	if _, err := outboundQueue.RebaseAbove(max(lastAcked, 1)); err != nil {
		return fmt.Errorf("failed to reserve hello sequence: %w", err)
	}
	a.wsClient.SetLastAckedSeq(lastAcked)

	a.commandExecutor = commands.NewExecutor(4, a.executeCommand, func(result commands.Result) {
		a.send(protocol.TypeCommandsResult, result)
	})
	a.launchTemplates = providers.NewLaunchTemplates(a.cfg)

	// Initialize Claude provider
	a.claudeProvider = providers.NewClaudeProvider(&a.cfg.Providers.Claude)
	a.claudeProvider.SetHookHandler(a.handleClaudeHook)
	a.claudeProvider.SetCodexHookHandler(a.handleCodexHook)
	a.claudeProvider.SetOrchestratorHandler(orchestrator.NewHandler(&agentOrchestratorBackend{agent: a}))

	// Initialize console streamer
	a.streamer, err = console.NewStreamer(a.cfg.Storage.StateDir + "/console")
	if err != nil {
		return fmt.Errorf("failed to create console streamer: %w", err)
	}
	a.streamer.SetHandler(a.handleConsoleChunk)

	// Initialize terminal manager
	a.terminalManager = tmux.NewTerminalManager(a.tmuxClient, a.cfg.Storage.StateDir)
	a.terminalManager.SetPerViewerPTY(a.cfg.Terminal.PerViewerPTY)
	a.terminalManager.SetOutputHandler(a.handleTerminalOutput)
	a.terminalManager.SetStatusHandler(a.handleTerminalStatus)
	a.terminalManager.SetAuditHandler(a.handleTerminalAudit)
	a.terminalManager.Start()

	// Initialize pipe mux for console + terminal output
	a.pipeMux = tmux.NewPipeMux(a.tmuxClient, a.cfg.Storage.StateDir+"/console")

	// Register additive topology hooks when the host tmux supports them. The
	// reconciliation poll remains active as the fallback and correctness pass.
	// Skipped entirely while topology events are disabled: hooks would mutate
	// the user's tmux server and trigger ListPanes for events that get dropped.
	if a.cfg.Tmux.TopologyEvents {
		a.tmuxHooks, err = a.tmuxClient.StartTopologyHooks(a.handleTmuxTopologyHook)
		if err != nil {
			log.Printf("tmux hooks unavailable; using poll-only topology: %v", err)
		} else {
			defer a.tmuxHooks.Close()
			log.Printf("tmux topology hooks active")
		}
	}

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
	if a.commandExecutor != nil {
		a.commandExecutor.Close()
	}
	if a.terminalManager != nil {
		a.terminalManager.Close()
	}
	if a.tmuxHooks != nil {
		a.tmuxHooks.Close()
	}
	a.stopTmuxTopology()
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

	output, err := providerusage.RunUsageCommand(command)
	if err != nil {
		log.Printf("Provider usage command failed (%s): %v", provider, err)
	}

	raw := strings.TrimSpace(string(output))
	if provider == "claude_code" {
		raw = strings.TrimSpace(providerusage.MaybeRetryClaudeUsage(command, raw))
	}
	if raw == "" {
		return
	}

	cleanedText := providerusage.StripANSI(raw)

	var rawJSON map[string]any
	if parseJSON || providerusage.LooksLikeJSON(raw) {
		var decoded any
		if err := json.Unmarshal([]byte(raw), &decoded); err == nil {
			if obj, ok := decoded.(map[string]any); ok {
				rawJSON = obj
			} else {
				rawJSON = map[string]any{"data": decoded}
			}
		}
	}

	fields := providerusage.ExtractUsageFields(rawJSON, cleanedText)
	scope := "account"

	payload := protocol.ProviderUsagePayload{
		Provider:   provider,
		Scope:      scope,
		HostID:     a.cfg.Host.ID,
		ReportedAt: time.Now().UTC().Format(time.RFC3339),
		RawText:    raw,
	}
	parsed := providerusage.ParseProviderUsageText(provider, cleanedText)
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
		payload.RawJSON = rawJSON
	}
	if data, marshalErr := json.Marshal(fields); marshalErr == nil {
		if unmarshalErr := json.Unmarshal(data, &payload); unmarshalErr != nil {
			log.Printf("Failed to apply provider usage fields (%s): %v", provider, unmarshalErr)
		}
	}

	_ = a.send(protocol.TypeProviderUsage, payload)
}

func (a *Agent) sendHello() error {
	providers := a.providerAvailabilityMap()

	payload := protocol.AgentHelloPayload{
		Host: protocol.AgentHostInfo{
			ID:           a.cfg.Host.ID,
			Name:         a.cfg.Host.Name,
			AgentVersion: Version,
			Capabilities: protocol.HostCapabilities{
				Tmux:          true,
				Spawn:         a.cfg.Security.AllowSpawn,
				Kill:          a.cfg.Security.AllowKill,
				ConsoleStream: a.cfg.Security.AllowConsoleStream,
				Terminal:      true,
				ClaudeHooks:   true,
				CodexExecJSON: true,
				Providers:     providers,
			},
		},
		Resume: &protocol.AgentResume{LastAckedSeq: a.wsClient.GetLastAckedSeq()},
	}

	return a.wsClient.SendHello(payload)
}

func (a *Agent) send(msgType string, payload any) error {
	var err error
	if a.sendMessage != nil {
		err = a.sendMessage(msgType, payload)
	} else if msgType == protocol.TypeTmuxTopology ||
		msgType == protocol.TypeTerminalNavigationResult ||
		msgType == protocol.TypeTerminalAttached ||
		msgType == protocol.TypeTerminalDetached ||
		msgType == protocol.TypeTerminalError ||
		msgType == protocol.TypeTerminalReadOnly ||
		msgType == protocol.TypeTerminalControl ||
		msgType == protocol.TypeTerminalLag {
		err = a.wsClient.SendUnsequenced(msgType, payload)
	} else {
		err = a.wsClient.Send(msgType, payload)
	}
	if err != nil {
		metrics.RecordMessageDrop(msgType)
		log.Printf("Failed to send %s: %v", msgType, err)
	}
	return err
}

func (a *Agent) providerAvailabilityMap() map[string]bool {
	return map[string]bool{
		"claude_code": providerCommandAvailable(a.cfg, "claude_code"),
		"codex":       providerCommandAvailable(a.cfg, "codex"),
		"gemini_cli":  providerCommandAvailable(a.cfg, "gemini_cli"),
		"opencode":    providerCommandAvailable(a.cfg, "opencode"),
		"cursor":      providerCommandAvailable(a.cfg, "cursor"),
		"aider":       providerCommandAvailable(a.cfg, "aider"),
		"continue":    providerCommandAvailable(a.cfg, "continue"),
		"shell":       true,
	}
}

func providerCommandAvailable(cfg *config.Config, provider string) bool {
	if provider == "shell" {
		return true
	}
	spec, err := providers.NewLaunchTemplates(cfg).Interactive(provider, nil, nil)
	if err != nil || len(spec.Argv) == 0 {
		return false
	}
	return commandAvailable(spec.Argv[0])
}

func commandAvailable(candidates ...string) bool {
	for _, candidate := range candidates {
		if strings.TrimSpace(candidate) == "" {
			continue
		}
		if filepath.IsAbs(candidate) {
			if _, err := os.Stat(candidate); err == nil {
				return true
			}
			continue
		}
		if _, err := exec.LookPath(candidate); err == nil {
			return true
		}
		for _, prefix := range []string{"/usr/local/bin", "/usr/bin", "/bin", filepath.Join(os.Getenv("HOME"), ".local", "bin")} {
			if strings.TrimSpace(prefix) == "" {
				continue
			}
			if _, err := os.Stat(filepath.Join(prefix, candidate)); err == nil {
				return true
			}
		}
	}
	if len(candidates) == 0 {
		return false
	}
	return false
}

func writeMemoryFiles(workingDirectory string, files []memoryFileSpec) error {
	if len(files) == 0 {
		return nil
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		return err
	}

	for _, file := range files {
		var root string
		switch file.BaseDir {
		case "home":
			root = homeDir
		case "working_directory", "local", "":
			root = workingDirectory
		default:
			return fmt.Errorf("unsupported memory file base_dir: %s", file.BaseDir)
		}
		if strings.TrimSpace(root) == "" {
			return fmt.Errorf("memory file root is empty")
		}
		if strings.TrimSpace(file.RelativePath) == "" {
			return fmt.Errorf("memory file relative_path is required")
		}
		if filepath.IsAbs(file.RelativePath) {
			return fmt.Errorf("memory file path must be relative: %s", file.RelativePath)
		}

		target := filepath.Clean(filepath.Join(root, file.RelativePath))
		rel, err := filepath.Rel(root, target)
		if err != nil {
			return err
		}
		if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return fmt.Errorf("memory file escapes root: %s", file.RelativePath)
		}

		if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			return err
		}

		existing, err := os.ReadFile(target)
		if err == nil && string(existing) == file.Content {
			continue
		}
		if err := os.WriteFile(target, []byte(file.Content), 0644); err != nil {
			return err
		}
	}

	return nil
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
	case "terminal.navigate":
		a.handleTerminalNavigate(payload)
	case "terminal.control":
		a.handleTerminalControl(payload)
	case "terminal.detach":
		a.handleTerminalDetach(payload)
	}
}

func (a *Agent) handleCommandDispatch(payload json.RawMessage) {
	var cmd commands.Dispatch
	if err := json.Unmarshal(payload, &cmd); err != nil {
		log.Printf("Failed to parse command: %v", err)
		return
	}
	if a.commandExecutor == nil {
		log.Printf("Command executor is not initialized (cmd_id=%s)", cmd.CmdID)
		return
	}
	if err := a.commandExecutor.Submit(cmd); err != nil {
		log.Printf("Failed to queue command %s: %v", cmd.CmdID, err)
	}
}

func (a *Agent) executeCommand(cmd commands.Dispatch) (map[string]any, error) {
	// Get session when required
	var session *SessionState
	a.sessionsMu.RLock()
	session, exists := a.sessions[cmd.SessionID]
	if exists && cmd.Command.Type == "capture_pane" {
		// Full capture can outlive a topology refresh. Keep its tmux target and
		// cache binding on the same immutable session identity.
		session = &SessionState{ID: session.ID, PaneID: session.PaneID}
	}
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
	case "new_window":
		if !exists {
			err = fmt.Errorf("session not found")
			break
		}
		resultPayload, err = a.executeNewWindow(session, cmd.Command.Payload)
	case "rename_window":
		if !exists {
			err = fmt.Errorf("session not found")
			break
		}
		err = a.executeRenameWindow(session, cmd.Command.Payload)
	case "kill_window":
		if !exists {
			err = fmt.Errorf("session not found")
			break
		}
		err = a.executeKillWindow(session, cmd.Command.Payload)
	case "select_window":
		if !exists {
			err = fmt.Errorf("session not found")
			break
		}
		err = a.executeSelectWindow(session, cmd.Command.Payload)
	case "split_pane":
		if !exists {
			err = fmt.Errorf("session not found")
			break
		}
		resultPayload, err = a.executeSplitPane(session, cmd.Command.Payload)
	case "select_pane":
		if !exists {
			err = fmt.Errorf("session not found")
			break
		}
		err = a.executeSelectPane(session, cmd.Command.Payload)
	case "resize_pane":
		if !exists {
			err = fmt.Errorf("session not found")
			break
		}
		err = a.executeResizePane(session, cmd.Command.Payload)
	case "zoom_pane":
		if !exists {
			err = fmt.Errorf("session not found")
			break
		}
		err = a.executeZoomPane(session, cmd.Command.Payload)
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
		resultPayload, err = a.executeCapturePaneCommand(session, cmd.Command.Payload)
	case "capture_transcript":
		if !exists {
			err = fmt.Errorf("session not found")
			break
		}
		resultPayload, err = a.executeCaptureTranscriptCommand(session, cmd.Command.Payload)
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
	return resultPayload, err
}

func (a *Agent) handleMCPList(payload json.RawMessage) {
	var req protocol.MCPListServersPayload
	if err := json.Unmarshal(payload, &req); err != nil {
		log.Printf("Failed to parse mcp.list_servers: %v", err)
		return
	}

	a.send(protocol.TypeMCPServers, protocol.MCPServersPayload{
		CmdID:      req.CmdID,
		Servers:    []protocol.MCPServer{},
		PoolConfig: protocol.MCPPoolConfig{},
	})
}

func (a *Agent) handleMCPGetConfig(payload json.RawMessage) {
	var req protocol.MCPGetConfigPayload
	if err := json.Unmarshal(payload, &req); err != nil {
		log.Printf("Failed to parse mcp.get_config: %v", err)
		return
	}

	a.send(protocol.TypeMCPConfig, protocol.MCPConfigPayload{
		CmdID:      req.CmdID,
		SessionID:  req.SessionID,
		Servers:    []protocol.MCPServer{},
		Enablement: map[string]protocol.MCPEnablement{},
	})
}

func (a *Agent) handleMCPUpdateConfig(payload json.RawMessage) {
	var req protocol.MCPUpdateConfigPayload
	if err := json.Unmarshal(payload, &req); err != nil {
		log.Printf("Failed to parse mcp.update_config: %v", err)
		return
	}

	a.send(protocol.TypeMCPUpdateResult, protocol.MCPUpdateResultPayload{
		CmdID: req.CmdID,
		Error: "MCP configuration not supported on this agent",
	})
}

func (a *Agent) handleMCPGetProjectConfig(payload json.RawMessage) {
	var req protocol.MCPGetProjectConfigPayload
	if err := json.Unmarshal(payload, &req); err != nil {
		log.Printf("Failed to parse mcp.get_project_config: %v", err)
		return
	}

	a.send(protocol.TypeMCPProjectConfig, protocol.MCPProjectConfigPayload{
		CmdID:      req.CmdID,
		Enablement: map[string]protocol.MCPEnablement{},
	})
}

func (a *Agent) handleMCPUpdateProjectConfig(payload json.RawMessage) {
	var req protocol.MCPUpdateProjectConfigPayload
	if err := json.Unmarshal(payload, &req); err != nil {
		log.Printf("Failed to parse mcp.update_project_config: %v", err)
		return
	}

	a.send(protocol.TypeMCPUpdateResult, protocol.MCPUpdateResultPayload{
		CmdID: req.CmdID,
		Error: "MCP configuration not supported on this agent",
	})
}

func (a *Agent) executeSendInput(session *SessionState, payload json.RawMessage) error {
	if !a.cfg.Security.AllowSendInput {
		return fmt.Errorf("send_input not allowed by policy")
	}

	var p protocol.SendInputPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}

	return a.sendInputSmart(session.PaneID, p.Text, p.Enter)
}

func (a *Agent) executeSendKeys(session *SessionState, payload json.RawMessage) error {
	if !a.cfg.Security.AllowSendInput {
		return fmt.Errorf("send_keys not allowed by policy")
	}

	var p protocol.SendKeysPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}

	return a.tmuxClient.SendKeys(session.PaneID, p.Keys)
}

func (a *Agent) executeNewWindow(session *SessionState, payload json.RawMessage) (map[string]any, error) {
	if !a.cfg.Security.AllowSpawn {
		return nil, fmt.Errorf("new_window not allowed by policy")
	}
	var p protocol.NewWindowPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return nil, err
	}
	tmuxSession := tmuxSessionFromTarget(session.TmuxTarget)
	if tmuxSession == "" {
		return nil, fmt.Errorf("session has no tmux target")
	}

	a.topologyMu.Lock()
	defer a.topologyMu.Unlock()
	paneID, err := a.tmuxClient.NewWindow(tmuxSession, p.WindowName, p.CWD)
	if err != nil {
		return nil, err
	}
	return map[string]any{"pane_id": paneID}, nil
}

func (a *Agent) executeRenameWindow(session *SessionState, payload json.RawMessage) error {
	if !a.cfg.Security.AllowSendInput {
		return fmt.Errorf("rename_window not allowed by policy")
	}
	var p protocol.RenameWindowPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	if p.WindowIndex == nil || *p.WindowIndex < 0 {
		return fmt.Errorf("window_index is required")
	}
	if strings.TrimSpace(p.Name) == "" {
		return fmt.Errorf("name is required")
	}
	target, err := tmuxWindowTarget(session, *p.WindowIndex)
	if err != nil {
		return err
	}

	a.topologyMu.Lock()
	defer a.topologyMu.Unlock()
	return a.tmuxClient.RenameWindow(target, p.Name)
}

func (a *Agent) executeKillWindow(session *SessionState, payload json.RawMessage) error {
	if !a.cfg.Security.AllowKill {
		return fmt.Errorf("kill_window not allowed by policy")
	}
	var p protocol.KillWindowPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	if p.WindowIndex == nil || *p.WindowIndex < 0 {
		return fmt.Errorf("window_index is required")
	}
	target, err := tmuxWindowTarget(session, *p.WindowIndex)
	if err != nil {
		return err
	}

	a.topologyMu.Lock()
	defer a.topologyMu.Unlock()
	return a.tmuxClient.KillWindow(target)
}

func (a *Agent) executeSelectWindow(session *SessionState, payload json.RawMessage) error {
	if !a.cfg.Security.AllowSendInput {
		return fmt.Errorf("select_window not allowed by policy")
	}
	var p protocol.SelectWindowPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	if p.WindowIndex == nil || *p.WindowIndex < 0 {
		return fmt.Errorf("window_index is required")
	}
	target, err := tmuxWindowTarget(session, *p.WindowIndex)
	if err != nil {
		return err
	}

	a.topologyMu.Lock()
	defer a.topologyMu.Unlock()
	return a.tmuxClient.SelectWindow(target)
}

func (a *Agent) executeSplitPane(session *SessionState, payload json.RawMessage) (map[string]any, error) {
	if !a.cfg.Security.AllowSpawn {
		return nil, fmt.Errorf("split_pane not allowed by policy")
	}
	var p protocol.SplitPanePayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return nil, err
	}
	if p.Direction != "horizontal" && p.Direction != "vertical" {
		return nil, fmt.Errorf("direction must be horizontal or vertical")
	}
	if p.Percent != nil && (*p.Percent < 1 || *p.Percent > 100) {
		return nil, fmt.Errorf("percent must be between 1 and 100")
	}
	if session.PaneID == "" {
		return nil, fmt.Errorf("session has no active pane")
	}

	a.topologyMu.Lock()
	defer a.topologyMu.Unlock()
	created, err := a.tmuxClient.SplitPaneWithOptions(session.PaneID, p.Direction, p.Percent, p.CWD)
	if err != nil {
		return nil, err
	}
	return map[string]any{"pane_id": created.PaneID, "tmux_target": created.TmuxTarget}, nil
}

func (a *Agent) executeSelectPane(session *SessionState, payload json.RawMessage) error {
	if !a.cfg.Security.AllowSendInput {
		return fmt.Errorf("select_pane not allowed by policy")
	}
	var p protocol.SelectPanePayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}

	a.topologyMu.Lock()
	defer a.topologyMu.Unlock()
	paneID, err := a.resolvePaneTarget(session, p.PaneID)
	if err != nil {
		return err
	}
	return a.tmuxClient.SelectPane(paneID)
}

func (a *Agent) executeResizePane(session *SessionState, payload json.RawMessage) error {
	if !a.cfg.Security.AllowSendInput {
		return fmt.Errorf("resize_pane not allowed by policy")
	}
	var p protocol.ResizePanePayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	if p.Width == nil && p.Height == nil {
		return fmt.Errorf("at least one of width or height is required")
	}
	if (p.Width != nil && *p.Width <= 0) || (p.Height != nil && *p.Height <= 0) {
		return fmt.Errorf("pane dimensions must be positive")
	}

	a.topologyMu.Lock()
	defer a.topologyMu.Unlock()
	paneID, err := a.resolvePaneTarget(session, p.PaneID)
	if err != nil {
		return err
	}
	width, height := 0, 0
	if p.Width != nil {
		width = *p.Width
	}
	if p.Height != nil {
		height = *p.Height
	}
	return a.tmuxClient.ResizePane(paneID, width, height)
}

func (a *Agent) executeZoomPane(session *SessionState, payload json.RawMessage) error {
	if !a.cfg.Security.AllowSendInput {
		return fmt.Errorf("zoom_pane not allowed by policy")
	}
	var p protocol.ZoomPanePayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}

	a.topologyMu.Lock()
	defer a.topologyMu.Unlock()
	paneID, err := a.resolvePaneTarget(session, p.PaneID)
	if err != nil {
		return err
	}
	return a.tmuxClient.ZoomPane(paneID)
}

func (a *Agent) resolvePaneTarget(session *SessionState, paneID string) (string, error) {
	if paneID == "" {
		return "", fmt.Errorf("pane_id is required")
	}
	tmuxSession := tmuxSessionFromTarget(session.TmuxTarget)
	if tmuxSession == "" {
		return "", fmt.Errorf("session has no tmux target")
	}
	panes, err := a.tmuxClient.ListPanes()
	if err != nil {
		return "", err
	}
	for _, pane := range panes {
		if pane.PaneID == paneID && pane.SessionName == tmuxSession {
			return paneID, nil
		}
	}
	return "", fmt.Errorf("pane is not in the tracked tmux session")
}

func tmuxWindowTarget(session *SessionState, windowIndex int) (string, error) {
	tmuxSession := tmuxSessionFromTarget(session.TmuxTarget)
	if tmuxSession == "" {
		return "", fmt.Errorf("session has no tmux target")
	}
	return fmt.Sprintf("%s:%d", tmuxSession, windowIndex), nil
}

func (a *Agent) executeKillSession(session *SessionState) error {
	if !a.cfg.Security.AllowKill {
		return fmt.Errorf("kill not allowed by policy")
	}

	a.topologyMu.Lock()
	a.sessionsMu.RLock()
	current := a.sessions[session.ID]
	if current == nil {
		a.sessionsMu.RUnlock()
		a.topologyMu.Unlock()
		return fmt.Errorf("session not found")
	}
	paneID := current.PaneID
	a.sessionsMu.RUnlock()
	if paneID == "" {
		a.topologyMu.Unlock()
		return fmt.Errorf("session has no active pane")
	}
	if err := a.localTmuxRunner().KillPane(paneID); err != nil {
		a.topologyMu.Unlock()
		return err
	}

	now := time.Now().UTC()
	a.sessionsMu.Lock()
	updates := make([]protocol.SessionUpsert, 0, 2)
	if current = a.sessions[session.ID]; current != nil {
		current.Status = "DONE"
		current.PaneID = ""
		current.TmuxTarget = ""
		current.LastActivity = now
		a.refreshHierarchyMetadataLocked()
		update := sessionUpsert(current)
		update.ArchivedAt = protocol.String(now.Format(time.RFC3339))
		updates = append(updates, update)
		if parent := a.sessions[current.ParentSessionID]; parent != nil {
			updates = append(updates, sessionUpsert(parent))
		}
	}
	a.sessionsMu.Unlock()
	a.topologyMu.Unlock()
	if len(updates) > 0 {
		a.send(protocol.TypeSessionsUpsert, protocol.SessionsUpsertPayload{Sessions: updates})
	}
	return nil
}

func (a *Agent) executeConsoleSubscribe(session *SessionState, payload json.RawMessage) error {
	if !a.cfg.Security.AllowConsoleStream {
		return fmt.Errorf("console_stream not allowed by policy")
	}

	var p protocol.ConsoleSubscribePayload
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
	var p protocol.ConsoleUnsubscribePayload
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

func (a *Agent) executeCapturePaneCommand(session *SessionState, payload json.RawMessage) (map[string]any, error) {
	var p protocol.CapturePanePayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return nil, err
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
	if mode != tmux.CaptureModeFull && (p.SnapshotID != "" || p.BeforeLine != nil) {
		return nil, fmt.Errorf("snapshot continuation requires full capture mode")
	}
	if mode == tmux.CaptureModeFull {
		if p.PageSize == 0 {
			p.PageSize = defaultCaptureSnapshotPageSize
		}
		if p.PageSize < 1 || p.PageSize > maxCaptureSnapshotPageSize {
			return nil, fmt.Errorf("page_size must be between 1 and %d", maxCaptureSnapshotPageSize)
		}
		if p.SnapshotID != "" {
			if p.BeforeLine == nil {
				return nil, fmt.Errorf("before_line is required with snapshot_id")
			}
			page, err := a.capturePaneSnapshots.continuation(
				p.SnapshotID,
				session.ID,
				session.PaneID,
				p.StripANSI,
				*p.BeforeLine,
				p.PageSize,
			)
			if err != nil {
				return nil, err
			}
			return page.result(), nil
		}
		if p.BeforeLine != nil {
			return nil, fmt.Errorf("snapshot_id is required with before_line")
		}
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
		return nil, fmt.Errorf("capture failed: %w", err)
	}
	if mode == tmux.CaptureModeFull {
		page, err := a.capturePaneSnapshots.create(session.ID, session.PaneID, p.StripANSI, content, p.PageSize)
		if err != nil {
			return nil, err
		}
		return page.result(), nil
	}

	lineCount := strings.Count(content, "\n")
	return map[string]any{
		"content":      content,
		"line_count":   lineCount,
		"capture_mode": p.Mode,
	}, nil
}

func (a *Agent) executeCopyToSession(sourceSession *SessionState, payload json.RawMessage) error {
	var p protocol.CopyToSessionPayload
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
	var p protocol.ListDirectoryPayload
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

	var p protocol.AdoptPanePayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	if p.TmuxPaneID == "" {
		return fmt.Errorf("tmux_pane_id is required")
	}

	a.topologyMu.Lock()
	defer a.topologyMu.Unlock()

	// Find existing unmanaged session for this pane
	a.sessionsMu.RLock()
	var session *SessionState
	for _, s := range a.sessions {
		if s.PaneID == p.TmuxPaneID {
			session = s
			break
		}
	}
	a.sessionsMu.RUnlock()

	newSession := session == nil
	if session == nil {
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
	}

	optionSessionID := a.cfg.Tmux.OptionSessionID
	if optionSessionID == "" {
		optionSessionID = "@ac_session_id"
	}
	if err := a.localTmuxRunner().SetPaneOption(p.TmuxPaneID, optionSessionID, session.ID); err != nil {
		return err
	}

	a.sessionsMu.Lock()
	if newSession {
		a.sessions[session.ID] = session
	}
	session.Unmanaged = false
	session.LastActivity = time.Now().UTC()
	session.LastOutput = session.LastActivity
	if p.Title != "" {
		session.Title = p.Title
	}
	a.refreshHierarchyMetadataLocked()
	update := sessionUpsert(session)
	a.sessionsMu.Unlock()

	a.send(protocol.TypeSessionsUpsert, protocol.SessionsUpsertPayload{Sessions: []protocol.SessionUpsert{update}})
	return nil
}

func (a *Agent) executeRenameSession(session *SessionState, payload json.RawMessage) error {
	var p protocol.RenameSessionPayload
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

	update := protocol.SessionUpsert{
		ID:             session.ID,
		Kind:           session.Kind,
		Provider:       session.Provider,
		Status:         session.Status,
		Title:          protocol.String(session.Title),
		LastActivityAt: session.LastActivity.UTC().Format(time.RFC3339),
	}
	a.send(protocol.TypeSessionsUpsert, protocol.SessionsUpsertPayload{Sessions: []protocol.SessionUpsert{update}})
	return nil
}

func (a *Agent) executeSpawnSession(sessionID string, payload json.RawMessage) error {
	if !a.cfg.Security.AllowSpawn {
		return fmt.Errorf("spawn_session not allowed by policy")
	}

	var p protocol.SpawnSessionPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}

	if p.WorkingDirectory != nil {
		return a.executeSpawnSessionInteractive(sessionID, p)
	}

	return a.executeSpawnSessionWorktree(sessionID, p)
}

func (a *Agent) executeSpawnSessionWorktree(sessionID string, p protocol.SpawnSessionPayload) error {
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
	if err := writeMemoryFiles(p.WorktreeDir, p.MemoryFiles); err != nil {
		return err
	}

	launchCommand, err := a.interactiveLaunchCommand(p.Provider, nil, p.Env, sessionID)
	if err != nil {
		return err
	}
	a.topologyMu.Lock()
	defer a.topologyMu.Unlock()

	// Ensure tmux session exists
	if !a.tmuxClient.HasSession(p.Tmux.TargetSession) {
		if err := a.tmuxClient.NewSession(p.Tmux.TargetSession); err != nil {
			return err
		}
	}

	// Create window
	created, err := a.tmuxClient.CreateWindow(p.Tmux.TargetSession, p.Tmux.WindowName, p.WorktreeDir)
	if err != nil {
		return err
	}
	paneID := created.PaneID
	committed := false
	registered := false
	defer func() {
		if committed {
			return
		}
		if registered {
			a.sessionsMu.Lock()
			delete(a.sessions, sessionID)
			delete(a.transcriptPaths, sessionID)
			a.refreshHierarchyMetadataLocked()
			a.sessionsMu.Unlock()
		}
		_ = a.tmuxClient.KillPane(paneID)
	}()

	// Persist session ID on the pane
	if err := a.tmuxClient.SetPaneOption(paneID, a.cfg.Tmux.OptionSessionID, sessionID); err != nil {
		return err
	}
	if p.ParentSessionID != "" {
		if err := a.tmuxClient.SetPaneOption(paneID, parentSessionOption, p.ParentSessionID); err != nil {
			return err
		}
	}
	if launchCommand != "" {
		if err := a.tmuxClient.SendInput(paneID, launchCommand, true); err != nil {
			return err
		}
	}

	// Register session
	now := time.Now().UTC()
	a.sessionsMu.Lock()
	spawned := &SessionState{
		ID:              sessionID,
		PaneID:          paneID,
		Kind:            "tmux_pane",
		Provider:        p.Provider,
		Status:          "STARTING",
		Title:           p.Title,
		CWD:             p.WorktreeDir,
		RepoRoot:        p.RepoRoot,
		GitBranch:       p.BranchName,
		TmuxTarget:      created.TmuxTarget,
		LastActivity:    now,
		LastOutput:      now,
		ParentSessionID: p.ParentSessionID,
	}
	a.sessions[sessionID] = spawned
	registered = true
	a.refreshHierarchyMetadataLocked()
	updates := []protocol.SessionUpsert{sessionUpsert(spawned)}
	if parent := a.sessions[p.ParentSessionID]; parent != nil {
		updates = append(updates, sessionUpsert(parent))
	}
	a.sessionsMu.Unlock()
	committed = true
	a.send(protocol.TypeSessionsUpsert, protocol.SessionsUpsertPayload{Sessions: updates})

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

func (a *Agent) executeSpawnSessionInteractive(sessionID string, p protocol.SpawnSessionPayload) error {
	if p.WorkingDirectory == nil || *p.WorkingDirectory == "" {
		return fmt.Errorf("working_directory is required")
	}
	_, resolvedWorkingDir, err := normalizeListDirectoryPath(*p.WorkingDirectory)
	if err != nil {
		return err
	}
	if err := writeMemoryFiles(resolvedWorkingDir, p.MemoryFiles); err != nil {
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
	launchCommand, err := a.interactiveLaunchCommand(p.Provider, p.Flags, nil, sessionID)
	if err != nil {
		return err
	}
	a.topologyMu.Lock()
	defer a.topologyMu.Unlock()
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

	created, err := a.tmuxClient.CreateWindow(tmuxSession, windowName, resolvedWorkingDir)
	if err != nil {
		return err
	}
	paneID := created.PaneID
	committed := false
	registered := false
	defer func() {
		if committed {
			return
		}
		if registered {
			a.sessionsMu.Lock()
			delete(a.sessions, sessionID)
			delete(a.transcriptPaths, sessionID)
			a.refreshHierarchyMetadataLocked()
			a.sessionsMu.Unlock()
		}
		_ = a.tmuxClient.KillPane(paneID)
	}()

	if err := a.tmuxClient.SetPaneOption(paneID, a.cfg.Tmux.OptionSessionID, sessionID); err != nil {
		return err
	}
	if p.ParentSessionID != "" {
		if err := a.tmuxClient.SetPaneOption(paneID, parentSessionOption, p.ParentSessionID); err != nil {
			return err
		}
	}

	if launchCommand != "" {
		if err := a.tmuxClient.SendInput(paneID, launchCommand, true); err != nil {
			return err
		}
	}

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
	spawned := &SessionState{
		ID:              sessionID,
		PaneID:          paneID,
		Kind:            "tmux_pane",
		Provider:        p.Provider,
		Status:          status,
		Title:           displayTitle,
		CWD:             resolvedWorkingDir,
		RepoRoot:        repoRoot,
		GitBranch:       gitBranch,
		GitRemote:       gitRemote,
		GroupID:         p.GroupID,
		ParentSessionID: p.ParentSessionID,
		TmuxTarget:      created.TmuxTarget,
		LastActivity:    now,
		LastOutput:      now,
	}
	a.sessions[sessionID] = spawned
	registered = true
	a.refreshHierarchyMetadataLocked()
	updates := []protocol.SessionUpsert{sessionUpsert(spawned)}
	if parent := a.sessions[p.ParentSessionID]; parent != nil {
		updates = append(updates, sessionUpsert(parent))
	}
	a.sessionsMu.Unlock()
	committed = true
	a.send(protocol.TypeSessionsUpsert, protocol.SessionsUpsertPayload{Sessions: updates})

	return nil
}

func (a *Agent) executeSpawnJob(sessionID string, payload json.RawMessage) error {
	if !a.cfg.Security.AllowSpawn {
		return fmt.Errorf("spawn_job not allowed by policy")
	}

	var p protocol.SpawnJobPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}
	if p.Provider == "" {
		p.Provider = "codex"
	}
	if p.CWD == "" || p.Prompt == "" {
		return fmt.Errorf("cwd and prompt are required")
	}
	if a.launchTemplates == nil {
		a.launchTemplates = providers.NewLaunchTemplates(a.cfg)
	}
	headlessSpec, err := a.launchTemplates.Headless(p.Provider, p.Prompt, p.Env)
	if err != nil {
		return err
	}
	if _, err := headlessSpec.ExecCommand(p.CWD); err != nil {
		return err
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
		CWD:          p.CWD,
		LastActivity: now,
		LastOutput:   now,
	}
	a.sessionsMu.Unlock()

	a.send(protocol.TypeSessionsUpsert, protocol.SessionsUpsertPayload{
		Sessions: []protocol.SessionUpsert{{
			ID:             sessionID,
			Kind:           "job",
			Provider:       p.Provider,
			Status:         "STARTING",
			CWD:            protocol.String(p.CWD),
			LastActivityAt: time.Now().UTC().Format(time.RFC3339),
		}},
	})

	go a.runHeadlessJob(sessionID, p.Provider, p.CWD, p.Prompt, p.Env)
	return nil
}

func (a *Agent) executeFork(parentSession *SessionState, payload json.RawMessage) error {
	if !a.cfg.Security.AllowSpawn {
		return fmt.Errorf("fork not allowed by policy")
	}

	var p protocol.ForkPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return err
	}

	newSessionID := uuid.New().String()
	newCwd := p.CWD
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

	launchCommand, err := a.interactiveLaunchCommand(provider, nil, nil, newSessionID)
	if err != nil {
		return err
	}
	a.topologyMu.Lock()
	defer a.topologyMu.Unlock()

	// Ensure tmux session exists
	tmuxSession := a.cfg.Spawn.TmuxSessionName
	if !a.tmuxClient.HasSession(tmuxSession) {
		if err := a.tmuxClient.NewSession(tmuxSession); err != nil {
			return err
		}
	}

	// Create new window in the tmux session
	created, err := a.tmuxClient.CreateWindow(tmuxSession, windowName, newCwd)
	if err != nil {
		return fmt.Errorf("failed to create window for fork: %w", err)
	}
	paneID := created.PaneID
	committed := false
	registered := false
	defer func() {
		if committed {
			return
		}
		if registered {
			a.sessionsMu.Lock()
			delete(a.sessions, newSessionID)
			delete(a.transcriptPaths, newSessionID)
			a.refreshHierarchyMetadataLocked()
			a.sessionsMu.Unlock()
		}
		_ = a.tmuxClient.KillPane(paneID)
	}()

	// Set session ID on the pane
	if err := a.tmuxClient.SetPaneOption(paneID, a.cfg.Tmux.OptionSessionID, newSessionID); err != nil {
		return err
	}
	if err := a.tmuxClient.SetPaneOption(paneID, parentSessionOption, parentSession.ID); err != nil {
		return err
	}

	// Start provider command (if applicable) and set env
	if launchCommand != "" {
		if err := a.tmuxClient.SendInput(paneID, launchCommand, true); err != nil {
			return err
		}
	}

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
	spawned := &SessionState{
		ID:              newSessionID,
		PaneID:          paneID,
		Kind:            "tmux_pane",
		Provider:        provider,
		Status:          status,
		Title:           title,
		CWD:             newCwd,
		RepoRoot:        repoRoot,
		GitBranch:       gitBranch,
		GitRemote:       gitRemote,
		TmuxTarget:      created.TmuxTarget,
		LastActivity:    now,
		LastOutput:      now,
		GroupID:         groupID,
		ForkedFrom:      parentSession.ID,
		ForkDepth:       forkDepth,
		ParentSessionID: parentSession.ID,
		Metadata: map[string]any{
			"forked_from":       parentSession.ID,
			"fork_depth":        forkDepth,
			"parent_session_id": parentSession.ID,
		},
	}
	a.sessions[newSessionID] = spawned
	registered = true
	a.refreshHierarchyMetadataLocked()
	updates := []protocol.SessionUpsert{sessionUpsert(spawned)}
	if parent := a.sessions[parentSession.ID]; parent != nil {
		updates = append(updates, sessionUpsert(parent))
	}
	a.sessionsMu.Unlock()
	committed = true
	a.send(protocol.TypeSessionsUpsert, protocol.SessionsUpsertPayload{Sessions: updates})

	return nil
}

func (a *Agent) interactiveLaunchCommand(provider string, flags []string, env map[string]string, sessionID string) (string, error) {
	if a.launchTemplates == nil {
		a.launchTemplates = providers.NewLaunchTemplates(a.cfg)
	}
	requestEnv := make(map[string]string, len(env)+1)
	for key, value := range env {
		requestEnv[key] = value
	}
	requestEnv["AC_SESSION_ID"] = sessionID
	spec, err := a.launchTemplates.Interactive(provider, flags, requestEnv)
	if err != nil {
		return "", err
	}
	return spec.ShellCommand()
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

func (a *Agent) runHeadlessJob(sessionID, provider, cwd, prompt string, env map[string]string) {
	if a.launchTemplates == nil {
		a.launchTemplates = providers.NewLaunchTemplates(a.cfg)
	}
	spec, err := a.launchTemplates.Headless(provider, prompt, env)
	if err != nil {
		a.updateJobStatus(sessionID, "ERROR")
		return
	}
	cmd, err := spec.ExecCommand(cwd)
	if err != nil {
		a.updateJobStatus(sessionID, "ERROR")
		return
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

		a.send(protocol.TypeEventsAppend, protocol.EventsAppendPayload{
			SessionID: sessionID,
			EventType: providerEventType(provider),
			Payload:   evt,
		})

		eventName, _ := evt["event_type"].(string)
		if eventName == "" {
			eventName, _ = evt["type"].(string)
		}
		if eventName != "" {
			switch eventName {
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

func providerEventType(provider string) string {
	switch provider {
	case "claude_code":
		return "claude.event"
	case "codex":
		return "codex.event"
	default:
		return provider + ".event"
	}
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

	a.send(protocol.TypeSessionsUpsert, protocol.SessionsUpsertPayload{
		Sessions: []protocol.SessionUpsert{{
			ID:             sessionID,
			Kind:           "job",
			Provider:       provider,
			Status:         status,
			LastActivityAt: time.Now().UTC().Format(time.RFC3339),
		}},
	})
}

func (a *Agent) handleApprovalDecision(payload json.RawMessage) {
	var decision protocol.ApprovalDecisionPayload
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

	sessionID := a.resolveHookSessionID(payload)
	if sessionID == "" {
		a.bufferHook("claude_code", payload)
		return nil, nil
	}
	a.retainTranscriptPath(sessionID, extractHookString(hookData, "transcript_path", "transcriptPath"))
	a.markSessionReady(sessionID)

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
	hookPayload := map[string]any{
		"hook_name": hookName,
		"hook_data": hookData,
	}
	if toolName != "" {
		hookPayload["tool_name"] = toolName
	}
	if usage := extractUsageFromHook(hookData); usage != nil {
		hookPayload["usage"] = usage
	}
	a.send(protocol.TypeEventsAppend, protocol.EventsAppendPayload{
		SessionID: sessionID,
		EventType: "claude.hook",
		Payload:   hookPayload,
	})

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
		a.send(protocol.TypeEventsAppend, protocol.EventsAppendPayload{
			SessionID: sessionID,
			EventType: "approval.requested",
			Payload:   payloadData,
		})
	}

	return nil, nil
}

func (a *Agent) handleCodexHook(payload providers.ClaudeHookPayload) (*providers.ApprovalDecision, error) {
	var hookData map[string]any
	if err := json.Unmarshal(payload.Hook, &hookData); err != nil {
		return nil, err
	}

	hookName := extractHookName(hookData)

	sessionID := a.resolveHookSessionID(payload)
	if sessionID == "" {
		a.bufferHook("codex", payload)
		return nil, nil
	}
	a.markSessionReady(sessionID)

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
	hookPayload := map[string]any{
		"hook_name": hookName,
		"hook_data": hookData,
	}
	if toolName != "" {
		hookPayload["tool_name"] = toolName
	}
	if usage := extractUsageFromHook(hookData); usage != nil {
		hookPayload["usage"] = usage
	}
	a.send(protocol.TypeEventsAppend, protocol.EventsAppendPayload{
		SessionID: sessionID,
		EventType: "codex.hook",
		Payload:   hookPayload,
	})

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
		a.send(protocol.TypeEventsAppend, protocol.EventsAppendPayload{
			SessionID: sessionID,
			EventType: "approval.requested",
			Payload:   codexPayload,
		})
	}

	return nil, nil
}

func (a *Agent) resolveHookSessionID(payload providers.ClaudeHookPayload) string {
	if payload.Meta.ACSessionID != "" {
		return payload.Meta.ACSessionID
	}
	a.sessionsMu.RLock()
	defer a.sessionsMu.RUnlock()
	for _, session := range a.sessions {
		if session.PaneID == payload.Meta.TmuxPane {
			return session.ID
		}
	}
	return ""
}

func (a *Agent) retainTranscriptPath(sessionID, transcriptPath string) {
	if sessionID == "" || transcriptPath == "" {
		return
	}
	a.sessionsMu.Lock()
	defer a.sessionsMu.Unlock()
	if a.sessions[sessionID] == nil {
		return
	}
	if a.transcriptPaths == nil {
		a.transcriptPaths = make(map[string]string)
	}
	a.transcriptPaths[sessionID] = transcriptPath
}

func (a *Agent) transcriptPathForSession(sessionID string) string {
	a.sessionsMu.RLock()
	defer a.sessionsMu.RUnlock()
	return a.transcriptPaths[sessionID]
}

func (a *Agent) markSessionReady(sessionID string) {
	a.sessionsMu.Lock()
	if session := a.sessions[sessionID]; session != nil {
		session.Ready = true
	}
	a.sessionsMu.Unlock()
}

func (a *Agent) bufferHook(provider string, payload providers.ClaudeHookPayload) {
	a.bufferedHooksMu.Lock()
	a.bufferedHooks = append(a.bufferedHooks, bufferedHook{
		Provider:   provider,
		Payload:    payload,
		BufferedAt: time.Now(),
	})
	a.bufferedHooksMu.Unlock()
	log.Printf("Buffered %s hook until pane %s is discovered", provider, payload.Meta.TmuxPane)
}

func (a *Agent) hookBufferTTL() time.Duration {
	pollCycle := time.Duration(a.cfg.Tmux.PollIntervalMs) * time.Millisecond
	if pollCycle < 5*time.Second {
		return 5 * time.Second
	}
	return pollCycle + time.Second
}

func (a *Agent) retryBufferedHooks() {
	a.bufferedHooksMu.Lock()
	pending := a.bufferedHooks
	a.bufferedHooks = nil
	a.bufferedHooksMu.Unlock()
	if len(pending) == 0 {
		return
	}

	now := time.Now()
	remaining := make([]bufferedHook, 0, len(pending))
	for _, hook := range pending {
		sessionID := a.resolveHookSessionID(hook.Payload)
		if sessionID != "" {
			hook.Payload.Meta.ACSessionID = sessionID
			switch hook.Provider {
			case "claude_code":
				if _, err := a.handleClaudeHook(hook.Payload); err != nil {
					log.Printf("Failed to replay buffered Claude hook: %v", err)
				}
			case "codex":
				if _, err := a.handleCodexHook(hook.Payload); err != nil {
					log.Printf("Failed to replay buffered Codex hook: %v", err)
				}
			}
			continue
		}
		if now.Sub(hook.BufferedAt) >= a.hookBufferTTL() {
			log.Printf("Dropping buffered %s hook after %s without a session match for pane %s", hook.Provider, now.Sub(hook.BufferedAt).Round(time.Millisecond), hook.Payload.Meta.TmuxPane)
			continue
		}
		remaining = append(remaining, hook)
	}

	if len(remaining) > 0 {
		a.bufferedHooksMu.Lock()
		a.bufferedHooks = append(remaining, a.bufferedHooks...)
		a.bufferedHooksMu.Unlock()
	}
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
	case lower == "subagentstart":
		return "subagent_start"
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
	a.send(protocol.TypeEventsAppend, protocol.EventsAppendPayload{
		SessionID: sessionID,
		EventType: "workshop." + eventType,
		Payload:   payload,
	})
}

func (a *Agent) handleWorkshopHookEvent(sessionID, provider, hookName string, hookData map[string]any, fallbackCwd string) {
	eventType := mapHookToWorkshopEventType(hookName)
	if eventType == "" {
		return
	}

	now := time.Now().UTC()
	base := map[string]any{
		"sessionId":   sessionID,
		"provider":    provider,
		"cwd":         extractCWD(hookData, fallbackCwd),
		"timestamp":   now.UnixMilli(),
		"occurred_at": now.Format(time.RFC3339Nano),
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
			base["tool_use_id"] = toolUseID
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
			base["tool_use_id"] = toolUseID
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
	case "subagent_start", "subagent_stop":
		if toolUseID := extractToolUseID(hookData); toolUseID != "" {
			base["toolUseId"] = toolUseID
			base["tool_use_id"] = toolUseID
		}
		if description := extractSubagentDescription(hookData); description != "" {
			base["description"] = description
		}
		if agentID := extractHookString(hookData, "agent_id", "agentId"); agentID != "" {
			base["agent_id"] = agentID
			base["subagent_id"] = agentID
		}
		if agentType := extractHookString(hookData, "agent_type", "agentType"); agentType != "" {
			base["agent_type"] = agentType
		}
		if eventType == "subagent_start" {
			base["started_at"] = now.Format(time.RFC3339Nano)
		} else {
			base["stopped_at"] = now.Format(time.RFC3339Nano)
		}
	case "pre_compact":
		if trigger := extractHookString(hookData, "trigger"); trigger != "" {
			base["trigger"] = trigger
		}
		if instructions := extractHookString(hookData, "custom_instructions"); instructions != "" {
			base["customInstructions"] = instructions
		}
	}

	toolUseID := extractToolUseID(hookData)
	if eventType == "pre_tool_use" && isLegacyTaskTool(extractToolName(hookData)) && toolUseID != "" {
		subagentPayload := cloneJSONMap(base)
		if description := extractSubagentDescription(hookData); description != "" {
			subagentPayload["description"] = description
		}
		subagentPayload["started_at"] = now.Format(time.RFC3339Nano)
		a.emitWorkshopEvent(sessionID, "subagent_start", subagentPayload)
	}
	if eventType == "post_tool_use" && isLegacyTaskTool(extractToolName(hookData)) && toolUseID != "" {
		subagentPayload := cloneJSONMap(base)
		if description := extractSubagentDescription(hookData); description != "" {
			subagentPayload["description"] = description
		}
		subagentPayload["stopped_at"] = now.Format(time.RFC3339Nano)
		a.emitWorkshopEvent(sessionID, "subagent_stop", subagentPayload)
	}
	a.emitWorkshopEvent(sessionID, eventType, base)
}

func extractSubagentDescription(hookData map[string]any) string {
	if description := extractHookString(hookData, "description", "task_description", "task", "prompt", "name", "agent_type", "agentType"); description != "" {
		return description
	}
	if input := extractToolInput(hookData); input != nil {
		return extractHookString(input, "description", "task_description", "task", "prompt", "name")
	}
	return ""
}

func isLegacyTaskTool(toolName string) bool {
	return strings.EqualFold(strings.TrimSpace(toolName), "task")
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

	a.send(protocol.TypeToolEventStarted, protocol.ToolEventStartedPayload{
		EventID:   eventID,
		SessionID: sessionID,
		Provider:  provider,
		ToolName:  toolName,
		ToolInput: toolInput,
		StartedAt: startedAt.Format(time.RFC3339),
	})
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
		a.send(protocol.TypeToolEventStarted, protocol.ToolEventStartedPayload{
			EventID:   eventID,
			SessionID: sessionID,
			Provider:  provider,
			ToolName:  toolName,
			StartedAt: completedAt.Format(time.RFC3339),
		})
		pending = toolEventPending{ID: eventID, StartedAt: completedAt}
	}

	durationMs := completedAt.Sub(pending.StartedAt).Milliseconds()
	if durationMs < 0 {
		durationMs = 0
	}

	a.send(protocol.TypeToolEventCompleted, protocol.ToolEventCompletedPayload{
		EventID:     pending.ID,
		ToolOutput:  toolOutput,
		CompletedAt: completedAt.Format(time.RFC3339),
		Success:     success,
		DurationMS:  durationMs,
	})
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
	var updates []protocol.SessionUpsert

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

		a.refreshHierarchyMetadataLocked()
		updates = append(updates, sessionUpsert(session))
		if parent := a.sessions[session.ParentSessionID]; parent != nil {
			updates = append(updates, sessionUpsert(parent))
		}
	}
	a.sessionsMu.Unlock()

	if len(updates) > 0 {
		a.send(protocol.TypeSessionsUpsert, protocol.SessionsUpsertPayload{Sessions: updates})
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
		update := protocol.SessionUpsert{
			ID:             session.ID,
			Kind:           session.Kind,
			Provider:       session.Provider,
			Status:         session.Status,
			Metadata:       protocol.NewSessionMetadata(cloneJSONMap(session.Metadata)),
			LastActivityAt: now.Format(time.RFC3339),
		}
		a.sessionsMu.Unlock()

		a.send(protocol.TypeSessionsUpsert, protocol.SessionsUpsertPayload{Sessions: []protocol.SessionUpsert{update}})
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
	a.send(protocol.TypeConsoleChunk, protocol.ConsoleChunkPayload{
		SubscriptionID: subscriptionID,
		SessionID:      sessionID,
		Data:           string(data),
		Offset:         offset,
	})
}

func (a *Agent) pollTmux() {
	a.reconcileTmux("startup")
	a.retryBufferedHooks()

	ticker := time.NewTicker(time.Duration(a.cfg.Tmux.PollIntervalMs) * time.Millisecond)
	defer ticker.Stop()

	for range ticker.C {
		a.reconcileTmux("poll")
		a.retryBufferedHooks()
	}
}

func (a *Agent) reconcileTmux(reason string) {
	a.topologyMu.Lock()
	panes, err := a.tmuxClient.ListPanes()
	if err != nil {
		a.topologyMu.Unlock()
		log.Printf("Failed to list tmux panes: %v", err)
		return
	}

	procSnap := proc.TakeSnapshot()
	a.syncPanes(panes, procSnap)
	a.topologyMu.Unlock()
	a.queueTmuxTopology(reason, panes)
}

func (a *Agent) handleTmuxTopologyHook(hookName string) {
	a.topologyMu.Lock()
	panes, err := a.tmuxClient.ListPanes()
	a.topologyMu.Unlock()
	if err != nil {
		log.Printf("Failed to list tmux panes after hook %s: %v", hookName, err)
		return
	}
	a.queueTmuxTopology("hook:"+hookName, panes)
}

func (a *Agent) syncPanes(panes []tmux.Pane, procSnap *proc.Snapshot) {
	type paneObservation struct {
		pane      tmux.Pane
		sessionID string
		unmanaged bool
		provider  string
		gitInfo   *tmux.GitInfo
		gitStatus *tmux.GitStatus
	}

	// Snapshot only the state needed to prepare observations. No tmux or git
	// subprocess is run while sessionsMu is held.
	unmanagedByPane := make(map[string]string)
	lastCWDByPane := make(map[string]string)
	a.sessionsMu.RLock()
	for id, session := range a.sessions {
		if session.Unmanaged && session.PaneID != "" {
			unmanagedByPane[session.PaneID] = id
		}
		if session.PaneID != "" {
			lastCWDByPane[session.PaneID] = session.LastCWD
		}
	}
	a.sessionsMu.RUnlock()

	observations := make([]paneObservation, 0, len(panes))
	for _, pane := range panes {
		sessionID := pane.SessionID
		unmanaged := false
		if sessionID == "" {
			sessionID = unmanagedByPane[pane.PaneID]
			if sessionID == "" {
				sessionID = uuid.New().String()
				unmanaged = true
			}
			if err := a.tmuxClient.SetPaneOption(pane.PaneID, a.cfg.Tmux.OptionSessionID, sessionID); err != nil {
				log.Printf("Failed to set pane session id: %v", err)
			}
		}

		if oldCWD := lastCWDByPane[pane.PaneID]; oldCWD != "" && oldCWD != pane.CurrentPath {
			a.gitCache.Delete(oldCWD)
			a.gitStatusCache.Delete(oldCWD)
		}

		var gitInfo *tmux.GitInfo
		var gitStatus *tmux.GitStatus
		if pane.CurrentPath != "" {
			if cached, ok := a.gitCache.Get(pane.CurrentPath); ok {
				gitInfo = cached
			} else if resolved := tmux.ResolveGitInfo(pane.CurrentPath); resolved != nil {
				a.gitCache.Set(pane.CurrentPath, resolved)
				gitInfo = resolved
			}
			if cached, ok := a.gitStatusCache.Get(pane.CurrentPath); ok {
				gitStatus = cached
			} else if resolved := tmux.ResolveGitStatus(pane.CurrentPath); resolved != nil {
				a.gitStatusCache.Set(pane.CurrentPath, resolved)
				gitStatus = resolved
			}
		}

		observations = append(observations, paneObservation{
			pane:      pane,
			sessionID: sessionID,
			unmanaged: unmanaged,
			provider:  detectProviderForPane(pane, procSnap),
			gitInfo:   gitInfo,
			gitStatus: gitStatus,
		})
	}

	seenPanes := make(map[string]bool, len(observations))
	updatedSessions := make([]protocol.SessionUpsert, 0, len(observations))
	activeSessionIDs := make([]string, 0, len(observations))
	var staleIDs []string
	pruneNow := false

	a.sessionsMu.Lock()
	for _, observation := range observations {
		pane := observation.pane
		seenPanes[pane.PaneID] = true
		activeSessionIDs = append(activeSessionIDs, observation.sessionID)

		session, exists := a.sessions[observation.sessionID]
		if !exists {
			now := time.Now().UTC()
			session = &SessionState{
				ID:           observation.sessionID,
				PaneID:       pane.PaneID,
				Kind:         "tmux_pane",
				Status:       "IDLE",
				Unmanaged:    observation.unmanaged,
				LastActivity: now,
				LastOutput:   now,
			}
			a.sessions[observation.sessionID] = session
		}

		session.PaneID = pane.PaneID
		expectedProvider := session.Provider
		if !(session.Status == "STARTING" && expectedProvider != "" && expectedProvider != "shell" && observation.provider == "shell") {
			session.Provider = observation.provider
		}
		if observation.provider == "shell" && (expectedProvider == "" || expectedProvider == "shell") {
			session.Ready = true
		} else if observation.provider == expectedProvider && observation.provider != "unknown" && !isShellCommand(pane.CurrentCommand) {
			session.Ready = true
		}
		session.CWD = pane.CurrentPath
		session.LastCWD = pane.CurrentPath
		session.TmuxTarget = pane.GetTmuxTarget()
		session.ParentSessionID = pane.ParentSessionID
		if session.Metadata == nil {
			session.Metadata = map[string]any{}
		}
		session.Metadata["tmux"] = map[string]any{
			"pane_id":              pane.PaneID,
			"target":               pane.GetTmuxTarget(),
			"pane_pid":             pane.PanePID,
			"current_command":      pane.CurrentCommand,
			"session_name":         pane.SessionName,
			"window_name":          pane.WindowName,
			"window_index":         pane.WindowIndex,
			"pane_index":           pane.PaneIndex,
			"pane_active":          pane.PaneActive,
			"window_active":        pane.WindowActive,
			"window_zoomed_flag":   pane.WindowZoomed,
			"window_layout":        pane.WindowLayout,
			"pane_width":           pane.PaneWidth,
			"pane_height":          pane.PaneHeight,
			"window_bell_flag":     pane.WindowBell,
			"window_activity_flag": pane.WindowActivity,
		}
		session.Metadata["unmanaged"] = session.Unmanaged

		if observation.gitInfo != nil {
			session.RepoRoot = observation.gitInfo.RepoRoot
			session.GitBranch = observation.gitInfo.Branch
			session.GitRemote = observation.gitInfo.Remote
		} else {
			session.RepoRoot = ""
			session.GitBranch = ""
			session.GitRemote = ""
		}
		if observation.gitStatus != nil {
			gitStatus := observation.gitStatus
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

		session.Status = a.deriveStatus(session, pane)
		update := protocol.SessionUpsert{
			ID:         session.ID,
			Kind:       session.Kind,
			Provider:   session.Provider,
			Status:     session.Status,
			CWD:        protocol.String(session.CWD),
			RepoRoot:   protocol.String(session.RepoRoot),
			GitBranch:  protocol.String(session.GitBranch),
			GitRemote:  protocol.String(session.GitRemote),
			TmuxPaneID: protocol.String(session.PaneID),
			TmuxTarget: protocol.String(session.TmuxTarget),
			Metadata:   protocol.NewSessionMetadata(cloneJSONMap(session.Metadata)),
		}
		if session.GroupID != "" {
			update.GroupID = protocol.String(session.GroupID)
		}
		if session.ForkedFrom != "" {
			update.ForkedFrom = protocol.String(session.ForkedFrom)
			update.ForkDepth = session.ForkDepth
		}
		if !session.LastActivity.IsZero() {
			update.LastActivityAt = session.LastActivity.UTC().Format(time.RFC3339)
		}
		if session.Title != "" {
			update.Title = protocol.String(session.Title)
		}
		updatedSessions = append(updatedSessions, update)
	}

	for id, session := range a.sessions {
		if session.Kind == "tmux_pane" && !seenPanes[session.PaneID] {
			session.Status = "DONE"
			session.LastActivity = time.Now().UTC()
			session.PaneID = ""
			session.TmuxTarget = ""
			updatedSessions = append(updatedSessions, protocol.SessionUpsert{
				ID:             id,
				Status:         "DONE",
				Kind:           session.Kind,
				Provider:       session.Provider,
				TmuxPaneID:     protocol.NullString(),
				TmuxTarget:     protocol.NullString(),
				ArchivedAt:     protocol.String(session.LastActivity.UTC().Format(time.RFC3339)),
				LastActivityAt: session.LastActivity.UTC().Format(time.RFC3339),
			})
			staleIDs = append(staleIDs, id)
		}
	}
	for _, id := range staleIDs {
		delete(a.sessions, id)
		delete(a.transcriptPaths, id)
		delete(a.snapshotHash, id)
		delete(a.providerUsageHash, id)
	}
	a.refreshHierarchyMetadataLocked()
	for index := range updatedSessions {
		if session := a.sessions[updatedSessions[index].ID]; session != nil {
			updatedSessions[index].Metadata = protocol.NewSessionMetadata(cloneJSONMap(session.Metadata))
		}
	}
	if time.Since(a.lastPruneAt) > 5*time.Minute {
		a.lastPruneAt = time.Now().UTC()
		pruneNow = true
	}
	a.sessionsMu.Unlock()

	for _, id := range staleIDs {
		a.usageTracker.RemoveSession(id)
	}
	if len(updatedSessions) > 0 {
		a.send(protocol.TypeSessionsUpsert, protocol.SessionsUpsertPayload{Sessions: updatedSessions})
	}
	if pruneNow {
		a.send(protocol.TypeSessionsPrune, protocol.SessionsPrunePayload{SessionIDs: activeSessionIDs})
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
			a.send(protocol.TypeSessionsSnapshot, protocol.SessionSnapshotPayload{
				SessionID:   session.ID,
				CaptureHash: hash,
				CaptureText: text,
			})

			// Emit provider usage snapshots for Claude/Codex when /usage output appears.
			a.maybeEmitProviderUsageSnapshot(session, text)

			// Parse and emit session usage if changed
			if sessionUsage := a.usageTracker.ParseAndCheckChanged(session.ID, session.Provider, text); sessionUsage != nil {
				payload := protocol.SessionUsagePayload{
					SessionID:                      session.ID,
					Provider:                       sessionUsage.Provider,
					InputTokens:                    sessionUsage.InputTokens,
					OutputTokens:                   sessionUsage.OutputTokens,
					TotalTokens:                    sessionUsage.TotalTokens,
					CacheReadTokens:                sessionUsage.CacheReadTokens,
					CacheWriteTokens:               sessionUsage.CacheWriteTokens,
					EstimatedCostCents:             sessionUsage.CostCents,
					SessionUtilizationPercent:      sessionUsage.SessionUtilizationPercent,
					SessionLeftPercent:             sessionUsage.SessionLeftPercent,
					SessionResetText:               sessionUsage.SessionResetText,
					WeeklyUtilizationPercent:       sessionUsage.WeeklyUtilizationPercent,
					WeeklyLeftPercent:              sessionUsage.WeeklyLeftPercent,
					WeeklyResetText:                sessionUsage.WeeklyResetText,
					WeeklySonnetUtilizationPercent: sessionUsage.WeeklySonnetUtilizationPercent,
					WeeklySonnetResetText:          sessionUsage.WeeklySonnetResetText,
					WeeklyOpusUtilizationPercent:   sessionUsage.WeeklyOpusUtilizationPercent,
					WeeklyOpusResetText:            sessionUsage.WeeklyOpusResetText,
					ContextUsedTokens:              sessionUsage.ContextUsedTokens,
					ContextTotalTokens:             sessionUsage.ContextTotalTokens,
					ContextLeftPercent:             sessionUsage.ContextLeftPercent,
					FiveHourLeftPercent:            sessionUsage.FiveHourLeftPercent,
					FiveHourResetText:              sessionUsage.FiveHourResetText,
					DailyUtilizationPercent:        sessionUsage.DailyUtilizationPercent,
					DailyLeftPercent:               sessionUsage.DailyLeftPercent,
					DailyResetHours:                sessionUsage.DailyResetHours,
					ReportedAt:                     sessionUsage.ReportedAt.Format(time.RFC3339),
					RawUsageLine:                   sessionUsage.RawLine,
				}
				a.send(protocol.TypeSessionUsage, payload)

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

					providerPayload := protocol.ProviderUsagePayload{
						Provider:   sessionUsage.Provider,
						Scope:      "account",
						HostID:     a.cfg.Host.ID,
						ReportedAt: sessionUsage.ReportedAt.Format(time.RFC3339),
					}

					if len(modelPayload) > 0 {
						providerPayload.RawJSON = map[string]any{
							"models": modelPayload,
						}
					}

					providerPayload.DailyUtilization = sessionUsage.DailyUtilizationPercent

					resetHours := minResetHours
					if sessionUsage.DailyResetHours != nil {
						resetHours = *sessionUsage.DailyResetHours
					}
					if resetHours > 0 {
						resetAt := sessionUsage.ReportedAt.Add(time.Duration(resetHours) * time.Hour).UTC().Format(time.RFC3339)
						providerPayload.DailyResetAt = resetAt
					}

					_ = a.send(protocol.TypeProviderUsage, providerPayload)
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

	parsed := providerusage.ParseProviderUsageText(session.Provider, normalized)
	if len(parsed) == 0 {
		return
	}

	usageHash := hashString(normalized)
	if last, ok := a.providerUsageHash[session.ID]; ok && last == usageHash {
		return
	}
	a.providerUsageHash[session.ID] = usageHash

	providerPayload := protocol.ProviderUsagePayload{
		Provider:   session.Provider,
		Scope:      "account",
		HostID:     a.cfg.Host.ID,
		ReportedAt: time.Now().UTC().Format(time.RFC3339),
		RawText:    normalized,
		RawJSON: map[string]any{
			"source":  "snapshot",
			"entries": parsed,
		},
	}

	fields := providerusage.ExtractUsageFields(nil, normalized)
	if data, err := json.Marshal(fields); err == nil {
		if err := json.Unmarshal(data, &providerPayload); err != nil {
			log.Printf("Failed to apply snapshot usage fields (%s): %v", session.Provider, err)
		}
	}

	_ = a.send(protocol.TypeProviderUsage, providerPayload)
}

func extractUsageSnapshot(text string) string {
	cleaned := providerusage.StripANSI(text)
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
	var req protocol.TerminalAttachPayload
	if err := json.Unmarshal(payload, &req); err != nil {
		log.Printf("Failed to parse terminal.attach: %v", err)
		return
	}

	result, err := a.terminalManager.AttachWithOptions(req.ChannelID, req.PaneID, tmux.AttachOptions{
		SessionID:   req.SessionID,
		Cols:        req.Cols,
		Rows:        req.Rows,
		ResumeToken: req.ResumeToken,
		Letterbox:   req.Letterbox,
	})
	if err != nil {
		log.Printf("Failed to attach terminal: %v", err)
		a.send(protocol.TypeTerminalError, protocol.TerminalStatusPayload{
			ChannelID: req.ChannelID,
			Message:   err.Error(),
		})
		return
	}

	// Check if using PTY mode (fifoPath is empty in PTY mode)
	isPTYMode := result.PTY

	// If using FIFO mode and this is the first viewer, enable terminal output in pipe mux
	if !isPTYMode && result.First {
		if err := a.pipeMux.SetTerminal(req.PaneID, result.FIFOPath, true); err != nil {
			log.Printf("Failed to enable terminal output: %v", err)
			a.send(protocol.TypeTerminalError, protocol.TerminalStatusPayload{
				ChannelID: req.ChannelID,
				Message:   err.Error(),
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
			a.handleTerminalOutput(req.ChannelID, base64.StdEncoding.EncodeToString([]byte(text)))
		}
	}
	readOnly := result.ReadOnly
	resumed := result.Resumed
	a.send(protocol.TypeTerminalAttached, protocol.TerminalStatusPayload{
		ChannelID:   req.ChannelID,
		PaneID:      req.PaneID,
		ReadOnly:    &readOnly,
		ResumeToken: result.ResumeToken,
		Resumed:     &resumed,
	})
	log.Printf("Terminal attached: channel=%s pane=%s mode=%s", req.ChannelID, req.PaneID, map[bool]string{true: "PTY", false: "FIFO"}[isPTYMode])
}

func (a *Agent) handleTerminalInput(payload json.RawMessage) {
	var req protocol.TerminalInputPayload
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
	var req protocol.TerminalResizePayload
	if err := json.Unmarshal(payload, &req); err != nil {
		log.Printf("Failed to parse terminal.resize: %v", err)
		return
	}

	if err := a.terminalManager.Resize(req.ChannelID, req.Cols, req.Rows); err != nil {
		log.Printf("Failed to resize terminal: %v", err)
	}
}

func (a *Agent) handleTerminalNavigate(payload json.RawMessage) {
	var req protocol.TerminalNavigatePayload
	if err := json.Unmarshal(payload, &req); err != nil {
		log.Printf("Failed to parse terminal.navigate: %v", err)
		return
	}

	navigation := tmux.TerminalNavigation{Op: tmux.TerminalNavigationOp(req.Op)}
	switch navigation.Op {
	case "viewer_state":
		result := protocol.TerminalNavigationResultPayload{
			ChannelID: req.ChannelID,
			RequestID: req.RequestID,
		}
		if strings.TrimSpace(req.RequestID) == "" {
			result.Message = "viewer_state requires request_id"
			_ = a.send(protocol.TypeTerminalNavigationResult, result)
			return
		}
		state, err := a.terminalManager.ViewerState(req.ChannelID)
		result.PaneID = state.PaneID
		result.WindowIndex = state.WindowIndex
		result.Zoomed = state.Zoomed
		if err != nil {
			result.Message = err.Error()
			log.Printf("Failed to read terminal viewer state for request %s: %v", req.RequestID, err)
		} else {
			result.OK = true
		}
		_ = a.send(protocol.TypeTerminalNavigationResult, result)
		return
	case "focus_pane":
		result := protocol.TerminalNavigationResultPayload{
			ChannelID: req.ChannelID,
			RequestID: req.RequestID,
			PaneID:    req.PaneID,
		}
		if strings.TrimSpace(req.RequestID) == "" || strings.TrimSpace(req.PaneID) == "" || req.Zoom == nil {
			result.Message = "focus_pane requires request_id, pane_id, and zoom"
			_ = a.send(protocol.TypeTerminalNavigationResult, result)
			return
		}
		state, err := a.terminalManager.FocusPane(req.ChannelID, req.PaneID, *req.Zoom)
		result.PaneID = state.PaneID
		result.WindowIndex = state.WindowIndex
		result.Zoomed = state.Zoomed
		if err != nil {
			result.Message = err.Error()
			log.Printf("Failed to focus terminal pane for request %s: %v", req.RequestID, err)
		} else {
			result.OK = true
		}
		_ = a.send(protocol.TypeTerminalNavigationResult, result)
		return
	case tmux.NavigateSelectWindow:
		if req.WindowIndex == nil {
			log.Printf("Failed to parse terminal.navigate: select_window requires window_index")
			return
		}
		navigation.WindowIndex = *req.WindowIndex
	case tmux.NavigateSelectPane:
		if strings.TrimSpace(req.PaneID) == "" {
			log.Printf("Failed to parse terminal.navigate: select_pane requires pane_id")
			return
		}
		navigation.PaneID = req.PaneID
	case tmux.NavigateZoom:
		if req.On == nil {
			log.Printf("Failed to parse terminal.navigate: zoom requires on")
			return
		}
		navigation.On = *req.On
	case tmux.NavigateScroll:
		if req.Lines == nil {
			log.Printf("Failed to parse terminal.navigate: scroll requires lines")
			return
		}
		navigation.Lines = *req.Lines
	default:
		log.Printf("Failed to parse terminal.navigate: unsupported op %q", req.Op)
		return
	}

	if err := a.terminalManager.Navigate(req.ChannelID, navigation); err != nil {
		log.Printf("Failed to navigate terminal: %v", err)
	}
}

func (a *Agent) handleTerminalControl(payload json.RawMessage) {
	var req protocol.TerminalChannelPayload
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
	var req protocol.TerminalChannelPayload
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

func (a *Agent) handleTerminalOutput(channelID, encodedData string) {
	a.send(protocol.TypeTerminalOutput, protocol.TerminalOutputPayload{
		ChannelID: channelID,
		Encoding:  "base64",
		Data:      encodedData,
	})
}

func (a *Agent) handleTerminalStatus(channelID, status, message string) {
	msgType := "terminal." + status
	paneID, _ := a.terminalManager.PaneForChannel(channelID)
	a.send(msgType, protocol.TerminalStatusPayload{ChannelID: channelID, PaneID: paneID, Message: message})
}

func (a *Agent) handleTerminalAudit(event tmux.TerminalAuditEvent) {
	a.send(protocol.TypeTerminalAudit, protocol.TerminalAuditPayload{
		EventType:                   protocol.TypeTerminalAudit,
		Action:                      event.Action,
		ChannelID:                   event.ChannelID,
		SessionID:                   event.SessionID,
		PaneID:                      event.PaneID,
		PreviousControllerChannelID: event.PreviousControllerChannelID,
	})
}
