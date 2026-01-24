/**
 * Detection Engine for Orchestrator
 *
 * Analyzes terminal snapshots to detect actionable prompts:
 * - Multi-choice selections (1., 2., 3., etc.)
 * - Yes/No confirmations
 * - Text input prompts
 * - Plan review requests
 * - Error states
 *
 * Uses ANSI stripping + pattern matching (no AI/LLM).
 */

// ANSI escape sequence pattern
const ANSI_PATTERN = /\x1B\[[0-?]*[ -/]*[@-~]/g;

export type DetectedActionType =
  | 'multi_choice'
  | 'yes_no'
  | 'text_input'
  | 'plan_review'
  | 'error'
  | 'needs_attention';

export interface DetectedOption {
  value: string;
  label: string;
}

export interface DetectedAction {
  type: DetectedActionType;
  question?: string;
  options?: DetectedOption[];
  context: string; // Last 40-60 lines of relevant context
  confidence: number; // 0-1 confidence score
  suggestedResponse?: string; // For yes/no, could be 'y' or 'n'
  placeholder?: string;
  multiline?: boolean;
  allowCustom?: boolean;
}

export interface DetectionResult {
  action: DetectedAction | null;
  captureHash: string;
  analyzedAt: number;
}

/**
 * Strip ANSI escape codes from text.
 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

/**
 * Generate a simple hash for deduplication.
 */
export function generateCaptureHash(text: string): string {
  // Simple hash based on last 100 chars (sufficient for dedup)
  const suffix = text.slice(-100);
  let hash = 0;
  for (let i = 0; i < suffix.length; i++) {
    const char = suffix.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(16);
}

// Pattern definitions
const YES_NO_PATTERNS = [
  /\b(y\/n|yes\/no|\[y\].*\[n\]|\[n\].*\[y\])\s*[?:>]?\s*$/i,
  /\bproceed\s*\?\s*\(y\/n\)/i,
  /\bcontinue\s*\?\s*\(y\/n\)/i,
  /\bconfirm\s*\?\s*\(y\/n\)/i,
  /\b(allow|approve|deny|reject)\s*\?\s*$/i,
  /\bdo you want to\b.*\?\s*$/i,
  /\bare you sure\b.*\?\s*$/i,
  /\bwould you like to\b.*\?\s*$/i,
];

const TEXT_INPUT_PATTERNS = [
  /\b(enter|type|input|provide)\s+(a|the|your)?\s*\w+[?:>]\s*$/i,
  /\bwhat\s+(is|should|would)\b.*[?:>]\s*$/i,
  /\bplease\s+(enter|type|input|provide)\b.*[?:>]\s*$/i,
  /\b(name|path|url|value|response)[?:>]\s*$/i,
  />\s*$/,  // Simple prompt ending with >
];

const PLAN_REVIEW_PATTERNS = [
  /\b(review|approve|accept)\s+(the\s+)?(plan|proposal|changes)\b/i,
  /\bplan\s+mode\b/i,
  /\bimplementation\s+plan\b/i,
  /\bplease\s+review\b.*plan/i,
];

const DECISION_OPTION_LINE_PATTERN = /^\s*(allow|deny|approve|reject|yes|no)\s*$/i;
const DECISION_PAIR_PATTERN = /\[y\].*\[n\]|\[n\].*\[y\]/i;

const ERROR_PATTERNS = [
  /\berror\b[:!]/i,
  /\bfailed\b[:!]/i,
  /\bexception\b[:!]/i,
  /\bcrash(ed)?\b[:!]/i,
  /\btraceback\b/i,
  /\bpanic\b[:!]/i,
  /\bfatal\b[:!]/i,
  /\bunhandled\s+(error|exception)\b/i,
];

const MULTI_CHOICE_OPTION_PATTERN = /^\s*(?:[❯>•]\s*)?(\d+)\.\s+(.+)$/;

// Status patterns for "needs attention" detection
const WAITING_PATTERNS = [
  /waiting\s+for\s+(input|approval|response)/i,
  /\bpress\s+(enter|any\s+key)\b/i,
  /\bselect\s+(an?\s+)?option\b/i,
  /\bchoose\b.*:/i,
];

/**
 * Analyze a terminal snapshot and detect any actionable state.
 */
export function analyzeSnapshot(
  text: string,
  captureHash?: string
): DetectionResult {
  const cleanText = stripAnsi(text);
  const hash = captureHash || generateCaptureHash(cleanText);
  const lines = cleanText.split('\n');
  const recentLines = lines.slice(-60);
  const context = recentLines.join('\n');

  // Try to detect in order of specificity

  // 1. Multi-choice detection
  const multiChoice = detectMultiChoice(recentLines);
  if (multiChoice) {
    return {
      action: { ...multiChoice, context },
      captureHash: hash,
      analyzedAt: Date.now(),
    };
  }

  // 2. Plan review detection (before yes/no to avoid (y/n) pattern stealing plan approvals)
  const planReview = detectPlanReview(recentLines);
  if (planReview) {
    return {
      action: { ...planReview, context },
      captureHash: hash,
      analyzedAt: Date.now(),
    };
  }

  // 3. Yes/No detection
  const yesNo = detectYesNo(recentLines);
  if (yesNo) {
    return {
      action: { ...yesNo, context },
      captureHash: hash,
      analyzedAt: Date.now(),
    };
  }

  // 4. Error detection
  const error = detectError(recentLines);
  if (error) {
    return {
      action: { ...error, context },
      captureHash: hash,
      analyzedAt: Date.now(),
    };
  }

  // 5. Text input detection (less specific, do last)
  const textInput = detectTextInput(recentLines);
  if (textInput) {
    return {
      action: { ...textInput, context },
      captureHash: hash,
      analyzedAt: Date.now(),
    };
  }

  // 6. Generic "needs attention" detection
  const needsAttention = detectNeedsAttention(recentLines);
  if (needsAttention) {
    return {
      action: { ...needsAttention, context },
      captureHash: hash,
      analyzedAt: Date.now(),
    };
  }

  return {
    action: null,
    captureHash: hash,
    analyzedAt: Date.now(),
  };
}

function detectMultiChoice(lines: string[]): Omit<DetectedAction, 'context'> | null {
  const options: DetectedOption[] = [];
  let firstOptionIndex = -1;

  // Find options (numbered items)
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = lines[i].match(MULTI_CHOICE_OPTION_PATTERN);
    if (match) {
      firstOptionIndex = i; // Keep updating - ends up as topmost option
      options.unshift({ value: match[1], label: match[2].trim() });
    } else if (options.length > 0) {
      // Stop if we hit a non-option line after finding options
      break;
    }
  }

  if (options.length < 2) return null;

  // Look for question/prompt above options (search ABOVE the first/topmost option)
  let question = '';
  const searchStart = Math.max(0, firstOptionIndex - 8);
  for (let i = firstOptionIndex - 1; i >= searchStart; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.endsWith('?') || line.endsWith(':')) {
      question = line;
      break;
    }
    // Check for common prompts
    const lower = line.toLowerCase();
    if (
      lower.includes('select') ||
      lower.includes('choose') ||
      lower.includes('which') ||
      lower.includes('pick')
    ) {
      question = line;
      break;
    }
  }

  return {
    type: 'multi_choice',
    question: question || 'Select an option',
    options,
    confidence: question ? 0.9 : 0.7,
  };
}

function detectYesNo(lines: string[]): Omit<DetectedAction, 'context'> | null {
  // Check last few lines for yes/no prompts
  const recentText = lines.slice(-10).join('\n');

  for (const pattern of YES_NO_PATTERNS) {
    if (pattern.test(recentText)) {
      // Find the question
      const question = findQuestion(lines.slice(-10));
      return {
        type: 'yes_no',
        question: question || 'Confirmation required',
        options: [
          { value: 'y', label: 'Yes' },
          { value: 'n', label: 'No' },
        ],
        confidence: 0.85,
      };
    }
  }

  return null;
}

function detectTextInput(lines: string[]): Omit<DetectedAction, 'context'> | null {
  const recentText = lines.slice(-5).join('\n');

  for (const pattern of TEXT_INPUT_PATTERNS) {
    if (pattern.test(recentText)) {
      const question = findQuestion(lines.slice(-5));
      return {
        type: 'text_input',
        question: question || 'Input required',
        confidence: 0.6, // Lower confidence - text input is harder to detect
      };
    }
  }

  return null;
}

function detectPlanReview(lines: string[]): Omit<DetectedAction, 'context'> | null {
  const planWindow = lines.slice(-30);
  const decisionWindow = lines.slice(-12);
  const planText = planWindow.join('\n');
  const decisionText = decisionWindow.join('\n');

  const hasPlanKeyword = PLAN_REVIEW_PATTERNS.some((pattern) => pattern.test(planText));
  if (!hasPlanKeyword) return null;

  const hasDecisionPrompt =
    decisionWindow.some((line) => DECISION_OPTION_LINE_PATTERN.test(line.trim())) ||
    DECISION_PAIR_PATTERN.test(decisionText) ||
    /\b(y\/n|yes\/no)\b/i.test(decisionText);

  if (!hasDecisionPrompt) return null;

  return {
    type: 'plan_review',
    question: 'Plan review requested',
    options: [
      { value: 'y', label: 'Approve' },
      { value: 'n', label: 'Reject' },
    ],
    confidence: decisionWindow.some((line) => DECISION_OPTION_LINE_PATTERN.test(line.trim()))
      ? 0.9
      : 0.8,
  };
}

function detectError(lines: string[]): Omit<DetectedAction, 'context'> | null {
  const recentText = lines.slice(-20).join('\n');

  for (const pattern of ERROR_PATTERNS) {
    if (pattern.test(recentText)) {
      // Find the error line
      const errorLine = lines.slice(-20).find((l) => pattern.test(l)) || 'Error detected';
      return {
        type: 'error',
        question: errorLine.trim().slice(0, 100),
        confidence: 0.8,
      };
    }
  }

  return null;
}

function detectNeedsAttention(lines: string[]): Omit<DetectedAction, 'context'> | null {
  const recentText = lines.slice(-10).join('\n');

  for (const pattern of WAITING_PATTERNS) {
    if (pattern.test(recentText)) {
      return {
        type: 'needs_attention',
        question: 'Session needs attention',
        confidence: 0.5,
      };
    }
  }

  return null;
}

function findQuestion(lines: string[]): string {
  // Look for a line ending with ? or : that looks like a question
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.endsWith('?')) return line;
    if (line.endsWith(':') && line.length > 3) return line;
  }
  return '';
}

/**
 * Determine the response to send based on detected action and user choice.
 */
export function buildResponse(
  action: DetectedAction,
  choice: string,
  includeEnter: boolean = true
): string {
  const enter = includeEnter ? '\n' : '';

  switch (action.type) {
    case 'yes_no':
      return choice.toLowerCase().startsWith('y') ? `y${enter}` : `n${enter}`;

    case 'multi_choice':
      return `${choice}${enter}`;

    case 'text_input':
      return `${choice}${enter}`;

    case 'plan_review':
      return choice.toLowerCase().startsWith('y') ? `y${enter}` : `n${enter}`;

    default:
      return `${choice}${enter}`;
  }
}
