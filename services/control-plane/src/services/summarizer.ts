import OpenAI from 'openai';
import { config } from '../config.js';

// Initialize OpenAI client (will be null if no API key configured)
const openai = config.OPENAI_API_KEY
  ? new OpenAI({ apiKey: config.OPENAI_API_KEY })
  : null;

export interface GenerateSummaryOptions {
  context: string;
  question: string;
  actionType: string;
  maxTokens?: number;
}

/**
 * Generates a concise AI summary explaining what an agent is doing
 * and why it needs user input.
 */
export async function generateSummary(
  options: GenerateSummaryOptions
): Promise<string> {
  if (!openai) {
    throw new Error('OpenAI API key not configured');
  }

  const { context, question, actionType, maxTokens = 100 } = options;

  const systemPrompt = `You are a helpful assistant that explains what an AI coding agent is doing.
Given context about a coding session and a question the agent is asking, provide a brief 1-2 sentence summary
that explains what the agent is working on and why it needs user input.
Be concise and focus on the practical "what" and "why".`;

  const userPrompt = `Action type: ${actionType}
Question being asked: ${question}

Context from the terminal/session:
${context.slice(-2000)}

Summarize what the agent is doing and why it needs input:`;

  const response = await openai.chat.completions.create({
    model: config.OPENAI_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: maxTokens,
    temperature: 0.3,
  });

  const summary = response.choices[0]?.message?.content?.trim();
  if (!summary) {
    throw new Error('No summary generated');
  }

  return summary;
}

/**
 * Check if the summarizer is available (has API key configured)
 */
export function isSummarizerAvailable(): boolean {
  return openai !== null;
}
