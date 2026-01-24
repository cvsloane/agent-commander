export const SLASH_COMMANDS = [
  { command: '/clear', description: 'Clear conversation history' },
  { command: '/compact', description: 'Compact conversation to save context' },
  { command: '/config', description: 'View/edit configuration' },
  { command: '/cost', description: 'Show token usage and cost' },
  { command: '/doctor', description: 'Run diagnostics' },
  { command: '/help', description: 'Show help' },
  { command: '/init', description: 'Initialize CLAUDE.md' },
  { command: '/login', description: 'Login to Anthropic' },
  { command: '/logout', description: 'Logout from Anthropic' },
  { command: '/memory', description: 'Edit CLAUDE.md memory' },
  { command: '/model', description: 'Switch model' },
  { command: '/permissions', description: 'View/edit permissions' },
  { command: '/pr-comments', description: 'View PR comments' },
  { command: '/review', description: 'Request code review' },
  { command: '/status', description: 'Show status' },
  { command: '/terminal-setup', description: 'Setup terminal integration' },
  { command: '/vim', description: 'Toggle vim mode' },
] as const;

export type SlashCommand = typeof SLASH_COMMANDS[number];

export function isSlashCommand(text: string): boolean {
  return text.trim().startsWith('/');
}
