// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import buildingFixture from '@/data/building.json';
import agentsFixture from '@/data/agents.json';
import tasksFixture from '@/data/tasks.json';
import { loadBuilding } from '@/domain/building';
import { parseAgents, parseTasks } from '@/domain/schema';
import { createOperationsState, moveAgent } from '@/domain/operations';
import { FloorLiveLayer, FloorShell } from '@/scene/FloorScene';
import { SceneBoxes, drawCallCount } from '@/scene/SceneBoxes';
import { buildFacadeFins, buildFloorFacade, buildSite } from '@/scene/facade';
import { visibleFloors, sceneLayers } from '@/scene/visibility';
import { SceneWorld } from '@/scene/OfficeScene';
import { CharacterAnimator, resetRigs, rigCount } from '@/scene/character/characterSystem';
import { AgentLayer } from '@/scene/character/officeAgents';
import type { OperationsState } from '@/domain/operations';
import type { Building, ViewMode } from '@/domain/types';

const { building } = loadBuilding(buildingFixture);
const agents = parseAgents(agentsFixture);
const tasks = parseTasks(tasksFixture);
const ops: OperationsState = createOperationsState(tasks, agents);

function countInstances(specs: Parameters<typeof drawCallCount>[0]) {
  const individual = specs.filter((spec, index) => {
    const key = `${spec.material}|${spec.size.join('x')}`;
    return specs.filter((other) => `${other.material}|${other.size.join('x')}` === key).length < 5;
  }).length;
  return {
    totalSpecs: specs.length,
    individualMeshes: individual,
    instancedGroups: drawCallCount(specs) - individual,
  };
}

/** jsdom has no canvas implementation; label textures are not part of this test. */
function stubCanvas() {
  const context = {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    set fillStyle(_value: string) {},
    set strokeStyle(_value: string) {},
    set lineWidth(_value: number) {},
    set font(_value: string) {},
    set textAlign(_value: string) {},
    set textBaseline(_value: string) {},
  };
  return {
    width: 512,
    height: 160,
    getContext: () => context,
  };
}

describe('floor scene rendering', () => {
  beforeAll(() => {
    (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = function getContext() {
      return stubCanvas().getContext();
    };
  });

  it('renders the architecture, furniture and agents of a floor', async () => {
    const floor = building.floors[3]!; // Technology
    const renderer = await ReactThreeTestRenderer.create(
      <group>
        <FloorShell building={building} floor={floor} showFacade={false} showInterior />
        <FloorLiveLayer
          building={building}
          floor={floor}
          ops={ops}
          viewMode="building"
          selectedRoomId={null}
          selectedAgentId={null}
          hoveredRoomId={null}
          onSelectRoom={() => {}}
          onHoverRoom={() => {}}
          onSelectAgent={() => {}}
        />
      </group>,
    );

    const meshes = renderer.scene.findAllByType('Mesh');
    // Architecture (walls, doors, slab, lights, furniture) + room hit plates +
    // detailed characters and their chairs.
    expect(meshes.length).toBeGreaterThan(120);
    await renderer.advanceFrames(3, 0.016);
    await renderer.unmount();
  });

  it('renders a highlighted room and the selected agent', async () => {
    const floor = building.floors[1]!;
    const room = floor.rooms.find((candidate) => candidate.template === 'creative-studio')!;
    const agent = agents.find((candidate) => candidate.roomId === room.id)!;
    const onSelectRoom = vi.fn();
    const onSelectAgent = vi.fn();

    const renderer = await ReactThreeTestRenderer.create(
      <group>
        <FloorLiveLayer
          building={building}
          floor={floor}
          ops={ops}
          viewMode="room"
          selectedRoomId={room.id}
          selectedAgentId={agent?.id ?? null}
          hoveredRoomId={null}
          onSelectRoom={onSelectRoom}
          onHoverRoom={() => {}}
          onSelectAgent={onSelectAgent}
        />
        <AgentLayer
          building={building}
          ops={ops}
          visibleFloorIds={new Set([floor.id])}
          detail="full"
          selectedAgentId={agent?.id ?? null}
          onSelectAgent={onSelectAgent}
        />
      </group>,
    );

    expect(renderer.scene.findAllByType('Mesh').length).toBeGreaterThan(30);
    // Room labels and the agent name tag are sprites in the focused view.
    expect(renderer.scene.findAllByType('Sprite').length).toBeGreaterThan(0);

    const interactive = renderer.scene.findAll((node) => typeof node.props.onClick === 'function');
    expect(interactive.length).toBeGreaterThan(0);
    await renderer.fireEvent(interactive[0]!, 'click', { delta: 0, stopPropagation: () => {} } as never);
    expect(onSelectRoom.mock.calls.length + onSelectAgent.mock.calls.length).toBeGreaterThan(0);
    await renderer.unmount();
  });

  it('renders the site and roof boxes', async () => {
    const renderer = await ReactThreeTestRenderer.create(
      <group>
        <SceneBoxes specs={buildSite(building)} />
      </group>,
    );
    expect(renderer.scene.findAllByType('Mesh').length).toBeGreaterThan(10);
    await renderer.unmount();
  });
});

describe('complete scene world', () => {
  const baseProps = {
    building,
    ops,
    viewMode: 'building' as const,
    isolatedFloorId: null,
    hiddenFloorIds: [],
    cutaway: false,
    selectedRoomId: null,
    selectedAgentId: null,
    hoveredRoomId: null,
    onSelectRoom: () => {},
    onHoverRoom: () => {},
    onSelectAgent: () => {},
  };

  it('renders all five floors and the envelope in the overview', async () => {
    const renderer = await ReactThreeTestRenderer.create(<SceneWorld {...baseProps} />);
    const meshes = renderer.scene.findAllByType('Mesh');
    // Shell-only LOD: the façades are closed, so interior detail is omitted.
    expect(meshes.length).toBeGreaterThan(250);
    expect(meshes.length).toBeLessThan(700);
    expect(renderer.scene.findAllByType('PointLight')).toHaveLength(0);
    await renderer.unmount();
  });

  it('reveals interiors and their lighting in cutaway mode', async () => {
    const overview = await ReactThreeTestRenderer.create(<SceneWorld {...baseProps} />);
    const overviewMeshes = overview.scene.findAllByType('Mesh').length;
    await overview.unmount();

    const cutaway = await ReactThreeTestRenderer.create(<SceneWorld {...baseProps} cutaway />);
    const cutawayMeshes = cutaway.scene.findAllByType('Mesh').length;
    expect(cutawayMeshes).toBeGreaterThan(overviewMeshes * 2);
    expect(cutaway.scene.findAllByType('PointLight').length).toBeGreaterThanOrEqual(10);
    await cutaway.unmount();
  });

  it('uses instancing for repeated façade elements', async () => {
    const counts = countInstances(
      [...buildFacadeFins(building), ...buildFloorFacade(building, building.floors[0]!)],
    );
    expect(counts.instancedGroups).toBeGreaterThan(0);
    expect(counts.individualMeshes).toBeLessThan(counts.totalSpecs);
  });

  it('renders far less geometry when a single floor is isolated', async () => {
    const full = await ReactThreeTestRenderer.create(<SceneWorld {...baseProps} cutaway />);
    const fullMeshes = full.scene.findAllByType('Mesh').length;
    await full.unmount();

    const isolated = await ReactThreeTestRenderer.create(
      <SceneWorld {...baseProps} viewMode="floor" isolatedFloorId="floor-2" />,
    );
    const isolatedMeshes = isolated.scene.findAllByType('Mesh').length;
    expect(isolatedMeshes).toBeGreaterThan(150);
    expect(isolatedMeshes).toBeLessThan(fullMeshes / 3);
    expect(isolated.scene.findAllByType('PointLight').length).toBe(3);
    await isolated.unmount();
  });

  it('drops the roof and façade fins in cutaway mode', async () => {
    const exterior = await ReactThreeTestRenderer.create(<SceneWorld {...baseProps} viewMode="exterior" />);
    const exteriorMeshes = exterior.scene.findAllByType('Mesh').length;
    await exterior.unmount();
    const cut = await ReactThreeTestRenderer.create(<SceneWorld {...baseProps} cutaway />);
    const cutMeshes = cut.scene.findAllByType('Mesh').length;
    expect(cutMeshes).toBeGreaterThan(exteriorMeshes);
    await cut.unmount();
  });

  it('navigates from a click on a room plate', async () => {
    const onSelectRoom = vi.fn();
    const renderer = await ReactThreeTestRenderer.create(
      <SceneWorld {...baseProps} viewMode="floor" isolatedFloorId="floor-3" onSelectRoom={onSelectRoom} />,
    );
    const interactive = renderer.scene.findAll(
      (node) => node.type === 'Mesh' && typeof node.props.onClick === 'function',
    );
    expect(interactive.length).toBeGreaterThan(0);
    await renderer.fireEvent(interactive[0]!, 'click', { delta: 0, stopPropagation: () => {} } as never);
    expect(onSelectRoom).toHaveBeenCalledTimes(1);
    await renderer.unmount();
  });

  it('re-renders with updated operational state without error', async () => {
    const renderer = await ReactThreeTestRenderer.create(<SceneWorld {...baseProps} />);
    const working = ops.agents.find((agent) => agent.status === 'WORKING')!;
    const nextOps: OperationsState = {
      ...ops,
      agents: ops.agents.map((agent) => (agent.id === working.id ? { ...agent, status: 'ERROR' } : agent)),
    };
    await renderer.update(<SceneWorld {...baseProps} ops={nextOps} />);
    await renderer.advanceFrames(5, 0.016);
    expect(renderer.scene.findAllByType('Mesh').length).toBeGreaterThan(400);
    await renderer.unmount();
  });
});

describe('visibility rules', () => {
  interface VisState {
    viewMode: ViewMode;
    isolatedFloorId: string | null;
    hiddenFloorIds: readonly string[];
    cutaway: boolean;
  }
  const state: VisState = { viewMode: 'building', isolatedFloorId: null, hiddenFloorIds: [], cutaway: false };

  function mutate(overrides: Partial<VisState>): VisState {
    return { ...state, ...overrides };
  }

  it('shows every floor by default', () => {
    expect(visibleFloors(building as Building, state)).toHaveLength(5);
  });

  it('isolates a single floor', () => {
    const floors = visibleFloors(building as Building, mutate({ isolatedFloorId: 'floor-2' }));
    expect(floors.map((floor) => floor.id)).toEqual(['floor-2']);
  });

  it('hides floors individually', () => {
    const floors = visibleFloors(building as Building, mutate({ hiddenFloorIds: ['floor-0', 'floor-4'] }));
    expect(floors.map((floor) => floor.id)).toEqual(['floor-1', 'floor-2', 'floor-3']);
  });

  it('lets isolation override hidden floors', () => {
    const floors = visibleFloors(
      building as Building,
      mutate({ isolatedFloorId: 'floor-0', hiddenFloorIds: ['floor-0'] }),
    );
    expect(floors).toHaveLength(1);
  });

  it('drops the façade and roof in interior views', () => {
    expect(sceneLayers(mutate({ viewMode: 'exterior' }))).toMatchObject({
      showFacade: true,
      showRoof: true,
      showFins: true,
    });
    expect(sceneLayers(mutate({ viewMode: 'building', cutaway: true }))).toMatchObject({
      showFacade: true,
      showRoof: false,
      showFins: false,
    });
    expect(sceneLayers(mutate({ viewMode: 'floor' }))).toMatchObject({
      showFacade: false,
      showRoof: false,
      showFins: false,
    });
    expect(sceneLayers(mutate({ viewMode: 'room' }))).toMatchObject({ showFacade: false });
    expect(sceneLayers(mutate({ viewMode: 'building', cutaway: true })).hiddenFacadeSide).toBe('north');
    expect(sceneLayers(mutate({ viewMode: 'floor' })).hiddenFacadeSide).toBeNull();
  });
});

describe('character rendering', () => {
  beforeAll(() => {
    (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = function getContext() {
      return stubCanvas().getContext();
    };
  });

  const techFloor = building.floors[3]!;
  const occupants = ops.agents.filter((agent) => techFloor.rooms.some((room) => room.id === agent.roomId));

  function seatOf(agentId: string) {
    const agent = ops.agents.find((candidate) => candidate.id === agentId)!;
    const room = techFloor.rooms.find((candidate) => candidate.id === agent.roomId)!;
    return room.workstations.find((station) => station.id === agent.workstationId)!.seat;
  }

  const techFloorIds = new Set([techFloor.id]);
  const layer = (detail: 'full' | 'compact') => (
    <group>
      <CharacterAnimator />
      <AgentLayer
        building={building}
        ops={ops}
        visibleFloorIds={techFloorIds}
        detail={detail}
        selectedAgentId={null}
        onSelectAgent={() => {}}
      />
    </group>
  );

  it('draws a detailed rig and a task chair, with a cheaper tier for the overview', async () => {
    const compact = await ReactThreeTestRenderer.create(layer('compact'));
    const compactMeshes = compact.scene.findAllByType('Mesh').length;
    await compact.unmount();

    const full = await ReactThreeTestRenderer.create(layer('full'));
    const fullMeshes = full.scene.findAllByType('Mesh').length;
    await full.unmount();

    expect(occupants.length).toBeGreaterThan(2);
    // The full rig is a real human: head, hands, feet, hair, glasses, lapels.
    expect(fullMeshes - compactMeshes).toBeGreaterThan(occupants.length * 25);
  });

  it('registers one animation rig per visible colleague and releases it', async () => {
    resetRigs();
    const renderer = await ReactThreeTestRenderer.create(layer('full'));
    const visible = occupants.filter((agent) => agent.status !== 'OFFLINE').length;
    expect(visible).toBeGreaterThan(1);
    expect(rigCount()).toBe(visible);
    await renderer.advanceFrames(2, 0.016);
    await renderer.unmount();
    expect(rigCount()).toBe(0);
  });

  it('walks a waiting colleague away from the chair while workers stay seated', async () => {
    const waiting = occupants.find((agent) => agent.status === 'WAITING');
    const working = occupants.find((agent) => agent.status === 'WORKING');
    expect(waiting).toBeDefined();
    expect(working).toBeDefined();

    const renderer = await ReactThreeTestRenderer.create(layer('full'));

    const byName = (id: string) =>
      renderer.scene.findAll((node) => node.instance?.name === `character-${id}`)[0];
    const waitingNode = byName(waiting!.id);
    const workingNode = byName(working!.id);
    expect(waitingNode).toBeDefined();
    expect(workingNode).toBeDefined();

    await renderer.advanceFrames(150, 0.05);

    const waitingSeat = seatOf(waiting!.id);
    const waitingPos = waitingNode!.instance.position;
    const moved = Math.hypot(waitingPos.x - waitingSeat.x, waitingPos.z - waitingSeat.z);
    // Roughly the 0.8 m step beside the desk, walked over several seconds.
    expect(moved).toBeGreaterThan(0.45);
    expect(moved).toBeLessThan(1.1);

    const workingSeat = seatOf(working!.id);
    const workingPos = workingNode!.instance.position;
    expect(Math.hypot(workingPos.x - workingSeat.x, workingPos.z - workingSeat.z)).toBeLessThan(0.01);

    await renderer.unmount();
  });

  it('walks a colleague to another desk instead of teleporting there', async () => {
    // An idle colleague with a free second workstation in the same room.
    let moved: OperationsState | null = null;
    let from: { x: number; z: number } | null = null;
    let to: { x: number; z: number } | null = null;
    let agentId = '';
    for (const room of techFloor.rooms) {
      {
        if (room.workstations.length < 2) continue;
        const occupant = ops.agents.find(
          (agent) =>
            agent.roomId === room.id &&
            agent.status === 'IDLE' &&
            agent.currentTaskId === null &&
            room.workstations.some((station) => station.id === agent.workstationId),
        );
        if (!occupant) continue;
        const free = room.workstations.find(
          (station) =>
            station.id !== occupant.workstationId &&
            !ops.agents.some((agent) => agent.workstationId === station.id),
        );
        if (!free) continue;
        const current = room.workstations.find((station) => station.id === occupant.workstationId)!;
        from = current.seat;
        to = free.seat;
        agentId = occupant.id;
        moved = {
          ...ops,
          agents: ops.agents.map((agent) =>
            agent.id === occupant.id
              ? { ...agent, workstationId: free.id, roomId: room.id }
              : agent,
          ),
        };
        if (moved) break;
      }
    }
    expect(moved, 'a relocatable idle colleague exists').not.toBeNull();

    resetRigs();
    const renderer = await ReactThreeTestRenderer.create(layer('full'));
    const node = () =>
      renderer.scene.findAll((candidate) => candidate.instance?.name === `character-${agentId}`)[0];
    await renderer.advanceFrames(6, 0.05);
    const start = node()!.instance.position.clone();
    expect(Math.hypot(start.x - from!.x, start.z - from!.z)).toBeLessThan(0.25);

    await renderer.update(
      <group>
        <CharacterAnimator />
        <AgentLayer
          building={building}
          ops={moved!}
          visibleFloorIds={techFloorIds}
          detail="full"
          selectedAgentId={null}
          onSelectAgent={() => {}}
        />
      </group>,
    );

    const samples: Array<{ x: number; z: number }> = [];
    for (let frame = 0; frame < 420; frame += 1) {
      await renderer.advanceFrames(1, 0.05);
      const position = node();
      if (!position) break;
      samples.push({ x: position.instance.position.x, z: position.instance.position.z });
    }

    const end = samples[samples.length - 1]!;
    expect(Math.hypot(end.x - to!.x, end.z - to!.z)).toBeLessThan(0.4);
    // Every frame moved a plausible walking step: no sliding, no teleport.
    let longest = 0;
    for (let index = 1; index < samples.length; index += 1) {
      const a = samples[index - 1]!;
      const b = samples[index]!;
      longest = Math.max(longest, Math.hypot(b.x - a.x, b.z - a.z));
    }
    expect(longest).toBeLessThan(0.12);
    // And it genuinely travelled through the room in between.
    const travelled = samples.reduce((sum, point, index) => {
      if (index === 0) return 0;
      const previous = samples[index - 1]!;
      return sum + Math.hypot(point.x - previous.x, point.z - previous.z);
    }, 0);
    expect(travelled).toBeGreaterThan(Math.hypot(to!.x - from!.x, to!.z - from!.z) * 0.9);

    await renderer.unmount();
  });

  it('walks to the new desk when relocated, instead of teleporting', async () => {
    resetRigs();
    const floor = building.floors[1]!;
    const agent = ops.agents.find(
      (candidate) =>
        candidate.roomId.startsWith('f1-') &&
        candidate.status === 'IDLE' &&
        candidate.currentTaskId === null,
    );
    expect(agent, 'an idle colleague on floor 1').toBeDefined();
    const fromRoom = floor.rooms.find((room) => room.id === agent!.roomId)!;
    const toRoom = floor.rooms.find(
      (room) =>
        room.id !== fromRoom.id &&
        room.workstations.some(
          (station) => !ops.agents.some((candidate) => candidate.workstationId === station.id),
        ),
    );
    expect(toRoom, 'another room with a free desk on the same floor').toBeDefined();
    const target = toRoom!.workstations.find(
      (station) => !ops.agents.some((candidate) => candidate.workstationId === station.id),
    );
    expect(target).toBeDefined();
    const rooms = new Map(
      building.floors.flatMap((item) => item.rooms.map((room) => [room.id, room] as const)),
    );
    const moved = moveAgent(ops, {
      agentId: agent!.id,
      roomId: toRoom!.id,
      workstationId: target!.id,
      at: new Date().toISOString(),
      rooms,
    });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;

    const floorIds = new Set([floor.id]);
    const view = (state: OperationsState) => (
      <group>
        <CharacterAnimator />
        <AgentLayer
          building={building}
          ops={state}
          visibleFloorIds={floorIds}
          detail="full"
          selectedAgentId={null}
          onSelectAgent={() => {}}
        />
      </group>
    );

    const renderer = await ReactThreeTestRenderer.create(view(ops));
    const node = () =>
      renderer.scene.findAll((candidate) => candidate.instance?.name === `character-${agent!.id}`)[0];
    await renderer.advanceFrames(5, 0.05);
    const start = node()!.instance.position.clone();
    const oldSeat = fromRoom!.workstations.find((station) => station.id === agent!.workstationId)!.seat;
    expect(Math.hypot(start.x - oldSeat.x, start.z - oldSeat.z)).toBeLessThan(0.3);
    const startFloorY = start.y;

    await renderer.update(view(moved.state));
    // Mid-way: the colleague is in the corridor, on its way, still at floor level.
    await renderer.advanceFrames(120, 0.05);
    const middle = node()!.instance.position.clone();
    expect(Math.hypot(middle.x - oldSeat.x, middle.z - oldSeat.z)).toBeGreaterThan(1.5);
    expect(Math.hypot(middle.x - target!.seat.x, middle.z - target!.seat.z)).toBeGreaterThan(0.5);
    expect(middle.y).toBeCloseTo(startFloorY, 3);

    // End: on the new chair, and the walker has reported arrival.
    await renderer.advanceFrames(600, 0.05);
    const end = node()!.instance.position.clone();
    expect(Math.hypot(end.x - target!.seat.x, end.z - target!.seat.z)).toBeLessThan(0.2);
    expect(end.y).toBeCloseTo(startFloorY, 3);
    await renderer.unmount();
  });

  it('takes the lift when relocated to another floor', async () => {
    resetRigs();
    const fromFloor = building.floors[1]!;
    const toFloor = building.floors[3]!;
    const agent = ops.agents.find(
      (candidate) =>
        candidate.roomId.startsWith('f1-') &&
        candidate.currentTaskId === null &&
        candidate.status === 'IDLE',
    );
    expect(agent).toBeDefined();
    const target = toFloor.rooms
      .flatMap((room) => room.workstations)
      .find((station) => !ops.agents.some((candidate) => candidate.workstationId === station.id));
    expect(target, 'a free workstation on the top floor').toBeDefined();
    const rooms = new Map(
      building.floors.flatMap((item) => item.rooms.map((room) => [room.id, room] as const)),
    );
    const targetRoomId = toFloor.rooms.find((room) =>
      room.workstations.some((station) => station.id === target!.id),
    )!.id;
    const moved = moveAgent(ops, {
      agentId: agent!.id,
      roomId: targetRoomId,
      workstationId: target!.id,
      at: new Date().toISOString(),
      rooms,
    });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;

    const floorIds = new Set([fromFloor.id, toFloor.id]);
    const view = (state: OperationsState) => (
      <group>
        <CharacterAnimator />
        <AgentLayer
          building={building}
          ops={state}
          visibleFloorIds={floorIds}
          detail="compact"
          selectedAgentId={null}
          onSelectAgent={() => {}}
        />
      </group>
    );
    const renderer = await ReactThreeTestRenderer.create(view(ops));
    const node = () =>
      renderer.scene.findAll((candidate) => candidate.instance?.name === `character-${agent!.id}`)[0];
    await renderer.advanceFrames(4, 0.05);
    await renderer.update(view(moved.state));
    // 45 simulated seconds: walk to the core, wait, ride, walk to the new desk.
    await renderer.advanceFrames(900, 0.05);
    const end = node()!.instance.position.clone();
    expect(Math.hypot(end.x - target!.seat.x, end.z - target!.seat.z)).toBeLessThan(0.25);
    expect(end.y).toBeGreaterThan(4);
    await renderer.unmount();
  });

  it('keeps the seated hips on the chair, not floating above it', async () => {
    const renderer = await ReactThreeTestRenderer.create(layer('full'));
    const working = occupants.find((agent) => agent.status === 'WORKING')!;
    const node = renderer.scene.findAll(
      (candidate) => candidate.instance?.name === `character-${working.id}`,
    )[0];
    await renderer.advanceFrames(90, 0.05);
    const root = node!.instance;
    const hips = root.children[0]!;
    expect(hips.position.y).toBeGreaterThan(0.42);
    expect(hips.position.y).toBeLessThan(0.58);
    await renderer.unmount();
  });
});
