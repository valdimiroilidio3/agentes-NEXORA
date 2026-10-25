'use client';

/**
 * Central application store.
 *
 * The 3D scene and every panel subscribe to this store; nothing reads the
 * fixtures directly. Operational mutations are delegated to the pure
 * reducers in `domain/operations.ts`, execution to an `ExecutionPort`.
 */
import { create } from 'zustand';
import buildingFixture from '@/data/building.json';
import agentsFixture from '@/data/agents.json';
import tasksFixture from '@/data/tasks.json';
import { loadBuilding } from '@/domain/building';
import { parseAgents, parseTasks } from '@/domain/schema';
import { validateAssignments } from '@/domain/agents';
import {
  assignTask,
  cancelTask as cancelTaskOp,
  completeTask,
  createOperationsState,
  failTask,
  moveAgent as moveAgentOp,
  progressTask,
  retryTask as retryTaskOp,
  setAgentStatus as setAgentStatusOp,
  startTask,
  type OperationsState,
} from '@/domain/operations';
import type {
  AgentStatus,
  Building,
  EventLevel,
  ExecutionMode,
  ExecutionPort,
  OperationalEvent,
  Room,
  Task,
  ViewMode,
} from '@/domain/types';
import type { ValidationResult } from '@/domain/space';
import { EMPTY_TASK_FILTER, roomFloorId, type SearchResult, type TaskFilter } from '@/domain/selectors';
import { createDemoExecutionPort } from '@/services/execution/demo';
import { createLiveExecutionPort } from '@/services/execution/live';
import { nowIso } from '@/lib/time';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export type InspectorTab = 'context' | 'tasks' | 'history';

export interface Toast {
  readonly id: number;
  readonly level: EventLevel;
  readonly message: string;
}

interface OfficeState {
  status: LoadStatus;
  loadError: string | null;
  dataWarnings: readonly string[];
  building: Building | null;
  validation: ValidationResult | null;
  ops: OperationsState;

  executionMode: ExecutionMode;
  executionLabel: string;
  runningTaskIds: readonly string[];

  viewMode: ViewMode;
  isolatedFloorId: string | null;
  hiddenFloorIds: readonly string[];
  cutaway: boolean;
  selectedRoomId: string | null;
  selectedAgentId: string | null;
  selectedTaskId: string | null;
  hoveredRoomId: string | null;
  focusToken: number;

  searchQuery: string;
  taskFilter: TaskFilter;
  overviewOpen: boolean;
  inspectorOpen: boolean;
  inspectorTab: InspectorTab;
  toast: Toast | null;

  initialize: () => void;
  notify: (level: EventLevel, message: string) => void;
  dismissToast: () => void;

  selectRoom: (roomId: string | null) => void;
  selectAgent: (agentId: string | null) => void;
  selectTask: (taskId: string | null) => void;
  clearSelection: () => void;
  hoverRoom: (roomId: string | null) => void;
  selectFloor: (floorId: string | null) => void;
  isolateFloor: (floorId: string | null) => void;
  toggleFloorVisibility: (floorId: string) => void;
  showAllFloors: () => void;
  setCutaway: (value: boolean) => void;
  showBuilding: () => void;
  showExterior: () => void;
  resetView: () => void;
  requestFocus: () => void;

  setSearchQuery: (value: string) => void;
  openSearchResult: (result: SearchResult) => void;
  setTaskFilter: (patch: Partial<TaskFilter>) => void;
  resetTaskFilter: () => void;
  setOverviewOpen: (value: boolean) => void;
  setInspectorOpen: (value: boolean) => void;
  setInspectorTab: (tab: InspectorTab) => void;

  setExecutionMode: (mode: ExecutionMode) => void;
  runTask: (taskId: string) => Promise<void>;
  retryTask: (taskId: string) => void;
  cancelTask: (taskId: string) => void;
  reassignTask: (taskId: string, agentId: string) => void;
  setAgentStatus: (agentId: string, status: AgentStatus) => void;
  moveAgent: (agentId: string, roomId: string, workstationId: string) => void;
}

const emptyOps: OperationsState = { tasks: [], agents: [], events: [], eventSeq: 0 };

const demoPort: ExecutionPort = createDemoExecutionPort();
const livePort: ExecutionPort = createLiveExecutionPort();

/** Abort handles live outside React state; they are not serialisable. */
const runningControllers = new Map<string, AbortController>();

let toastSeq = 0;

export const useOfficeStore = create<OfficeState>()((set, get) => ({
  status: 'idle',
  loadError: null,
  dataWarnings: [],
  building: null,
  validation: null,
  ops: emptyOps,

  executionMode: 'simulated',
  executionLabel: demoPort.label,
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
  taskFilter: EMPTY_TASK_FILTER,
  overviewOpen: false,
  inspectorOpen: true,
  inspectorTab: 'context',
  toast: null,

  initialize: () => {
    if (get().status !== 'idle') return;
    set({ status: 'loading' });
    try {
      const { building, validation } = loadBuilding(buildingFixture as unknown);
      const agents = parseAgents(agentsFixture as unknown);
      const tasks = parseTasks(tasksFixture as unknown);
      const issues = validateAssignments(building, agents, tasks);
      const errors = issues.filter((issue) => issue.severity === 'error');
      if (errors.length > 0) {
        set({
          status: 'error',
          loadError: `Operational data failed integrity checks:\n${errors
            .map((issue) => `[${issue.code}] ${issue.message}`)
            .join('\n')}`,
        });
        return;
      }

      const rooms = building.floors.flatMap((floor) => floor.rooms);
      const workstations = rooms.reduce((sum, room) => sum + room.workstations.length, 0);
      const initialEvent: OperationalEvent = {
        id: 'evt-0001',
        type: 'DATA_LOADED',
        at: nowIso(),
        level: 'info',
        message: `Loaded ${building.floors.length} floors, ${rooms.length} rooms, ${workstations} workstations, ${agents.length} agents and ${tasks.length} tasks from local fixtures.`,
        actor: { kind: 'system', id: 'loader' },
        data: { demo: true },
      };

      set({
        status: 'ready',
        building,
        validation,
        ops: createOperationsState(tasks, agents, [initialEvent]),
        dataWarnings: validation.warnings.map((issue) => issue.message),
      });
    } catch (error) {
      set({
        status: 'error',
        loadError: error instanceof Error ? error.message : 'Unknown error while loading the building.',
      });
    }
  },

  notify: (level, message) => {
    toastSeq += 1;
    set({ toast: { id: toastSeq, level, message } });
  },

  dismissToast: () => set({ toast: null }),

  selectRoom: (roomId) => {
    const { building, hiddenFloorIds } = get();
    if (!building) return;
    if (roomId === null) {
      get().clearSelection();
      return;
    }
    const floorId = roomFloorId(building, roomId);
    if (!floorId) {
      get().notify('error', 'The selected room no longer exists.');
      return;
    }
    set({
      selectedRoomId: roomId,
      selectedAgentId: null,
      viewMode: 'room',
      isolatedFloorId: floorId,
      hiddenFloorIds: hiddenFloorIds.filter((id) => id !== floorId),
      focusToken: get().focusToken + 1,
      inspectorOpen: true,
    });
  },

  selectAgent: (agentId) => {
    const { building, ops } = get();
    if (!building) return;
    if (!agentId) {
      set({ selectedAgentId: null });
      return;
    }
    const agent = ops.agents.find((candidate) => candidate.id === agentId);
    if (!agent) {
      get().notify('error', 'That agent is no longer available.');
      return;
    }
    const floorId = roomFloorId(building, agent.roomId);
    set({
      selectedAgentId: agent.id,
      selectedRoomId: agent.roomId,
      selectedTaskId: agent.currentTaskId,
      viewMode: 'room',
      ...(floorId ? { isolatedFloorId: floorId } : {}),
      inspectorOpen: true,
    });
  },

  selectTask: (taskId) => {
    if (!taskId) {
      set({ selectedTaskId: null });
      return;
    }
    const task = get().ops.tasks.find((candidate) => candidate.id === taskId);
    if (!task) {
      get().notify('error', 'That task is no longer available.');
      return;
    }
    set({ selectedTaskId: task.id, selectedRoomId: task.roomId });
  },

  clearSelection: () =>
    set((state) => ({
      selectedRoomId: null,
      selectedAgentId: null,
      selectedTaskId: null,
      viewMode: state.isolatedFloorId ? 'floor' : 'building',
    })),

  hoverRoom: (roomId) => {
    if (get().hoveredRoomId !== roomId) set({ hoveredRoomId: roomId });
  },

  selectFloor: (floorId) => {
    if (!floorId) {
      get().showBuilding();
      return;
    }
    set({
      viewMode: 'floor',
      isolatedFloorId: floorId,
      selectedRoomId: null,
      selectedAgentId: null,
      selectedTaskId: null,
      hiddenFloorIds: get().hiddenFloorIds.filter((id) => id !== floorId),
      focusToken: get().focusToken + 1,
    });
  },

  isolateFloor: (floorId) => {
    set({
      isolatedFloorId: floorId,
      viewMode: floorId ? 'floor' : 'building',
      focusToken: get().focusToken + 1,
    });
  },

  toggleFloorVisibility: (floorId) => {
    const { hiddenFloorIds, selectedRoomId, building } = get();
    const hidden = hiddenFloorIds.includes(floorId)
      ? hiddenFloorIds.filter((id) => id !== floorId)
      : [...hiddenFloorIds, floorId];
    const roomFloor = selectedRoomId && building ? roomFloorId(building, selectedRoomId) : null;
    set({
      hiddenFloorIds: hidden,
      ...(roomFloor && hidden.includes(roomFloor)
        ? { selectedRoomId: null, selectedAgentId: null, viewMode: 'building' as ViewMode }
        : {}),
    });
  },

  showAllFloors: () => set({ hiddenFloorIds: [], isolatedFloorId: null, viewMode: 'building' }),

  setCutaway: (value) => set({ cutaway: value, focusToken: get().focusToken + 1 }),

  showBuilding: () =>
    set({
      viewMode: 'building',
      isolatedFloorId: null,
      hiddenFloorIds: [],
      selectedRoomId: null,
      selectedAgentId: null,
      selectedTaskId: null,
      focusToken: get().focusToken + 1,
    }),

  showExterior: () =>
    set({
      viewMode: 'exterior',
      isolatedFloorId: null,
      selectedRoomId: null,
      selectedAgentId: null,
      selectedTaskId: null,
      focusToken: get().focusToken + 1,
    }),

  resetView: () =>
    set({
      viewMode: 'building',
      isolatedFloorId: null,
      hiddenFloorIds: [],
      cutaway: false,
      selectedRoomId: null,
      selectedAgentId: null,
      selectedTaskId: null,
      focusToken: get().focusToken + 1,
    }),

  requestFocus: () => set({ focusToken: get().focusToken + 1 }),

  setSearchQuery: (value) => set({ searchQuery: value }),

  openSearchResult: (result) => {
    set({ searchQuery: '' });
    if (result.roomId) {
      get().selectRoom(result.roomId);
      if (result.kind === 'agent') set({ selectedAgentId: result.id });
      if (result.kind === 'task') set({ selectedTaskId: result.id });
      return;
    }
    if (result.floorId) get().selectFloor(result.floorId);
  },

  setTaskFilter: (patch) => set({ taskFilter: { ...get().taskFilter, ...patch } }),
  resetTaskFilter: () => set({ taskFilter: EMPTY_TASK_FILTER }),
  setOverviewOpen: (value) => set({ overviewOpen: value }),
  setInspectorOpen: (value) => set({ inspectorOpen: value }),
  setInspectorTab: (tab) => set({ inspectorTab: tab, inspectorOpen: true }),

  setExecutionMode: (mode) => {
    const port = mode === 'simulated' ? demoPort : livePort;
    set({ executionMode: mode, executionLabel: port.label });
    if (mode === 'live') {
      get().notify(
        'warning',
        'Live mode routes runs through /api/executions. Without a configured backend every run fails with INTEGRATION_UNAVAILABLE — that is expected and reported honestly.',
      );
    }
  },

  runTask: async (taskId) => {
    const state = get();
    if (state.status !== 'ready') return;
    if (state.runningTaskIds.includes(taskId)) return;
    const port = state.executionMode === 'simulated' ? demoPort : livePort;
    const started = startTask(state.ops, {
      taskId,
      at: nowIso(),
      simulated: port.mode === 'simulated',
    });
    if (!started.ok) {
      get().notify('warning', started.message);
      return;
    }

    const task = started.state.tasks.find((candidate) => candidate.id === taskId);
    const agent = task?.agentId
      ? started.state.agents.find((candidate) => candidate.id === task.agentId)
      : undefined;
    if (!task || !agent) {
      get().notify('error', 'Cannot run a task without an assigned agent.');
      return;
    }

    const controller = new AbortController();
    runningControllers.set(taskId, controller);
    set({
      ops: started.state,
      runningTaskIds: [...state.runningTaskIds, taskId],
      selectedTaskId: taskId,
      selectedAgentId: agent.id,
      selectedRoomId: agent.roomId,
    });

    try {
      const outcome = await port.execute({
        task,
        agent,
        signal: controller.signal,
        onProgress: (message) => {
          const progressed = progressTask(get().ops, {
            taskId,
            at: nowIso(),
            message,
            simulated: port.mode === 'simulated',
          });
          if (progressed.ok) set({ ops: progressed.state });
        },
      });

      const current = get().ops;
      const liveTask = current.tasks.find((candidate) => candidate.id === taskId);
      if (!liveTask || liveTask.status !== 'RUNNING') {
        get().notify('warning', 'The run finished after the task changed state; the outcome was discarded.');
        return;
      }

      if (outcome.ok) {
        const completed = completeTask(current, {
          taskId,
          at: nowIso(),
          result: {
            summary: outcome.summary,
            simulated: outcome.simulated,
            source: outcome.source,
            ...(outcome.metrics ? { metrics: outcome.metrics } : {}),
            ...(outcome.artifacts ? { artifacts: outcome.artifacts } : {}),
          },
        });
        if (completed.ok) {
          set({ ops: completed.state });
          get().notify('success', outcome.simulated ? 'Simulated run completed.' : 'Run completed.');
        } else {
          get().notify('error', completed.message);
        }
      } else {
        const error = outcome.error ?? {
          code: 'EXECUTION_FAILED',
          message: outcome.summary,
          retryable: true,
        };
        const failed = failTask(current, { taskId, at: nowIso(), error });
        if (failed.ok) {
          set({ ops: failed.state });
          get().notify('error', `${error.code}: ${error.message}`);
        } else {
          get().notify('error', failed.message);
        }
      }
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === 'AbortError';
      if (!aborted) {
        const failed = failTask(get().ops, {
          taskId,
          at: nowIso(),
          error: {
            code: 'ADAPTER_ERROR',
            message: error instanceof Error ? error.message : 'Unknown adapter failure.',
            retryable: true,
          },
        });
        if (failed.ok) set({ ops: failed.state });
        get().notify('error', 'The execution adapter threw an unexpected error.');
      }
    } finally {
      runningControllers.delete(taskId);
      set({ runningTaskIds: get().runningTaskIds.filter((id) => id !== taskId) });
    }
  },

  retryTask: (taskId) => {
    const result = retryTaskOp(get().ops, { taskId, at: nowIso() });
    if (!result.ok) {
      get().notify('warning', result.message);
      return;
    }
    set({ ops: result.state });
    get().notify('info', 'Task re-queued. Start it again when ready.');
  },

  cancelTask: (taskId) => {
    const controller = runningControllers.get(taskId);
    controller?.abort();
    runningControllers.delete(taskId);
    const result = cancelTaskOp(get().ops, { taskId, at: nowIso() });
    if (!result.ok) {
      get().notify('warning', result.message);
      return;
    }
    set({
      ops: result.state,
      runningTaskIds: get().runningTaskIds.filter((id) => id !== taskId),
    });
  },

  reassignTask: (taskId, agentId) => {
    const result = assignTask(get().ops, { taskId, agentId, at: nowIso() });
    if (!result.ok) {
      get().notify('warning', result.message);
      return;
    }
    set({ ops: result.state });
  },

  setAgentStatus: (agentId, status) => {
    const result = setAgentStatusOp(get().ops, { agentId, status, at: nowIso() });
    if (!result.ok) {
      get().notify('warning', result.message);
      return;
    }
    set({ ops: result.state });
  },

  moveAgent: (agentId, roomId, workstationId) => {
    const building = get().building;
    if (!building) return;
    const rooms = new Map<string, Room>(
      building.floors.flatMap((floor) => floor.rooms.map((room) => [room.id, room] as const)),
    );
    const result = moveAgentOp(get().ops, {
      agentId,
      roomId,
      workstationId,
      at: nowIso(),
      rooms,
    });
    if (!result.ok) {
      get().notify('warning', result.message);
      return;
    }
    set({ ops: result.state, selectedRoomId: roomId });
  },
}));

/* Convenience selectors used by components. */
export const selectTaskList = (state: OfficeState): readonly Task[] => state.ops.tasks;
