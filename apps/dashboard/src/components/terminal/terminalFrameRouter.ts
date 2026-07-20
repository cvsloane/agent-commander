import type { DecodedTerminalFrame } from './protocol';

type TerminalOutputFrame = Extract<DecodedTerminalFrame, { type: 'output' }>;

export function handleTerminalOutputFrame(
  frame: DecodedTerminalFrame,
  write: (data: TerminalOutputFrame['data']) => void
): frame is TerminalOutputFrame {
  if (frame.type !== 'output') return false;
  write(frame.data);
  return true;
}
