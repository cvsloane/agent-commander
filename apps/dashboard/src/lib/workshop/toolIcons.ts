export function getToolIcon(tool: string): string {
  const icons: Record<string, string> = {
    Read: '📖',
    Edit: '✏️',
    Write: '📝',
    Bash: '💻',
    Grep: '🔍',
    Glob: '📁',
    WebFetch: '🌐',
    WebSearch: '🔎',
    Task: '🤖',
    TodoWrite: '📋',
    NotebookEdit: '📓',
    AskFollowupQuestion: '❓',
    AskUserQuestion: '❓',
  };
  return icons[tool] ?? '🔧';
}
