import { useMemo, useState, useSyncExternalStore } from 'react';
import type { Circuit, CircuitPoint, Panel, Room } from '../types';

const NARROW_SCREEN = '(max-width: 700px)';

function subscribeToScreenSize(onChange: () => void) {
  const media = window.matchMedia(NARROW_SCREEN);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

function isNarrowScreen() {
  return window.matchMedia(NARROW_SCREEN).matches;
}

export type FloorplanFindTarget =
  | { type: 'room'; id: number }
  | { type: 'point'; id: number }
  | { type: 'panel'; id: number }
  | { type: 'circuit'; id: number };

type FindResult = {
  target: FloorplanFindTarget;
  kind: string;
  name: string;
  floor: string;
  context: string;
  searchText: string;
};

function resultKey(target: FloorplanFindTarget): string {
  return `${target.type}-${target.id}`;
}

export function FloorplanFinder({
  rooms,
  points,
  panels,
  circuits,
  loading,
  onSelect,
}: {
  rooms: Room[];
  points: CircuitPoint[];
  panels: Panel[];
  circuits: Circuit[];
  loading: boolean;
  onSelect: (target: FloorplanFindTarget) => void;
}) {
  const narrow = useSyncExternalStore(subscribeToScreenSize, isNarrowScreen, () => false);
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const [query, setQuery] = useState('');
  const open = expanded ?? !narrow;

  const results = useMemo(() => {
    const roomsById = new Map(rooms.map((room) => [room.id, room]));
    const panelsById = new Map(panels.map((panel) => [panel.id, panel]));
    const circuitsById = new Map(circuits.map((circuit) => [circuit.id, circuit]));
    const results: FindResult[] = [
      ...rooms.map((room): FindResult => ({
        target: { type: 'room', id: room.id },
        kind: 'Room',
        name: room.name,
        floor: room.floor,
        context: 'Room on floorplan',
        searchText: `${room.name} ${room.floor} room`,
      })),
      ...points.map((point): FindResult => {
        const room = roomsById.get(point.room_id);
        const circuit = circuitsById.get(point.circuit_id);
        const panel = circuit ? panelsById.get(circuit.panel_id) : undefined;
        const name = point.label?.trim() || point.kind;
        return {
          target: { type: 'point', id: point.id },
          kind: 'Mapped point',
          name,
          floor: room?.floor ?? 'Floor not found',
          context: [point.label && point.kind, room?.name, panel?.name, circuit && `Breaker ${circuit.breaker_label}`]
            .filter(Boolean)
            .join(' · '),
          searchText: [point.label, point.kind, room?.name, room?.floor, panel?.name,
            circuit?.breaker_label, circuit?.verified_description, 'point']
            .filter(Boolean)
            .join(' '),
        };
      }),
      ...panels.map((panel): FindResult => {
        const room = panel.room_id == null ? undefined : roomsById.get(panel.room_id);
        return {
          target: { type: 'panel', id: panel.id },
          kind: 'Panel',
          name: panel.name,
          floor: room?.floor ?? 'No floor recorded',
          context: room ? `Location: ${room.name}` : 'Location not recorded',
          searchText: `${panel.name} ${room?.name ?? ''} ${room?.floor ?? ''} panel`,
        };
      }),
      ...circuits.map((circuit): FindResult => {
        const panel = panelsById.get(circuit.panel_id);
        const mappedPoints = points.filter((point) => point.circuit_id === circuit.id);
        const mappedFloors = Array.from(new Set(mappedPoints
          .map((point) => roomsById.get(point.room_id)?.floor)
          .filter((floor): floor is string => Boolean(floor))))
          .sort((a, b) => a.localeCompare(b));
        return {
          target: { type: 'circuit', id: circuit.id },
          kind: 'Breaker',
          name: `Breaker ${circuit.breaker_label}`,
          floor: mappedFloors.length ? mappedFloors.join(', ') : 'Unmapped',
          context: [panel?.name, circuit.verified_description,
            mappedPoints.length ? `${mappedPoints.length} mapped point${mappedPoints.length === 1 ? '' : 's'}` : 'Unmapped']
            .filter(Boolean)
            .join(' · '),
          searchText: [circuit.breaker_label, `breaker ${circuit.breaker_label}`, panel?.name, circuit.verified_description,
            'breaker', mappedPoints.length ? mappedFloors.join(' ') : 'unmapped']
            .filter(Boolean)
            .join(' '),
        };
      }),
    ];
    const visibleCounts = new Map<string, number>();
    for (const result of results) {
      const visibleText = `${result.kind}|${result.name}|${result.floor}|${result.context}`;
      visibleCounts.set(visibleText, (visibleCounts.get(visibleText) ?? 0) + 1);
    }
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return normalizedQuery
      ? results
          .filter((result) => result.searchText.toLocaleLowerCase().includes(normalizedQuery))
          .map((result) => {
            const visibleText = `${result.kind}|${result.name}|${result.floor}|${result.context}`;
            return visibleCounts.get(visibleText) === 1
              ? result
              : { ...result, context: `${result.context} · Record #${result.target.id}` };
          })
      : [];
  }, [circuits, panels, points, query, rooms]);

  return (
    <section className="floorplan-finder" aria-label="Find floorplan items">
      <div className="floorplan-finder-heading">
        <h3>Find</h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="floorplan-find-content"
          onClick={() => setExpanded(!open)}
        >
          {open ? 'Close find' : 'Open find'}
        </button>
      </div>
      {open && (
        <div id="floorplan-find-content">
          <label htmlFor="floorplan-find-query">Room, point, panel, breaker, or verified description</label>
          <input
            id="floorplan-find-query"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
          />
          <p className="floorplan-find-status" aria-live="polite">
            {!query.trim()
              ? 'Type to search saved rooms, mapped points, panels, and breakers.'
              : loading
                ? 'Loading saved floorplan items…'
                : results.length === 0
                ? 'No matches. Try a room name, point label or kind, panel name, breaker label, or verified description.'
                : `${results.length} result${results.length === 1 ? '' : 's'}. Tab to a result and press Enter to focus it.`}
          </p>
          {results.length > 0 && (
            <ul className="floorplan-find-results">
              {results.map((result) => (
                <li
                  key={resultKey(result.target)}
                  data-find-type={result.target.type}
                  data-find-id={result.target.id}
                >
                  <button type="button" onClick={() => onSelect(result.target)}>
                    <span className="floorplan-find-kind">{result.kind}</span>
                    <strong>{result.name}</strong>
                    <span>{result.floor}</span>
                    {result.context && <span>{result.context}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
