'use client';

import { useMemo } from 'react';
import { useOfficeStore } from '@/store/officeStore';
import { summariseBuilding } from '@/domain/selectors';
import { Badge } from './primitives';

export function StatusBar() {
  const ops = useOfficeStore((state) => state.ops);
  const executionMode = useOfficeStore((state) => state.executionMode);
  const executionLabel = useOfficeStore((state) => state.executionLabel);
  const setExecutionMode = useOfficeStore((state) => state.setExecutionMode);
  const validation = useOfficeStore((state) => state.validation);
  const summary = useMemo(() => summariseBuilding(ops), [ops]);

  return (
    <footer className="statusbar">
      <div className="statusbar__group">
        <span className="statusbar__label">Agents</span>
        <span className="statusbar__value">{summary.agents}</span>
        <span className="statusbar__sep" />
        <span className="statusbar__label">Working</span>
        <span className="statusbar__value">{summary.working}</span>
        <span className="statusbar__sep" />
        <span className="statusbar__label">Waiting</span>
        <span className="statusbar__value">{summary.waiting}</span>
        <span className="statusbar__sep" />
        <span className="statusbar__label">Offline</span>
        <span className="statusbar__value">{summary.offline}</span>
      </div>

      <div className="statusbar__group">
        <span className="statusbar__label">Tasks</span>
        <span className="statusbar__value">{summary.tasksRunning}</span>
        <span className="statusbar__label">running</span>
        <span className="statusbar__value">{summary.tasksQueued}</span>
        <span className="statusbar__label">queued</span>
        <span className="statusbar__value">{summary.tasksFailed}</span>
        <span className="statusbar__label">failed</span>
        <span className="statusbar__value">{summary.tasksCompleted}</span>
        <span className="statusbar__label">completed</span>
      </div>

      <div className="statusbar__group statusbar__group--end">
        {validation && validation.warnings.length > 0 && (
          <Badge tone="waiting" title={validation.warnings.map((issue) => issue.message).join('\n')}>
            {validation.warnings.length} spatial warnings
          </Badge>
        )}
        <Badge tone="waiting" title="All data comes from local fixtures">
          DEMO DATA
        </Badge>
        <label className="statusbar__mode">
          <span>Execution</span>
          <select
            className="select select--compact"
            value={executionMode}
            aria-label="Execution adapter"
            onChange={(event) => setExecutionMode(event.target.value === 'live' ? 'live' : 'simulated')}
          >
            <option value="simulated">Simulated adapter</option>
            <option value="live">Live bridge</option>
          </select>
        </label>
        <span className="statusbar__adapter" title={executionLabel}>
          {executionLabel}
        </span>
      </div>
    </footer>
  );
}
