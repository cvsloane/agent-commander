export interface DetectedAgentMark {
  label: string;
  lineOffset: number;
}

export interface TerminalCommandMarkView {
  id: number;
  label: string;
  approximate: boolean;
}

export function stripTerminalControlSequences(value: string): string {
  return value
    .replace(/\x1B\]133;.*?(?:\x07|\x1B\\)/g, '')
    .replace(/\x1BPtmux;.*?\x1B\\/g, '')
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r/g, '');
}

export function getAgentTurnLabel(line: string): string | null {
  const clean = stripTerminalControlSequences(line).trim();
  const match = clean.match(/^(?:❯|›|Human:|User:|You:)\s*(.*)$/i);
  if (!match) return null;
  const prompt = match[1]?.trim();
  return prompt ? prompt.slice(0, 120) : 'Agent turn';
}

export function detectAgentTurnMarks(data: string | Uint8Array): DetectedAgentMark[] {
  const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
  const lines = stripTerminalControlSequences(text).split('\n');
  return lines.flatMap((line, index) => {
    const label = getAgentTurnLabel(line);
    return label
      ? [{ label, lineOffset: index - (lines.length - 1) }]
      : [];
  });
}

export function commandLabelFromTerminalLine(line: string): string {
  const clean = stripTerminalControlSequences(line).trim();
  if (!clean) return 'Shell command';
  const promptStripped = clean.replace(/^.*?(?:[$#%❯›>]\s+)/, '');
  return (promptStripped || clean).slice(0, 120);
}
