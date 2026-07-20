// Compatibility exports for topology consumers. Fleet and topology now share
// one canonical store so roster rows and orchestrator cards cannot drift.
export {
  buildLiveTopology,
  buildRosterTopology,
  TMUX_TOPOLOGY_STALE_AFTER_MS,
  useFleetStore as useTmuxTopologyStore,
} from './fleet';
export type {
  TmuxHostTopologyView,
  TmuxPaneTopologyView,
  TmuxSessionTopologyView,
  TmuxWindowTopologyView,
} from './fleet';
