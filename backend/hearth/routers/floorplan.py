from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from hearth import models, schemas
from hearth.database import get_db

router = APIRouter(prefix="/floorplan", tags=["floorplan"])


@router.get("/{floor}", response_model=schemas.FloorplanResponse)
def get_floorplan(floor: str, db: Session = Depends(get_db)):
    rooms = db.query(models.Room).filter(models.Room.floor == floor).all()
    room_ids = [room.id for room in rooms]
    circuit_points = (
        db.query(models.CircuitPoint)
        .filter(models.CircuitPoint.room_id.in_(room_ids))
        .all()
        if room_ids
        else []
    )
    return schemas.FloorplanResponse(rooms=rooms, circuit_points=circuit_points)
