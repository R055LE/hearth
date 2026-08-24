from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from hearth import models, schemas
from hearth.database import get_db
from hearth.routers._database import commit_or_conflict

router = APIRouter(prefix="/panels", tags=["panels"])


def _feed_would_create_cycle(
    db: Session, panel_id: int, fed_from_panel_id: int
) -> bool:
    current_id: int | None = fed_from_panel_id
    visited: set[int] = set()
    while current_id is not None:
        if current_id == panel_id or current_id in visited:
            return True
        visited.add(current_id)
        current = db.get(models.Panel, current_id)
        if current is None:
            return False
        current_id = current.fed_from_panel_id
    return False


@router.get("", response_model=list[schemas.PanelRead])
def list_panels(db: Session = Depends(get_db)):
    return db.query(models.Panel).all()


@router.post("", response_model=schemas.PanelRead, status_code=201)
def create_panel(panel: schemas.PanelCreate, db: Session = Depends(get_db)):
    db_panel = models.Panel(**panel.model_dump())
    db.add(db_panel)
    commit_or_conflict(db, "Panel references a missing room or upstream panel")
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
    updates = panel.model_dump(exclude_unset=True)
    fed_from_panel_id = updates.get("fed_from_panel_id")
    if fed_from_panel_id is not None and _feed_would_create_cycle(
        db, panel_id, fed_from_panel_id
    ):
        raise HTTPException(
            status_code=409,
            detail="Panel feed relationship would create a cycle",
        )
    for field, value in updates.items():
        setattr(db_panel, field, value)
    commit_or_conflict(db, "Panel references a missing room or upstream panel")
    db.refresh(db_panel)
    return db_panel


@router.delete("/{panel_id}", status_code=204)
def delete_panel(panel_id: int, db: Session = Depends(get_db)):
    db_panel = db.get(models.Panel, panel_id)
    if db_panel is None:
        raise HTTPException(status_code=404, detail="Panel not found")
    if db.query(models.Panel).filter(models.Panel.fed_from_panel_id == panel_id).first():
        raise HTTPException(status_code=409, detail="Panel still feeds another panel")
    db.delete(db_panel)
    commit_or_conflict(db, "Panel is still referenced")


@router.get("/{panel_id}/circuits", response_model=list[schemas.CircuitRead])
def list_panel_circuits(panel_id: int, db: Session = Depends(get_db)):
    db_panel = db.get(models.Panel, panel_id)
    if db_panel is None:
        raise HTTPException(status_code=404, detail="Panel not found")
    return db_panel.circuits
