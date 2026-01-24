export type StationType =
  | 'center'
  | 'bookshelf'
  | 'desk'
  | 'workbench'
  | 'terminal'
  | 'scanner'
  | 'antenna'
  | 'portal'
  | 'taskboard';

export const TOOL_STATION_MAP: Record<string, StationType> = {
  Read: 'bookshelf',
  Write: 'desk',
  Edit: 'workbench',
  Bash: 'terminal',
  Grep: 'scanner',
  Glob: 'scanner',
  WebFetch: 'antenna',
  WebSearch: 'antenna',
  Task: 'portal',
  TodoWrite: 'taskboard',
  AskUserQuestion: 'center',
  AskFollowupQuestion: 'center',
  NotebookEdit: 'desk',
  EnterPlanMode: 'portal',
  ExitPlanMode: 'portal',
};

export function getStationForTool(tool?: string | null): StationType {
  if (!tool) return 'center';
  return TOOL_STATION_MAP[tool] || 'center';
}

export const STATION_POSITIONS: Record<StationType, [number, number, number]> = {
  center: [0, 0, 0],
  bookshelf: [0, 0, -4],
  desk: [4, 0, 0],
  workbench: [-4, 0, 0],
  terminal: [0, 0, 4],
  scanner: [3, 0, -3],
  antenna: [-3, 0, -3],
  portal: [-3, 0, 3],
  taskboard: [3, 0, 3],
};
