from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from hearth import models, schemas
from hearth.database import get_db

router = APIRouter(prefix="/circuits", tags=["circuits"])


@router.get("", response_model=list[schemas.CircuitRead])
def list_circuits(db: Session = Depends(get_db)):
    return db.query(models.Circuit).all()


@router.post("", response_model=schemas.CircuitRead, status_code=201)
def create_circuit(circuit: schemas.CircuitCreate, db: Session = Depends(get_db)):
    db_circuit = models.Circuit(**circuit.model_dump())
    db.add(db_circuit)
    db.commit()
    db.refresh(db_circuit)
    return db_circuit


@router.get("/{circuit_id}", response_model=schemas.CircuitRead)
def get_circuit(circuit_id: int, db: Session = Depends(get_db)):
    db_circuit = db.get(models.Circuit, circuit_id)
    if db_circuit is None:
        raise HTTPException(status_code=404, detail="Circuit not found")
    return db_circuit


@router.patch("/{circuit_id}", response_model=schemas.CircuitRead)
def update_circuit(
    circuit_id: int, circuit: schemas.CircuitUpdate, db: Session = Depends(get_db)
):
    db_circuit = db.get(models.Circuit, circuit_id)
    if db_circuit is None:
        raise HTTPException(status_code=404, detail="Circuit not found")
    for field, value in circuit.model_dump(exclude_unset=True).items():
        setattr(db_circuit, field, value)
    db.commit()
    db.refresh(db_circuit)
    return db_circuit


@router.delete("/{circuit_id}", status_code=204)
def delete_circuit(circuit_id: int, db: Session = Depends(get_db)):
    db_circuit = db.get(models.Circuit, circuit_id)
    if db_circuit is None:
        raise HTTPException(status_code=404, detail="Circuit not found")
    db.delete(db_circuit)
    db.commit()
