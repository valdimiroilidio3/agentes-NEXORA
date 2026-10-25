/**
 * Room templates.
 *
 * A template turns a validated room configuration into furniture and
 * workstations. Adding a room to the building only requires a configuration
 * entry plus (if it is a genuinely new kind of space) one template function.
 *
 * All coordinates emitted here are floor-local metres.
 */
import type {
  FurnitureKind,
  FurniturePlacement,
  RoomConfig,
  RoomTemplateId,
  Workstation,
} from './types';
import { seatAnchor } from './space';

export interface GeneratedRoom {
  readonly furniture: readonly FurniturePlacement[];
  readonly workstations: readonly Workstation[];
  readonly capacity: number;
}

class RoomBuilder {
  readonly furniture: FurniturePlacement[] = [];
  readonly workstations: Workstation[] = [];
  readonly width: number;
  readonly depth: number;
  readonly cx: number;
  readonly cz: number;
  /** 1 when the room lies south of the corridor (door on its north wall). */
  readonly dir: 1 | -1;
  /** Desk rotation that makes the occupant face into the room. */
  readonly facing: number;
  private seq = 0;

  constructor(readonly room: RoomConfig) {
    this.width = room.rect.width;
    this.depth = room.rect.depth;
    this.cx = room.rect.x;
    this.cz = room.rect.z;
    this.dir = room.door.edge === 'north' ? 1 : -1;
    this.facing = this.dir === 1 ? Math.PI : 0;
  }

  item = (
    kind: FurnitureKind,
    dx: number,
    dz: number,
    rotationY = 0,
    scale?: number,
  ): FurniturePlacement => {
    this.seq += 1;
    const placement: FurniturePlacement = {
      id: `${this.room.id}-f${String(this.seq).padStart(2, '0')}`,
      kind,
      position: { x: this.cx + dx, z: this.cz + dz },
      rotationY,
      ...(scale === undefined ? {} : { scale }),
    };
    this.furniture.push(placement);
    return placement;
  };

  workstation = (dx: number, dz: number, rotationY = this.facing): Workstation => {
    const position = { x: this.cx + dx, z: this.cz + dz };
    const station: Workstation = {
      id: `${this.room.id}-ws${this.workstations.length + 1}`,
      roomId: this.room.id,
      position,
      rotationY,
      seat: seatAnchor(position, rotationY, 0.95),
    };
    this.workstations.push(station);
    return station;
  };

  /** Desk + monitor + the workstation an agent can be assigned to. */
  desk = (dx: number, dz: number, rotationY = this.facing, scale = 1): Workstation => {
    this.item('desk', dx, dz, rotationY, scale);
    const back = 0.3 * scale;
    this.item(
      'monitor',
      dx - Math.sin(rotationY) * back,
      dz - Math.cos(rotationY) * back,
      rotationY,
    );
    return this.workstation(dx, dz, rotationY);
  };
}

type TemplateFn = (b: RoomBuilder) => number;

/* ------------------------------------------------------------------ */
/* Template implementations                                            */
/* ------------------------------------------------------------------ */

const reception: TemplateFn = (b) => {
  const { width: w, depth: d } = b;
  const counterZ = -b.dir * (d / 2 - 1.9);
  b.item('counter', -w * 0.16, counterZ, 0, 1);
  b.item('rug', w * 0.26, b.dir * (d / 2 - 2.6), 0, Math.min(2.4, w / 7));
  b.item('sofa', w * 0.32, b.dir * (d / 2 - 1.3), Math.PI / 2);
  b.item('coffee-table', w * 0.28, b.dir * (d / 2 - 2.7));
  b.item('plant', -w / 2 + 0.9, -d / 2 + 0.9);
  b.item('plant', w / 2 - 0.9, -d / 2 + 0.9);
  b.item('turnstile', w * 0.12, -b.dir * (d / 2 - 0.75));
  b.item('turnstile', w * 0.18, -b.dir * (d / 2 - 0.75));
  b.workstation(-w * 0.16, counterZ + b.dir * 0.9, b.facing);
  return 10;
};

const operationsCenter: TemplateFn = (b) => {
  const { width: w, depth: d } = b;
  // Operators face the video wall on the window wall, not the door.
  b.item('video-wall', 0, b.dir * (d / 2 - 0.35), 0, Math.min(1.6, (w - 4) / 4.2));
  const faceWall = b.facing;
  const columns = w >= 16 ? [-w * 0.3, 0, w * 0.3] : [-w * 0.26, w * 0.26];
  const rows = [b.dir * (d / 2 - 2.4), b.dir * (d / 2 - 4.3)].filter(
    (z) => Math.abs(z) < d / 2 - 1.3,
  );
  for (const rowZ of rows) {
    for (const columnX of columns) {
      b.desk(columnX, rowZ, faceWall);
    }
  }
  b.item('credenza', w / 2 - 1.1, b.dir * (d / 2 - 1.2), Math.PI / 2);
  b.item('plant', -w / 2 + 0.8, -d / 2 + 0.8);
  b.item('plant', -w / 2 + 0.8, d / 2 - 0.8);
  return 10;
};

const openWorkspace: TemplateFn = (b) => {
  const { width: w, depth: d } = b;
  const columns = w >= 13.5 ? [-w * 0.28, 0, w * 0.28] : [-w * 0.24, w * 0.24];
  const rows = [-d * 0.2, d * 0.18];
  let count = 0;
  for (const rowZ of rows) {
    for (const columnX of columns) {
      // Keep the door axis free.
      if (Math.abs(columnX) < 1.2 && Math.abs(rowZ) > d * 0.1) continue;
      b.desk(columnX, rowZ);
      count += 1;
    }
  }
  b.item('shelf', w / 2 - 0.32, b.dir * 0.35, Math.PI / 2, 1);
  b.item('plant', w / 2 - 0.8, -b.dir * (d / 2 - 0.8));
  b.item('plant', -w / 2 + 0.8, b.dir * (d / 2 - 0.8));
  return count + 8;
};

const privateOffice: TemplateFn = (b) => {
  const { width: w, depth: d } = b;
  b.item('rug', 0, 0, 0, 0.9);
  b.desk(0, -b.dir * 0.25, b.facing, 1.1);
  b.item('shelf', w / 2 - 0.5, b.dir * (d / 2 - 1.6), Math.PI / 2);
  b.item('plant', -w / 2 + 0.75, -b.dir * (d / 2 - 0.75));
  b.item('credenza', -w / 2 + 0.95, b.dir * (d / 2 - 0.45), 0);
  return 4;
};

const executiveOffice: TemplateFn = (b) => {
  const { width: w, depth: d } = b;
  b.item('rug', -w * 0.06, 0, 0, 1.15);
  b.desk(-w * 0.08, -b.dir * 0.4, b.facing, 1.3);
  b.item('sofa', w * 0.3, b.dir * (d / 2 - 1.1), Math.PI / 2);
  b.item('coffee-table', w * 0.3, b.dir * (d / 2 - 2.3));
  b.item('credenza', -w / 2 + 1.2, -b.dir * (d / 2 - 0.45), 0);
  b.item('shelf', -w / 2 + 0.55, 0, Math.PI / 2);
  b.item('plant', w / 2 - 0.8, -b.dir * (d / 2 - 0.8));
  return 6;
};

const meetingRoom: TemplateFn = (b) => {
  const { width: w, depth: d } = b;
  const scale = Math.min(1.2, w / 6.2);
  b.item('meeting-table', 0, 0, 0, scale);
  b.item('rug', 0, 0, 0, Math.min(1.6, w / 5.4));
  const seatX = 1.25 * scale;
  const seatZ = 1.0 * scale;
  for (const x of [-seatX, 0, seatX]) {
    b.item('chair', x, -seatZ, 0);
    b.item('chair', x, seatZ, Math.PI);
  }
  b.item('whiteboard', 0, b.dir * (d / 2 - 0.18), 0, Math.min(1.2, w / 5.4));
  b.item('credenza', -w / 2 + 0.95, b.dir * (d / 2 - 0.45), 0);
  b.item('plant', w / 2 - 0.7, -b.dir * (d / 2 - 0.7));
  return 8;
};

const creativeStudio: TemplateFn = (b) => {
  const { width: w, depth: d } = b;
  b.item('whiteboard', 0, b.dir * (d / 2 - 0.16), 0, Math.min(1.5, w / 5.2));
  b.desk(-w * 0.24, -b.dir * 0.6, b.facing, 1.15);
  b.desk(w * 0.18, -b.dir * 0.6, b.facing, 1.15);
  b.desk(-w * 0.04, b.dir * 1.35, b.facing + Math.PI, 1.15);
  b.item('stool', w * 0.34, b.dir * 1.9);
  b.item('plant', -w / 2 + 0.75, b.dir * (d / 2 - 0.75));
  b.item('shelf', w / 2 - 0.5, b.dir * 0.2, Math.PI / 2);
  return 8;
};

const lab: TemplateFn = (b) => {
  const { width: w, depth: d } = b;
  b.item('bench', -w * 0.22, b.dir * (d / 2 - 0.9), 0, Math.min(1.3, w / 6.5));
  b.desk(-w * 0.18, b.dir * 0.5, b.facing, 1.2);
  b.desk(w * 0.2, b.dir * 0.5, b.facing, 1.2);
  b.item('server-rack', w / 2 - 0.85, -b.dir * (d / 2 - 1.0), 0);
  b.item('server-rack', w / 2 - 0.85, -b.dir * (d / 2 - 2.1), 0);
  b.item('whiteboard', 0, b.dir * (d / 2 - 0.14), 0, Math.min(1.1, w / 6));
  b.item('plant', -w / 2 + 0.7, b.dir * (d / 2 - 0.7));
  return 6;
};

const lounge: TemplateFn = (b) => {
  const { width: w, depth: d } = b;
  b.item('rug', 0, b.dir * 0.4, 0, 1.5);
  b.item('sofa', -w * 0.18, -b.dir * 0.9, 0);
  b.item('sofa', w * 0.2, b.dir * 1.0, Math.PI);
  b.item('coffee-table', w * 0.02, b.dir * 0.1);
  b.item('counter', w / 2 - 1.4, -b.dir * (d / 2 - 0.8), 0, 0.9);
  b.item('plant', -w / 2 + 0.75, -b.dir * (d / 2 - 0.75));
  b.item('plant', w / 2 - 0.75, b.dir * (d / 2 - 0.75));
  b.item('stool', w / 2 - 2.4, -b.dir * (d / 2 - 1.8));
  return 8;
};

const core: TemplateFn = (b) => {
  const { width: w, depth: d } = b;
  // Lift lobby towards the corridor: two lift doors on the west shaft wall,
  // a two-flight stair on the east side, waiting plants by the window.
  b.item('elevator-door', -w / 2 + 0.09, -1.3, Math.PI / 2);
  b.item('elevator-door', -w / 2 + 0.09, 1.3, Math.PI / 2);
  b.item('stair', w * 0.12, 0.2, 0, 1);
  b.item('plant', w / 2 - 0.65, b.dir * (d / 2 - 0.65));
  b.item('plant', -w / 2 + 0.65, b.dir * (d / 2 - 0.65));
  return 4;
};

const security: TemplateFn = (b) => {
  const { width: w, depth: d } = b;
  b.item('counter', 0, b.dir * (d / 2 - 2.0), Math.PI);
  b.item('video-wall', w / 2 - 0.16, b.dir * 0.2, Math.PI / 2, Math.min(1.1, w / 6));
  b.desk(-w * 0.24, 0, b.facing);
  b.desk(w * 0.24, 0, b.facing);
  b.item('plant', w / 2 - 0.7, b.dir * (d / 2 - 0.7));
  b.item('shelf', -w / 2 + 0.5, -b.dir * (d / 2 - 2.2), Math.PI / 2);
  return 6;
};

const templates: Record<RoomTemplateId, TemplateFn> = {
  reception,
  'operations-center': operationsCenter,
  'open-workspace': openWorkspace,
  'private-office': privateOffice,
  'executive-office': executiveOffice,
  'meeting-room': meetingRoom,
  'creative-studio': creativeStudio,
  lab,
  lounge,
  core,
  security,
};

export function generateRoomContents(room: RoomConfig): GeneratedRoom {
  const builder = new RoomBuilder(room);
  const capacity = templates[room.template](builder);
  return {
    furniture: builder.furniture,
    workstations: builder.workstations,
    capacity: room.capacity ?? capacity,
  };
}

export const templateLabels: Record<RoomTemplateId, string> = {
  reception: 'Reception',
  'operations-center': 'Operations centre',
  'open-workspace': 'Open workspace',
  'private-office': 'Private office',
  'executive-office': 'Executive office',
  'meeting-room': 'Meeting room',
  'creative-studio': 'Creative studio',
  lab: 'Laboratory',
  lounge: 'Lounge',
  core: 'Vertical core',
  security: 'Security',
};
