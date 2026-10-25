'use client';

import { useMemo } from 'react';
import { useOfficeStore } from '@/store/officeStore';
import { DEPARTMENTS, summariseFloor, summariseRoom } from '@/domain/selectors';
import { Button, EmptyState, Section, StatusDot, toneForAgent } from './primitives';

function NavRail() {
  const setInspectorTab = useOfficeStore((state) => state.setInspectorTab);
  const inspectorTab = useOfficeStore((state) => state.inspectorTab);
  const showBuilding = useOfficeStore((state) => state.showBuilding);
  const showExterior = useOfficeStore((state) => state.showExterior);
  const overviewOpen = useOfficeStore((state) => state.overviewOpen);
  const setOverviewOpen = useOfficeStore((state) => state.setOverviewOpen);
  const viewMode = useOfficeStore((state) => state.viewMode);

  return (
    <nav className="rail" aria-label="Primary navigation">
      <button
        type="button"
        className={`rail__item${viewMode === 'exterior' ? ' is-active' : ''}`}
        onClick={showExterior}
        title="Exterior view (E)"
        aria-label="Exterior view"
      >
        ◱
      </button>
      <button
        type="button"
        className={`rail__item${viewMode === 'building' ? ' is-active' : ''}`}
        onClick={showBuilding}
        title="Building overview (0)"
        aria-label="Building overview"
      >
        ▤
      </button>
      <button
        type="button"
        className={`rail__item${inspectorTab === 'tasks' ? ' is-active' : ''}`}
        onClick={() => setInspectorTab('tasks')}
        title="Task board"
        aria-label="Task board"
      >
        ☰
      </button>
      <button
        type="button"
        className={`rail__item${inspectorTab === 'history' ? ' is-active' : ''}`}
        onClick={() => setInspectorTab('history')}
        title="Event history"
        aria-label="Event history"
      >
        ⌁
      </button>
      <button
        type="button"
        className={`rail__item${overviewOpen ? ' is-active' : ''}`}
        onClick={() => setOverviewOpen(!overviewOpen)}
        title="Operational overview"
        aria-label="Operational overview"
      >
        ◇
      </button>
    </nav>
  );
}

function FloorList() {
  const building = useOfficeStore((state) => state.building);
  const ops = useOfficeStore((state) => state.ops);
  const isolatedFloorId = useOfficeStore((state) => state.isolatedFloorId);
  const hiddenFloorIds = useOfficeStore((state) => state.hiddenFloorIds);
  const selectFloor = useOfficeStore((state) => state.selectFloor);
  const isolateFloor = useOfficeStore((state) => state.isolateFloor);
  const toggleFloorVisibility = useOfficeStore((state) => state.toggleFloorVisibility);
  const setCutaway = useOfficeStore((state) => state.setCutaway);
  const cutaway = useOfficeStore((state) => state.cutaway);
  const showAllFloors = useOfficeStore((state) => state.showAllFloors);

  if (!building) return null;

  return (
    <Section
      title="Floors"
      aside={
        <Button size="sm" variant="ghost" onClick={showAllFloors} title="Show every floor">
          All
        </Button>
      }
    >
      <ul className="floor-list">
        {[...building.floors].reverse().map((floor) => {
          const summary = summariseFloor(building, ops, floor.id);
          const hidden = hiddenFloorIds.includes(floor.id);
          const active = isolatedFloorId === floor.id;
          return (
            <li key={floor.id} className={`floor-item${active ? ' is-active' : ''}${hidden ? ' is-hidden' : ''}`}>
              <button
                type="button"
                className="floor-item__main"
                onClick={() => (active ? isolateFloor(null) : selectFloor(floor.id))}
                aria-pressed={active}
                title={active ? 'Return to the whole building' : `Isolate ${floor.name}`}
              >
                <span className="floor-item__index">{floor.index}</span>
                <span className="floor-item__text">
                  <span className="floor-item__name">{floor.name}</span>
                  <span className="floor-item__meta">
                    {DEPARTMENTS[floor.department].short} · {summary.totalAgents} agents ·{' '}
                    {summary.activeTasks} active
                  </span>
                </span>
                <span className="floor-item__signals">
                  {summary.hasError && <StatusDot tone="error" />}
                  {summary.hasActivity && <StatusDot tone="active" pulse />}
                  {!summary.hasError && !summary.hasActivity && <StatusDot tone="neutral" />}
                </span>
              </button>
              <button
                type="button"
                className="floor-item__toggle"
                onClick={() => toggleFloorVisibility(floor.id)}
                aria-pressed={!hidden}
                title={hidden ? `Show ${floor.name}` : `Hide ${floor.name}`}
              >
                {hidden ? '◌' : '◉'}
              </button>
            </li>
          );
        })}
      </ul>
      <label className="toggle">
        <input type="checkbox" checked={cutaway} onChange={(event) => setCutaway(event.target.checked)} />
        <span>Cutaway view (hide south façade and roof)</span>
      </label>
    </Section>
  );
}

function RoomList() {
  const building = useOfficeStore((state) => state.building);
  const ops = useOfficeStore((state) => state.ops);
  const isolatedFloorId = useOfficeStore((state) => state.isolatedFloorId);
  const selectedRoomId = useOfficeStore((state) => state.selectedRoomId);
  const selectRoom = useOfficeStore((state) => state.selectRoom);

  const floor = useMemo(() => {
    if (!building) return null;
    if (isolatedFloorId) return building.floors.find((candidate) => candidate.id === isolatedFloorId) ?? null;
    if (selectedRoomId) {
      return (
        building.floors.find((candidate) => candidate.rooms.some((room) => room.id === selectedRoomId)) ?? null
      );
    }
    return null;
  }, [building, isolatedFloorId, selectedRoomId]);

  if (!building) return null;

  return (
    <Section title={floor ? `${floor.name} — rooms` : 'Rooms'} aside={<span className="muted">{floor?.rooms.length ?? 0}</span>}>
      {!floor && <EmptyState title="Select a floor" hint="Pick a floor above, or search for a room, agent or task." />}
      {floor && (
        <ul className="room-list">
          {floor.rooms.map((room) => {
            const summary = summariseRoom(ops, room.id);
            const tone = summary.hasError
              ? 'error'
              : summary.hasActivity
                ? 'active'
                : summary.agents.some((agent) => agent.status === 'WAITING')
                  ? 'waiting'
                  : summary.agents.length > 0
                    ? 'neutral'
                    : 'offline';
            return (
              <li key={room.id}>
                <button
                  type="button"
                  className={`room-item${room.id === selectedRoomId ? ' is-active' : ''}`}
                  onClick={() => selectRoom(room.id)}
                  aria-pressed={room.id === selectedRoomId}
                >
                  <StatusDot tone={tone} pulse={tone === 'active'} />
                  <span className="room-item__text">
                    <span className="room-item__name">{room.name}</span>
                    <span className="room-item__meta">
                      {room.code} · {room.template.replace(/-/g, ' ')}
                    </span>
                  </span>
                  <span className="room-item__count">{summary.agents.length}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="room-list__legend">
        {(['active', 'waiting', 'error', 'neutral', 'offline'] as const).map((tone) => (
          <span key={tone} className="legend__item">
            <StatusDot tone={tone} /> {toneForAgent(tone === 'active' ? 'WORKING' : tone === 'waiting' ? 'WAITING' : tone === 'error' ? 'ERROR' : tone === 'offline' ? 'OFFLINE' : 'IDLE')}
          </span>
        ))}
      </div>
    </Section>
  );
}

export function LeftPanel() {
  return (
    <div className="left">
      <NavRail />
      <div className="left__panels">
        <FloorList />
        <RoomList />
      </div>
    </div>
  );
}
