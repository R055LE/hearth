from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from hearth import models, schemas
from hearth.database import get_db

router = APIRouter(prefix="/panels", tags=["panels"])


@router.get("", response_model=list[schemas.PanelRead])
def list_panels(db: Session = Depends(get_db)):
    return db.query(models.Panel).all()


@router.post("", response_model=schemas.PanelRead, status_code=201)
def create_panel(panel: schemas.PanelCreate, db: Session = Depends(get_db)):
    db_panel = models.Panel(**panel.model_dump())
    db.add(db_panel)
    db.commit()
    db.refresh(db_panel)
    return db_panel


@router.get("/{panel_id}", response_model=schemas.PanelRead)
def get_panel(panel_id: int, db: Session = Depends(get_db)):
    db_panel = db.get(models.Panel, panel_id)
    if db_panel is None:
        raise HTTPException(status_code=404, detail="Panel not found")
    return db_panel


@router.patch("/{panel_id}", response_model=schemas.PanelRead)
def update_panel(panel_id: int, panel: schemas.PanelUpdate, db: Session = Depends(get_db)):
    db_panel = db.get(models.Panel, panel_id)
    if db_panel is None:
        raise HTTPException(status_code=404, detail="Panel not found")
    for field, value in panel.model_dump(exclude_unset=True).items():
        setattr(db_panel, field, value)
    db.commit()
    db.refresh(db_panel)
    return db_panel


@router.delete("/{panel_id}", status_code=204)
def delete_panel(panel_id: int, db: Session = Depends(get_db)):
    db_panel = db.get(models.Panel, panel_id)
    if db_panel is None:
        raise HTTPException(status_code=404, detail="Panel not found")
    db.delete(db_panel)
    db.commit()


@router.get("/{panel_id}/circuits", response_model=list[schemas.CircuitRead])
def list_panel_circuits(panel_id: int, db: Session = Depends(get_db)):
    db_panel = db.get(models.Panel, panel_id)
    if db_panel is None:
        raise HTTPException(status_code=404, detail="Panel not found")
    return db_panel.circuits
