"""Validate a room's stored outline against its measured wall walk."""

import math

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.orm import Session

from hearth import models
from hearth.schemas import MeasurementSource


def _reject(message: str):
    raise HTTPException(status_code=422, detail=message)


def validate_polygon(polygon):
    if len(polygon) < 3 or any(not math.isfinite(n) for p in polygon for n in p):
        _reject("Room polygon needs at least three finite vertices")
    if len({tuple(p) for p in polygon}) != len(polygon):
        _reject("Room polygon must not repeat vertices or edges; closure is implicit")

    def cross(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

    def on_segment(a, b, p):
        return abs(cross(a, b, p)) < 1e-9 and all(
            min(a[i], b[i]) <= p[i] <= max(a[i], b[i]) for i in (0, 1)
        )

    edges = list(zip(polygon, polygon[1:] + polygon[:1], strict=True))
    area = sum(a[0] * b[1] - b[0] * a[1] for a, b in edges)
    if not math.isfinite(area) or abs(area) < 1e-9:
        _reject("Room polygon must have nonzero finite area")
    for i, (a, b) in enumerate(edges):
        c = edges[(i + 1) % len(edges)][1]
        if on_segment(a, b, c) or on_segment(b, c, a):
            _reject("Room polygon has overlapping edges")
        for j in range(i + 1, len(edges)):
            if j == i + 1 or (i == 0 and j == len(edges) - 1):
                continue
            c, d = edges[j]
            if (cross(a, b, c) * cross(a, b, d) < 0 and cross(c, d, a) * cross(c, d, b) < 0) or any(
                (
                    on_segment(a, b, c),
                    on_segment(a, b, d),
                    on_segment(c, d, a),
                    on_segment(c, d, b),
                )
            ):
                _reject("Room polygon must not self-intersect")


def validate_room_geometry(db: Session, polygon, source, floor: str, room_id=None):
    validate_polygon(polygon)
    if source is None:
        return
    try:
        source = MeasurementSource.model_validate(source).model_dump()
    except ValidationError:
        _reject("Stored measurements are invalid; supply a valid replacement")
    start = source["start"]
    heading = start["heading_deg"]
    if start["mode"] == "absolute":
        x, y = start["x"], start["y"]
    else:
        anchor = db.get(models.Room, start["anchor_room_id"])
        index = start["wall_index"]
        if (
            anchor is None
            or anchor.id == room_id
            or anchor.floor != floor
            or not 0 <= index < len(anchor.polygon)
        ):
            _reject(
                "Anchor must reference a different existing room on the same floor and valid wall"
            )
        a, b = anchor.polygon[index], anchor.polygon[(index + 1) % len(anchor.polygon)]
        if start["corner"] == "end":
            a, b = b, a
        distance = math.dist(a, b)
        if not math.isfinite(distance) or distance <= 0:
            _reject("Anchor wall must have finite positive length")
        offset = start["offset_in"] / 12
        x, y = (a[i] + (b[i] - a[i]) / distance * offset for i in (0, 1))
    if not all(math.isfinite(n) for n in (x, y, heading)):
        _reject("Placement must be finite")
    origin = (x, y)
    projected = []
    for wall in source["walls"]:
        length = wall["length_in"] / 12
        turn = wall["turn"]
        angle = (
            {"left": -90, "right": 90, "straight": 0}[turn]
            if isinstance(turn, str)
            else turn["deg"]
        )
        if not all(math.isfinite(n) for n in (length, angle)) or length <= 0:
            _reject("Wall lengths must be finite and positive; turns must be finite")
        if not all(math.isfinite(n * 10) for n in (x, y)):
            _reject("Projected coordinates must be finite")
        # Match JavaScript Math.round, including its behavior at negative half steps.
        projected.append([math.floor(x * 10 + 0.5) / 10, math.floor(y * 10 + 0.5) / 10])
        radians = (heading * math.pi) / 180
        if not math.isfinite(radians):
            _reject("Wall heading must project to a finite angle")
        x += math.cos(radians) * length
        y += math.sin(radians) * length
        heading += angle
        if not all(math.isfinite(n) for n in (x, y, heading)):
            _reject("Wall walk must have finite coordinates")
    if math.dist(origin, (x, y)) > 1 / 12:
        _reject("Measured walls must close within one inch")
    if len(polygon) != len(projected) or any(
        abs(a - b) > 1e-9
        for actual, expected in zip(polygon, projected, strict=True)
        for a, b in zip(actual, expected, strict=True)
    ):
        _reject("Room polygon and measurement source disagree; supply a matching pair")
