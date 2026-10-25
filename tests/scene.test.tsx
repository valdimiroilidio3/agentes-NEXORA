// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import buildingFixture from '@/data/building.json';
import agentsFixture from '@/data/agents.json';
import tasksFixture from '@/data/tasks.json';
import { loadBuilding } from '@/domain/building';
import { parseAgents, parseTasks } from '@/domain/schema';
import { createOperationsState } from '@/domain/operations';
import { FloorLiveLayer, FloorShell } from '@/scene/FloorScene';
import { SceneBoxes, drawCallCount } from '@/scene/SceneBoxes';
import { buildFacadeFins, buildFloorFacade, buildSite } from '@/scene/facade';
import { visibleFloors, sceneLayers } from '@/scene/visibility';
import { SceneWorld } from '@/scene/OfficeScene';
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
    // Architecture (walls, doors, slab, lights, furniture) + room hit plates + avatars.
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
