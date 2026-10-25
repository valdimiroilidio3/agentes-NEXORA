import { beforeEach, describe, expect, it } from 'vitest';
import { useOfficeStore } from '@/store/officeStore';

function reset() {
  useOfficeStore.setState({
    status: 'idle',
    loadError: null,
    dataWarnings: [],
    building: null,
    validation: null,
    ops: { tasks: [], agents: [], events: [], eventSeq: 0 },
    executionMode: 'simulated',
    executionLabel: 'Demo adapter (simulated)',
    runningTaskIds: [],
    viewMode: 'building',
    isolatedFloorId: null,
    hiddenFloorIds: [],
    cutaway: false,
    selectedRoomId: null,
    selectedAgentId: null,
    selectedTaskId: null,
    hoveredRoomId: null,
    focusToken: 0,
    searchQuery: '',
    taskFilter: { status: 'ALL', agentId: null, roomId: null, department: null, query: '' },
    overviewOpen: false,
    inspectorOpen: true,
    inspectorTab: 'context',
    toast: null,
  });
}

function ready() {
  useOfficeStore.getState().initialize();
  const state = useOfficeStore.getState();
  expect(state.status).toBe('ready');
  expect(state.building).not.toBeNull();
  return state;
}

describe('office store', () => {
  beforeEach(reset);

  it('initialises from the fixtures and records a load event', () => {
    const state = ready();
    expect(state.building?.floors).toHaveLength(5);
    expect(state.ops.agents).toHaveLength(27);
    expect(state.ops.tasks).toHaveLength(15);
    expect(state.ops.events[0]?.type).toBe('DATA_LOADED');
    expect(state.validation?.ok).toBe(true);
  });

  it('is idempotent', () => {
    ready();
    const before = useOfficeStore.getState().ops.events.length;
    useOfficeStore.getState().initialize();
    expect(useOfficeStore.getState().ops.events.length).toBe(before);
  });

  it('selects a room and isolates its floor', () => {
    ready();
    useOfficeStore.getState().selectRoom('f2-leads');
    const state = useOfficeStore.getState();
    expect(state.selectedRoomId).toBe('f2-leads');
    expect(state.viewMode).toBe('room');
    expect(state.isolatedFloorId).toBe('floor-2');
    expect(state.focusToken).toBeGreaterThan(0);
  });

  it('ignores an unknown room instead of breaking navigation', () => {
    ready();
    useOfficeStore.getState().selectRoom('missing-room');
    const state = useOfficeStore.getState();
    expect(state.selectedRoomId).toBeNull();
    expect(state.toast?.level).toBe('error');
  });

  it('clears the selection when its floor is hidden', () => {
    ready();
    useOfficeStore.getState().selectRoom('f1-content');
    useOfficeStore.getState().toggleFloorVisibility('floor-1');
    const state = useOfficeStore.getState();
    expect(state.selectedRoomId).toBeNull();
    expect(state.hiddenFloorIds).toContain('floor-1');
    expect(state.viewMode).toBe('building');
  });

  it('re-selects a hidden room by making its floor visible again', () => {
    ready();
    useOfficeStore.getState().toggleFloorVisibility('floor-3');
    useOfficeStore.getState().selectRoom('f3-qa');
    const state = useOfficeStore.getState();
    expect(state.hiddenFloorIds).not.toContain('floor-3');
    expect(state.isolatedFloorId).toBe('floor-3');
  });

  it('resets the view and cutaway', () => {
    ready();
    useOfficeStore.getState().selectRoom('f4-board');
    useOfficeStore.getState().setCutaway(true);
    useOfficeStore.getState().resetView();
    const state = useOfficeStore.getState();
    expect(state.viewMode).toBe('building');
    expect(state.cutaway).toBe(false);
    expect(state.selectedRoomId).toBeNull();
    expect(state.isolatedFloorId).toBeNull();
  });

  it('does not start a task whose dependencies are unmet', () => {
    ready();
    const before = useOfficeStore.getState().ops.tasks.find((task) => task.id === 'task-queue-007');
    expect(before?.status).toBe('QUEUED');
    void useOfficeStore.getState().runTask('task-queue-007');
    const state = useOfficeStore.getState();
    const after = state.ops.tasks.find((task) => task.id === 'task-queue-007');
    expect(after?.status).toBe('QUEUED');
    expect(state.toast?.level).toBe('warning');
    expect(state.toast?.message).toContain('blocked');
  });

  it('reacts to execution mode changes with an honest warning', () => {
    ready();
    useOfficeStore.getState().setExecutionMode('live');
    const state = useOfficeStore.getState();
    expect(state.executionMode).toBe('live');
    expect(state.executionLabel).toContain('Live');
    expect(state.toast?.message).toContain('INTEGRATION_UNAVAILABLE');
  });

  it('opens search results in the right spatial context', () => {
    ready();
    const results = useOfficeStore.getState();
    expect(results.building).not.toBeNull();
    useOfficeStore.getState().openSearchResult({
      kind: 'agent',
      id: 'agent-archive',
      label: 'Archive',
      detail: 'idle',
      floorId: 'floor-4',
      roomId: 'f4-docs',
    });
    const state = useOfficeStore.getState();
    expect(state.selectedRoomId).toBe('f4-docs');
    expect(state.selectedAgentId).toBe('agent-archive');
    expect(state.isolatedFloorId).toBe('floor-4');
    expect(state.searchQuery).toBe('');
  });

  it('refuses an invalid agent status update without corrupting state', () => {
    ready();
    const before = useOfficeStore.getState().ops.agents;
    useOfficeStore.getState().setAgentStatus('agent-atria', 'IDLE');
    const after = useOfficeStore.getState();
    expect(after.ops.agents).toBe(before);
    expect(after.toast?.level).toBe('warning');
  });
});
