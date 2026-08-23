from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from hearth import models, schemas
from hearth.database import get_db
from hearth.routers._database import commit_or_conflict

router = APIRouter(prefix="/rooms", tags=["rooms"])


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
    for field, value in room.model_dump(exclude_unset=True).items():
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
