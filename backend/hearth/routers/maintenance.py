from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload

from hearth import models, schemas
from hearth.database import get_db
from hearth.routers._database import commit_or_conflict

router = APIRouter(prefix="/maintenance-tasks", tags=["maintenance"])


def _task_or_404(task_id: int, db: Session) -> models.MaintenanceTask:
    task = db.get(models.MaintenanceTask, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Maintenance task not found")
    return task


@router.get("", response_model=list[schemas.MaintenanceTaskRead])
def list_tasks(db: Session = Depends(get_db)):
    return (
        db.query(models.MaintenanceTask)
        .options(selectinload(models.MaintenanceTask.completions))
        .order_by(models.MaintenanceTask.is_active.desc(), models.MaintenanceTask.due_date)
        .all()
    )


@router.post("", response_model=schemas.MaintenanceTaskRead, status_code=201)
def create_task(task: schemas.MaintenanceTaskCreate, db: Session = Depends(get_db)):
    db_task = models.MaintenanceTask(**task.model_dump())
    db.add(db_task)
    commit_or_conflict(db, "Maintenance task references a missing room")
    db.refresh(db_task)
    return db_task


@router.patch("/{task_id}", response_model=schemas.MaintenanceTaskRead)
def update_task(
    task_id: int,
    task: schemas.MaintenanceTaskUpdate,
    db: Session = Depends(get_db),
):
    db_task = _task_or_404(task_id, db)
    for field, value in task.model_dump(exclude_unset=True).items():
        setattr(db_task, field, value)
    commit_or_conflict(db, "Maintenance task references a missing room")
    db.refresh(db_task)
    return db_task


@router.post(
    "/{task_id}/completions",
    response_model=schemas.MaintenanceTaskRead,
    status_code=201,
)
def complete_task(
    task_id: int,
    completion: schemas.MaintenanceCompletionCreate,
    db: Session = Depends(get_db),
):
    db_task = _task_or_404(task_id, db)
    if not db_task.is_active:
        raise HTTPException(status_code=409, detail="Maintenance task is already closed")

    db.add(
        models.MaintenanceCompletion(
            task=db_task,
            scheduled_for=db_task.due_date,
            completed_on=completion.completed_on,
        )
    )
    if db_task.recurrence_days is None:
        db_task.is_active = False
    else:
        db_task.due_date = completion.completed_on + timedelta(days=db_task.recurrence_days)
    commit_or_conflict(db, "Maintenance completion could not be saved")
    db.refresh(db_task)
    return db_task
