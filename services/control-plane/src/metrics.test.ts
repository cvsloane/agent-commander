import { describe, expect, it } from 'vitest';
import {
  recordTerminalNavigation,
  terminalNavigationDurationSeconds,
  terminalNavigationTotal,
} from './metrics.js';

describe('terminal navigation metrics', () => {
  it('records bounded operation and result labels with acknowledgement latency', async () => {
    recordTerminalNavigation('viewer_state', 'failure', 0.25);

    const counter = await terminalNavigationTotal.get();
    expect(counter.values).toContainEqual(expect.objectContaining({
      labels: expect.objectContaining({ operation: 'viewer_state', result: 'failure' }),
      value: 1,
    }));
    const histogram = await terminalNavigationDurationSeconds.get();
    expect(histogram.values).toContainEqual(expect.objectContaining({
      metricName: 'agent_command_terminal_navigation_duration_seconds_sum',
      labels: expect.objectContaining({ operation: 'viewer_state', result: 'failure' }),
      value: 0.25,
    }));
  });
});
