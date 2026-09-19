from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from hearth import models, schemas
from hearth.database import get_db
from hearth.routers._database import commit_or_conflict

router = APIRouter(prefix="/rooms", tags=["rooms"])


def _point_in_polygon(x: float, y: float, polygon: list[list[float]]) -> bool:
    inside = False
    for index, (end_x, end_y) in enumerate(polygon):
        start_x, start_y = polygon[index - 1]
        cross = (x - start_x) * (end_y - start_y) - (y - start_y) * (end_x - start_x)
        if abs(cross) < 1e-9 and min(start_x, end_x) <= x <= max(start_x, end_x) and min(
            start_y, end_y
        ) <= y <= max(start_y, end_y):
            return True
        if (start_y > y) != (end_y > y) and x < (end_x - start_x) * (y - start_y) / (
            end_y - start_y
        ) + start_x:
            inside = not inside
    return inside


def _rectangle_bounds(polygon: list[list[float]]) -> tuple[float, float, float, float] | None:
    if len(polygon) != 4:
        return None
    epsilon = 1e-6
    min_x = min(point[0] for point in polygon)
    max_x = max(point[0] for point in polygon)
    min_y = min(point[1] for point in polygon)
    max_y = max(point[1] for point in polygon)
    if max_x - min_x <= epsilon or max_y - min_y <= epsilon:
        return None
    expected = [
        (min_x, min_y),
        (max_x, min_y),
        (max_x, max_y),
        (min_x, max_y),
    ]
    matched: set[int] = set()
    for x, y in polygon:
        corner = next(
            (
                index
                for index, (corner_x, corner_y) in enumerate(expected)
                if index not in matched
                and abs(x - corner_x) <= epsilon
                and abs(y - corner_y) <= epsilon
            ),
            None,
        )
        if corner is None:
            return None
        matched.add(corner)
    return min_x, min_y, max_x, max_y


def _translation(
    old_polygon: list[list[float]], new_polygon: list[list[float]]
) -> tuple[float, float] | None:
    if len(old_polygon) != len(new_polygon) or not old_polygon:
        return None
    dx = new_polygon[0][0] - old_polygon[0][0]
    dy = new_polygon[0][1] - old_polygon[0][1]
    if all(
        abs((new_x - old_x) - dx) < 1e-9 and abs((new_y - old_y) - dy) < 1e-9
        for (old_x, old_y), (new_x, new_y) in zip(old_polygon, new_polygon, strict=True)
    ):
        return dx, dy
    return None


def _preserve_circuit_points(db_room: models.Room, new_polygon: list[list[float]]) -> None:
    if not db_room.circuit_points or db_room.polygon == new_polygon:
        return

    translation = _translation(db_room.polygon, new_polygon)
    if translation:
        dx, dy = translation
        for point in db_room.circuit_points:
            point.x += dx
            point.y += dy
        return

    old_bounds = _rectangle_bounds(db_room.polygon)
    new_bounds = _rectangle_bounds(new_polygon)
    if old_bounds and new_bounds:
        old_min_x, old_min_y, old_max_x, old_max_y = old_bounds
        new_min_x, new_min_y, new_max_x, new_max_y = new_bounds
        for point in db_room.circuit_points:
            x_ratio = (point.x - old_min_x) / (old_max_x - old_min_x)
            y_ratio = (point.y - old_min_y) / (old_max_y - old_min_y)
            point.x = new_min_x + x_ratio * (new_max_x - new_min_x)
            point.y = new_min_y + y_ratio * (new_max_y - new_min_y)
        return

    point_outside = any(
        not _point_in_polygon(point.x, point.y, new_polygon)
        for point in db_room.circuit_points
    )
    if point_outside:
        raise HTTPException(
            status_code=409,
            detail="Room shape would leave a mapped circuit point outside the room",
        )


@router.get("", response_model=list[schemas.RoomRead])
def list_rooms(db: Session = Depends(get_db)):
    return db.query(models.Room).all()


@router.post("", response_model=schemas.RoomRead, status_code=201)
def create_room(room: schemas.RoomCreate, db: Session = Depends(get_db)):
    db_room = models.Room(**room.model_dump())
    db.add(db_room)
    commit_or_conflict(db, "Room could not be created")
    db.refresh(db_room)
    return db_room


@router.get("/{room_id}", response_model=schemas.RoomRead)
def get_room(room_id: int, db: Session = Depends(get_db)):
    db_room = db.get(models.Room, room_id)
    if db_room is None:
        raise HTTPException(status_code=404, detail="Room not found")
    return db_room


@router.patch("/{room_id}", response_model=schemas.RoomRead)
def update_room(room_id: int, room: schemas.RoomUpdate, db: Session = Depends(get_db)):
    db_room = db.get(models.Room, room_id)
    if db_room is None:
        raise HTTPException(status_code=404, detail="Room not found")
    changes = room.model_dump(exclude_unset=True)
    if "polygon" in changes:
        _preserve_circuit_points(db_room, changes["polygon"])
    for field, value in changes.items():
        setattr(db_room, field, value)
    commit_or_conflict(db, "Room could not be updated")
    db.refresh(db_room)
    return db_room


@router.delete("/{room_id}", status_code=204)
def delete_room(room_id: int, db: Session = Depends(get_db)):
    db_room = db.get(models.Room, room_id)
    if db_room is None:
        raise HTTPException(status_code=404, detail="Room not found")
    if db.query(models.CircuitPoint).filter(models.CircuitPoint.room_id == room_id).first():
        raise HTTPException(status_code=409, detail="Room still has circuit points")
    db.delete(db_room)
    commit_or_conflict(db, "Room is still referenced")
