import type { Session } from '@agent-command/schema';
import {
  attentionRepository,
  type AttentionDetection,
  type AttentionTransition,
} from '../db/attention.js';
import { pubsub } from './pubsub.js';
import { notificationDispatcher } from './notificationDispatcher.js';

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');

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
  />\s*$/,
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
const WAITING_PATTERNS = [
  /waiting\s+for\s+(input|approval|response)/i,
  /\bpress\s+(enter|any\s+key)\b/i,
  /\bselect\s+(an?\s+)?option\b/i,
  /\bchoose\b.*:/i,
];

export interface SnapshotAttentionDetection extends AttentionDetection {
  reason: Exclude<AttentionDetection['reason'], null>;
  captureHash: string;
}

function captureHash(text: string): string {
  const suffix = text.slice(-100);
  let hash = 0;
  for (let index = 0; index < suffix.length; index += 1) {
    hash = (hash << 5) - hash + suffix.charCodeAt(index);
    hash &= hash;
  }
  return hash.toString(16);
}

function findQuestion(lines: string[]): string {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim() ?? '';
    if (!line) continue;
    if (line.endsWith('?')) return line;
    if (line.endsWith(':') && line.length > 3) return line;
  }
  return '';
}

function detectMultiChoice(
  lines: string[]
): Omit<SnapshotAttentionDetection, 'captureHash'> | null {
  const options: Array<{ value: string; label: string }> = [];
  let firstOptionIndex = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = lines[index]?.match(MULTI_CHOICE_OPTION_PATTERN);
    if (match?.[1] && match[2]) {
      firstOptionIndex = index;
      options.unshift({ value: match[1], label: match[2].trim() });
    } else if (options.length > 0) {
      break;
    }
  }
  if (options.length < 2) return null;

  let question = '';
  const searchStart = Math.max(0, firstOptionIndex - 8);
  for (let index = firstOptionIndex - 1; index >= searchStart; index -= 1) {
    const line = lines[index]?.trim() ?? '';
    if (!line) continue;
    if (line.endsWith('?') || line.endsWith(':')) {
      question = line;
      break;
    }
    const lower = line.toLowerCase();
    if (['select', 'choose', 'which', 'pick'].some((term) => lower.includes(term))) {
      question = line;
      break;
    }
  }
  return {
    reason: 'multi_choice',
    question: question || 'Select an option',
    confidence: question ? 0.9 : 0.7,
  };
}

function detectPlanReview(lines: string[]): Omit<SnapshotAttentionDetection, 'captureHash'> | null {
  const planWindow = lines.slice(-30);
  const decisionWindow = lines.slice(-12);
  const hasPlanKeyword = PLAN_REVIEW_PATTERNS.some((pattern) =>
    pattern.test(planWindow.join('\n'))
  );
  if (!hasPlanKeyword) return null;
  const decisionText = decisionWindow.join('\n');
  const hasDecisionPrompt =
    decisionWindow.some((line) => DECISION_OPTION_LINE_PATTERN.test(line.trim())) ||
    DECISION_PAIR_PATTERN.test(decisionText) ||
    /\b(y\/n|yes\/no)\b/i.test(decisionText);
  if (!hasDecisionPrompt) return null;
  return {
    reason: 'plan_review',
    question: 'Plan review requested',
    confidence: decisionWindow.some((line) => DECISION_OPTION_LINE_PATTERN.test(line.trim()))
      ? 0.9
      : 0.8,
  };
}

function detectPattern(
  lines: string[],
  patterns: RegExp[],
  windowSize: number,
  detection: (pattern: RegExp, text: string) => Omit<SnapshotAttentionDetection, 'captureHash'>
): Omit<SnapshotAttentionDetection, 'captureHash'> | null {
  const text = lines.slice(-windowSize).join('\n');
  for (const pattern of patterns) {
    if (pattern.test(text)) return detection(pattern, text);
  }
  return null;
}

export function analyzeAttentionSnapshot(
  text: string,
  providedHash?: string
): SnapshotAttentionDetection | null {
  const cleanText = text.replace(ANSI_PATTERN, '');
  const hash = providedHash || captureHash(cleanText);
  const lines = cleanText.split('\n').slice(-60);

  const detection =
    detectMultiChoice(lines) ??
    detectPlanReview(lines) ??
    detectPattern(lines, YES_NO_PATTERNS, 10, () => ({
      reason: 'yes_no',
      question: findQuestion(lines.slice(-10)) || 'Confirmation required',
      confidence: 0.85,
    })) ??
    detectPattern(lines, ERROR_PATTERNS, 20, (pattern) => ({
      reason: 'error',
      question: (lines.slice(-20).find((line) => pattern.test(line)) || 'Error detected')
        .trim()
        .slice(0, 100),
      confidence: 0.8,
    })) ??
    detectPattern(lines, TEXT_INPUT_PATTERNS, 5, () => ({
      reason: 'text_input',
      question: findQuestion(lines.slice(-5)) || 'Input required',
      confidence: 0.6,
    })) ??
    detectPattern(lines, WAITING_PATTERNS, 10, () => ({
      reason: 'needs_attention',
      question: 'Session needs attention',
      confidence: 0.5,
    }));

  return detection ? { ...detection, captureHash: hash } : null;
}

function statusDetection(session: Session): AttentionDetection {
  if (session.status === 'WAITING_FOR_INPUT') return { reason: 'waiting_input' };
  if (session.status === 'WAITING_FOR_APPROVAL') return { reason: 'waiting_approval' };
  if (session.status === 'ERROR') return { reason: 'error' };
  return { reason: null };
}

interface AttentionServiceDependencies {
  store: {
    transition(
      sessionId: string,
      detection: AttentionDetection
    ): Promise<AttentionTransition | null>;
  };
  publish(sessionId: string, event: AttentionTransition['event']): void;
  notify(session: Session, payload: AttentionTransition['event']['payload']): Promise<void>;
}

export function createAttentionService(dependencies: AttentionServiceDependencies) {
  async function persist(session: Session, detection: AttentionDetection): Promise<Session> {
    const transition = await dependencies.store.transition(session.id, detection);
    if (!transition) return session;
    dependencies.publish(session.id, transition.event);
    await dependencies.notify(transition.session, transition.event.payload);
    return transition.session;
  }

  return {
    async evaluateStatus(session: Session): Promise<Session> {
      const detection = statusDetection(session);
      if (detection.reason === null && session.attention_reason == null) return session;
      return persist(session, detection);
    },
    async evaluateSnapshot(session: Session, text: string, hash?: string): Promise<Session> {
      const detected = analyzeAttentionSnapshot(text, hash);
      return persist(session, detected ?? statusDetection(session));
    },
  };
}

export const attentionService = createAttentionService({
  store: attentionRepository,
  publish: (sessionId, event) => pubsub.publishAttentionChanged(sessionId, event),
  notify: (session, payload) => notificationDispatcher.notifyAttention(session, payload),
});
