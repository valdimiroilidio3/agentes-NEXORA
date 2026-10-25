'use client';

/**
 * Live desk screens.
 *
 * Every workstation monitor shows a canvas texture describing what its
 * occupant is doing *right now*: activity, task, status, room and clock. The
 * text is composed in one place (`screenContentFor`) so it can be unit tested
 * without a canvas, and painted through a small registry so 27 screens cost one
 * lazy texture each and are only repainted when their content changes (plus a
 * slow clock refresh).
 *
 * The screens are part of the scene, not the UI: reading them is the same as
 * looking over a colleague's shoulder while walking the floor.
 */
import * as THREE from 'three';
import type { Agent, AgentStatus, Task } from '@/domain/types';
import type { AgentActivity } from './activity';

export interface ScreenContent {
  readonly agentName: string;
  readonly role: string;
  readonly roomName: string;
  readonly status: AgentStatus;
  readonly statusLabel: string;
  readonly activityLabel: string;
  readonly activityDetail: string;
  readonly activityKind: string;
  readonly taskTitle: string | null;
  readonly taskStatus: string | null;
  readonly clock: string;
  readonly destination: string;
}

const STATUS_LABELS: Record<AgentStatus, string> = {
  IDLE: 'idle',
  WORKING: 'working',
  WAITING: 'blocked',
  ERROR: 'failed',
  OFFLINE: 'offline',
};

const TASK_STATUS_LABELS: Record<string, string> = {
  QUEUED: 'queued',
  RUNNING: 'running',
  WAITING: 'waiting',
  COMPLETED: 'done',
  FAILED: 'failed',
};

/** Accent colour per activity, used for the activity headline. */
const ACTIVITY_COLOURS: Record<string, string> = {
  TYPING: '#7ee787',
  READING: '#79c0ff',
  THINKING: '#d2a8ff',
  TALKING: '#ffd166',
  MEETING: '#f78fb3',
  SITTING: '#8b949e',
  SITTING_DOWN: '#8b949e',
  STANDING_UP: '#8b949e',
  WALKING: '#54d6e6',
  TURNING: '#54d6e6',
  PICKING_UP: '#ffa657',
  RETURNING_TO_WORK: '#54d6e6',
  IDLE: '#9aa7b4',
};

function clockString(from: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(from.getHours())}:${pad(from.getMinutes())}:${pad(from.getSeconds())}`;
}

export interface ScreenContentInput {
  readonly agent: Agent;
  readonly task: Task | null;
  readonly roomName: string;
  readonly activity: AgentActivity | null;
  readonly at: Date;
}

/**
 * Pure composition of what a monitor displays. No canvas, no Three.js, so the
 * wording is covered by tests like any other domain rule.
 */
export function screenContentFor(input: ScreenContentInput): ScreenContent {
  const activity = input.activity;
  return {
    agentName: input.agent.name,
    role: input.agent.role,
    roomName: input.roomName,
    status: input.agent.status,
    statusLabel: STATUS_LABELS[input.agent.status],
    activityLabel: activity?.label ?? 'No behaviour state',
    activityDetail: activity?.reason ?? 'The scene is not mounted.',
    activityKind: activity?.activity ?? 'UNKNOWN',
    taskTitle: input.task?.title ?? null,
    taskStatus: input.task ? (TASK_STATUS_LABELS[input.task.status] ?? input.task.status) : null,
    clock: clockString(input.at),
    destination:
      activity?.destination.kind === 'meeting'
        ? 'meeting room'
        : activity?.destination.kind === 'break'
          ? 'on break'
          : 'at the desk',
  };
}

/* ------------------------------------------------------------------ */
/* Canvas painting                                                     */
/* ------------------------------------------------------------------ */

const WIDTH = 320;
const HEIGHT = 180;

function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
): void {
  const words = text.split(/\s+/);
  let line = '';
  let lineIndex = 0;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width > maxWidth && line) {
      context.fillText(line, x, y + lineIndex * lineHeight);
      lineIndex += 1;
      if (lineIndex >= maxLines) return;
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line && lineIndex < maxLines) context.fillText(line, x, y + lineIndex * lineHeight);
}

function paint(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  content: ScreenContent,
): void {
  const accent = ACTIVITY_COLOURS[content.activityKind] ?? '#54d6e6';
  const backdrop = context.createLinearGradient(0, 0, 0, HEIGHT);
  backdrop.addColorStop(0, '#0d1524');
  backdrop.addColorStop(1, '#080d16');
  context.fillStyle = backdrop;
  context.fillRect(0, 0, WIDTH, HEIGHT);

  // Header strip: who sits here.
  context.fillStyle = '#132033';
  context.fillRect(0, 0, WIDTH, 30);
  context.font = 'bold 15px ui-sans-serif, system-ui, sans-serif';
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.fillStyle = '#e8eef6';
  context.fillText(content.agentName.slice(0, 22), 10, 16);
  context.font = '10px ui-sans-serif, system-ui, sans-serif';
  context.fillStyle = '#8aa0b8';
  context.textAlign = 'right';
  context.fillText(`${content.statusLabel} · ${content.clock}`, WIDTH - 10, 16);

  // Activity headline.
  context.textAlign = 'left';
  context.font = 'bold 19px ui-sans-serif, system-ui, sans-serif';
  context.fillStyle = accent;
  context.fillText(content.activityLabel.slice(0, 26), 12, 54);
  context.font = '9px ui-sans-serif, system-ui, sans-serif';
  context.fillStyle = '#54d6e6';
  context.fillText(`${content.activityKind} · ${content.destination}`, 12, 72);

  // Reason / detail, two lines maximum.
  context.font = '10px ui-sans-serif, system-ui, sans-serif';
  context.fillStyle = '#a9b8c9';
  wrapText(context, content.activityDetail, 12, 92, WIDTH - 24, 13, 2);

  // Task block.
  context.fillStyle = '#0f1b2b';
  context.fillRect(8, 120, WIDTH - 16, 36);
  context.fillStyle = '#2a3a4f';
  context.fillRect(8, 120, 3, 36);
  context.font = '10px ui-sans-serif, system-ui, sans-serif';
  context.fillStyle = '#6f8298';
  context.fillText('TASK', 18, 130);
  context.font = 'bold 12px ui-sans-serif, system-ui, sans-serif';
  context.fillStyle = content.taskTitle ? '#dce6f2' : '#5f7386';
  context.fillText(
    (content.taskTitle ?? 'No active task').slice(0, 30),
    18,
    146,
  );
  if (content.taskStatus) {
    context.textAlign = 'right';
    context.font = '10px ui-sans-serif, system-ui, sans-serif';
    context.fillStyle = accent;
    context.fillText(content.taskStatus, WIDTH - 16, 130);
    context.textAlign = 'left';
  }

  // Footer: where the colleague belongs.
  context.font = '9px ui-sans-serif, system-ui, sans-serif';
  context.fillStyle = '#54677d';
  context.fillText(`${content.roomName} · ${content.role}`.slice(0, 52), 12, 170);

  // Scanline for a screen-like finish.
  context.fillStyle = 'rgba(120, 200, 255, 0.05)';
  for (let y = 0; y < HEIGHT; y += 4) context.fillRect(0, y, WIDTH, 1);
  void canvas;
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export interface DeskScreenHandle {
  readonly id: string;
  readonly texture: THREE.CanvasTexture;
  content: () => ScreenContent;
  lastPaint: number;
  lastKey: string;
  /** Paints the current content into the canvas and flags the texture. */
  paint: () => void;
}

const registry = new Map<string, DeskScreenHandle>();
let paintCount = 0;

const fingerprint = (content: ScreenContent): string =>
  [
    content.agentName,
    content.statusLabel,
    content.activityKind,
    content.activityLabel,
    content.activityDetail,
    content.taskTitle ?? '',
    content.taskStatus ?? '',
    content.clock,
  ].join('|');

/**
 * Creates (or re-binds) the screen of one workstation. Returns `null` when the
 * environment cannot give us a 2D canvas, in which case the monitor simply
 * shows its static glass.
 */
export function registerDeskScreen(
  id: string,
  content: () => ScreenContent,
): DeskScreenHandle | null {
  if (typeof document === 'undefined') return null;
  const existing = registry.get(id);
  if (existing) {
    existing.content = content;
    return existing;
  }
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  let context: CanvasRenderingContext2D | null = null;
  try {
    context = canvas.getContext('2d');
  } catch {
    context = null;
  }
  if (!context || typeof context.measureText !== 'function') return null;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const handle: DeskScreenHandle = {
    id,
    texture,
    content,
    lastPaint: -Infinity,
    lastKey: '',
    paint: () => {
      try {
        paint(canvas, context as CanvasRenderingContext2D, handle.content());
        texture.needsUpdate = true;
        paintCount += 1;
      } catch {
        // A canvas that cannot be painted must never break the frame loop.
      }
    },
  };
  registry.set(id, handle);
  paintDeskScreen(handle, 0, true);
  return handle;
}

function paintDeskScreen(handle: DeskScreenHandle, elapsed: number, force: boolean): void {
  const content = handle.content();
  const key = fingerprint(content);
  if (!force && key === handle.lastKey) return;
  // At most one repaint per screen per 400 ms: the clock is the only part that
  // changes while an activity is steady.
  if (!force && elapsed - handle.lastPaint < 0.4) return;
  handle.lastKey = key;
  handle.lastPaint = elapsed;
  handle.paint();
}

let clock = 0;

/**
 * Repaints mounted screens whose content moved on, throttled per screen.
 * Driven by the shared frame loop with the real delta, so it behaves the same
 * in the browser and in the headless tests.
 */
export function refreshDeskScreens(dt: number): void {
  clock += Math.max(0, Math.min(0.1, dt));
  for (const handle of registry.values()) paintDeskScreen(handle, clock, false);
}

/** Seconds accumulated by the screen clock (tests and diagnostics). */
export function deskScreenClock(): number {
  return clock;
}

export function unregisterDeskScreen(id: string): void {
  const handle = registry.get(id);
  if (!handle) return;
  registry.delete(id);
  handle.texture.dispose();
}

export function deskScreenCount(): number {
  return registry.size;
}

export function deskScreenPaintCount(): number {
  return paintCount;
}

export function resetDeskScreens(): void {
  for (const handle of registry.values()) handle.texture.dispose();
  registry.clear();
  paintCount = 0;
  clock = 0;
}
