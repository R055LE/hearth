from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from hearth import models, schemas
from hearth.database import get_db

router = APIRouter(prefix="/circuit-points", tags=["circuit-points"])


@router.get("", response_model=list[schemas.CircuitPointRead])
def list_circuit_points(db: Session = Depends(get_db)):
    return db.query(models.CircuitPoint).all()


@router.post("", response_model=schemas.CircuitPointRead, status_code=201)
def create_circuit_point(point: schemas.CircuitPointCreate, db: Session = Depends(get_db)):
    db_point = models.CircuitPoint(**point.model_dump())
    db.add(db_point)
    db.commit()
    db.refresh(db_point)
    return db_point


@router.get("/{point_id}", response_model=schemas.CircuitPointRead)
def get_circuit_point(point_id: int, db: Session = Depends(get_db)):
    db_point = db.get(models.CircuitPoint, point_id)
    if db_point is None:
        raise HTTPException(status_code=404, detail="Circuit point not found")
    return db_point


@router.patch("/{point_id}", response_model=schemas.CircuitPointRead)
def update_circuit_point(
    point_id: int, point: schemas.CircuitPointUpdate, db: Session = Depends(get_db)
):
    db_point = db.get(models.CircuitPoint, point_id)
    if db_point is None:
        raise HTTPException(status_code=404, detail="Circuit point not found")
    for field, value in point.model_dump(exclude_unset=True).items():
        setattr(db_point, field, value)
    db.commit()
    db.refresh(db_point)
    return db_point


@router.delete("/{point_id}", status_code=204)
def delete_circuit_point(point_id: int, db: Session = Depends(get_db)):
    db_point = db.get(models.CircuitPoint, point_id)
    if db_point is None:
        raise HTTPException(status_code=404, detail="Circuit point not found")
    db.delete(db_point)
    db.commit()
