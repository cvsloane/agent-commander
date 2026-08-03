package acp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	maxRecordsPerState   = 250
	maxWorkRecords       = 200
	maxAttentionItems    = 100
	maxOutputBytes       = 64 * 1024
	maxLogBytes          = 8 * 1024
	quotaExhaustedUsed   = 95.0
	builderReserveFloor  = 15.0
	reviewerReserveFloor = 20.0
	statusStaleAfter     = 90 * time.Minute
)

var (
	idPattern       = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$`)
	repoPattern     = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)
	digestPattern   = regexp.MustCompile(`^[a-fA-F0-9]{64}$`)
	secretPattern   = regexp.MustCompile(`(?i)(token|secret|api[_-]?key|password|authorization)(\s*[:=]\s*)\S+`)
	absolutePattern = regexp.MustCompile(`/(home|tmp|var|srv|opt|workspace|etc)/[^\s"']+`)
)

type source struct {
	home         string
	codingRoot   string
	releaseRoot  string
	entrypoint   string
	routerPath   string
	modelPath    string
	mapPath      string
	registryPath string
}

type record struct {
	kind      string
	id        string
	repo      string
	stateHint string
	file      string
	raw       map[string]any
	summary   map[string]any
	when      time.Time
}

type statusRequest struct {
	TaskID    string `json:"task_id"`
	ProgramID string `json:"program_id"`
}

type actionRequest struct {
	Type           string `json:"type"`
	Repo           string `json:"repo"`
	Objective      string `json:"objective"`
	Goal           string `json:"goal"`
	Lane           string `json:"lane"`
	ProgramID      string `json:"program_id"`
	Answer         string `json:"answer"`
	Statement      string `json:"statement"`
	ApprovalDigest string `json:"approval_digest"`
	Confirmation   string `json:"confirmation"`
	RequestID      string `json:"request_id"`
	RequestedBy    string `json:"requested_by"`
	ApprovedBy     string `json:"approved_by"`
}

type limitedBuffer struct {
	bytes.Buffer
	limited bool
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	remaining := maxOutputBytes - b.Len()
	if remaining <= 0 {
		b.limited = true
		return len(p), nil
	}
	if len(p) > remaining {
		_, _ = b.Buffer.Write(p[:remaining])
		b.limited = true
		return len(p), nil
	}
	return b.Buffer.Write(p)
}

func ReadStatus(payload []byte, machine string) (map[string]any, error) {
	request, err := parseStatusRequest(payload)
	if err != nil {
		return nil, err
	}
	result := emptyStatus()
	src, sourceErr := loadSource(machine)
	if sourceErr != nil {
		setUnavailable(result, sourceErr)
		return result, nil
	}
	result["source"] = map[string]any{"available": true}

	quota, quotaErr := parseQuota(src)
	if quotaErr != nil {
		result["quota"] = unavailableQuota(quotaErr)
	} else {
		result["quota"] = quota
	}

	activations, activationErr := parseActivations(src)
	if activationErr != nil {
		result["activations"] = unavailableActivations(activationErr)
		result["fleet"] = unavailableFleet(activationErr)
	} else {
		result["activations"] = activations
		result["fleet"] = parseFleet(activations, src)
	}

	work, records, workErr := parseWork(src)
	if workErr != nil {
		result["work"] = unavailableWork(workErr)
	} else {
		selectedID := request.TaskID
		selectedKind := "task"
		if request.ProgramID != "" {
			selectedID = request.ProgramID
			selectedKind = "program"
		}
		if selectedID != "" {
			for _, item := range records {
				if item.id == selectedID && item.kind == selectedKind {
					work["selected"] = buildDetail(item, records, src)
					break
				}
			}
		}
		result["work"] = work
		result["attention"] = buildAttention(records)
	}

	routing, routingErr := parseRouting(src, quota, records)
	if routingErr != nil {
		result["routing"] = unavailableRouting(routingErr)
	} else {
		result["routing"] = routing
	}
	result["readiness"] = buildReadiness(result)
	return result, nil
}

func ExecuteAction(payload []byte, machine string) (map[string]any, error) {
	request, err := parseActionRequest(payload)
	if err != nil {
		return nil, err
	}
	src, err := loadSource(machine)
	if err != nil {
		return nil, err
	}
	if request.RequestID == "" || !idPattern.MatchString(request.RequestID) {
		return nil, errors.New("ACP action request_id is invalid")
	}
	if strings.TrimSpace(request.RequestedBy) == "" || len(request.RequestedBy) > 128 {
		return nil, errors.New("ACP action requested_by is invalid")
	}

	if request.Type == "enqueue_task" || request.Type == "start_program" {
		if !repoPattern.MatchString(strings.TrimSpace(request.Repo)) || strings.Contains(request.Repo, "..") {
			return nil, errors.New("ACP repo alias is invalid")
		}
		if !repoAllowed(src.mapPath, request.Repo) {
			return nil, errors.New("ACP repo alias is not allowlisted")
		}
	}

	var args []string
	temporaryDir, err := os.MkdirTemp("", "agent-command-acp-")
	if err != nil {
		return nil, errors.New("failed to create ACP input directory")
	}
	defer os.RemoveAll(temporaryDir)

	writeAnswers := func(answer *string) (string, error) {
		value := map[string]any{
			"schema_version": 1,
			"request_id":     request.RequestID,
			"requested_by":   request.RequestedBy,
			"answers":        map[string]any{},
		}
		if answer != nil {
			value["answer"] = strings.TrimSpace(*answer)
		}
		return writeInputFile(temporaryDir, "answers.json", value)
	}

	switch request.Type {
	case "enqueue_task":
		if err := validateUserText(request.Objective, "objective"); err != nil {
			return nil, err
		}
		if request.Lane != "cheap" && request.Lane != "standard" && request.Lane != "critical" {
			return nil, errors.New("ACP lane is invalid")
		}
		args = []string{
			"enqueue", "--source", "agent-command", "--requested-by", request.RequestedBy,
			"--receipt-target", "coding-dispatch", "--lane", request.Lane, "--",
			request.Repo, strings.TrimSpace(request.Objective),
		}
	case "start_program":
		if err := validateUserText(request.Goal, "goal"); err != nil {
			return nil, err
		}
		answersPath, writeErr := writeAnswers(nil)
		if writeErr != nil {
			return nil, writeErr
		}
		args = []string{
			"program", "--answers", answersPath, "--",
			request.Repo + ":", strings.TrimSpace(request.Goal),
		}
	case "answer_program":
		if err := validateID(request.ProgramID, "program_id"); err != nil {
			return nil, err
		}
		if err := validateUserText(request.Answer, "answer"); err != nil {
			return nil, err
		}
		answer := strings.TrimSpace(request.Answer)
		if strings.EqualFold(answer, "cancel") {
			return nil, errors.New("cancel is reserved; use the dedicated cancel action")
		}
		program, setup, err := findProgramSetup(src.codingRoot, request.ProgramID)
		if err != nil {
			return nil, err
		}
		if strings.EqualFold(answer, "retry") && judgmentGate(program, setup) {
			return nil, errors.New("retry remains available only through the authorized ACP CLI")
		}
		answersPath, writeErr := writeAnswers(&answer)
		if writeErr != nil {
			return nil, writeErr
		}
		args = []string{"program", "--program-id", request.ProgramID, "--answers", answersPath}
	case "approve_program":
		if err := validateID(request.ProgramID, "program_id"); err != nil {
			return nil, err
		}
		if err := validateUserText(request.Statement, "statement"); err != nil {
			return nil, err
		}
		if !digestPattern.MatchString(strings.TrimSpace(request.ApprovalDigest)) {
			return nil, errors.New("approval_digest must be a 64-character SHA-256 digest")
		}
		if request.ApprovedBy != "chris" {
			return nil, errors.New("ACP approval identity is not authorized")
		}
		program, setup, err := findProgramSetup(src.codingRoot, request.ProgramID)
		if err != nil {
			return nil, err
		}
		digest, err := approvalDigest(setup)
		if err != nil {
			return nil, err
		}
		if !strings.EqualFold(digest, strings.TrimSpace(request.ApprovalDigest)) {
			return nil, errors.New("approval digest does not match the current frozen plan")
		}
		repo, _ := textValue(program, "repo")
		goal, _ := textValue(program, "goal")
		if repo == "" || goal == "" {
			return nil, errors.New("durable program is missing approval fields")
		}
		answersPath, writeErr := writeAnswers(nil)
		if writeErr != nil {
			return nil, writeErr
		}
		approvalPath, approvalErr := writeInputFile(temporaryDir, "approval.json", map[string]any{
			"schema_version":    1,
			"program_id":        request.ProgramID,
			"repo":              repo,
			"goal":              goal,
			"decision":          "approved",
			"statement":         strings.TrimSpace(request.Statement),
			"approved_by":       "chris",
			"approved_at":       time.Now().UTC().Format(time.RFC3339),
			"approval_snapshot": digest,
		})
		if approvalErr != nil {
			return nil, approvalErr
		}
		args = []string{
			"program", "--program-id", request.ProgramID, "--answers", answersPath, "--approval", approvalPath,
		}
	case "cancel_program":
		if err := validateID(request.ProgramID, "program_id"); err != nil {
			return nil, err
		}
		if request.Confirmation != "cancel" {
			return nil, errors.New("cancel_program requires explicit cancel confirmation")
		}
		answer := "cancel"
		answersPath, writeErr := writeAnswers(&answer)
		if writeErr != nil {
			return nil, writeErr
		}
		args = []string{"program", "--program-id", request.ProgramID, "--answers", answersPath}
	default:
		return nil, errors.New("unknown ACP action")
	}

	stdout, stderr, runErr := runCommand(src.entrypoint, args)
	if runErr != nil {
		message := strings.TrimSpace(stderr)
		if message == "" {
			message = strings.TrimSpace(stdout)
		}
		if message == "" {
			message = runErr.Error()
		}
		return nil, errors.New(sanitizeText(truncate(message, 4_000)))
	}
	result := map[string]any{"accepted": true, "queued": true, "status": "accepted"}
	if output := strings.TrimSpace(stdout); output != "" {
		result["output"] = sanitizeText(truncate(output, 4_000))
		var decoded any
		if json.Unmarshal([]byte(output), &decoded) == nil {
			for _, key := range []string{"task_id", "program_id", "status"} {
				if value := findString(decoded, key); value != "" {
					result[key] = value
				}
			}
		}
	}
	return result, nil
}

func parseStatusRequest(payload []byte) (statusRequest, error) {
	if len(bytes.TrimSpace(payload)) == 0 {
		payload = []byte(`{}`)
	}
	var request statusRequest
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return statusRequest{}, errors.New("acp_status accepts only task_id or program_id")
	}
	if request.TaskID != "" && request.ProgramID != "" {
		return statusRequest{}, errors.New("acp_status accepts one selected record")
	}
	if request.TaskID != "" {
		if err := validateID(request.TaskID, "task_id"); err != nil {
			return statusRequest{}, err
		}
	}
	if request.ProgramID != "" {
		if err := validateID(request.ProgramID, "program_id"); err != nil {
			return statusRequest{}, err
		}
	}
	return request, nil
}

func parseActionRequest(payload []byte) (actionRequest, error) {
	var request actionRequest
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return actionRequest{}, errors.New("invalid ACP action payload")
	}
	if strings.TrimSpace(request.Type) == "" {
		return actionRequest{}, errors.New("ACP action type is required")
	}
	return request, nil
}

func loadSource(machine string) (source, error) {
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return source{}, errors.New("failed to resolve ACP home")
	}
	registryPath := filepath.Join(home, ".local", "state", "open-agents", "capability-registry.json")
	value, err := readJSON(registryPath)
	if err != nil {
		return source{}, errors.New("ACP capability registry is unavailable")
	}
	root, ok := value.(map[string]any)
	if !ok {
		return source{}, errors.New("ACP capability registry is malformed")
	}
	instances, ok := root["harness_instances"].([]any)
	if !ok {
		return source{}, errors.New("ACP capability registry has no harness instances")
	}
	var release string
	for _, raw := range instances {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		itemMachine, _ := textValue(item, "machine")
		harness, _ := textValue(item, "harness")
		freshness, _ := item["freshness"].(map[string]any)
		activated, _ := textValue(freshness, "activated_path")
		if itemMachine == machine && harness == "open-agents-release" && filepath.IsAbs(activated) {
			release = activated
			break
		}
	}
	if release == "" {
		return source{}, errors.New("ACP activated release is unavailable for this machine")
	}
	if info, statErr := os.Stat(release); statErr != nil || !info.IsDir() {
		return source{}, errors.New("ACP activated release directory is unavailable")
	}
	src := source{
		home:         home,
		codingRoot:   filepath.Join(home, ".hermes", "coding"),
		releaseRoot:  release,
		entrypoint:   filepath.Join(release, "scripts", "hermes-coding-dispatch.py"),
		routerPath:   filepath.Join(release, "hermes", "config", "model-router.json"),
		modelPath:    filepath.Join(release, "hermes", "config", "llm-model-registry.json"),
		mapPath:      filepath.Join(release, "hermes", "config", "coding-dispatch-map.md"),
		registryPath: registryPath,
	}
	for _, required := range []string{src.entrypoint, src.routerPath, src.modelPath, src.mapPath} {
		if info, statErr := os.Stat(required); statErr != nil || info.IsDir() {
			return source{}, errors.New("ACP activated release is missing a required source")
		}
	}
	return src, nil
}

func emptyStatus() map[string]any {
	return map[string]any{
		"source":      map[string]any{"available": false},
		"readiness":   map[string]any{"available": false, "ready": false, "reasons": []string{"ACP source is unavailable"}},
		"routing":     unavailableRouting(errors.New("ACP routing is unavailable")),
		"quota":       unavailableQuota(errors.New("ACP quota is unavailable")),
		"activations": unavailableActivations(errors.New("ACP activation facts are unavailable")),
		"fleet":       unavailableFleet(errors.New("ACP fleet facts are unavailable")),
		"work":        unavailableWork(errors.New("ACP work source is unavailable")),
		"attention":   []map[string]any{},
	}
}

func setUnavailable(result map[string]any, err error) {
	reason := err.Error()
	result["source"] = map[string]any{"available": false, "error": reason}
	result["readiness"] = map[string]any{"available": false, "ready": false, "reasons": []string{reason}}
}

func unavailableQuota(err error) map[string]any {
	return map[string]any{"available": false, "error": err.Error(), "items": []map[string]any{}}
}

func unavailableActivations(err error) map[string]any {
	return map[string]any{"available": false, "error": err.Error(), "rows": []map[string]any{}}
}

func unavailableFleet(err error) map[string]any {
	return map[string]any{
		"available": false, "error": err.Error(), "release_alignment": "unknown",
		"activations": []map[string]any{}, "capabilities": []map[string]any{},
	}
}

func unavailableRouting(err error) map[string]any {
	return map[string]any{
		"available": false, "error": err.Error(), "repositories": []string{},
		"builder": defaultPolicy("builder", err.Error()), "reviewer": defaultPolicy("reviewer", err.Error()),
		"latest_builder_resolution": nil, "latest_reviewer_resolution": nil,
	}
}

func unavailableWork(err error) map[string]any {
	return map[string]any{
		"available": false, "error": err.Error(), "partial": false, "skipped_count": 0,
		"records":  []map[string]any{},
		"counts":   map[string]any{"active": 0, "attention": 0, "history": 0, "total": 0},
		"selected": nil,
	}
}

func parseQuota(src source) (map[string]any, error) {
	value, err := readJSON(filepath.Join(src.home, ".local", "state", "open-agents", "quota-latest.json"))
	if err != nil {
		return nil, errors.New("ACP quota source is unavailable")
	}
	root, ok := value.(map[string]any)
	if !ok {
		return nil, errors.New("ACP quota source is malformed")
	}
	generatedAt, ok := textValue(root, "generated_at")
	if !ok {
		return nil, errors.New("ACP quota source has no measurement time")
	}
	generated, parseErr := time.Parse(time.RFC3339Nano, generatedAt)
	if parseErr != nil {
		return nil, errors.New("ACP quota measurement time is invalid")
	}
	pools, ok := root["pools"].([]any)
	if !ok {
		return nil, errors.New("ACP quota source has no pools")
	}
	items := make([]map[string]any, 0, len(pools))
	for _, raw := range pools {
		pool, ok := raw.(map[string]any)
		if !ok {
			return nil, errors.New("ACP quota pool is malformed")
		}
		provider, providerOK := textValue(pool, "provider")
		poolID, poolOK := textValue(pool, "pool_id")
		confidence, confidenceOK := textValue(pool, "confidence")
		if !providerOK || !poolOK || !confidenceOK {
			return nil, errors.New("ACP quota pool is missing operator-safe fields")
		}
		if confidence != "measured" && confidence != "stale" && confidence != "unmeasurable" {
			return nil, errors.New("ACP quota confidence is invalid")
		}
		usedValue, usedPresent := pool["used_percent"]
		if !usedPresent {
			return nil, errors.New("ACP quota used_percent is missing")
		}
		used, usedOK := numberOrNil(usedValue)
		if !usedOK {
			return nil, errors.New("ACP quota used_percent is invalid")
		}
		resetValue, resetPresent := pool["resets_at"]
		if !resetPresent {
			return nil, errors.New("ACP quota resets_at is missing")
		}
		resets, resetsOK := nullableText(resetValue)
		if !resetsOK {
			return nil, errors.New("ACP quota reset time is invalid")
		}
		measuredAt, _ := textValue(pool, "measured_at")
		poolKind, _ := textValue(pool, "pool_kind")
		routingEnabled := true
		if value, exists := pool["routing_enabled"]; exists {
			if typed, valid := value.(bool); valid {
				routingEnabled = typed
			}
		}
		shared := strings.HasPrefix(poolID, "codex-account-")
		if sourceInfo, valid := pool["source"].(map[string]any); valid {
			if plan, _ := textValue(sourceInfo, "plan_type"); strings.EqualFold(plan, "team") {
				shared = true
			}
		}
		status := confidence
		if used == nil {
			status = "unmeasurable"
		} else if *used >= quotaExhaustedUsed {
			status = "exhausted"
		}
		usedPercent := any(nil)
		remaining := any(nil)
		if used != nil {
			usedPercent = *used
			remaining = maxFloat(0, 100-*used)
		}
		effect := "routable"
		if shared {
			effect = "shared/nonblocking"
		} else if !routingEnabled {
			effect = "disabled"
		} else if status == "exhausted" {
			effect = "blocking"
		} else if confidence != "measured" || used == nil {
			effect = "held: quota freshness unavailable"
		} else if *used >= 100-reviewerReserveFloor {
			effect = "held: reserve floor"
		}
		item := map[string]any{
			"provider": provider, "pool_id": poolID, "used_percent": usedPercent,
			"remaining_percent": remaining, "resets_at": resets, "confidence": confidence,
			"status": status, "shared": shared, "routing_enabled": routingEnabled,
			"effect": effect,
		}
		if poolKind != "" {
			item["pool_kind"] = poolKind
		}
		if measuredAt != "" {
			item["measured_at"] = measuredAt
		}
		items = append(items, item)
	}
	return map[string]any{
		"available": true, "generated_at": generatedAt,
		"stale": time.Since(generated) > statusStaleAfter, "items": items,
	}, nil
}

func parseActivations(src source) (map[string]any, error) {
	value, err := readJSON(src.registryPath)
	if err != nil {
		return nil, errors.New("ACP capability registry is unavailable")
	}
	root, ok := value.(map[string]any)
	if !ok {
		return nil, errors.New("ACP capability registry is malformed")
	}
	instances, ok := root["harness_instances"].([]any)
	if !ok {
		return nil, errors.New("ACP capability registry has no harness instances")
	}
	rows := map[string]map[string]any{}
	for _, raw := range instances {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		machine, machineOK := textValue(item, "machine")
		harness, harnessOK := textValue(item, "harness")
		if !machineOK || !harnessOK || (machine != "heavisidelinux" && machine != "homelinux") {
			continue
		}
		if harness != "open-agents-release" {
			continue
		}
		freshness, _ := item["freshness"].(map[string]any)
		version, versionOK := textValue(freshness, "version")
		activated, pathOK := textValue(freshness, "activated_path")
		measured, measuredOK := textValue(item, "measured_at")
		if !versionOK || !pathOK || !measuredOK {
			continue
		}
		rows[machine] = map[string]any{
			"machine": machine, "open_agents_version": version,
			"open_agents_path": activated, "measured_at": measured,
		}
	}
	result := make([]map[string]any, 0, 2)
	for _, machine := range []string{"heavisidelinux", "homelinux"} {
		if row, exists := rows[machine]; exists {
			result = append(result, row)
		} else {
			result = append(result, map[string]any{
				"machine": machine, "open_agents_version": "unknown",
				"open_agents_path": "unknown", "measured_at": "unknown",
			})
		}
	}
	return map[string]any{"available": true, "rows": result}, nil
}

func parseFleet(activations map[string]any, src source) map[string]any {
	rows, _ := activations["rows"].([]map[string]any)
	alignment := "unknown"
	if len(rows) == 2 {
		leftVersion, _ := textValue(rows[0], "open_agents_version")
		rightVersion, _ := textValue(rows[1], "open_agents_version")
		leftPath, _ := textValue(rows[0], "open_agents_path")
		rightPath, _ := textValue(rows[1], "open_agents_path")
		if leftVersion != "" && rightVersion != "" && leftPath != "" && rightPath != "" &&
			leftVersion != "unknown" && rightVersion != "unknown" && leftPath != "unknown" && rightPath != "unknown" {
			if leftVersion == rightVersion && leftPath == rightPath {
				alignment = "aligned"
			} else {
				alignment = "different"
			}
		}
	}
	capabilities := make([]map[string]any, 0, 6)
	value, err := readJSON(src.registryPath)
	if err != nil {
		return map[string]any{
			"available": false, "error": "ACP capability registry is unavailable",
			"release_alignment": alignment, "activations": rows, "capabilities": capabilities,
		}
	}
	root, _ := value.(map[string]any)
	instances, _ := root["harness_instances"].([]any)
	expected := map[string]string{
		"hermes-gateway":      "gateway",
		"dispatch-worker":     "claim-queue-item",
		"open-agents-release": "immutable-artifact",
	}
	for _, machine := range []string{"heavisidelinux", "homelinux"} {
		for _, harness := range []string{"hermes-gateway", "dispatch-worker", "open-agents-release"} {
			capability := expected[harness]
			row := map[string]any{
				"machine": machine, "harness": harness, "capability": capability, "available": false,
			}
			for _, raw := range instances {
				item, valid := raw.(map[string]any)
				if !valid {
					continue
				}
				itemMachine, _ := textValue(item, "machine")
				itemHarness, _ := textValue(item, "harness")
				if itemMachine != machine || itemHarness != harness {
					continue
				}
				if measured, ok := textValue(item, "measured_at"); ok {
					row["measured_at"] = measured
				}
				if version, ok := textValue(item, "version"); ok {
					row["version"] = version
				}
				caps, _ := item["capabilities"].([]any)
				for _, rawCapability := range caps {
					if value, ok := rawCapability.(string); ok && value == capability {
						row["available"] = true
						break
					}
				}
			}
			capabilities = append(capabilities, row)
		}
	}
	return map[string]any{
		"available": true, "release_alignment": alignment,
		"activations": rows, "capabilities": capabilities,
	}
}

func parseRouting(src source, quota map[string]any, records []record) (map[string]any, error) {
	value, err := readJSON(src.routerPath)
	if err != nil {
		return nil, errors.New("ACP router policy is unavailable")
	}
	root, ok := value.(map[string]any)
	if !ok {
		return nil, errors.New("ACP router policy is malformed")
	}
	registryValue, registryErr := readJSON(src.modelPath)
	if registryErr != nil {
		return nil, errors.New("ACP model registry is unavailable")
	}
	providers := modelProviders(registryValue)
	quotaItems, _ := quota["items"].([]map[string]any)
	jobClasses, _ := root["job_classes"].(map[string]any)
	builderClass, _ := jobClasses["builder"].(map[string]any)
	adversaryClass, _ := jobClasses["adversary"].(map[string]any)
	builder := buildPolicy("builder", builderClass, providers, quotaItems)
	reviewer := buildPolicy("reviewer", adversaryClass, providers, quotaItems)
	repositories, mapErr := repoAliases(src.mapPath)
	if mapErr != nil {
		return nil, mapErr
	}
	latestBuilder, latestReviewer := latestResolutions(records)
	return map[string]any{
		"available": true, "repositories": repositories, "builder": builder, "reviewer": reviewer,
		"latest_builder_resolution": latestBuilder, "latest_reviewer_resolution": latestReviewer,
	}, nil
}

func buildReadiness(result map[string]any) map[string]any {
	reasons := make([]string, 0)
	sourceValue, _ := result["source"].(map[string]any)
	if available, _ := sourceValue["available"].(bool); !available {
		if reason, ok := textValue(sourceValue, "error"); ok {
			reasons = append(reasons, reason)
		} else {
			reasons = append(reasons, "ACP source is unavailable")
		}
	}
	routing, _ := result["routing"].(map[string]any)
	if available, _ := routing["available"].(bool); !available {
		reasons = append(reasons, "Activated routing policy is unavailable")
	}
	quota, _ := result["quota"].(map[string]any)
	if available, _ := quota["available"].(bool); !available {
		reasons = append(reasons, "Fresh quota data is unavailable")
	} else if stale, _ := quota["stale"].(bool); stale {
		reasons = append(reasons, "Quota data is stale")
	}
	if builder, ok := routing["builder"].(map[string]any); ok {
		if selectable, _ := builder["selectable"].(bool); !selectable {
			if reason, ok := textValue(builder, "selectable_reason"); ok {
				reasons = append(reasons, "Builder: "+reason)
			}
		}
	}
	ready := len(reasons) == 0
	return map[string]any{"available": len(reasons) == 0 || sourceValue["available"] == true, "ready": ready, "reasons": reasons}
}

func buildPolicy(role string, class map[string]any, providers map[string]string, quotaItems []map[string]any) map[string]any {
	candidates := stringList(class["candidates"])
	lead := ""
	if len(candidates) > 0 {
		lead = candidates[0]
	}
	provider := providers[lead]
	selectable := false
	reason := "No configured lead candidate is available"
	if provider != "" {
		selectable = providerSelectable(role, provider, quotaItems)
		if selectable {
			reason = "Configured lead candidate has a fresh routable capacity pool above its reserve floor"
		} else {
			reason = "No fresh routable capacity pool is available above the configured reserve floor"
		}
	} else if lead != "" {
		reason = "Configured lead candidate is missing from the activated model registry"
	}
	policy := map[string]any{
		"role": role, "candidates": candidates, "selectable": selectable, "selectable_reason": reason,
	}
	if lead != "" {
		policy["lead_model"] = lead
	}
	if provider != "" {
		policy["provider"] = provider
	}
	if effort, ok := textValue(class, "effort"); ok {
		policy["effort"] = effort
	}
	if rationale, ok := textValue(class, "rationale"); ok {
		policy["rationale"] = truncate(firstLine(rationale), 360)
	}
	return policy
}

func defaultPolicy(role, reason string) map[string]any {
	return map[string]any{
		"role": role, "candidates": []string{}, "selectable": false, "selectable_reason": reason,
	}
}

func providerSelectable(role, provider string, items []map[string]any) bool {
	reserveFloor := builderReserveFloor
	if role == "reviewer" {
		reserveFloor = reviewerReserveFloor
	}
	maxUsed := 100 - reserveFloor
	for _, item := range items {
		itemProvider, _ := textValue(item, "provider")
		if itemProvider != provider {
			continue
		}
		if shared, _ := item["shared"].(bool); shared && provider == "openai" {
			continue
		}
		if enabled, exists := item["routing_enabled"].(bool); exists && !enabled {
			continue
		}
		confidence, _ := textValue(item, "confidence")
		if confidence != "measured" {
			continue
		}
		used, ok := numberOrNil(item["used_percent"])
		if !ok || used == nil || *used >= maxUsed {
			continue
		}
		return true
	}
	return false
}

func modelProviders(value any) map[string]string {
	result := map[string]string{}
	root, _ := value.(map[string]any)
	approved, _ := root["approved"].([]any)
	for _, raw := range approved {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		id, idOK := textValue(item, "id")
		provider, providerOK := textValue(item, "provider")
		if idOK && providerOK {
			result[id] = provider
		}
	}
	return result
}

func repoAliases(mapPath string) ([]string, error) {
	data, err := os.ReadFile(mapPath)
	if err != nil {
		return nil, errors.New("ACP repo allowlist is unavailable")
	}
	aliases := make([]string, 0, 32)
	seen := map[string]bool{}
	for _, line := range strings.Split(string(data), "\n") {
		trimmed := strings.TrimSpace(line)
		if !strings.HasPrefix(trimmed, "|") {
			continue
		}
		fields := strings.Split(trimmed, "|")
		if len(fields) < 3 || strings.TrimSpace(fields[1]) == "repo" {
			continue
		}
		alias := strings.TrimSpace(fields[1])
		if !repoPattern.MatchString(alias) || seen[alias] {
			continue
		}
		seen[alias] = true
		aliases = append(aliases, alias)
	}
	sort.Strings(aliases)
	if len(aliases) == 0 {
		return nil, errors.New("ACP repo allowlist is empty")
	}
	return aliases, nil
}

func repoAllowed(mapPath, alias string) bool {
	aliases, err := repoAliases(mapPath)
	if err != nil {
		return false
	}
	for _, value := range aliases {
		if value == alias {
			return true
		}
	}
	return false
}

func latestResolutions(records []record) (map[string]any, map[string]any) {
	var builder, reviewer *record
	for i := range records {
		item := &records[i]
		if hasResolution(item.raw, "builder_lane_resolution") && (builder == nil || item.when.After(builder.when)) {
			builder = item
		}
		if hasResolution(item.raw, "program_reviewer_runtime_route") && (reviewer == nil || item.when.After(reviewer.when)) {
			reviewer = item
		}
	}
	return resolutionFor(builder, "builder_lane_resolution"), resolutionFor(reviewer, "program_reviewer_runtime_route")
}

func hasResolution(raw map[string]any, key string) bool {
	if _, ok := raw[key].(map[string]any); ok {
		return true
	}
	text, ok := raw[key].(string)
	return ok && strings.TrimSpace(text) != ""
}

func resolutionFor(item *record, key string) map[string]any {
	if item == nil {
		return nil
	}
	result := map[string]any{"recorded_at": item.rawTimeString()}
	if item.kind == "task" {
		result["task_id"] = item.id
	} else {
		result["program_id"] = item.id
	}
	if value, ok := item.raw[key].(map[string]any); ok {
		for _, field := range []string{"model", "route", "provider", "effort", "machine", "reserve", "freshness", "selection_reason", "reason"} {
			if text, ok := textValue(value, field); ok {
				if field == "reason" {
					result["selection_reason"] = truncate(firstLine(text), 360)
				} else if field == "route" {
					result["model"] = truncate(firstLine(text), 240)
				} else {
					result[field] = truncate(firstLine(text), 360)
				}
			}
		}
		if rank, ok := numberValue(value["rank_in_ladder"]); ok {
			result["selection_reason"] = fmt.Sprintf("Recorded at rank %d in the activated builder ladder", int(rank))
		}
	} else if route, ok := item.raw[key].(string); ok {
		result["model"] = truncate(firstLine(route), 240)
	}
	for _, field := range []string{"provider", "model", "effort", "machine", "reserve", "freshness"} {
		if _, exists := result[field]; exists {
			continue
		}
		if text, ok := textValue(item.raw, key+"_"+field); ok {
			result[field] = truncate(firstLine(text), 240)
		}
	}
	for _, reasonKey := range []string{key + "_selection_reason", "selection_reason"} {
		if reason, ok := textValue(item.raw, reasonKey); ok {
			result["selection_reason"] = truncate(firstLine(reason), 360)
			break
		}
	}
	return result
}

func parseWork(src source) (map[string]any, []record, error) {
	if info, err := os.Stat(src.codingRoot); err != nil || !info.IsDir() {
		return nil, nil, errors.New("ACP coding state is unavailable")
	}
	stateDirs := []string{
		"queue", "queued", "running", "claimed", "starting",
		"awaiting-input", "awaiting_input", "judgment", "blocked", "needs-review", "needs_review",
		"completed", "complete", "no-op", "no_op", "failed", "error", "cancelled", "canceled",
	}
	byKey := map[string]record{}
	skipped := 0
	partial := false
	for _, state := range stateDirs {
		entries, err := os.ReadDir(filepath.Join(src.codingRoot, state))
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			partial = true
			continue
		}
		count := 0
		for _, entry := range entries {
			if count >= maxRecordsPerState {
				partial = true
				break
			}
			if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
				continue
			}
			count++
			file := filepath.Join(src.codingRoot, state, entry.Name())
			value, err := readJSON(file)
			if err != nil {
				skipped++
				continue
			}
			object, ok := value.(map[string]any)
			if !ok {
				skipped++
				continue
			}
			item, ok := parseRecord(object, "task", state, file)
			if !ok {
				skipped++
				continue
			}
			key := item.kind + ":" + item.id
			if existing, exists := byKey[key]; !exists || item.when.After(existing.when) {
				byKey[key] = item
			}
		}
	}
	programDir := filepath.Join(src.codingRoot, "programs")
	entries, err := os.ReadDir(programDir)
	if err != nil && !os.IsNotExist(err) {
		partial = true
	} else {
		count := 0
		for _, entry := range entries {
			if count >= maxRecordsPerState {
				partial = true
				break
			}
			if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
				continue
			}
			count++
			file := filepath.Join(programDir, entry.Name())
			value, err := readJSON(file)
			if err != nil {
				skipped++
				continue
			}
			object, ok := value.(map[string]any)
			if !ok {
				skipped++
				continue
			}
			item, ok := parseRecord(object, "program", "programs", file)
			if !ok {
				skipped++
				continue
			}
			key := item.kind + ":" + item.id
			if existing, exists := byKey[key]; !exists || item.when.After(existing.when) {
				byKey[key] = item
			}
		}
	}
	records := make([]record, 0, len(byKey))
	for _, item := range byKey {
		records = append(records, item)
	}
	sort.Slice(records, func(i, j int) bool {
		if records[i].when.Equal(records[j].when) {
			return records[i].id < records[j].id
		}
		return records[i].when.After(records[j].when)
	})
	counts := map[string]any{"active": 0, "attention": 0, "history": 0, "total": len(records)}
	for _, item := range records {
		if state, _ := item.summary["state"].(string); state != "" {
			counts[state] = counts[state].(int) + 1
		}
	}
	bounded := records
	if len(bounded) > maxWorkRecords {
		bounded = bounded[:maxWorkRecords]
		partial = true
	}
	summaries := make([]map[string]any, 0, len(bounded))
	for _, item := range bounded {
		summaries = append(summaries, item.summary)
	}
	return map[string]any{
		"available": true, "partial": partial || skipped > 0, "skipped_count": skipped,
		"records": summaries, "counts": counts, "selected": nil,
	}, records, nil
}

func parseRecord(object map[string]any, kind, stateHint, file string) (record, bool) {
	idKey := "task_id"
	if kind == "program" {
		idKey = "program_id"
	}
	id, idOK := textValue(object, idKey)
	repo, repoOK := textValue(object, "repo")
	status, statusOK := textValue(object, "status")
	requested, requestedOK := textValue(object, "requested_at")
	if !idOK || !idPattern.MatchString(id) || !repoOK || !statusOK || !requestedOK {
		return record{}, false
	}
	when := parseTime(firstPresent(object, "updated_at", "completed_at", "last_attempted_at", "started_at", "requested_at"))
	if when.IsZero() {
		return record{}, false
	}
	state := normalizeState(status, stateHint, kind)
	objective := safeObjective(object, kind)
	summary := map[string]any{
		"kind": kind, "id": id, "repo": repo, "state": state, "raw_status": status,
		"detail_available": true,
	}
	if objective != "" {
		summary["objective"] = objective
	}
	for _, key := range []string{"lane", "next_action", "machine", "provider", "model", "effort"} {
		if value, ok := textValue(object, key); ok {
			summary[key] = truncate(firstLine(value), 360)
		}
	}
	if resolution, ok := object["builder_lane_resolution"].(map[string]any); ok {
		for _, key := range []string{"provider", "model", "effort", "machine"} {
			if _, exists := summary[key]; exists {
				continue
			}
			if value, ok := textValue(resolution, key); ok {
				summary[key] = truncate(firstLine(value), 160)
			}
		}
	}
	if programID, ok := textValue(object, "program_id"); ok && idPattern.MatchString(programID) {
		summary["program_id"] = programID
	}
	if relation, ok := textValue(object, "program_role"); ok {
		summary["program_relation"] = truncate(firstLine(relation), 120)
	}
	if requested != "" {
		summary["requested_at"] = requested
	}
	updated := firstPresent(object, "updated_at", "completed_at", "last_attempted_at", "started_at")
	if updated != "" {
		summary["updated_at"] = updated
	}
	if state == "attention" {
		if reason, ok := textValue(object, "awaiting_input_question"); ok {
			summary["attention_reason"] = truncate(firstLine(reason), 360)
		} else if reason, ok := textValue(object, "program_judgment_reason"); ok {
			summary["attention_reason"] = truncate(firstLine(reason), 360)
		} else if next, ok := textValue(object, "next_action"); ok {
			summary["attention_reason"] = truncate(firstLine(next), 360)
		}
	}
	return record{kind: kind, id: id, repo: repo, stateHint: stateHint, file: file, raw: object, summary: summary, when: when}, true
}

func normalizeState(status, hint, kind string) string {
	normalized := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(strings.TrimSpace(status), "_", "-"), " ", "-"))
	hinted := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(strings.TrimSpace(hint), "_", "-"), " ", "-"))
	if normalized == "completed" || normalized == "complete" || normalized == "no-op" || normalized == "failed" || normalized == "error" || normalized == "canceled" || normalized == "cancelled" {
		return "history"
	}
	switch hinted {
	case "completed", "complete", "no-op", "failed", "error", "cancelled", "canceled":
		return "history"
	case "queue", "queued", "claimed", "starting", "running":
		return "active"
	case "interview", "awaiting-approval", "awaiting-input", "judgment", "blocked", "needs-review":
		return "attention"
	}
	switch normalized {
	case "queue", "queued", "claimed", "starting", "running", "in-progress":
		return "active"
	case "interview", "awaiting-approval", "awaiting-input", "judgment", "blocked", "needs-review":
		return "attention"
	default:
		if kind == "program" && normalized == "needs-review" {
			return "attention"
		}
		return "history"
	}
}

func buildAttention(records []record) []map[string]any {
	items := make([]map[string]any, 0)
	for _, item := range records {
		state, _ := item.summary["state"].(string)
		if state != "attention" {
			continue
		}
		title, _ := item.summary["objective"].(string)
		if title == "" {
			title = item.id
		}
		reason, _ := item.summary["attention_reason"].(string)
		if reason == "" {
			reason = "ACP item needs operator attention"
		}
		items = append(items, map[string]any{
			"id": item.kind + ":" + item.id, "record_id": item.id, "kind": item.kind,
			"title": title, "repo": item.repo, "reason": reason,
			"created_at": item.rawTimeString(), "session_id": nil, "session_status": "ACP_ATTENTION",
		})
		if len(items) >= maxAttentionItems {
			break
		}
	}
	return items
}

func copyResolutionFields(result map[string]any, role string, raw any) {
	if value, ok := raw.(map[string]any); ok {
		for _, field := range []string{"machine", "provider", "model", "effort"} {
			if text, ok := textValue(value, field); ok {
				result[role+"_"+field] = truncate(firstLine(text), 240)
			}
		}
		if _, exists := result[role+"_model"]; !exists {
			if route, ok := textValue(value, "route"); ok {
				result[role+"_model"] = truncate(firstLine(route), 240)
			}
		}
		return
	}
	if text, ok := raw.(string); ok && strings.TrimSpace(text) != "" {
		result[role+"_model"] = truncate(firstLine(text), 240)
	}
}

func buildDetail(item record, records []record, src source) map[string]any {
	result := cloneMap(item.summary)
	copyResolutionFields(result, "builder", item.raw["builder_lane_resolution"])
	copyResolutionFields(result, "reviewer", item.raw["program_reviewer_runtime_route"])
	for _, role := range []string{"builder", "reviewer"} {
		for _, field := range []string{"machine", "provider", "model", "effort"} {
			if value, ok := textValue(item.raw, role+"_"+field); ok {
				result[role+"_"+field] = truncate(firstLine(value), 240)
			}
		}
	}
	if value, ok := numberValue(item.raw["duration_ms"]); ok && value >= 0 {
		result["duration_ms"] = int64(value)
	}
	if value, ok := numberValue(item.raw["cost_usd"]); ok && value >= 0 {
		result["cost_usd"] = value
	}
	if value, ok := numberValue(item.raw["input_tokens"]); ok && value >= 0 {
		result["input_tokens"] = int64(value)
	}
	if value, ok := numberValue(item.raw["output_tokens"]); ok && value >= 0 {
		result["output_tokens"] = int64(value)
	}
	if attempts, ok := item.raw["attempts"].([]any); ok {
		result["attempts"] = len(attempts)
		checkpoints := make([]string, 0, len(attempts))
		var cost float64
		var inputTokens, outputTokens int64
		for _, rawAttempt := range attempts {
			attempt, valid := rawAttempt.(map[string]any)
			if !valid {
				continue
			}
			if checkpoint, ok := textValue(attempt, "status"); ok {
				checkpoints = append(checkpoints, truncate(firstLine(checkpoint), 120))
			}
			if value, ok := numberValue(attempt["cost_usd"]); ok {
				cost += value
			}
			if value, ok := numberValue(attempt["input_tokens"]); ok {
				inputTokens += int64(value)
			}
			if value, ok := numberValue(attempt["output_tokens"]); ok {
				outputTokens += int64(value)
			}
		}
		if len(checkpoints) > 0 {
			result["checkpoints"] = checkpoints
		}
		if _, exists := result["cost_usd"]; !exists && cost > 0 {
			result["cost_usd"] = cost
		}
		if _, exists := result["input_tokens"]; !exists && inputTokens > 0 {
			result["input_tokens"] = inputTokens
		}
		if _, exists := result["output_tokens"]; !exists && outputTokens > 0 {
			result["output_tokens"] = outputTokens
		}
	}
	if value, ok := textValue(item.raw, "verification_status"); ok {
		result["verification_status"] = value
		result["verification"] = value
	}
	if value, ok := textValue(item.raw, "verdict"); ok {
		result["verdict"] = truncate(firstLine(value), 160)
	}
	if value, ok := textValue(item.raw, "verdict_reason"); ok {
		result["verdict_reason"] = truncate(firstLine(value), 360)
	}
	if blockers := safeBlockers(item.raw["review_blockers"]); len(blockers) > 0 {
		result["blockers"] = blockers
	}
	if changed := safeStringList(item.raw["changed_files"], 100); len(changed) > 0 {
		result["changed_files"] = changed
	}
	if branch, ok := textValue(item.raw, "branch"); ok {
		result["worktree_ref"] = truncate(firstLine(branch), 240)
	} else if ref, ok := textValue(item.raw, "ref"); ok {
		result["worktree_ref"] = truncate(firstLine(ref), 240)
	}
	if receipt, ok := textValue(item.raw, "receipt_target"); ok {
		result["receipt_target"] = receipt
	}
	if item.kind == "task" {
		if tail := readSafeLogTail(item.raw, src); tail != "" {
			result["log_tail"] = tail
		}
	}
	if item.kind == "program" {
		program := map[string]any{}
		if gates := safeGateList(item.raw["gate_states"]); len(gates) > 0 {
			program["gates"] = gates
		}
		if lanes := safeLaneList(item.raw["lanes"]); len(lanes) > 0 {
			program["lanes"] = lanes
		}
		if deps := safeStringList(item.raw["dependencies"], 40); len(deps) > 0 {
			program["dependencies"] = deps
		}
		if budget := safeBudget(item.raw["budget"]); len(budget) > 0 {
			program["budget"] = budget
		}
		if next, ok := textValue(item.raw, "next_action"); ok {
			program["next_action"] = truncate(firstLine(next), 360)
		}
		if setupID, ok := textValue(item.raw, "setup_task_id"); ok {
			for _, task := range records {
				if task.id != setupID || task.kind != "task" {
					continue
				}
				if gate, ok := textValue(task.raw, "program_judgment_gate"); ok {
					program["setup_gate"] = gate
				}
				if digest, digestErr := approvalDigest(task.raw); digestErr == nil {
					result["approval_snapshot_digest"] = digest
				}
				break
			}
		}
		if len(program) > 0 {
			result["program"] = program
		}
	}
	if digest, err := approvalDigest(item.raw); err == nil {
		result["approval_snapshot_digest"] = digest
	}
	return result
}

func findProgramSetup(codingRoot, programID string) (map[string]any, map[string]any, error) {
	programPath := filepath.Join(codingRoot, "programs", programID+".json")
	programValue, err := readJSON(programPath)
	if err != nil {
		return nil, nil, errors.New("ACP program is unavailable")
	}
	program, ok := programValue.(map[string]any)
	if !ok {
		return nil, nil, errors.New("ACP program record is malformed")
	}
	setupID, ok := textValue(program, "setup_task_id")
	if !ok || !idPattern.MatchString(setupID) {
		return program, nil, errors.New("ACP program setup task is unavailable")
	}
	states := []string{"awaiting-input", "awaiting_input", "needs-review", "needs_review", "judgment", "blocked", "completed", "complete", "no-op", "no_op", "failed", "error", "cancelled", "canceled"}
	for _, state := range states {
		path := filepath.Join(codingRoot, state, setupID+".json")
		value, readErr := readJSON(path)
		if readErr != nil {
			continue
		}
		if task, valid := value.(map[string]any); valid {
			return program, task, nil
		}
	}
	return program, nil, errors.New("ACP program setup task is unavailable")
}

func approvalDigest(setup map[string]any) (string, error) {
	history, ok := setup["awaiting_input_history"].([]any)
	if !ok || len(history) == 0 {
		return "", errors.New("ACP program has no approval history")
	}
	last, ok := history[len(history)-1].(map[string]any)
	if !ok {
		return "", errors.New("ACP approval history is malformed")
	}
	snapshot, ok := last["approval_snapshot"].(map[string]any)
	if !ok {
		return "", errors.New("ACP program has no frozen approval snapshot")
	}
	digest, ok := textValue(snapshot, "combined_sha256")
	if !ok || !digestPattern.MatchString(digest) {
		return "", errors.New("ACP frozen approval snapshot is invalid")
	}
	return strings.ToLower(digest), nil
}

func judgmentGate(program, setup map[string]any) bool {
	if status, ok := textValue(program, "status"); ok {
		normalized := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(status, "_", "-"), " ", "-"))
		if strings.Contains(normalized, "review") || strings.Contains(normalized, "judgment") {
			return true
		}
	}
	if role, ok := textValue(setup, "program_role"); ok && strings.EqualFold(role, "judgment") {
		return true
	}
	if gate, ok := textValue(setup, "program_judgment_gate"); ok && gate != "" {
		return true
	}
	if state, ok := textValue(setup, "program_judgment_state"); ok && strings.Contains(strings.ToLower(state), "review") {
		return true
	}
	return false
}

func readSafeLogTail(raw map[string]any, src source) string {
	pathValue, ok := textValue(raw, "log_file")
	if !ok || pathValue == "" {
		return ""
	}
	path := pathValue
	if strings.HasPrefix(path, "~/") {
		path = filepath.Join(src.home, strings.TrimPrefix(path, "~/"))
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return ""
	}
	resolvedRoot, err := filepath.EvalSymlinks(src.codingRoot)
	if err != nil {
		return ""
	}
	resolved, err := filepath.EvalSymlinks(absolute)
	if err != nil {
		return ""
	}
	relative, err := filepath.Rel(resolvedRoot, resolved)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(os.PathSeparator)) {
		return ""
	}
	data, err := os.ReadFile(resolved)
	if err != nil {
		return ""
	}
	if len(data) > maxLogBytes {
		data = data[len(data)-maxLogBytes:]
	}
	return sanitizeText(string(data))
}

func safeBlockers(value any) []string {
	if value == nil {
		return nil
	}
	if text, ok := value.(string); ok {
		return boundedLines(text, 8, 360)
	}
	return safeStringList(value, 8)
}

func safeStringList(value any, limit int) []string {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	result := make([]string, 0, minInt(limit, len(items)))
	for _, raw := range items {
		text, ok := raw.(string)
		if !ok || strings.TrimSpace(text) == "" {
			continue
		}
		text = strings.TrimSpace(text)
		if filepath.IsAbs(text) || strings.Contains(text, "\\") {
			text = "[redacted path]"
		}
		result = append(result, truncate(firstLine(text), 240))
		if len(result) >= limit {
			break
		}
	}
	return result
}

func safeGateList(value any) []string {
	object, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	keys := make([]string, 0, len(object))
	for key, raw := range object {
		if text, ok := raw.(string); ok {
			keys = append(keys, truncate(key+"="+firstLine(text), 180))
		}
	}
	sort.Strings(keys)
	return keys
}

func safeLaneList(value any) []string {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	result := make([]string, 0, len(items))
	for _, raw := range items {
		if object, valid := raw.(map[string]any); valid {
			name, _ := textValue(object, "name")
			if name == "" {
				name, _ = textValue(object, "lane")
			}
			status, _ := textValue(object, "status")
			if name != "" && status != "" {
				result = append(result, truncate(firstLine(name+"="+status), 180))
			} else if name != "" {
				result = append(result, truncate(firstLine(name), 180))
			}
		}
	}
	return result
}

func safeBudget(value any) map[string]any {
	object, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	result := map[string]any{}
	for _, key := range []string{"ceiling_usd", "consumed_usd", "remaining_usd"} {
		if number, ok := numberValue(object[key]); ok {
			result[key] = number
		}
	}
	return result
}

func writeInputFile(dir, name string, value map[string]any) (string, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return "", errors.New("failed to encode ACP input")
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, data, 0600); err != nil {
		return "", errors.New("failed to write ACP input")
	}
	if err := os.Chmod(path, 0600); err != nil {
		return "", errors.New("failed to secure ACP input")
	}
	return path, nil
}

func runCommand(entrypoint string, args []string) (string, string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, entrypoint, args...)
	var stdout, stderr limitedBuffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	err := command.Run()
	if ctx.Err() != nil {
		return stdout.String(), stderr.String(), errors.New("ACP command timed out")
	}
	return stdout.String(), stderr.String(), err
}

func readJSON(path string) (any, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		return nil, err
	}
	return value, nil
}

func textValue(object map[string]any, key string) (string, bool) {
	if object == nil {
		return "", false
	}
	value, ok := object[key].(string)
	value = strings.TrimSpace(value)
	return value, ok && value != ""
}

func nullableText(value any) (any, bool) {
	if value == nil {
		return nil, true
	}
	text, ok := value.(string)
	if !ok {
		return nil, false
	}
	return strings.TrimSpace(text), true
}

func numberOrNil(value any) (*float64, bool) {
	if value == nil {
		return nil, true
	}
	number, ok := numberValue(value)
	if !ok {
		return nil, false
	}
	return &number, true
}

func numberValue(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case json.Number:
		number, err := typed.Float64()
		return number, err == nil
	default:
		return 0, false
	}
}

func firstPresent(object map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := textValue(object, key); ok {
			return value
		}
	}
	return ""
}

func safeObjective(object map[string]any, kind string) string {
	keys := []string{"objective", "goal", "task"}
	if kind == "program" {
		keys = []string{"goal", "objective", "task"}
	}
	for _, key := range keys {
		if value, ok := textValue(object, key); ok {
			return truncate(firstLine(value), 280)
		}
	}
	return ""
}

func firstLine(value string) string {
	for _, line := range strings.Split(strings.TrimSpace(value), "\n") {
		line = strings.TrimSpace(line)
		line = strings.TrimLeft(line, "# ")
		if line != "" {
			return line
		}
	}
	return ""
}

func parseTime(value string) time.Time {
	if value == "" {
		return time.Time{}
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Time{}
	}
	return parsed
}

func (item record) rawTimeString() string {
	for _, key := range []string{"updated_at", "completed_at", "last_attempted_at", "started_at", "requested_at"} {
		if value, ok := textValue(item.raw, key); ok {
			return value
		}
	}
	return item.when.UTC().Format(time.RFC3339)
}

func cloneMap(value map[string]any) map[string]any {
	result := make(map[string]any, len(value))
	for key, item := range value {
		result[key] = item
	}
	return result
}

func findString(value any, key string) string {
	switch typed := value.(type) {
	case map[string]any:
		if text, ok := textValue(typed, key); ok {
			return text
		}
		for _, child := range typed {
			if result := findString(child, key); result != "" {
				return result
			}
		}
	case []any:
		for _, child := range typed {
			if result := findString(child, key); result != "" {
				return result
			}
		}
	}
	return ""
}

func validateID(value, field string) error {
	value = strings.TrimSpace(value)
	if value == "" || !idPattern.MatchString(value) || strings.Contains(value, "..") || strings.ContainsAny(value, `/\\`) || strings.IndexByte(value, 0) >= 0 {
		return fmt.Errorf("ACP %s is invalid", field)
	}
	return nil
}

func validateUserText(value, field string) error {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 4_000 || strings.ContainsRune(value, '\x00') {
		return fmt.Errorf("ACP %s is invalid", field)
	}
	if strings.HasPrefix(value, "-") {
		return fmt.Errorf("ACP %s cannot begin with a CLI option", field)
	}
	return nil
}

func sanitizeText(value string) string {
	value = secretPattern.ReplaceAllString(value, `$1=[redacted]`)
	value = absolutePattern.ReplaceAllString(value, "[redacted path]")
	return truncate(value, maxLogBytes)
}

func truncate(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	return value[:limit] + "…"
}

func boundedLines(value string, limit, lineLimit int) []string {
	lines := strings.Split(value, "\n")
	result := make([]string, 0, minInt(limit, len(lines)))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		result = append(result, truncate(firstLine(line), lineLimit))
		if len(result) >= limit {
			break
		}
	}
	return result
}

func stringList(value any) []string {
	items, ok := value.([]any)
	if !ok {
		return []string{}
	}
	result := make([]string, 0, len(items))
	for _, raw := range items {
		if text, ok := raw.(string); ok && strings.TrimSpace(text) != "" {
			result = append(result, truncate(firstLine(text), 160))
		}
	}
	return result
}

func minInt(left, right int) int {
	if left < right {
		return left
	}
	return right
}

func maxFloat(left, right float64) float64 {
	if left > right {
		return left
	}
	return right
}
