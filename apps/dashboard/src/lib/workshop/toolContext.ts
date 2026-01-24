function shortenPath(path: string, cwd?: string): string {
  if (!path) return path;
  const normalizedCwd = cwd?.endsWith('/') ? cwd.slice(0, -1) : cwd;
  if (normalizedCwd && path.startsWith(`${normalizedCwd}/`)) {
    path = path.slice(normalizedCwd.length + 1);
  }
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

export function getToolContext(
  tool: string,
  input?: Record<string, unknown>,
  cwd?: string
): string | null {
  if (!input) return null;
  switch (tool) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit': {
      const filePath =
        (typeof input.file_path === 'string' && input.file_path) ||
        (typeof input.path === 'string' && input.path) ||
        (typeof input.notebook_path === 'string' && input.notebook_path) ||
        '';
      if (filePath) {
        return shortenPath(filePath, cwd);
      }
      break;
    }
    case 'Bash': {
      if (typeof input.command === 'string') {
        const firstLine = input.command.split('\n')[0];
        return firstLine.length > 36 ? `${firstLine.slice(0, 36)}...` : firstLine;
      }
      break;
    }
    case 'Grep': {
      if (typeof input.pattern === 'string') {
        return `/${input.pattern}/`;
      }
      break;
    }
    case 'Glob': {
      if (typeof input.pattern === 'string') {
        return input.pattern;
      }
      break;
    }
    case 'WebFetch': {
      if (typeof input.url === 'string') {
        try {
          return new URL(input.url).hostname;
        } catch {
          return input.url;
        }
      }
      break;
    }
    case 'WebSearch': {
      if (typeof input.query === 'string') {
        return `"${input.query}"`;
      }
      break;
    }
    case 'Task': {
      if (typeof input.description === 'string') {
        return input.description;
      }
      if (typeof input.prompt === 'string') {
        return input.prompt;
      }
      break;
    }
    case 'TodoWrite':
      return 'Updating tasks';
  }

  return null;
}
