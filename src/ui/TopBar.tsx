'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useOfficeStore } from '@/store/officeStore';
import { roomById, searchEverything, type SearchResult } from '@/domain/selectors';
import { Button } from './primitives';

function SearchBox() {
  const building = useOfficeStore((state) => state.building);
  const agents = useOfficeStore((state) => state.ops.agents);
  const tasks = useOfficeStore((state) => state.ops.tasks);
  const query = useOfficeStore((state) => state.searchQuery);
  const setQuery = useOfficeStore((state) => state.setSearchQuery);
  const openResult = useOfficeStore((state) => state.openSearchResult);

  const [focused, setFocused] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const results = useMemo(
    () => (building ? searchEverything(building, agents, tasks, query) : []),
    [building, agents, tasks, query],
  );

  useEffect(() => {
    setCursor(0);
  }, [query]);

  const open = (result: SearchResult | undefined) => {
    if (!result) return;
    openResult(result);
    setFocused(false);
    inputRef.current?.blur();
  };

  return (
    <div className="search">
      <input
        ref={inputRef}
        className="search__input"
        type="search"
        placeholder="Search rooms, agents, tasks…  ⌘K"
        aria-label="Search rooms, agents and tasks"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => window.setTimeout(() => setFocused(false), 120)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setCursor((current) => Math.min(results.length - 1, current + 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setCursor((current) => Math.max(0, current - 1));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            open(results[cursor]);
          } else if (event.key === 'Escape') {
            setFocused(false);
            inputRef.current?.blur();
          }
        }}
      />
      {focused && query.trim().length > 0 && (
        <ul className="search__results" role="listbox" aria-label="Search results">
          {results.length === 0 && <li className="search__empty">No matches for “{query}”.</li>}
          {results.map((result, index) => (
            <li key={`${result.kind}-${result.id}`}>
              <button
                type="button"
                role="option"
                aria-selected={index === cursor}
                className={`search__result${index === cursor ? ' is-active' : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => open(result)}
                onMouseEnter={() => setCursor(index)}
              >
                <span className={`search__kind search__kind--${result.kind}`}>{result.kind}</span>
                <span className="search__label">{result.label}</span>
                <span className="search__detail">{result.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TopBar() {
  const building = useOfficeStore((state) => state.building);
  const viewMode = useOfficeStore((state) => state.viewMode);
  const selectedRoomId = useOfficeStore((state) => state.selectedRoomId);
  const selectedAgentId = useOfficeStore((state) => state.selectedAgentId);
  const isolateFloor = useOfficeStore((state) => state.isolateFloor);
  const showBuilding = useOfficeStore((state) => state.showBuilding);
  const showExterior = useOfficeStore((state) => state.showExterior);
  const resetView = useOfficeStore((state) => state.resetView);
  const isolatedFloorId = useOfficeStore((state) => state.isolatedFloorId);

  const room = building ? roomById(building, selectedRoomId) : null;
  const floor = building?.floors.find((candidate) => candidate.id === room?.floorId);
  const agent = useOfficeStore((state) => state.ops.agents.find((candidate) => candidate.id === selectedAgentId));

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand__mark" aria-hidden />
        <div>
          <p className="brand__name">NEXORA</p>
          <p className="brand__sub">OFFICE 3D</p>
        </div>
      </div>

      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <button type="button" onClick={showBuilding} className={viewMode === 'building' ? 'is-current' : ''}>
          Building
        </button>
        {floor && (
          <>
            <span className="breadcrumbs__sep">/</span>
            <button
              type="button"
              onClick={() => isolateFloor(floor.id)}
              className={viewMode === 'floor' && isolatedFloorId === floor.id ? 'is-current' : ''}
            >
              {floor.name}
            </button>
          </>
        )}
        {room && (
          <>
            <span className="breadcrumbs__sep">/</span>
            <button type="button" onClick={() => isolateFloor(room.floorId)} className="is-current">
              {room.name}
            </button>
          </>
        )}
        {agent && (
          <>
            <span className="breadcrumbs__sep">/</span>
            <span className="breadcrumbs__current">{agent.name}</span>
          </>
        )}
      </nav>

      <div className="topbar__tools">
        <SearchBox />
        <div className="view-switch" role="group" aria-label="Camera presets">
          <Button
            size="sm"
            variant={viewMode === 'exterior' ? 'primary' : 'ghost'}
            aria-pressed={viewMode === 'exterior'}
            onClick={showExterior}
          >
            Exterior
          </Button>
          <Button
            size="sm"
            variant={viewMode === 'building' ? 'primary' : 'ghost'}
            aria-pressed={viewMode === 'building'}
            onClick={showBuilding}
          >
            Overview
          </Button>
        </div>
        <Button size="sm" variant="ghost" onClick={resetView} title="Reset camera and selection (R)">
          Reset
        </Button>
      </div>
    </header>
  );
}
