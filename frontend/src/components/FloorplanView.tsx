import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { FloorplanFinder, type FloorplanFindTarget } from './FloorplanFinder';
import {
  axisAlignedRectangle,
  mapPointBetweenRectangles,
  rectanglePolygon,
  roomContainingPoint,
  suggestedRectangleOrigin,
} from '../floorplanGeometry';
import type { AxisAlignedRectangle } from '../floorplanGeometry';
import type { Circuit, CircuitPoint, Floorplan, MeasurementSource, Panel, Room } from '../types';

type InteractionMode = 'idle' | 'add' | 'walk' | 'edit' | 'move' | 'room';
type PointDraft = Omit<CircuitPoint, 'id'>;
type RoomDraft = {
  roomId: number | null;
  name: string;
  floor: string;
  length: string;
  width: string;
  x: string;
  y: string;
};
type Viewport = { minX: number; minY: number; width: number; height: number };
type PointerPosition = { clientX: number; clientY: number; pointerType: string };
type RoomDrag = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startPoint: { x: number; y: number };
  origin: { x: number; y: number };
  inverse: DOMMatrix;
  moved: boolean;
};
type RoomShapeGesture = {
  kind: 'draw' | 'resize';
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startPoint: { x: number; y: number };
  startRectangle: AxisAlignedRectangle;
  startViewport: Viewport | null;
  inverse: DOMMatrix;
  moved: boolean;
};
type ViewGesture =
  | {
      kind: 'pan-candidate' | 'pan';
      pointerId: number;
      startClientX: number;
      startClientY: number;
      startPoint: { x: number; y: number };
      startViewport: Viewport;
      inverse: DOMMatrix;
    }
  | {
      kind: 'pinch';
      pointerIds: [number, number];
      startDistance: number;
      startMidpoint: { x: number; y: number };
      startViewport: Viewport;
      inverse: DOMMatrix;
    };

function rectangleFromDraft(draft: RoomDraft): AxisAlignedRectangle | null {
  if ([draft.x, draft.y, draft.length, draft.width].some((value) => value.trim() === '')) return null;
  const rectangle = {
    x: Number(draft.x),
    y: Number(draft.y),
    length: Number(draft.length),
    width: Number(draft.width),
  };
  return Object.values(rectangle).every(Number.isFinite) && rectangle.length > 0 && rectangle.width > 0
    ? rectangle
    : null;
}

function roundTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

function rectangleMeasurement(rectangle: AxisAlignedRectangle): MeasurementSource {
  const side = (feet: number) => ({ length_in: feet * 12, turn: 'right' as const });
  return {
    unit: 'ft_in',
    start: { mode: 'absolute', x: rectangle.x, y: rectangle.y, heading_deg: 0 },
    walls: [side(rectangle.length), side(rectangle.width), side(rectangle.length), side(rectangle.width)],
  };
}

function editableRectangle(room: Room): AxisAlignedRectangle | null {
  const rectangle = axisAlignedRectangle(room.polygon);
  if (!rectangle || !room.measurement_source) return rectangle;
  const source = room.measurement_source;
  const expected = rectangleMeasurement(rectangle);
  if (
    source.start.mode !== 'absolute' ||
    Math.abs(source.start.x - rectangle.x) > 1e-6 ||
    Math.abs(source.start.y - rectangle.y) > 1e-6 ||
    Math.abs(source.start.heading_deg) > 1e-6 ||
    source.walls.length !== 4
  ) return null;
  return source.walls.every((wall, index) =>
    wall.turn === 'right' && Math.abs(wall.length_in - expected.walls[index].length_in) <= 1e-6,
  ) ? rectangle : null;
}

function getSvgPoint(svg: SVGSVGElement, evt: React.MouseEvent): { x: number; y: number } {
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX;
  pt.y = evt.clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const transformed = pt.matrixTransform(ctm.inverse());
  return { x: Math.round(transformed.x * 10) / 10, y: Math.round(transformed.y * 10) / 10 };
}

function mapPointFromClient(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
  inverse = svg.getScreenCTM()?.inverse(),
): { x: number; y: number } | null {
  if (!inverse) return null;
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const transformed = point.matrixTransform(inverse);
  return { x: transformed.x, y: transformed.y };
}

function boundsForPoints(points: [number, number][]): Viewport {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    minX,
    minY,
    width: Math.max(...xs) - minX,
    height: Math.max(...ys) - minY,
  };
}

function viewportForTarget(
  current: Viewport | null,
  bounds: Viewport,
  target: Viewport,
): Viewport | null {
  const currentView = current ?? bounds;
  if (
    target.minX >= currentView.minX &&
    target.minY >= currentView.minY &&
    target.minX + target.width <= currentView.minX + currentView.width &&
    target.minY + target.height <= currentView.minY + currentView.height
  ) {
    return current;
  }

  const scale = Math.max(
    1,
    (target.width * 1.25) / currentView.width,
    (target.height * 1.25) / currentView.height,
  );
  const width = currentView.width * scale;
  const height = currentView.height * scale;
  return {
    minX: target.minX + target.width / 2 - width / 2,
    minY: target.minY + target.height / 2 - height / 2,
    width,
    height,
  };
}

function centroid(polygon: [number, number][]): [number, number] {
  const n = polygon.length || 1;
  const [sx, sy] = polygon.reduce(([ax, ay], [x, y]) => [ax + x, ay + y], [0, 0]);
  return [sx / n, sy / n];
}

function splitRoomLabel(words: string[], lineCount: number): string[] {
  const lines: string[] = [];
  let wordIndex = 0;

  for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
    if (lineIndex === lineCount - 1) {
      lines.push(words.slice(wordIndex).join(' '));
      break;
    }

    const linesLeft = lineCount - lineIndex;
    const targetLength = words.slice(wordIndex).join(' ').length / linesLeft;
    const lastWordIndex = words.length - (linesLeft - 1);
    let line = words[wordIndex];
    wordIndex += 1;

    while (wordIndex < lastWordIndex) {
      const candidate = `${line} ${words[wordIndex]}`;
      if (
        Math.abs(candidate.length - targetLength) > Math.abs(line.length - targetLength)
      ) {
        break;
      }
      line = candidate;
      wordIndex += 1;
    }
    lines.push(line);
  }

  return lines;
}

function roomLabelLayout(name: string, polygon: [number, number][]) {
  const words = name.trim().split(/\s+/);
  const xs = polygon.map(([x]) => x);
  const ys = polygon.map(([, y]) => y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  let best = { lines: [name], fontSize: 0 };

  for (let lineCount = 1; lineCount <= Math.min(6, words.length); lineCount += 1) {
    const lines = splitRoomLabel(words, lineCount);
    const longestLine = Math.max(...lines.map((line) => line.length));
    const fontSize = Math.min(
      3,
      (width * 0.9) / (longestLine * 0.6),
      (height * 0.8) / (lineCount * 1.1),
    );
    if (fontSize > best.fontSize) best = { lines, fontSize };
  }

  return { ...best, lineHeight: best.fontSize * 1.1 };
}

const KIND_COLORS: Record<string, string> = {
  outlet: '#2563eb',
  switch: '#7c3aed',
  light: '#d97706',
  appliance: '#059669',
  smoke_detector: '#dc2626',
};

function colorForKind(kind: string): string {
  return KIND_COLORS[kind] ?? '#6b7280';
}

function pointAccessibleLabel(point: CircuitPoint): string {
  return `${point.kind}: ${point.label ?? `point ${point.id}`}`;
}

export function FloorplanView({
  initialCircuitId,
  initialFloor,
  initialWalking = false,
  onOpenRooms,
}: {
  initialCircuitId?: number;
  initialFloor?: string;
  initialWalking?: boolean;
  onOpenRooms: () => void;
}) {
  const [allRooms, setAllRooms] = useState<Room[]>([]);
  const [allPoints, setAllPoints] = useState<CircuitPoint[]>([]);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [circuits, setCircuits] = useState<Circuit[]>([]);
  const [floor, setFloor] = useState<string>(initialFloor ?? '');
  const [plan, setPlan] = useState<Floorplan>({ rooms: [], circuit_points: [] });
  const [planFloor, setPlanFloor] = useState<string | null>(null);
  const [selectedPointId, setSelectedPointId] = useState<number | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [selectedPanelId, setSelectedPanelId] = useState<number | null>(null);
  const [selectedCircuitId, setSelectedCircuitId] = useState<number | null>(initialCircuitId ?? null);
  const [mode, setMode] = useState<InteractionMode>(initialWalking ? 'walk' : 'idle');
  const [draftPoint, setDraftPoint] = useState<PointDraft | null>(null);
  const [roomDraft, setRoomDraft] = useState<RoomDraft | null>(null);
  const [resizingRoom, setResizingRoom] = useState(false);
  const [walkCircuitId, setWalkCircuitId] = useState<number | ''>(initialWalking ? initialCircuitId ?? '' : '');
  const [walkKind, setWalkKind] = useState('outlet');
  const [walkCreatedIds, setWalkCreatedIds] = useState<number[]>([]);
  const [findDataReady, setFindDataReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [pendingFindTarget, setPendingFindTarget] = useState<FloorplanFindTarget | null>(null);
  const [pendingFindFocus, setPendingFindFocus] = useState<{
    target: FloorplanFindTarget;
    floor: string;
  } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pointDetailsRef = useRef<HTMLDivElement>(null);
  const findConfirmationRef = useRef<HTMLDivElement>(null);
  const pointerPositions = useRef(new Map<number, PointerPosition>());
  const viewGesture = useRef<ViewGesture | null>(null);
  const roomDrag = useRef<RoomDrag | null>(null);
  const roomShape = useRef<RoomShapeGesture | null>(null);
  const roomPlacement = useRef<{ pointerId: number; startClientX: number; startClientY: number } | null>(null);
  const suppressMapClick = useRef(false);

  function revealPointDetails() {
    if (!window.matchMedia('(max-width: 700px)').matches) return;
    pointDetailsRef.current?.focus({ preventScroll: true });
    pointDetailsRef.current?.scrollIntoView({ block: 'start' });
  }

  useEffect(() => {
    if (mode === 'idle' && selectedPointId !== null) revealPointDetails();
    if (mode === 'move' && window.matchMedia('(max-width: 700px)').matches) returnToPoint(selectedPointId);
  }, [mode, selectedPointId]);

  function returnToPoint(pointId: number | null) {
    const marker = svgRef.current?.querySelector<SVGCircleElement>(
      `[data-point-id="${pointId}"]`,
    );
    marker?.focus({ preventScroll: true });
    marker?.scrollIntoView({ block: 'center' });
  }

  const floors = useMemo(() => {
    const names = new Set(allRooms.map((room) => room.floor));
    if (floor) names.add(floor);
    if (names.size === 0) names.add('main');
    return Array.from(names).sort();
  }, [allRooms, floor]);

  useEffect(() => {
    Promise.all([
      api.rooms.list(),
      api.panels.list(),
      api.circuits.list(),
      api.circuitPoints.list(),
    ])
      .then(([rooms, panelList, circuitList, pointList]) => {
        setAllRooms(rooms);
        setPanels(panelList);
        setCircuits(circuitList);
        setAllPoints(pointList);
        setError(null);
        if (!floor && rooms.length > 0) setFloor(rooms[0].floor);
      })
      .catch((err) => setError(String(err)))
      .finally(() => setFindDataReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!floor) return;
    let current = true;
    setPlanFloor(null);
    api.floorplan
      .get(floor)
      .then((floorplan) => {
        if (!current) return;
        setPlan(floorplan);
        setPlanFloor(floor);
        setError(null);
      })
      .catch((err) => {
        if (current) setError(String(err));
      });
    return () => {
      current = false;
    };
  }, [floor]);

  const draftRectangle = roomDraft ? rectangleFromDraft(roomDraft) : null;
  const draftPolygon = draftRectangle ? rectanglePolygon(draftRectangle) : null;
  const displayedRooms = roomDraft
    ? allRooms.filter((room) => room.floor === roomDraft.floor)
    : plan.rooms;
  const editedRoom = roomDraft?.roomId == null
    ? null
    : allRooms.find((room) => room.id === roomDraft.roomId) ?? null;
  const editedRectangle = editedRoom ? axisAlignedRectangle(editedRoom.polygon) : null;
  const displayedRoomIds = new Set(displayedRooms.map((room) => room.id));
  const pointsOnDisplayedFloor = plan.circuit_points.filter((point) =>
    displayedRoomIds.has(point.room_id),
  );
  const displayedPoints = editedRoom && editedRectangle && draftRectangle
    ? pointsOnDisplayedFloor.map((point) => {
        if (point.room_id !== editedRoom.id) return point;
        const [x, y] = mapPointBetweenRectangles(
          [point.x, point.y],
          editedRectangle,
          draftRectangle,
        );
        return { ...point, x, y };
      })
    : pointsOnDisplayedFloor;

  const bounds = useMemo(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const room of displayedRooms) {
      for (const [x, y] of room.polygon) {
        xs.push(x);
        ys.push(y);
      }
    }
    for (const [x, y] of draftPolygon ?? []) {
      xs.push(x);
      ys.push(y);
    }
    for (const point of displayedPoints) {
      xs.push(point.x);
      ys.push(point.y);
    }
    if (xs.length === 0) return { minX: 0, minY: 0, width: 100, height: 100 };
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const pad = Math.max(1, span * 0.05);
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    const width = Math.max(...xs) - minX + pad;
    const height = Math.max(...ys) - minY + pad;
    return { minX, minY, width, height };
  }, [displayedRooms, displayedPoints, draftPolygon]);
  const visibleViewport = viewport ?? bounds;

  function focusMapBounds(target: Viewport) {
    setViewport((current) => viewportForTarget(current, bounds, target));
  }

  useEffect(() => {
    if (!pendingFindFocus || pendingFindFocus.floor !== floor || planFloor !== floor) return;
    let targetBounds: Viewport | null = null;
    if (pendingFindFocus.target.type === 'room') {
      const room = allRooms.find((candidate) => candidate.id === pendingFindFocus.target.id);
      if (room) targetBounds = boundsForPoints(room.polygon);
    } else if (pendingFindFocus.target.type === 'point') {
      const point = allPoints.find((candidate) => candidate.id === pendingFindFocus.target.id);
      if (point) targetBounds = { minX: point.x, minY: point.y, width: 0, height: 0 };
    } else if (pendingFindFocus.target.type === 'panel') {
      const panel = panels.find((candidate) => candidate.id === pendingFindFocus.target.id);
      const room = panel?.room_id == null
        ? null
        : allRooms.find((candidate) => candidate.id === panel.room_id);
      if (room) targetBounds = boundsForPoints(room.polygon);
    } else {
      const roomById = new Map(allRooms.map((room) => [room.id, room]));
      const points = allPoints
        .filter((point) => point.circuit_id === pendingFindFocus.target.id)
        .filter((point) => roomById.get(point.room_id)?.floor === pendingFindFocus.floor);
      if (points.length) targetBounds = boundsForPoints(points.map(({ x, y }) => [x, y]));
    }
    if (targetBounds) {
      setViewport((current) => viewportForTarget(current, bounds, targetBounds!));
    }
    setPendingFindFocus(null);
  }, [allPoints, allRooms, bounds, floor, panels, pendingFindFocus, planFloor]);

  useEffect(() => {
    if (pendingFindTarget) findConfirmationRef.current?.focus();
  }, [pendingFindTarget]);

  function zoomMap(factor: number, anchor?: { x: number; y: number }) {
    setViewport((current) => {
      const currentView = current ?? bounds;
      const center = anchor ?? {
        x: currentView.minX + currentView.width / 2,
        y: currentView.minY + currentView.height / 2,
      };
      const nextWidth = Math.min(
        bounds.width * 4,
        Math.max(bounds.width / 12, currentView.width * factor),
      );
      const scale = nextWidth / currentView.width;
      return {
        minX: center.x - (center.x - currentView.minX) * scale,
        minY: center.y - (center.y - currentView.minY) * scale,
        width: nextWidth,
        height: currentView.height * scale,
      };
    });
  }

  function handleSvgPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (mode === 'room') {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (saving || roomDrag.current || roomShape.current || roomPlacement.current) return;
      suppressMapClick.current = false;
      const svg = event.currentTarget;
      if (roomDraft && (roomDraft.roomId == null ||
        (resizingRoom && (event.target as SVGElement).classList.contains('room-resize-hit')))) {
        const inverse = svg.getScreenCTM()?.inverse();
        const startPoint = mapPointFromClient(svg, event.clientX, event.clientY, inverse);
        const startRectangle = rectangleFromDraft(roomDraft);
        if (!inverse || !startPoint || !startRectangle) return;
        roomShape.current = {
          kind: roomDraft.roomId == null ? 'draw' : 'resize',
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          startPoint,
          startRectangle,
          startViewport: viewport,
          inverse,
          moved: false,
        };
        if (viewport === null) setViewport(visibleViewport);
      } else if (!resizingRoom && roomDraft?.roomId != null &&
        (event.target as SVGElement).classList.contains('draft-room-polygon')) {
        const inverse = svg.getScreenCTM()?.inverse();
        const startPoint = mapPointFromClient(svg, event.clientX, event.clientY, inverse);
        const origin = rectangleFromDraft(roomDraft);
        if (!inverse || !startPoint || !origin) return;
        roomDrag.current = {
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          startPoint,
          origin: { x: origin.x, y: origin.y },
          inverse,
          moved: false,
        };
      } else {
        roomPlacement.current = {
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
        };
      }
      svg.setPointerCapture(event.pointerId);
      return;
    }
    if (mode !== 'idle') return;
    if (!viewGesture.current) suppressMapClick.current = false;

    const svg = event.currentTarget;
    const inverse = svg.getScreenCTM()?.inverse();
    if (!inverse) return;

    if (event.pointerType === 'touch') {
      pointerPositions.current.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
        pointerType: event.pointerType,
      });
      const touches = Array.from(pointerPositions.current.entries()).filter(
        ([, pointer]) => pointer.pointerType === 'touch',
      );
      if (touches.length >= 2) {
        const [first, second] = touches.slice(-2);
        const [firstId, firstPointer] = first;
        const [secondId, secondPointer] = second;
        const midpointX = (firstPointer.clientX + secondPointer.clientX) / 2;
        const midpointY = (firstPointer.clientY + secondPointer.clientY) / 2;
        const startMidpoint = mapPointFromClient(svg, midpointX, midpointY, inverse);
        if (!startMidpoint) return;
        viewGesture.current = {
          kind: 'pinch',
          pointerIds: [firstId, secondId],
          startDistance: Math.hypot(
            secondPointer.clientX - firstPointer.clientX,
            secondPointer.clientY - firstPointer.clientY,
          ),
          startMidpoint,
          startViewport: visibleViewport,
          inverse,
        };
        suppressMapClick.current = true;
        svg.setPointerCapture(firstId);
        svg.setPointerCapture(secondId);
      } else if (event.target === svg) {
        const startPoint = mapPointFromClient(svg, event.clientX, event.clientY, inverse);
        if (!startPoint) return;
        viewGesture.current = {
          kind: 'pan-candidate',
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          startPoint,
          startViewport: visibleViewport,
          inverse,
        };
        svg.setPointerCapture(event.pointerId);
      }
      return;
    }

    if (event.button !== 0 || event.target !== svg) return;
    const startPoint = mapPointFromClient(svg, event.clientX, event.clientY, inverse);
    if (!startPoint) return;
    viewGesture.current = {
      kind: 'pan-candidate',
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPoint,
      startViewport: visibleViewport,
      inverse,
    };
    svg.setPointerCapture(event.pointerId);
  }

  function handleSvgPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const shape = roomShape.current;
    if (shape?.pointerId === event.pointerId) {
      if (!shape.moved && Math.hypot(
        event.clientX - shape.startClientX,
        event.clientY - shape.startClientY,
      ) < 4) return;
      shape.moved = true;
      const point = mapPointFromClient(event.currentTarget, event.clientX, event.clientY, shape.inverse);
      if (!point) return;
      if (shape.kind === 'draw') {
        changeRoomDraft({
          x: String(roundTenth(Math.min(shape.startPoint.x, point.x))),
          y: String(roundTenth(Math.min(shape.startPoint.y, point.y))),
          length: String(Math.max(0.1, roundTenth(Math.abs(point.x - shape.startPoint.x)))),
          width: String(Math.max(0.1, roundTenth(Math.abs(point.y - shape.startPoint.y)))),
        });
      } else {
        changeRoomDraft({
          length: String(Math.max(0.1, roundTenth(point.x - shape.startRectangle.x))),
          width: String(Math.max(0.1, roundTenth(point.y - shape.startRectangle.y))),
        });
      }
      return;
    }
    const drag = roomDrag.current;
    if (drag?.pointerId === event.pointerId) {
      if (!drag.moved && Math.hypot(
        event.clientX - drag.startClientX,
        event.clientY - drag.startClientY,
      ) < 4) return;
      drag.moved = true;
      const point = mapPointFromClient(event.currentTarget, event.clientX, event.clientY, drag.inverse);
      if (!point) return;
      changeRoomDraft({
        x: String(Math.round((drag.origin.x + point.x - drag.startPoint.x) * 10) / 10),
        y: String(Math.round((drag.origin.y + point.y - drag.startPoint.y) * 10) / 10),
      });
      return;
    }
    const placement = roomPlacement.current;
    if (placement?.pointerId === event.pointerId) {
      if (Math.hypot(
        event.clientX - placement.startClientX,
        event.clientY - placement.startClientY,
      ) >= 4) suppressMapClick.current = true;
      return;
    }
    const pointer = pointerPositions.current.get(event.pointerId);
    if (pointer?.pointerType === 'touch') {
      pointerPositions.current.set(event.pointerId, {
        ...pointer,
        clientX: event.clientX,
        clientY: event.clientY,
      });
    }

    const gesture = viewGesture.current;
    if (!gesture) return;
    const svg = event.currentTarget;
    if (gesture.kind === 'pinch') {
      if (!gesture.pointerIds.includes(event.pointerId)) return;
      const first = pointerPositions.current.get(gesture.pointerIds[0]);
      const second = pointerPositions.current.get(gesture.pointerIds[1]);
      if (!first || !second) return;
      const distance = Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
      const requestedScale = distance / gesture.startDistance;
      const nextWidth = Math.min(
        bounds.width * 4,
        Math.max(bounds.width / 12, gesture.startViewport.width / requestedScale),
      );
      const scale = gesture.startViewport.width / nextWidth;
      const midpoint = mapPointFromClient(
        svg,
        (first.clientX + second.clientX) / 2,
        (first.clientY + second.clientY) / 2,
        gesture.inverse,
      );
      if (!midpoint) return;
      setViewport({
        minX: gesture.startMidpoint.x - (midpoint.x - gesture.startViewport.minX) / scale,
        minY: gesture.startMidpoint.y - (midpoint.y - gesture.startViewport.minY) / scale,
        width: nextWidth,
        height: gesture.startViewport.height / scale,
      });
      return;
    }

    if (gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.startClientX;
    const deltaY = event.clientY - gesture.startClientY;
    if (gesture.kind === 'pan-candidate' && Math.hypot(deltaX, deltaY) < 4) return;
    if (gesture.kind === 'pan-candidate') {
      viewGesture.current = { ...gesture, kind: 'pan' };
      suppressMapClick.current = true;
    }
    const currentPoint = mapPointFromClient(svg, event.clientX, event.clientY, gesture.inverse);
    if (!currentPoint) return;
    setViewport({
      ...gesture.startViewport,
      minX: gesture.startViewport.minX - (currentPoint.x - gesture.startPoint.x),
      minY: gesture.startViewport.minY - (currentPoint.y - gesture.startPoint.y),
    });
  }

  function endSvgPointer(event: React.PointerEvent<SVGSVGElement>) {
    const shape = roomShape.current;
    if (shape?.pointerId === event.pointerId) {
      if (event.type === 'pointercancel') {
        changeRoomDraft({
          x: String(shape.startRectangle.x),
          y: String(shape.startRectangle.y),
          length: String(shape.startRectangle.length),
          width: String(shape.startRectangle.width),
        });
      }
      if (shape.moved) suppressMapClick.current = true;
      if (shape.startViewport === null) setViewport(null);
      roomShape.current = null;
      return;
    }
    const drag = roomDrag.current;
    if (drag?.pointerId === event.pointerId) {
      if (event.type === 'pointercancel') {
        changeRoomDraft({ x: String(drag.origin.x), y: String(drag.origin.y) });
      }
      if (drag.moved) suppressMapClick.current = true;
      roomDrag.current = null;
      return;
    }
    if (roomPlacement.current?.pointerId === event.pointerId) {
      roomPlacement.current = null;
      return;
    }
    pointerPositions.current.delete(event.pointerId);
    const gesture = viewGesture.current;
    if (!gesture) return;
    if (gesture.kind === 'pinch' && gesture.pointerIds.includes(event.pointerId)) {
      viewGesture.current = null;
    } else if (gesture.kind !== 'pinch' && gesture.pointerId === event.pointerId) {
      viewGesture.current = null;
    }
  }

  function handleSvgClickCapture(event: React.MouseEvent<SVGSVGElement>) {
    if (!suppressMapClick.current) return;
    suppressMapClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  function handleSvgWheel(event: React.WheelEvent<SVGSVGElement>) {
    if (mode !== 'idle') return;
    const point = mapPointFromClient(event.currentTarget, event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    zoomMap(Math.exp(Math.max(-2, Math.min(2, event.deltaY * 0.002))), point);
  }

  function handleSvgKeyDown(event: React.KeyboardEvent<SVGSVGElement>) {
    if (mode !== 'idle' || event.target !== event.currentTarget) return;
    const currentView = viewport ?? bounds;
    const stepX = currentView.width * 0.1;
    const stepY = currentView.height * 0.1;
    if (event.key === 'ArrowLeft') setViewport({ ...currentView, minX: currentView.minX - stepX });
    else if (event.key === 'ArrowRight') setViewport({ ...currentView, minX: currentView.minX + stepX });
    else if (event.key === 'ArrowUp') setViewport({ ...currentView, minY: currentView.minY - stepY });
    else if (event.key === 'ArrowDown') setViewport({ ...currentView, minY: currentView.minY + stepY });
    else if (event.key === '+' || event.key === '=') zoomMap(0.8);
    else if (event.key === '-') zoomMap(1.25);
    else if (event.key === 'Home') setViewport(null);
    else return;
    event.preventDefault();
  }

  function circuitLabel(circuitId: number): string {
    const circuit = circuits.find((c) => c.id === circuitId);
    if (!circuit) return `circuit #${circuitId}`;
    const panel = panels.find((p) => p.id === circuit.panel_id);
    return `${panel?.name ?? 'unknown panel'} — breaker ${circuit.breaker_label}`;
  }

  function finishInteraction() {
    roomDrag.current = null;
    roomShape.current = null;
    roomPlacement.current = null;
    setResizingRoom(false);
    setMode('idle');
    setDraftPoint(null);
    setRoomDraft(null);
  }

  function finishWalk() {
    if (walkCircuitId !== '') setSelectedCircuitId(walkCircuitId);
    setWalkCreatedIds([]);
    finishInteraction();
  }

  function startAdd() {
    if (plan.rooms.length === 0) return;
    if (mode === 'add') {
      finishInteraction();
      return;
    }
    setSelectedPointId(null);
    setSelectedRoomId(null);
    setDraftPoint(null);
    setMode('add');
  }

  function startWalk() {
    if (mode === 'walk') {
      finishWalk();
      return;
    }
    const circuitId = selectedCircuitId ?? circuits[0]?.id;
    if (circuitId == null) return;
    setSelectedPointId(null);
    setSelectedRoomId(null);
    setSelectedCircuitId(circuitId);
    setWalkCircuitId(circuitId);
    setWalkCreatedIds([]);
    setDraftPoint(null);
    setMode('walk');
  }

  function selectPoint(point: CircuitPoint) {
    if (mode !== 'idle') return;
    if (selectedPointId === point.id) revealPointDetails();
    setSelectedPointId(point.id);
    setSelectedRoomId(null);
    setSelectedPanelId(null);
    setSelectedCircuitId(point.circuit_id);
    setDraftPoint(null);
    focusMapBounds({ minX: point.x, minY: point.y, width: 0, height: 0 });
  }

  function showFindTarget(target: FloorplanFindTarget) {
    setSelectedPointId(null);
    setSelectedRoomId(null);
    setSelectedPanelId(null);
    let targetFloor: string | null = null;
    if (target.type === 'room') {
      const room = allRooms.find((candidate) => candidate.id === target.id);
      if (!room) return;
      setSelectedRoomId(room.id);
      setSelectedCircuitId(null);
      targetFloor = room.floor;
    } else if (target.type === 'point') {
      const point = allPoints.find((candidate) => candidate.id === target.id);
      const room = point && allRooms.find((candidate) => candidate.id === point.room_id);
      if (!point) return;
      setSelectedPointId(point.id);
      setSelectedCircuitId(point.circuit_id);
      targetFloor = room?.floor ?? null;
    } else if (target.type === 'panel') {
      const panel = panels.find((candidate) => candidate.id === target.id);
      const room = panel?.room_id == null
        ? null
        : allRooms.find((candidate) => candidate.id === panel.room_id);
      if (!panel) return;
      setSelectedPanelId(panel.id);
      setSelectedRoomId(room?.id ?? null);
      setSelectedCircuitId(null);
      targetFloor = room?.floor ?? null;
    } else {
      const points = allPoints.filter((point) => point.circuit_id === target.id);
      const pointFloors = Array.from(new Set(points
        .map((point) => allRooms.find((room) => room.id === point.room_id)?.floor)
        .filter((pointFloor): pointFloor is string => Boolean(pointFloor))))
        .sort((a, b) => a.localeCompare(b));
      setSelectedCircuitId(target.id);
      targetFloor = pointFloors.includes(floor) ? floor : pointFloors[0] ?? null;
    }

    if (targetFloor) {
      setPendingFindFocus({ target, floor: targetFloor });
      if (targetFloor !== floor) setViewport(null);
      setFloor(targetFloor);
    } else {
      setPendingFindFocus(null);
    }
  }

  function chooseFindTarget(target: FloorplanFindTarget) {
    if (roomDraft || draftPoint) {
      setPendingFindTarget(target);
      return;
    }
    if (mode === 'walk') finishWalk();
    else if (mode !== 'idle') finishInteraction();
    showFindTarget(target);
  }

  async function savePendingFindDraft() {
    if (!pendingFindTarget) return;
    const target = pendingFindTarget;
    const saved = roomDraft ? await saveRoomDraft() : await saveDraft();
    if (!saved) return;
    if (mode === 'walk') finishWalk();
    setPendingFindTarget(null);
    showFindTarget(target);
  }

  function discardPendingFindDraft() {
    if (!pendingFindTarget) return;
    const target = pendingFindTarget;
    if (mode === 'walk') finishWalk();
    else finishInteraction();
    setPendingFindTarget(null);
    showFindTarget(target);
  }

  function beginEdit(move: boolean) {
    const point = plan.circuit_points.find((candidate) => candidate.id === selectedPointId);
    if (!point) return;
    const { id: _id, ...draft } = point;
    setDraftPoint(draft);
    setMode(move ? 'move' : 'edit');
  }

  function handleFloorChange(nextFloor: string) {
    if (nextFloor === floor) return;
    if (mode === 'walk') setWalkCreatedIds([]);
    finishInteraction();
    setSelectedPointId(null);
    setSelectedRoomId(null);
    setViewport(null);
    setFloor(nextFloor);
  }

  function startRoomCreate() {
    const roomFloor = floor || allRooms[0]?.floor || 'main';
    const [x, y] = suggestedRectangleOrigin(
      allRooms.filter((room) => room.floor === roomFloor),
    );
    setRoomDraft({
      roomId: null,
      name: '',
      floor: roomFloor,
      length: '10',
      width: '10',
      x: String(x),
      y: String(y),
    });
    setResizingRoom(false);
    if (roomFloor !== floor) setViewport(null);
    setFloor(roomFloor);
    setSelectedPointId(null);
    setSelectedRoomId(null);
    setDraftPoint(null);
    setMode('room');
    setError(null);
  }

  function selectRoom(room: Room) {
    if (mode !== 'idle') return;
    setSelectedRoomId(room.id);
    setSelectedPointId(null);
    setSelectedPanelId(null);
    setSelectedCircuitId(null);
    setDraftPoint(null);
    focusMapBounds(boundsForPoints(room.polygon));
  }

  function startRoomEdit(room: Room, resize = false) {
    const rectangle = editableRectangle(room);
    if (!rectangle) return;
    setRoomDraft({
      roomId: room.id,
      name: room.name,
      floor: room.floor,
      length: String(rectangle.length),
      width: String(rectangle.width),
      x: String(rectangle.x),
      y: String(rectangle.y),
    });
    setResizingRoom(resize);
    setSelectedPointId(null);
    setDraftPoint(null);
    setMode('room');
    setError(null);
  }

  function changeRoomDraft(change: Partial<RoomDraft>) {
    if (change.floor != null) {
      if (change.floor !== floor) setViewport(null);
      setFloor(change.floor);
    }
    setRoomDraft((current) => (current ? { ...current, ...change } : current));
  }

  async function saveRoomDraft(): Promise<boolean> {
    if (!roomDraft) return false;
    const rectangle = rectangleFromDraft(roomDraft);
    if (!rectangle || !roomDraft.name.trim() || !roomDraft.floor.trim()) return false;
    const payload = {
      name: roomDraft.name,
      floor: roomDraft.floor,
      polygon: rectanglePolygon(rectangle),
      measurement_source: rectangleMeasurement(rectangle),
    };
    setSaving(true);
    let saved: Room;
    try {
      saved = roomDraft.roomId == null
        ? await api.rooms.create(payload)
        : await api.rooms.update(roomDraft.roomId, {
            name: payload.name,
            polygon: payload.polygon,
            measurement_source: payload.measurement_source,
          });
    } catch (err) {
      setError(
        `Failed to ${roomDraft.roomId == null ? 'create' : 'save'} room: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      setSaving(false);
      return false;
    }

    const updatedPoints = editedRoom && editedRectangle
      ? allPoints.map((point) => {
          if (point.room_id !== editedRoom.id) return point;
          const [x, y] = mapPointBetweenRectangles([point.x, point.y], editedRectangle, rectangle);
          return { ...point, x, y };
        })
      : allPoints;

    const localRooms = [
      ...allRooms.filter((room) => room.id !== saved.id),
      saved,
    ];
    setAllRooms(localRooms);
    setAllPoints(updatedPoints);
    setPlan({
      rooms: [
        ...displayedRooms.filter((room) => room.id !== saved.id),
        saved,
      ],
      circuit_points: displayedPoints,
    });
    setFloor(saved.floor);
    setSelectedRoomId(saved.id);
    setRoomDraft(null);
    setResizingRoom(false);
    setMode('idle');
    setError(null);

    try {
      const [rooms, floorplan, points] = await Promise.all([
        api.rooms.list(),
        api.floorplan.get(saved.floor),
        api.circuitPoints.list(),
      ]);
      setAllRooms(rooms);
      setAllPoints(points);
      setPlan(floorplan);
    } catch (err) {
      setError(
        `Room saved, but the floorplan could not refresh: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    setSaving(false);
    return true;
  }

  function handleSvgClick(evt: React.MouseEvent<SVGSVGElement>) {
    if (roomDraft && svgRef.current) {
      if (resizingRoom) return;
      const point = getSvgPoint(svgRef.current, evt);
      changeRoomDraft({ x: String(point.x), y: String(point.y) });
      return;
    }
    if (!svgRef.current || !['add', 'walk', 'move'].includes(mode)) return;
    if ((evt.target as SVGElement).tagName === 'circle') return;

    const point = getSvgPoint(svgRef.current, evt);
    const inferredRoom = roomContainingPoint(plan.rooms, [point.x, point.y]);
    if (mode === 'move') {
      setDraftPoint((current) =>
        current
          ? { ...current, ...point, room_id: inferredRoom?.id ?? current.room_id }
          : current,
      );
      return;
    }

    setDraftPoint((current) => {
      const roomId = inferredRoom?.id ?? current?.room_id ?? plan.rooms[0]?.id;
      const circuitId =
        mode === 'walk'
          ? walkCircuitId
          : current?.circuit_id ?? selectedCircuitId ?? circuits[0]?.id;
      if (roomId == null || circuitId === '' || circuitId == null) return current;
      return {
        room_id: roomId,
        circuit_id: circuitId,
        kind: mode === 'walk' ? walkKind : current?.kind ?? 'outlet',
        x: point.x,
        y: point.y,
        label: current?.label ?? null,
      };
    });
  }

  function changeDraft(change: Partial<PointDraft>) {
    setDraftPoint((current) => (current ? { ...current, ...change } : current));
  }

  async function saveDraft(): Promise<boolean> {
    if (!draftPoint) return false;
    setSaving(true);
    try {
      if (mode === 'edit' || mode === 'move') {
        if (selectedPointId == null) return false;
        const saved = await api.circuitPoints.update(selectedPointId, draftPoint);
        setPlan((current) => ({
          ...current,
          circuit_points: current.circuit_points.map((point) =>
            point.id === saved.id ? saved : point,
          ),
        }));
        setAllPoints((current) => current.map((point) => point.id === saved.id ? saved : point));
        setSelectedCircuitId(saved.circuit_id);
        finishInteraction();
      } else {
        const saved = await api.circuitPoints.create(draftPoint);
        setPlan((current) => ({
          ...current,
          circuit_points: [...current.circuit_points, saved],
        }));
        setAllPoints((current) => [...current, saved]);
        if (mode === 'walk') {
          setWalkCreatedIds((ids) => [...ids, saved.id]);
          setDraftPoint(null);
        } else {
          setSelectedPointId(saved.id);
          setSelectedCircuitId(saved.circuit_id);
          finishInteraction();
        }
      }
      setError(null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function undoLastWalkPoint() {
    const pointId = walkCreatedIds.at(-1);
    if (pointId == null) return;
    try {
      await api.circuitPoints.remove(pointId);
      setPlan((current) => ({
        ...current,
        circuit_points: current.circuit_points.filter((point) => point.id !== pointId),
      }));
      setAllPoints((current) => current.filter((point) => point.id !== pointId));
      setWalkCreatedIds((ids) => ids.slice(0, -1));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteSelectedPoint() {
    if (selectedPointId == null) return;
    if (!window.confirm('Delete this point? This cannot be undone.')) return;
    try {
      await api.circuitPoints.remove(selectedPointId);
      setPlan((current) => ({
        ...current,
        circuit_points: current.circuit_points.filter((point) => point.id !== selectedPointId),
      }));
      setAllPoints((current) => current.filter((point) => point.id !== selectedPointId));
      setSelectedPointId(null);
      setSelectedCircuitId(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const selectedPoint = plan.circuit_points.find((p) => p.id === selectedPointId) ?? null;
  const selectedRoom = allRooms.find((room) => room.id === selectedRoomId) ?? null;
  const selectedPanel = panels.find((panel) => panel.id === selectedPanelId) ?? null;
  const selectedPanelRoom = selectedPanel?.room_id == null
    ? null
    : allRooms.find((room) => room.id === selectedPanel.room_id) ?? null;
  const selectedCircuit = circuits.find((c) => c.id === selectedCircuitId) ?? null;
  const selectedCircuitPanel = selectedCircuit
    ? panels.find((panel) => panel.id === selectedCircuit.panel_id) ?? null
    : null;
  const selectedCircuitPoints = selectedCircuit
    ? allPoints.filter((point) => point.circuit_id === selectedCircuit.id)
    : [];
  const selectedCircuitPointFloors = new Map<string, CircuitPoint[]>();
  for (const point of selectedCircuitPoints) {
    const pointFloor = allRooms.find((room) => room.id === point.room_id)?.floor ?? 'Floor not found';
    selectedCircuitPointFloors.set(pointFloor, [
      ...(selectedCircuitPointFloors.get(pointFloor) ?? []),
      point,
    ]);
  }
  const activeEdit = mode === 'edit' || mode === 'move';
  const markerRadius = Math.max(bounds.width, bounds.height) * 0.018;

  return (
    <section aria-labelledby="floorplan-heading">
      <h2 id="floorplan-heading">Floorplan</h2>
      <div
        className={`floorplan-layout${mode === 'walk' ? ' walking' : ''}${
          mode === 'room' ? ' room-authoring' : ''
        }`}
      >
        <div className="floorplan-main">
          {error && <p className="error">{error}</p>}
          <FloorplanFinder
            rooms={allRooms}
            points={allPoints}
            panels={panels}
            circuits={circuits}
            loading={!findDataReady}
            onSelect={chooseFindTarget}
          />
          {pendingFindTarget && (
            <div
              className="floorplan-find-confirmation"
              ref={findConfirmationRef}
              role="alertdialog"
              aria-labelledby="floorplan-find-confirmation-title"
              aria-describedby="floorplan-find-confirmation-description"
              tabIndex={-1}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setPendingFindTarget(null);
                  document.getElementById('floorplan-find-query')?.focus();
                }
              }}
            >
              <h3 id="floorplan-find-confirmation-title">Leave this draft?</h3>
              <p id="floorplan-find-confirmation-description">
                {roomDraft
                  ? 'Save the room draft, discard it, or stay and keep editing before finding this item.'
                  : mode === 'walk'
                    ? 'Earlier points in this walk are already saved. Save or discard only the current point draft, or stay.'
                    : 'Save the point draft, discard it, or stay and keep editing before finding this item.'}
              </p>
              <div className="form-actions">
                <button type="button" onClick={savePendingFindDraft} disabled={saving}>
                  {roomDraft ? 'Save room and find' : 'Save point and find'}
                </button>
                <button type="button" onClick={discardPendingFindDraft} disabled={saving}>
                  {roomDraft ? 'Discard room and find' : 'Discard point and find'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPendingFindTarget(null);
                    document.getElementById('floorplan-find-query')?.focus();
                  }}
                >
                  Stay
                </button>
              </div>
            </div>
          )}
          <div className="floorplan-toolbar">
            <label>
              Floor:{' '}
              <select
                value={floor || floors[0]}
                onChange={(e) => handleFloorChange(e.target.value)}
                disabled={mode === 'room'}
              >
                {floors.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={startRoomCreate} disabled={mode !== 'idle'}>
              Add room
            </button>
            <button
              onClick={startAdd}
              disabled={activeEdit || mode === 'walk' || mode === 'room' || plan.rooms.length === 0}
            >
              {mode === 'add' ? 'Cancel add point' : 'Add point'}
            </button>
            <button
              onClick={startWalk}
              disabled={activeEdit || mode === 'add' || mode === 'room' || circuits.length === 0 || plan.rooms.length === 0}
            >
              {mode === 'walk' ? 'Finish circuit walk' : 'Walk circuit'}
            </button>
          </div>
          {displayedRooms.length === 0 && !roomDraft ? (
            <div>
              {selectedCircuit ? (
                <>
                  <p>Add a room before mapping {circuitLabel(selectedCircuit.id)}.</p>
                  <p>Then return to this breaker and choose Map breaker.</p>
                </>
              ) : (
                <p>Add a room before placing points on the floorplan.</p>
              )}
              <button type="button" onClick={startRoomCreate}>Add a rectangular room</button>{' '}
              <button type="button" onClick={onOpenRooms}>Add a measured or irregular room</button>
            </div>
          ) : (
            <>
              <div className="floorplan-navigation" role="group" aria-label="Floorplan navigation">
                <button type="button" onClick={() => setViewport(null)}>
                  Fit
                </button>
                <button type="button" onClick={() => zoomMap(1.25)}>
                  Zoom out
                </button>
                <button type="button" onClick={() => zoomMap(0.8)}>
                  Zoom in
                </button>
                <p id="floorplan-navigation-help">
                  {mode === 'idle'
                    ? 'Drag empty space to pan. Scroll or pinch to zoom; focus the map and use arrow keys to pan.'
                    : resizingRoom
                      ? 'Drag the corner handle to resize. Use the fields for exact dimensions.'
                      : roomDraft?.roomId != null
                      ? 'Drag the outlined room to move it. Focus it and use arrow keys to nudge; use Fit or zoom controls to navigate.'
                      : roomDraft
                        ? 'Drag on the map to draw a rectangle, or tap to place the default size.'
                        : 'Use Fit or the zoom controls while editing. Map gestures are reserved for your draft.'}
                </p>
              </div>
              {roomDraft && draftRectangle && (
                <p className="room-draft-summary">
                  {roomDraft.roomId == null ? 'Drag to draw' : resizingRoom ? 'Drag corner to resize' : 'Drag outline to move'} ·{' '}
                  {draftRectangle.length} × {draftRectangle.width} ft at X {draftRectangle.x}, Y {draftRectangle.y}
                </p>
              )}
              <svg
                ref={svgRef}
                viewBox={`${visibleViewport.minX} ${visibleViewport.minY} ${visibleViewport.width} ${visibleViewport.height}`}
                className={`floorplan-svg${mode === 'idle' ? '' : ' editing'}`}
                aria-label={`Floorplan map for ${floor}`}
                aria-describedby="floorplan-navigation-help"
                tabIndex={0}
                onClick={handleSvgClick}
                onClickCapture={handleSvgClickCapture}
                onPointerDown={handleSvgPointerDown}
                onPointerMove={handleSvgPointerMove}
                onPointerUp={endSvgPointer}
                onPointerCancel={endSvgPointer}
                onWheel={handleSvgWheel}
                onKeyDown={handleSvgKeyDown}
              >
                <title>{`Floorplan for ${floor}`}</title>
                {displayedRooms.map((room) => {
                  const [cx, cy] = centroid(room.polygon);
                  const label = roomLabelLayout(room.name, room.polygon);
                  const points = room.polygon.map(([x, y]) => `${x},${y}`).join(' ');
                  const isSelected = room.id === selectedRoomId;
                  return (
                    <g
                      key={room.id}
                      role="button"
                      tabIndex={mode === 'idle' ? 0 : -1}
                      aria-label={`Room: ${room.name}`}
                      aria-pressed={isSelected}
                      onClick={(event) => {
                        if (mode !== 'idle') return;
                        event.stopPropagation();
                        selectRoom(room);
                      }}
                      onKeyDown={(event) => {
                        if (mode !== 'idle' || (event.key !== 'Enter' && event.key !== ' ')) return;
                        event.preventDefault();
                        selectRoom(room);
                      }}
                    >
                      <clipPath id={`room-label-clip-${room.id}`}>
                        <polygon points={points} />
                      </clipPath>
                      <polygon
                        points={points}
                        className={`room-polygon${isSelected ? ' selected-room' : ''}`}
                      />
                      <text
                        className="room-label"
                        textAnchor="middle"
                        dominantBaseline="middle"
                        clipPath={`url(#room-label-clip-${room.id})`}
                        style={{ fontSize: label.fontSize }}
                      >
                        {label.lines.map((line, index) => (
                          <tspan
                            key={`${line}-${index}`}
                            x={cx}
                            y={cy + (index - (label.lines.length - 1) / 2) * label.lineHeight}
                          >
                            {line}{index < label.lines.length - 1 ? ' ' : ''}
                          </tspan>
                        ))}
                      </text>
                    </g>
                  );
                })}
                {draftPolygon && (
                  <polygon
                    points={draftPolygon.map(([x, y]) => `${x},${y}`).join(' ')}
                    className="draft-room-polygon"
                    strokeWidth={2}
                    strokeDasharray="8 6"
                    vectorEffect="non-scaling-stroke"
                    pointerEvents={roomDraft?.roomId == null || resizingRoom ? 'none' : 'auto'}
                    role={roomDraft?.roomId == null || resizingRoom ? undefined : 'button'}
                    tabIndex={roomDraft?.roomId == null || resizingRoom ? undefined : 0}
                    aria-label={roomDraft?.roomId == null || resizingRoom ? undefined : `Move ${roomDraft.name} draft`}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      if (!roomDraft || roomDraft.roomId == null) return;
                      const step = event.shiftKey ? 1 : 0.1;
                      const x = Number(roomDraft.x);
                      const y = Number(roomDraft.y);
                      if (event.key === 'ArrowLeft') changeRoomDraft({ x: String(Math.round((x - step) * 10) / 10) });
                      else if (event.key === 'ArrowRight') changeRoomDraft({ x: String(Math.round((x + step) * 10) / 10) });
                      else if (event.key === 'ArrowUp') changeRoomDraft({ y: String(Math.round((y - step) * 10) / 10) });
                      else if (event.key === 'ArrowDown') changeRoomDraft({ y: String(Math.round((y + step) * 10) / 10) });
                      else return;
                      event.preventDefault();
                    }}
                  />
                )}
                {displayedPoints.map((storedPoint) => {
                  const point =
                    activeEdit && storedPoint.id === selectedPointId && draftPoint
                      ? { ...storedPoint, ...draftPoint }
                      : storedPoint;
                  const isSelectedPoint = point.id === selectedPointId;
                  const isSelectedCircuit = point.circuit_id === selectedCircuitId;
                  return (
                    <Fragment key={point.id}>
                      <circle
                        data-point-id={point.id}
                        cx={point.x}
                        cy={point.y}
                        r={markerRadius}
                        fill="transparent"
                        stroke="transparent"
                        strokeWidth={32}
                        vectorEffect="non-scaling-stroke"
                        className="point-marker"
                        pointerEvents={mode === 'room' ? 'none' : undefined}
                        role="button"
                        tabIndex={mode === 'room' ? -1 : 0}
                        aria-pressed={isSelectedPoint}
                        aria-label={pointAccessibleLabel(point)}
                        onClick={(e) => {
                          if (mode === 'room') return;
                          e.stopPropagation();
                          selectPoint(point);
                        }}
                        onKeyDown={(e) => {
                          if (mode === 'room' || (e.key !== 'Enter' && e.key !== ' ')) return;
                          e.preventDefault();
                          selectPoint(point);
                        }}
                      >
                        <title>{pointAccessibleLabel(point)}</title>
                      </circle>
                      <circle
                        cx={point.x}
                        cy={point.y}
                        r={markerRadius}
                        fill={colorForKind(point.kind)}
                        stroke={isSelectedCircuit ? '#f97316' : '#fff'}
                        strokeWidth={isSelectedPoint ? 3 : 2}
                        vectorEffect="non-scaling-stroke"
                        className="point-symbol"
                        pointerEvents="none"
                      />
                    </Fragment>
                  );
                })}
                {draftPoint && !activeEdit && (
                  <circle
                    cx={draftPoint.x}
                    cy={draftPoint.y}
                    r={2}
                    fill="none"
                    stroke="#f97316"
                    strokeWidth={0.5}
                    pointerEvents="none"
                  />
                )}
                {resizingRoom && roomDraft?.roomId != null && draftRectangle && (
                  <g
                    className="room-resize-handle"
                    role="button"
                    tabIndex={0}
                    aria-label={`Resize ${roomDraft.name} draft`}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      const step = event.shiftKey ? 1 : 0.1;
                      if (event.key === 'ArrowRight') changeRoomDraft({ length: String(roundTenth(draftRectangle.length + step)) });
                      else if (event.key === 'ArrowLeft') changeRoomDraft({ length: String(Math.max(0.1, roundTenth(draftRectangle.length - step))) });
                      else if (event.key === 'ArrowDown') changeRoomDraft({ width: String(roundTenth(draftRectangle.width + step)) });
                      else if (event.key === 'ArrowUp') changeRoomDraft({ width: String(Math.max(0.1, roundTenth(draftRectangle.width - step))) });
                      else return;
                      event.preventDefault();
                    }}
                  >
                    <circle
                      cx={draftRectangle.x + draftRectangle.length}
                      cy={draftRectangle.y + draftRectangle.width}
                      r={markerRadius}
                      className="room-resize-handle-visible"
                      pointerEvents="none"
                    />
                    <circle
                      cx={draftRectangle.x + draftRectangle.length}
                      cy={draftRectangle.y + draftRectangle.width}
                      r={markerRadius}
                      fill="transparent"
                      stroke="transparent"
                      strokeWidth={44}
                      vectorEffect="non-scaling-stroke"
                      className="room-resize-hit"
                    />
                  </g>
                )}
              </svg>
            </>
          )}
        </div>

        <div className={`floorplan-sidebar${mode === 'walk' ? ' walk-sidebar' : ''}`}>
          {roomDraft ? (
            <RoomDraftForm
              draft={roomDraft}
              resizing={resizingRoom}
              saving={saving}
              onChange={changeRoomDraft}
              onCancel={finishInteraction}
              onSubmit={saveRoomDraft}
            />
          ) : draftPoint ? (
            <PointForm
              point={draftPoint}
              rooms={plan.rooms}
              circuits={circuits}
              panels={panels}
              title={activeEdit ? 'Edit point' : mode === 'walk' ? 'Next point' : 'Add point'}
              submitLabel={activeEdit ? 'Save point' : mode === 'walk' ? 'Add point' : 'Create'}
              showCircuitAndKind={mode !== 'walk'}
              moveMode={mode === 'move'}
              saving={saving}
              onPointChange={changeDraft}
              onMove={() => setMode('move')}
              onCancel={() => {
                if (mode === 'walk') setDraftPoint(null);
                else finishInteraction();
              }}
              onSubmit={saveDraft}
            />
          ) : selectedPoint && mode === 'idle' ? (
            <div
              className="info-card point-details"
              ref={pointDetailsRef}
              role="region"
              aria-label="Selected point"
              tabIndex={-1}
            >
              <h3>{selectedPoint.kind}</h3>
              <p>Circuit: {circuitLabel(selectedPoint.circuit_id)}</p>
              {selectedPoint.label && <p>{selectedPoint.label}</p>}
              <p>Room: {allRooms.find((r) => r.id === selectedPoint.room_id)?.name}</p>
              {selectedCircuit?.verified_description && (
                <p>Confirmed: {selectedCircuit.verified_description}</p>
              )}
              {selectedCircuit?.panel_sticker_text && (
                <p>Panel says: {selectedCircuit.panel_sticker_text}</p>
              )}
              <div className="form-actions">
                <button className="back-to-map" type="button" onClick={() => returnToPoint(selectedPointId)}>Back to map</button>
                <button type="button" onClick={() => beginEdit(false)}>Edit point</button>
                <button type="button" onClick={() => beginEdit(true)}>Move point</button>
                <button type="button" onClick={deleteSelectedPoint}>Delete point</button>
              </div>
            </div>
          ) : selectedPanel && mode === 'idle' ? (
            <div className="info-card panel-details" role="region" aria-label="Selected panel">
              <h3>{selectedPanel.name}</h3>
              <p>
                Location: {selectedPanelRoom
                  ? `${selectedPanelRoom.name} · ${selectedPanelRoom.floor}`
                  : 'not recorded'}
              </p>
              {selectedPanel.amperage && <p>{selectedPanel.amperage}A</p>}
              {selectedPanel.fed_from_panel_id != null && (
                <p>Fed from: {panels.find((panel) => panel.id === selectedPanel.fed_from_panel_id)?.name ?? 'unknown panel'}</p>
              )}
              <h4>Breakers</h4>
              {circuits.filter((circuit) => circuit.panel_id === selectedPanel.id).length > 0 ? (
                <ul>
                  {circuits
                    .filter((circuit) => circuit.panel_id === selectedPanel.id)
                    .map((circuit) => {
                      const pointCount = allPoints.filter((point) => point.circuit_id === circuit.id).length;
                      return (
                        <li key={circuit.id}>
                          <button type="button" onClick={() => chooseFindTarget({ type: 'circuit', id: circuit.id })}>
                            Breaker {circuit.breaker_label}: {circuit.verified_description ?? 'No verified description'} · {pointCount > 0 ? `${pointCount} mapped points` : 'Unmapped'}
                          </button>
                        </li>
                      );
                    })}
                </ul>
              ) : (
                <p>No breakers recorded.</p>
              )}
            </div>
          ) : selectedRoom && mode === 'idle' ? (
            <div className="info-card room-details" role="region" aria-label="Selected room">
              <h3>{selectedRoom.name}</h3>
              <p>Floor: {selectedRoom.floor}</p>
              {editableRectangle(selectedRoom) ? (
                <div className="form-actions">
                  <button type="button" onClick={() => startRoomEdit(selectedRoom)}>
                    Edit room on map
                  </button>
                  <button type="button" onClick={() => startRoomEdit(selectedRoom, true)}>
                    Resize room on map
                  </button>
                </div>
              ) : (
                <>
                  <p>This room uses measured or irregular geometry.</p>
                  <button type="button" onClick={onOpenRooms}>Open geometry editor</button>
                </>
              )}
            </div>
          ) : selectedCircuit && mode === 'idle' ? (
            <div className="info-card breaker-details-card" role="region" aria-label="Selected breaker">
              <h3>{selectedCircuitPanel?.name ?? 'Unknown panel'} · Breaker {selectedCircuit.breaker_label}</h3>
              <p>{selectedCircuit.verified_description ?? 'No verified description.'}</p>
              {selectedCircuitPoints.length === 0 ? (
                <p>Unmapped: this breaker has no points on the floorplan.</p>
              ) : (
                <>
                  <p>{selectedCircuitPoints.length} mapped point{selectedCircuitPoints.length === 1 ? '' : 's'} across {selectedCircuitPointFloors.size} floor{selectedCircuitPointFloors.size === 1 ? '' : 's'}.</p>
                  {Array.from(selectedCircuitPointFloors.entries())
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([pointFloor, points]) => (
                      <section key={pointFloor} aria-label={`${pointFloor} mapped points`}>
                        <h4>{pointFloor}</h4>
                        <ul>
                          {points.map((point) => {
                            const room = allRooms.find((candidate) => candidate.id === point.room_id);
                            return (
                              <li key={point.id}>
                                <button type="button" onClick={() => chooseFindTarget({ type: 'point', id: point.id })}>
                                  {point.label?.trim() || point.kind} · {room?.name ?? 'Unknown room'}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </section>
                    ))}
                </>
              )}
            </div>
          ) : mode === 'add' ? (
            <p>Click the floorplan to choose a location for the new point.</p>
          ) : mode !== 'walk' ? (
            <p>Select a room or point on the floorplan, or a circuit below, to see details.</p>
          ) : null}

          {mode === 'walk' && plan.rooms.length > 0 && (
            <div className="info-card walk-controls">
              <h3>Circuit walk</h3>
              <label>
                Circuit:{' '}
                <select
                  value={walkCircuitId}
                  onChange={(e) => {
                    const circuitId = Number(e.target.value);
                    setWalkCircuitId(circuitId);
                    setSelectedCircuitId(circuitId);
                    changeDraft({ circuit_id: circuitId });
                  }}
                >
                  {circuits.map((circuit) => (
                    <option key={circuit.id} value={circuit.id}>
                      {circuitLabel(circuit.id)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Kind:{' '}
                <input
                  value={walkKind}
                  onChange={(e) => {
                    setWalkKind(e.target.value);
                    changeDraft({ kind: e.target.value });
                  }}
                  list="circuit-walk-kind-options"
                />
                <KindOptions id="circuit-walk-kind-options" />
              </label>
              <p aria-live="polite">
                {walkCreatedIds.length} {walkCreatedIds.length === 1 ? 'point' : 'points'} added this walk.
              </p>
              {!draftPoint && <p>Tap the floorplan to place the next point.</p>}
              <div className="form-actions">
                <button type="button" onClick={undoLastWalkPoint} disabled={walkCreatedIds.length === 0}>
                  Undo last point
                </button>
                <button type="button" onClick={finishWalk}>Finish walk</button>
              </div>
            </div>
          )}

          {mode !== 'walk' && mode !== 'room' && (
            <>
              <h3>Circuits</h3>
              <ul className="circuit-list">
                {panels.map((panel) => (
                  <li key={panel.id}>
                    <strong>{panel.name}</strong>
                    <ul>
                      {circuits
                        .filter((c) => c.panel_id === panel.id)
                        .map((circuit) => (
                          <li key={circuit.id}>
                            <button
                              type="button"
                              className={circuit.id === selectedCircuitId ? 'selected' : ''}
                              onClick={() => chooseFindTarget({ type: 'circuit', id: circuit.id })}
                            >
                              Breaker {circuit.breaker_label}
                              {circuit.verified_description ? ` — ${circuit.verified_description}` : ''}
                            </button>
                          </li>
                        ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function RoomDraftForm({
  draft,
  resizing,
  saving,
  onChange,
  onCancel,
  onSubmit,
}: {
  draft: RoomDraft;
  resizing: boolean;
  saving: boolean;
  onChange: (change: Partial<RoomDraft>) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const rectangle = rectangleFromDraft(draft);
  const valid = rectangle !== null && draft.name.trim() !== '' && draft.floor.trim() !== '';
  return (
    <form
      className="info-card room-draft-form"
      aria-label={draft.roomId == null ? 'Add room' : 'Edit room'}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <h3>{draft.roomId == null ? 'Add room' : `Edit ${draft.name}`}</h3>
      <p className="placement-instruction">
        {draft.roomId == null
          ? 'Drag on the map to draw, or tap to place the default room. Saved rooms stay visible until Save.'
          : resizing
            ? 'Drag the corner handle to resize. Use the fields for exact size. Saved rooms stay visible until Save.'
            : 'Drag the outlined room or tap the map to place it. Saved rooms stay visible until Save.'}
      </p>
      <label>
        Name
        <input
          aria-label="Room name"
          value={draft.name}
          onChange={(event) => onChange({ name: event.target.value })}
          required
        />
      </label>
      <label>
        Floor
        <input
          aria-label="Room floor"
          value={draft.floor}
          onChange={(event) => onChange({ floor: event.target.value })}
          disabled={draft.roomId !== null}
          required
        />
      </label>
      <div className="room-dimensions">
        <label>
          Length (ft)
          <input
            type="number"
            min="0.1"
            step="0.1"
            aria-label="Room length in feet"
            value={draft.length}
            onChange={(event) => onChange({ length: event.target.value })}
            required
          />
        </label>
        <label>
          Width (ft)
          <input
            type="number"
            min="0.1"
            step="0.1"
            aria-label="Room width in feet"
            value={draft.width}
            onChange={(event) => onChange({ width: event.target.value })}
            required
          />
        </label>
      </div>
      {!rectangle && <p role="alert">Enter positive length and width, and valid X/Y coordinates.</p>}
      <details>
        <summary>Fine position (optional)</summary>
        <div className="room-position">
          <label>
            X (ft)
            <input
              type="number"
              step="0.1"
              aria-label="Room X position in feet"
              value={draft.x}
              onChange={(event) => onChange({ x: event.target.value })}
            />
          </label>
          <label>
            Y (ft)
            <input
              type="number"
              step="0.1"
              aria-label="Room Y position in feet"
              value={draft.y}
              onChange={(event) => onChange({ y: event.target.value })}
            />
          </label>
        </div>
      </details>
      <div className="form-actions">
        <button type="submit" disabled={!valid || saving}>
          {saving ? 'Saving…' : 'Save room'}
        </button>
        <button type="button" onClick={onCancel} disabled={saving}>Cancel</button>
      </div>
    </form>
  );
}

function KindOptions({ id }: { id: string }) {
  return (
    <datalist id={id}>
      <option value="outlet" />
      <option value="switch" />
      <option value="light" />
      <option value="appliance" />
      <option value="smoke_detector" />
    </datalist>
  );
}

function PointForm({
  point,
  rooms,
  circuits,
  panels,
  title,
  submitLabel,
  showCircuitAndKind,
  moveMode,
  saving,
  onPointChange,
  onMove,
  onCancel,
  onSubmit,
}: {
  point: PointDraft;
  rooms: Room[];
  circuits: Circuit[];
  panels: Panel[];
  title: string;
  submitLabel: string;
  showCircuitAndKind: boolean;
  moveMode: boolean;
  saving: boolean;
  onPointChange: (change: Partial<PointDraft>) => void;
  onMove: () => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  function submit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit();
  }

  return (
    <form className="info-card point-form" onSubmit={submit}>
      <h3>{title}</h3>
      {moveMode && <p>Tap the floorplan to choose the new location.</p>}
      <label>
        Room:{' '}
        <select value={point.room_id} onChange={(e) => onPointChange({ room_id: Number(e.target.value) })}>
          {rooms.map((room) => (
            <option key={room.id} value={room.id}>
              {room.name}
            </option>
          ))}
        </select>
      </label>
      {showCircuitAndKind && (
        <>
          <label>
            Circuit:{' '}
            <select
              value={point.circuit_id}
              onChange={(e) => onPointChange({ circuit_id: Number(e.target.value) })}
            >
              {circuits.map((circuit) => (
                <option key={circuit.id} value={circuit.id}>
                  {panels.find((panel) => panel.id === circuit.panel_id)?.name} — breaker {circuit.breaker_label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Kind:{' '}
            <input
              value={point.kind}
              onChange={(e) => onPointChange({ kind: e.target.value })}
              list="point-kind-options"
            />
            <KindOptions id="point-kind-options" />
          </label>
        </>
      )}
      <label>
        Label:{' '}
        <input value={point.label ?? ''} onChange={(e) => onPointChange({ label: e.target.value || null })} />
      </label>
      <label>
        X:{' '}
        <input
          type="number"
          step="0.1"
          value={point.x}
          onChange={(e) => onPointChange({ x: Number(e.target.value) })}
        />
      </label>
      <label>
        Y:{' '}
        <input
          type="number"
          step="0.1"
          value={point.y}
          onChange={(e) => onPointChange({ y: Number(e.target.value) })}
        />
      </label>
      <div className="form-actions">
        <button type="submit" disabled={saving || rooms.length === 0 || circuits.length === 0}>
          {saving ? 'Saving…' : submitLabel}
        </button>
        {showCircuitAndKind && !moveMode && submitLabel === 'Save point' && (
          <button type="button" onClick={onMove}>Move on floorplan</button>
        )}
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
