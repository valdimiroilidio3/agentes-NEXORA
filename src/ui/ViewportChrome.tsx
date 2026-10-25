'use client';

import { useMemo } from 'react';
import { useOfficeStore } from '@/store/officeStore';
import { DEPARTMENTS, summariseBuilding, summariseFloor } from '@/domain/selectors';
import { Badge, Button, StatusDot, toneForAgent } from './primitives';

export function ViewToolbar() {
  const viewMode = useOfficeStore((state) => state.viewMode);
  const cutaway = useOfficeStore((state) => state.cutaway);
  const setCutaway = useOfficeStore((state) => state.setCutaway);
  const showBuilding = useOfficeStore((state) => state.showBuilding);
  const showExterior = useOfficeStore((state) => state.showExterior);
  const resetView = useOfficeStore((state) => state.resetView);
  const isolatedFloorId = useOfficeStore((state) => state.isolatedFloorId);
  const building = useOfficeStore((state) => state.building);
  const isolatedFloor = building?.floors.find((floor) => floor.id === isolatedFloorId);

  return (
    <div className="view-toolbar">
      <div className="view-toolbar__modes" role="group" aria-label="View mode">
        <Button size="sm" variant={viewMode === 'building' ? 'primary' : 'ghost'} onClick={showBuilding}>
          Building
        </Button>
        <Button size="sm" variant={viewMode === 'exterior' ? 'primary' : 'ghost'} onClick={showExterior}>
          Exterior
        </Button>
        <Button
          size="sm"
          variant={cutaway ? 'primary' : 'ghost'}
          aria-pressed={cutaway}
          onClick={() => setCutaway(!cutaway)}
          title="Hide the south façade and roof (C)"
        >
          Cutaway
        </Button>
        <Button size="sm" variant="ghost" onClick={resetView} title="Reset view (R)">
          Reset
        </Button>
      </div>
      <p className="view-toolbar__hint">
        {isolatedFloor ? `${isolatedFloor.name} isolated` : 'Drag to orbit · scroll to zoom · click a room or agent'}
      </p>
    </div>
  );
}

export function SceneLegend() {
  const tones = ['active', 'waiting', 'error', 'neutral', 'offline'] as const;
  const labels: Record<(typeof tones)[number], string> = {
    active: 'working',
    waiting: 'waiting',
    error: 'error',
    neutral: 'idle',
    offline: 'offline',
  };
  return (
    <div className="scene-legend" aria-label="Agent status legend">
      {tones.map((tone) => (
        <span key={tone} className="scene-legend__item">
          <StatusDot tone={toneForAgent(tone === 'active' ? 'WORKING' : tone === 'waiting' ? 'WAITING' : tone === 'error' ? 'ERROR' : tone === 'offline' ? 'OFFLINE' : 'IDLE')} />
          {labels[tone]}
        </span>
      ))}
    </div>
  );
}

export function OverviewDrawer() {
  const open = useOfficeStore((state) => state.overviewOpen);
  const setOpen = useOfficeStore((state) => state.setOverviewOpen);
  const building = useOfficeStore((state) => state.building);
  const ops = useOfficeStore((state) => state.ops);
  const selectFloor = useOfficeStore((state) => state.selectFloor);

  const summary = useMemo(() => summariseBuilding(ops), [ops]);
  if (!open || !building) return null;

  return (
    <div className="overview" role="dialog" aria-label="Operational overview">
      <header className="overview__head">
        <div>
          <p className="eyebrow">Company-wide</p>
          <h2>Operational overview</h2>
        </div>
        <div className="overview__totals">
          <span>
            <strong>{summary.working}</strong> working
          </span>
          <span>
            <strong>{summary.tasksRunning}</strong> running
          </span>
          <span>
            <strong>{summary.tasksQueued}</strong> queued
          </span>
          <span>
            <strong>{summary.tasksFailed}</strong> failed
          </span>
          <Badge tone="waiting">DEMO DATA</Badge>
        </div>
        <button type="button" className="overview__close" onClick={() => setOpen(false)} aria-label="Close overview">
          ✕
        </button>
      </header>
      <div className="overview__grid">
        {[...building.floors].reverse().map((floor) => {
          const floorSummary = summariseFloor(building, ops, floor.id);
          return (
            <button key={floor.id} type="button" className="overview__row" onClick={() => selectFloor(floor.id)}>
              <span className="overview__floor">
                <strong>{floor.index}</strong>
                {floor.name}
              </span>
              <span>{DEPARTMENTS[floor.department].short}</span>
              <span>
                {floorSummary.workingAgents}/{floorSummary.totalAgents} working
              </span>
              <span>{floorSummary.activeTasks} active</span>
              <span className={floorSummary.failedTasks > 0 ? 'is-error' : ''}>{floorSummary.failedTasks} failed</span>
              <span className="overview__signal">
                {floorSummary.hasError ? (
                  <StatusDot tone="error" />
                ) : floorSummary.hasActivity ? (
                  <StatusDot tone="active" pulse />
                ) : (
                  <StatusDot tone="neutral" />
                )}
              </span>
            </button>
          );
        })}
      </div>
      <p className="overview__note">
        Every count is derived from the operational state that also drives the 3D scene. Simulated runs are labelled in
        the inspector and in the event history.
      </p>
    </div>
  );
}
