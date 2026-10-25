/**
 * Which parts of the building are on screen.
 *
 * Isolating a floor overrides per-floor visibility toggles, and the façade
 * drops away in floor/room views so interiors stay readable. Kept pure so the
 * navigation rules can be tested without a renderer.
 */
import type { Building, Floor, ViewMode } from '@/domain/types';

export interface VisibilityState {
  readonly viewMode: ViewMode;
  readonly isolatedFloorId: string | null;
  readonly hiddenFloorIds: readonly string[];
  readonly cutaway: boolean;
}

export interface SceneLayers {
  readonly showFacade: boolean;
  readonly showRoof: boolean;
  readonly showFins: boolean;
  readonly showNorthFacade: boolean;
  readonly showSite: boolean;
  /** In cutaway the camera-facing façade is removed to reveal interiors. */
  readonly hiddenFacadeSide: 'north' | 'south' | null;
}

export function visibleFloors(building: Building, state: VisibilityState): Floor[] {
  if (state.isolatedFloorId) {
    return building.floors.filter((floor) => floor.id === state.isolatedFloorId);
  }
  return building.floors.filter((floor) => !state.hiddenFloorIds.includes(floor.id));
}

export function sceneLayers(state: VisibilityState): SceneLayers {
  const exterior = state.viewMode === 'exterior';
  const buildingView = state.viewMode === 'building';
  const showFacade = exterior || buildingView;
  return {
    showFacade,
    showRoof: exterior || (buildingView && !state.cutaway),
    showFins: showFacade && !state.cutaway,
    showNorthFacade: showFacade && !state.cutaway,
    showSite: true,
    hiddenFacadeSide: showFacade && state.cutaway ? 'north' : null,
  };
}
