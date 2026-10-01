from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from hearth import models, schemas
from hearth.database import get_db
from hearth.routers._database import commit_or_conflict

router = APIRouter(prefix="/floors", tags=["floors"])


def matching_floor(db: Session, name: str, exclude_id: int | None = None) -> models.Floor | None:
    query = db.query(models.Floor)
    if exclude_id is not None:
        query = query.filter(models.Floor.id != exclude_id)
    floors = query.all()
    return next((floor for floor in floors if floor.name == name), None) or next(
        (floor for floor in floors if floor.name.casefold() == name.casefold()), None
    )


def ensure_floor(db: Session, name: str) -> str:
    if not name.strip():
        raise HTTPException(status_code=422, detail="Floor name must not be blank")
    exact = db.query(models.Floor).filter(models.Floor.name == name).first()
    if exact:
        return exact.name
    name = name.strip()
    existing = matching_floor(db, name)
    if existing:
        return existing.name
    db.add(models.Floor(name=name))
    return name


@router.get("", response_model=list[schemas.FloorRead])
def list_floors(db: Session = Depends(get_db)):
    return db.query(models.Floor).order_by(models.Floor.name).all()


@router.post("", response_model=schemas.FloorRead, status_code=201)
def create_floor(floor: schemas.FloorWrite, db: Session = Depends(get_db)):
    if matching_floor(db, floor.name):
        raise HTTPException(status_code=409, detail="Floor name already exists")
    db_floor = models.Floor(name=floor.name)
    db.add(db_floor)
    commit_or_conflict(db, "Floor name already exists")
    db.refresh(db_floor)
    return db_floor


@router.patch("/{floor_id}", response_model=schemas.FloorRead)
def rename_floor(floor_id: int, floor: schemas.FloorWrite, db: Session = Depends(get_db)):
    db_floor = db.get(models.Floor, floor_id)
    if db_floor is None:
        raise HTTPException(status_code=404, detail="Floor not found")
    if floor.name != db_floor.name:
        if matching_floor(db, floor.name, exclude_id=floor_id):
            raise HTTPException(status_code=409, detail="Floor name already exists")
        old_name = db_floor.name
        db.query(models.Room).filter(models.Room.floor == old_name).update(
            {models.Room.floor: floor.name}, synchronize_session="fetch"
        )
        db_floor.name = floor.name
        commit_or_conflict(db, "Floor could not be renamed")
        db.refresh(db_floor)
    return db_floor


@router.delete("/{floor_id}", status_code=204)
def delete_floor(floor_id: int, db: Session = Depends(get_db)):
    db_floor = db.get(models.Floor, floor_id)
    if db_floor is None:
        raise HTTPException(status_code=404, detail="Floor not found")
    if db.query(models.Room).filter(models.Room.floor == db_floor.name).first():
        raise HTTPException(status_code=409, detail="Move or delete this floor's rooms first")
    db.delete(db_floor)
    commit_or_conflict(db, "Floor could not be removed")
