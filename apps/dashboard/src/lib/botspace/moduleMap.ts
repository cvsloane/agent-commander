export type ModuleType =
  | 'center'
  | 'dataCore'       // was bookshelf - Read
  | 'commandDeck'    // was desk - Write, NotebookEdit
  | 'fabricator'     // was workbench - Edit
  | 'shellBay'       // was terminal - Bash
  | 'sensorArray'    // was scanner - Grep, Glob
  | 'commRelay'      // was antenna - WebFetch, WebSearch
  | 'airlock'        // was portal - Task, EnterPlanMode
  | 'missionBoard';  // was taskboard - TodoWrite

export const TOOL_MODULE_MAP: Record<string, ModuleType> = {
  Read: 'dataCore',
  Write: 'commandDeck',
  Edit: 'fabricator',
  Bash: 'shellBay',
  Grep: 'sensorArray',
  Glob: 'sensorArray',
  WebFetch: 'commRelay',
  WebSearch: 'commRelay',
  Task: 'airlock',
  TodoWrite: 'missionBoard',
  AskUserQuestion: 'center',
  AskFollowupQuestion: 'center',
  NotebookEdit: 'commandDeck',
  EnterPlanMode: 'airlock',
  ExitPlanMode: 'airlock',
};

export function getModuleForTool(tool?: string | null): ModuleType {
  if (!tool) return 'center';
  return TOOL_MODULE_MAP[tool] || 'center';
}

// Module positions arranged in a circular pattern around center
export const MODULE_POSITIONS: Record<ModuleType, [number, number, number]> = {
  center: [0, 0, 0],
  dataCore: [0, 0, -4],       // North - data access
  commandDeck: [4, 0, 0],     // East - command/write
  fabricator: [-4, 0, 0],     // West - fabrication/edit
  shellBay: [0, 0, 4],        // South - shell access
  sensorArray: [3, 0, -3],    // NE - sensors
  commRelay: [-3, 0, -3],     // NW - communications
  airlock: [-3, 0, 3],        // SW - task spawning
  missionBoard: [3, 0, 3],    // SE - task management
};

export const MODULE_LABELS: Record<ModuleType, string> = {
  center: 'Hub',
  dataCore: 'Data Core',
  commandDeck: 'Command Deck',
  fabricator: 'Fabricator',
  shellBay: 'Shell Bay',
  sensorArray: 'Sensor Array',
  commRelay: 'Comm Relay',
  airlock: 'Airlock',
  missionBoard: 'Mission Board',
};
