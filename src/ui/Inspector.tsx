'use client';

import { useMemo, useState } from 'react';
import { useOfficeStore, type InspectorTab } from '@/store/officeStore';
import {
  DEPARTMENTS,
  agentById,
  eventsForAgent,
  eventsForRoom,
  eventsForTask,
  filterTasks,
  roomById,
  summariseBuilding,
  summariseRoom,
  taskById,
  type TaskFilter,
} from '@/domain/selectors';
import { AGENT_STATUS_LABELS } from '@/domain/agents';
import { TASK_STATUS_LABELS, unmetDependencies } from '@/domain/tasks';
import { formatDateTime, formatDuration, formatRelative, formatTime } from '@/lib/time';
import {
  Badge,
  Button,
  DataSourceNote,
  EmptyState,
  KeyValue,
  Section,
  StatusDot,
  toneForAgent,
  toneForTask,
} from './primitives';
import type { Agent, OperationalEvent, Task, TaskStatus } from '@/domain/types';

const TABS: Array<{ id: InspectorTab; label: string }> = [
  { id: 'context', label: 'Context' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'history', label: 'History' },
];

function TaskRow({ task, onSelect }: { task: Task; onSelect: () => void }) {
  const runningIds = useOfficeStore((state) => state.runningTaskIds);
  const runTask = useOfficeStore((state) => state.runTask);
  const cancelTask = useOfficeStore((state) => state.cancelTask);
  const retryTask = useOfficeStore((state) => state.retryTask);
  const agent = useOfficeStore((state) => state.ops.agents.find((candidate) => candidate.id === task.agentId));
  const running = runningIds.includes(task.id);

  return (
    <li className="task-row">
      <button type="button" className="task-row__main" onClick={onSelect}>
        <span className="task-row__top">
          <StatusDot tone={toneForTask(task.status)} pulse={running} />
          <span className="task-row__title">{task.title}</span>
          <Badge tone={toneForTask(task.status)}>{TASK_STATUS_LABELS[task.status]}</Badge>
        </span>
        <span className="task-row__meta">
          {agent ? `${agent.name} · ` : 'Unassigned · '}
          {task.id}
          {task.result?.simulated ? ' · simulated' : ''}
        </span>
      </button>
      <div className="task-row__actions">
        {task.status === 'QUEUED' && (
          <Button size="sm" variant="primary" onClick={() => void runTask(task.id)} disabled={running || !agent}>
            Run
          </Button>
        )}
        {(task.status === 'RUNNING' || task.status === 'WAITING') && (
          <Button size="sm" variant="danger" onClick={() => cancelTask(task.id)}>
            {running ? 'Stop' : 'Cancel'}
          </Button>
        )}
        {task.status === 'FAILED' && (
          <Button size="sm" onClick={() => retryTask(task.id)} disabled={task.error?.retryable === false}>
            Retry
          </Button>
        )}
      </div>
    </li>
  );
}

function EventList({ events, limit = 8 }: { events: readonly OperationalEvent[]; limit?: number }) {
  const ordered = [...events].reverse().slice(0, limit);
  if (ordered.length === 0) return <EmptyState title="No events yet" hint="Start a task to populate the audit log." />;
  return (
    <ul className="event-list">
      {ordered.map((event) => (
        <li key={event.id} className={`event event--${event.level}`}>
          <span className="event__time">{formatTime(event.at)}</span>
          <span className="event__message">{event.message}</span>
        </li>
      ))}
    </ul>
  );
}

function RoomContext({ roomId }: { roomId: string }) {
  const building = useOfficeStore((state) => state.building);
  const ops = useOfficeStore((state) => state.ops);
  const selectAgent = useOfficeStore((state) => state.selectAgent);
  const selectTask = useOfficeStore((state) => state.selectTask);
  const isolateFloor = useOfficeStore((state) => state.isolateFloor);
  const clearSelection = useOfficeStore((state) => state.clearSelection);
  const requestFocus = useOfficeStore((state) => state.requestFocus);

  const room = building ? roomById(building, roomId) : null;
  const floor = building?.floors.find((candidate) => candidate.id === room?.floorId);
  const summary = useMemo(() => summariseRoom(ops, roomId), [ops, roomId]);
  if (!room || !floor) return <EmptyState title="Room unavailable" hint="It may have been removed from the configuration." />;

  const tasks = ops.tasks.filter((task) => task.roomId === roomId);
  const events = eventsForRoom(ops.events, roomId);

  return (
    <div className="stack">
      <header className="context-head">
        <div>
          <p className="eyebrow">
            {floor.name} · {room.code}
          </p>
          <h2>{room.name}</h2>
          <p className="context-head__meta">
            {room.template.replace(/-/g, ' ')} · {DEPARTMENTS[floor.department].label}
          </p>
        </div>
        <div className="context-head__actions">
          <Button size="sm" variant="ghost" onClick={requestFocus} title="Re-frame the camera on this room">
            Frame
          </Button>
          <Button size="sm" variant="ghost" onClick={() => isolateFloor(floor.id)}>
            Floor
          </Button>
          <Button size="sm" variant="ghost" onClick={clearSelection} title="Clear selection (Esc)">
            ✕
          </Button>
        </div>
      </header>

      <div className="stat-strip">
        <div>
          <span>{room.rect.width.toFixed(1)}×{room.rect.depth.toFixed(1)} m</span>
          <small>footprint</small>
        </div>
        <div>
          <span>{room.workstations.length}</span>
          <small>workstations</small>
        </div>
        <div>
          <span>{summary.agents.length}</span>
          <small>agents</small>
        </div>
        <div>
          <span>{summary.activeTaskCount + summary.queuedTaskCount}</span>
          <small>open tasks</small>
        </div>
      </div>

      <Section title="Assigned agents" aside={<span className="muted">{summary.agents.length}</span>}>
        {summary.agents.length === 0 ? (
          <EmptyState title="No agent seated here" hint="This space is currently unstaffed." />
        ) : (
          <ul className="agent-list">
            {summary.agents.map((agent) => (
              <li key={agent.id}>
                <button type="button" className="agent-item" onClick={() => selectAgent(agent.id)}>
                  <StatusDot tone={toneForAgent(agent.status)} pulse={agent.status === 'WORKING'} />
                  <span className="agent-item__text">
                    <span className="agent-item__name">{agent.name}</span>
                    <span className="agent-item__meta">{agent.role}</span>
                  </span>
                  <Badge tone={toneForAgent(agent.status)}>{AGENT_STATUS_LABELS[agent.status]}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Tasks in this room" aside={<span className="muted">{tasks.length}</span>}>
        {tasks.length === 0 ? (
          <EmptyState title="No tasks" hint="Queue a task from the task board." />
        ) : (
          <ul className="task-list">
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} onSelect={() => selectTask(task.id)} />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Recent activity">
        <EventList events={events} limit={6} />
      </Section>
    </div>
  );
}

function AgentContext({ agentId }: { agentId: string }) {
  const building = useOfficeStore((state) => state.building);
  const agents = useOfficeStore((state) => state.ops.agents);
  const tasks = useOfficeStore((state) => state.ops.tasks);
  const events = useOfficeStore((state) => state.ops.events);
  const selectRoom = useOfficeStore((state) => state.selectRoom);
  const selectTask = useOfficeStore((state) => state.selectTask);
  const setAgentStatus = useOfficeStore((state) => state.setAgentStatus);

  const agent = agentById(agents, agentId);
  if (!agent) return <EmptyState title="Agent unavailable" />;
  const room = building ? roomById(building, agent.roomId) : null;
  const floor = building?.floors.find((candidate) => candidate.id === room?.floorId);
  const currentTask = taskById(tasks, agent.currentTaskId);
  const assigned = tasks.filter((task) => task.agentId === agent.id);
  const agentEvents = eventsForAgent(events, agent.id);

  return (
    <div className="stack">
      <header className="context-head">
        <div>
          <p className="eyebrow">
            {floor?.name ?? 'Unassigned'} · {room?.name ?? agent.roomId}
          </p>
          <h2>{agent.name}</h2>
          <p className="context-head__meta">
            {agent.role} · {agent.specialization}
          </p>
        </div>
        <Badge tone={toneForAgent(agent.status)}>{AGENT_STATUS_LABELS[agent.status]}</Badge>
      </header>

      <section className="detail-grid">
        <KeyValue label="Department">{DEPARTMENTS[agent.department].label}</KeyValue>
        <KeyValue label="Workstation">
          <code>{agent.workstationId}</code>
        </KeyValue>
        <KeyValue label="Last activity">{formatRelative(agent.lastActivityAt)}</KeyValue>
        <KeyValue label="Executor contract">{agent.execution?.provider ?? 'not configured'}</KeyValue>
      </section>

      <Section title="Current task">
        {currentTask ? (
          <div className="callout">
            <div className="callout__head">
              <StatusDot tone={toneForTask(currentTask.status)} pulse />
              <strong>{currentTask.title}</strong>
              <Badge tone={toneForTask(currentTask.status)}>{TASK_STATUS_LABELS[currentTask.status]}</Badge>
            </div>
            <p className="muted">Started {formatDateTime(currentTask.startedAt)}</p>
            <div className="row-actions">
              <Button size="sm" onClick={() => selectTask(currentTask.id)}>
                Open task
              </Button>
            </div>
          </div>
        ) : (
          <EmptyState title="No active task" hint="The agent is available for the next queued item." />
        )}
      </Section>

      <Section title="Controls">
        <div className="row-actions">
          <Button size="sm" onClick={() => selectRoom(agent.roomId)}>
            Go to room
          </Button>
          {agent.status === 'OFFLINE' ? (
            <Button size="sm" onClick={() => setAgentStatus(agent.id, 'IDLE')}>
              Bring online
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setAgentStatus(agent.id, 'OFFLINE')}>
              Take offline
            </Button>
          )}
          {agent.status === 'ERROR' && (
            <Button size="sm" onClick={() => setAgentStatus(agent.id, 'IDLE')}>
              Clear error
            </Button>
          )}
        </div>
        <p className="hint">
          Agent status always follows task execution. Only offline and error-clearing are operator actions.
        </p>
      </Section>

      <Section title="Assigned tasks" aside={<span className="muted">{assigned.length}</span>}>
        {assigned.length === 0 ? (
          <EmptyState title="No tasks assigned" />
        ) : (
          <ul className="task-list">
            {assigned.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onSelect={() => selectTask(task.id)}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Recent events">
        <EventList events={agentEvents} limit={6} />
      </Section>
    </div>
  );
}

function TaskContext({ taskId }: { taskId: string }) {
  const building = useOfficeStore((state) => state.building);
  const tasks = useOfficeStore((state) => state.ops.tasks);
  const agents = useOfficeStore((state) => state.ops.agents);
  const events = useOfficeStore((state) => state.ops.events);
  const runningIds = useOfficeStore((state) => state.runningTaskIds);
  const runTask = useOfficeStore((state) => state.runTask);
  const cancelTask = useOfficeStore((state) => state.cancelTask);
  const retryTask = useOfficeStore((state) => state.retryTask);
  const selectRoom = useOfficeStore((state) => state.selectRoom);
  const reassignTask = useOfficeStore((state) => state.reassignTask);

  const task = taskById(tasks, taskId);
  const [reassignTo, setReassignTo] = useState('');
  if (!task) return <EmptyState title="Task unavailable" />;

  const agent = agentById(agents, task.agentId);
  const room = building ? roomById(building, task.roomId) : null;
  const running = runningIds.includes(task.id);
  const taskEvents = eventsForTask(events, task.id);
  const candidates = agents.filter(
    (candidate: Agent) => candidate.department === task.department && candidate.status !== 'OFFLINE',
  );
  const blockedBy = unmetDependencies(task, tasks);

  return (
    <div className="stack">
      <header className="context-head">
        <div>
          <p className="eyebrow">
            {room?.name ?? task.roomId} · <code>{task.id}</code>
          </p>
          <h2>{task.title}</h2>
          <p className="context-head__meta">{task.description}</p>
        </div>
        <Badge tone={toneForTask(task.status)}>{TASK_STATUS_LABELS[task.status]}</Badge>
      </header>

      <div className="row-actions">
        {task.status === 'QUEUED' && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => void runTask(task.id)}
            disabled={running || !agent || blockedBy.length > 0}
            title={blockedBy.length > 0 ? 'Dependencies are incomplete' : 'Start the run'}
          >
            Run with {agent?.name ?? 'no agent'}
          </Button>
        )}
        {(task.status === 'RUNNING' || task.status === 'WAITING') && (
          <Button variant="danger" size="sm" onClick={() => cancelTask(task.id)}>
            Cancel task
          </Button>
        )}
        {task.status === 'FAILED' && (
          <Button size="sm" onClick={() => retryTask(task.id)} disabled={task.error?.retryable === false}>
            Re-queue
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => selectRoom(task.roomId)}>
          Open room
        </Button>
      </div>

      <section className="detail-grid">
        <KeyValue label="Agent">
          {agent ? (
            <button type="button" className="link" onClick={() => agent && selectRoom(agent.roomId)}>
              {agent.name}
            </button>
          ) : (
            'Unassigned'
          )}
        </KeyValue>
        <KeyValue label="Department">{DEPARTMENTS[task.department].label}</KeyValue>
        <KeyValue label="Priority">{task.priority}</KeyValue>
        <KeyValue label="Created">{formatDateTime(task.createdAt)}</KeyValue>
        <KeyValue label="Started">{formatDateTime(task.startedAt)}</KeyValue>
        <KeyValue label="Completed">{formatDateTime(task.completedAt)}</KeyValue>
        <KeyValue label="Duration">{formatDuration(task.startedAt, task.completedAt)}</KeyValue>
        <KeyValue label="Depends on">{task.dependsOn.length ? task.dependsOn.join(', ') : 'nothing'}</KeyValue>
      </section>

      {blockedBy.length > 0 && (
        <div className="callout">
          <div className="callout__head">
            <Badge tone="waiting">BLOCKED</Badge>
            <strong>Waiting on {blockedBy.length} dependency</strong>
          </div>
          <p>{blockedBy.join(', ')} — the task cannot start until those complete.</p>
        </div>
      )}

      {task.error && (
        <div className="callout callout--error">
          <div className="callout__head">
            <Badge tone="error">FAILED</Badge>
            <strong>{task.error.code}</strong>
          </div>
          <p>{task.error.message}</p>
          <p className="muted">{task.error.retryable ? 'Retry is permitted.' : 'This failure is not retryable.'}</p>
        </div>
      )}

      {task.result && (
        <div className="callout callout--result">
          <div className="callout__head">
            <Badge tone={task.result.simulated ? 'waiting' : 'success'}>
              {task.result.simulated ? 'SIMULATED RESULT' : 'RESULT'}
            </Badge>
            <strong>{task.result.source}</strong>
          </div>
          <p>{task.result.summary}</p>
          {task.result.metrics && (
            <dl className="metric-list">
              {Object.entries(task.result.metrics).map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{String(value)}</dd>
                </div>
              ))}
            </dl>
          )}
          {task.result.artifacts && task.result.artifacts.length > 0 && (
            <p className="muted">Artifacts: {task.result.artifacts.join(', ')}</p>
          )}
        </div>
      )}

      {task.status === 'QUEUED' && candidates.length > 1 && (
        <Section title="Re-assign">
          <div className="row-actions">
            <select
              className="select"
              aria-label="Re-assign task to another agent"
              value={reassignTo}
              onChange={(event) => setReassignTo(event.target.value)}
            >
              <option value="">Select an agent…</option>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name} — {candidate.role}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              disabled={!reassignTo}
              onClick={() => {
                if (reassignTo) {
                  reassignTask(task.id, reassignTo);
                  setReassignTo('');
                }
              }}
            >
              Re-assign
            </Button>
          </div>
        </Section>
      )}

      <Section title="Execution history">
        <EventList events={taskEvents} limit={10} />
      </Section>
    </div>
  );
}

function BuildingContext() {
  const ops = useOfficeStore((state) => state.ops);
  const validation = useOfficeStore((state) => state.validation);
  const warnings = useOfficeStore((state) => state.dataWarnings);
  const summary = useMemo(() => summariseBuilding(ops), [ops]);
  const selectTask = useOfficeStore((state) => state.selectTask);

  const nextTasks = ops.tasks
    .filter((task) => task.status === 'QUEUED')
    .slice(0, 5);

  return (
    <div className="stack">
      <header className="context-head">
        <div>
          <p className="eyebrow">NEXORA Headquarters</p>
          <h2>Operational overview</h2>
          <p className="context-head__meta">
            Select a floor, room, agent or task to inspect it. Everything shown is derived from the same state the 3D
            building renders.
          </p>
        </div>
      </header>

      <div className="stat-strip stat-strip--wide">
        <div>
          <span>{summary.agents}</span>
          <small>agents</small>
        </div>
        <div>
          <span>{summary.working}</span>
          <small>working</small>
        </div>
        <div>
          <span>{summary.tasksRunning}</span>
          <small>running</small>
        </div>
        <div>
          <span>{summary.tasksQueued}</span>
          <small>queued</small>
        </div>
        <div>
          <span>{summary.tasksFailed}</span>
          <small>failed</small>
        </div>
        <div>
          <span>{summary.tasksCompleted}</span>
          <small>completed</small>
        </div>
      </div>

      <Section title="Ready to run" aside={<span className="muted">queued</span>}>
        {nextTasks.length === 0 ? (
          <EmptyState title="Queue is empty" />
        ) : (
          <ul className="task-list">
            {nextTasks.map((task) => (
              <TaskRow key={task.id} task={task} onSelect={() => selectTask(task.id)} />
            ))}
          </ul>
        )}
      </Section>

      {summary.simulatedResults > 0 && (
        <div className="callout">
          <div className="callout__head">
            <Badge tone="waiting">SIMULATED</Badge>
            <strong>{summary.simulatedResults} completed results are simulated</strong>
          </div>
          <p>They were produced locally by the demo adapter. No external system was contacted.</p>
        </div>
      )}

      <Section title="Data integrity">
        {validation ? (
          <ul className="integrity">
            <li>
              <StatusDot tone="success" /> Spatial validation: {validation.errors.length} errors,{' '}
              {validation.warnings.length} warnings
            </li>
            <li>
              <StatusDot tone={warnings.length ? 'waiting' : 'success'} /> Fixture warnings: {warnings.length}
            </li>
          </ul>
        ) : (
          <EmptyState title="Validation unavailable" />
        )}
      </Section>

      <DataSourceNote />
    </div>
  );
}

function TasksTab() {
  const ops = useOfficeStore((state) => state.ops);
  const building = useOfficeStore((state) => state.building);
  const filter = useOfficeStore((state) => state.taskFilter);
  const setTaskFilter = useOfficeStore((state) => state.setTaskFilter);
  const resetTaskFilter = useOfficeStore((state) => state.resetTaskFilter);
  const selectTask = useOfficeStore((state) => state.selectTask);
  const setInspectorTab = useOfficeStore((state) => state.setInspectorTab);

  const tasks = useMemo(() => filterTasks(ops.tasks, filter), [ops.tasks, filter]);
  const statuses: Array<'ALL' | TaskStatus> = ['ALL', 'RUNNING', 'QUEUED', 'WAITING', 'COMPLETED', 'FAILED'];

  const update = (patch: Partial<TaskFilter>) => setTaskFilter(patch);

  return (
    <div className="stack">
      <header className="context-head">
        <div>
          <p className="eyebrow">Operations</p>
          <h2>Task board</h2>
          <p className="context-head__meta">
            {tasks.length} of {ops.tasks.length} tasks · runs are explicitly triggered, never automatic
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={resetTaskFilter}>
          Clear
        </Button>
      </header>

      <div className="chips" role="group" aria-label="Filter by status">
        {statuses.map((status) => (
          <button
            key={status}
            type="button"
            className={`chip${filter.status === status ? ' is-active' : ''}`}
            aria-pressed={filter.status === status}
            onClick={() => update({ status })}
          >
            {status === 'ALL' ? 'All' : TASK_STATUS_LABELS[status]}
          </button>
        ))}
      </div>

      <div className="filters">
        <input
          className="search__input search__input--inline"
          placeholder="Filter tasks…"
          aria-label="Filter tasks by text"
          value={filter.query}
          onChange={(event) => update({ query: event.target.value })}
        />
        <select
          className="select"
          aria-label="Filter by department"
          value={filter.department ?? ''}
          onChange={(event) => update({ department: (event.target.value || null) as TaskFilter['department'] })}
        >
          <option value="">All departments</option>
          {(Object.keys(DEPARTMENTS) as Array<keyof typeof DEPARTMENTS>).map((key) => (
            <option key={key} value={key}>
              {DEPARTMENTS[key].label}
            </option>
          ))}
        </select>
      </div>

      {filter.agentId && (
        <div className="filter-pill">
          Agent filter: {agentById(ops.agents, filter.agentId)?.name ?? filter.agentId}
          <button type="button" onClick={() => update({ agentId: null })} aria-label="Clear agent filter">
            ✕
          </button>
        </div>
      )}
      {filter.roomId && (
        <div className="filter-pill">
          Room filter: {(building ? roomById(building, filter.roomId)?.name : null) ?? filter.roomId}
          <button type="button" onClick={() => update({ roomId: null })} aria-label="Clear room filter">
            ✕
          </button>
        </div>
      )}

      {tasks.length === 0 ? (
        <EmptyState title="No tasks match these filters" hint="Clear the filters to see the full queue." />
      ) : (
        <ul className="task-list">
          {[...tasks]
            .sort((a, b) => {
              const order: Record<TaskStatus, number> = {
                RUNNING: 0,
                WAITING: 1,
                QUEUED: 2,
                FAILED: 3,
                COMPLETED: 4,
              };
              return order[a.status] - order[b.status] || b.updatedAt.localeCompare(a.updatedAt);
            })
            .map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onSelect={() => {
                  selectTask(task.id);
                  setInspectorTab('context');
                }}
              />
            ))}
        </ul>
      )}
    </div>
  );
}

function HistoryTab() {
  const events = useOfficeStore((state) => state.ops.events);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const filtered = useMemo(
    () => (errorsOnly ? events.filter((event) => event.level === 'error' || event.level === 'warning') : events),
    [events, errorsOnly],
  );

  return (
    <div className="stack">
      <header className="context-head">
        <div>
          <p className="eyebrow">Audit trail</p>
          <h2>Event history</h2>
          <p className="context-head__meta">{events.length} events retained (most recent last)</p>
        </div>
      </header>
      <label className="toggle">
        <input type="checkbox" checked={errorsOnly} onChange={(event) => setErrorsOnly(event.target.checked)} />
        <span>Warnings and errors only</span>
      </label>
      {filtered.length === 0 ? (
        <EmptyState title="No matching events" />
      ) : (
        <ul className="event-list event-list--full">
          {[...filtered].reverse().map((event) => (
            <li key={event.id} className={`event event--${event.level}`}>
              <span className="event__time">{formatDateTime(event.at)}</span>
              <span className="event__type">{event.type.replace(/_/g, ' ').toLowerCase()}</span>
              <span className="event__message">{event.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Inspector() {
  const tab = useOfficeStore((state) => state.inspectorTab);
  const setTab = useOfficeStore((state) => state.setInspectorTab);
  const selectedRoomId = useOfficeStore((state) => state.selectedRoomId);
  const selectedAgentId = useOfficeStore((state) => state.selectedAgentId);
  const selectedTaskId = useOfficeStore((state) => state.selectedTaskId);

  return (
    <aside className="inspector" aria-label="Inspector">
      <div className="tabs" role="tablist">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={`tab${tab === entry.id ? ' is-active' : ''}`}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
            {entry.id === 'tasks' && selectedTaskId ? <span className="tab__dot" /> : null}
          </button>
        ))}
      </div>
      <div className="inspector__body">
        {tab === 'context' &&
          (selectedAgentId ? (
            <AgentContext agentId={selectedAgentId} />
          ) : selectedRoomId ? (
            <RoomContext roomId={selectedRoomId} />
          ) : selectedTaskId ? (
            <TaskContext taskId={selectedTaskId} />
          ) : (
            <BuildingContext />
          ))}
        {tab === 'tasks' && <TasksTab />}
        {tab === 'history' && <HistoryTab />}
      </div>
    </aside>
  );
}
