import OpenAI from 'openai';
import { config } from '../config.js';

const openai = config.OPENAI_API_KEY
  ? new OpenAI({ apiKey: config.OPENAI_API_KEY })
  : null;

export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;

export function isEmbeddingAvailable(): boolean {
  return openai !== null;
}

export async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!openai) {
    return null;
  }

  const input = text.trim();
  if (!input) {
    return null;
  }

  const response = await openai.embeddings.create({
    model: config.OPENAI_EMBEDDING_MODEL,
    input: input.slice(0, 8000),
  });
  const embedding = response.data[0]?.embedding;
  return Array.isArray(embedding) ? embedding.map((value) => Number(value)) : null;
}

export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}
