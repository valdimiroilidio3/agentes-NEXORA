'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { useOfficeStore } from '@/store/officeStore';
import { TopBar } from './TopBar';
import { LeftPanel } from './LeftPanel';
import { Inspector } from './Inspector';
import { StatusBar } from './StatusBar';
import { Toast } from './Toast';
import { OverviewDrawer, SceneLegend, ViewToolbar } from './ViewportChrome';
import { Button } from './primitives';

const OfficeScene = dynamic(() => import('@/scene/OfficeScene'), {
  ssr: false,
  loading: () => (
    <div className="scene-placeholder">
      <p>Preparing the 3D viewport…</p>
      <span>Geometry is generated from the building configuration.</span>
    </div>
  ),
});

function LoadingPanel() {
  return (
    <div className="scene-placeholder" role="status">
      <div className="skeleton skeleton--title" />
      <div className="skeleton skeleton--line" />
      <div className="skeleton skeleton--line short" />
      <p>Loading the building configuration and operational fixtures…</p>
    </div>
  );
}

function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="scene-placeholder scene-placeholder--error" role="alert">
      <h2>The building could not be loaded</h2>
      <pre>{message}</pre>
      <p>
        This is a data integrity failure, not a rendering problem. Fix the fixture or the configuration and reload.
      </p>
      <Button variant="primary" onClick={() => window.location.reload()}>
        Reload application
      </Button>
    </div>
  );
}

function Shortcuts({ onClose }: { onClose: () => void }) {
  const rows: Array<[string, string]> = [
    ['0', 'Whole building overview'],
    ['E', 'Exterior view'],
    ['1 – 5', 'Isolate a floor'],
    ['C', 'Toggle cutaway'],
    ['R', 'Reset view and selection'],
    ['⌘K / Ctrl K', 'Search rooms, agents and tasks'],
    ['/', 'Focus the search field'],
    ['Esc', 'Clear selection / close dialogs'],
  ];
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={(event) => event.stopPropagation()}>
        <header className="modal__head">
          <h2>Keyboard shortcuts</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <dl className="shortcut-list">
          {rows.map(([key, description]) => (
            <div key={key}>
              <dt>
                <kbd>{key}</kbd>
              </dt>
              <dd>{description}</dd>
            </div>
          ))}
        </dl>
        <p className="hint">
          Every action is also available through the visible controls, so keyboard and pointer users can navigate the
          whole building without the 3D canvas.
        </p>
      </div>
    </div>
  );
}

export function AppShell() {
  const status = useOfficeStore((state) => state.status);
  const loadError = useOfficeStore((state) => state.loadError);
  const building = useOfficeStore((state) => state.building);
  const initialize = useOfficeStore((state) => state.initialize);
  const [showShortcuts, setShowShortcuts] = useState(false);

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.matches('input, textarea, select') || target.isContentEditable)) return;
      const state = useOfficeStore.getState();
      switch (event.key) {
        case 'Escape':
          state.clearSelection();
          state.dismissToast();
          setShowShortcuts(false);
          break;
        case '0':
          state.showBuilding();
          break;
        case 'e':
        case 'E':
          state.showExterior();
          break;
        case 'r':
        case 'R':
          state.resetView();
          break;
        case 'c':
        case 'C':
          state.setCutaway(!state.cutaway);
          break;
        case '/':
          event.preventDefault();
          document.querySelector<HTMLInputElement>('.search__input')?.focus();
          break;
        case '?':
          setShowShortcuts((current) => !current);
          break;
        case '1':
        case '2':
        case '3':
        case '4':
        case '5': {
          const index = Number(event.key) - 1;
          const floor = state.building?.floors[index];
          if (floor) state.selectFloor(floor.id);
          break;
        }
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="app-shell">
      <TopBar />
      <div className="app-body">
        <LeftPanel />
        <main className="viewport" aria-label="3D building viewport">
          {status === 'error' && <ErrorPanel message={loadError ?? 'Unknown error'} />}
          {status !== 'error' && (status === 'ready' && building ? <OfficeScene /> : <LoadingPanel />)}
          <ViewToolbar />
          <SceneLegend />
          {status === 'ready' && <OverviewDrawer />}
          <Toast />
          <button
            type="button"
            className="shortcut-button"
            onClick={() => setShowShortcuts(true)}
            aria-label="Show keyboard shortcuts"
            title="Keyboard shortcuts (?)"
          >
            ?
          </button>
        </main>
        <Inspector />
      </div>
      <StatusBar />
      {showShortcuts && <Shortcuts onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}
