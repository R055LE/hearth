from sqlalchemy import JSON, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from hearth.database import Base


class Room(Base):
    __tablename__ = "rooms"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(nullable=False)
    floor: Mapped[str] = mapped_column(nullable=False)
    # List of [x, y] pairs in the floor's shared coordinate space.
    polygon: Mapped[list[list[float]]] = mapped_column(JSON, nullable=False)
    # Ordered wall-walk + placement that produced `polygon`; validated at the API
    # boundary and kept so a bad measurement is correctable without editing vertices.
    measurement_source: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    panels: Mapped[list["Panel"]] = relationship(back_populates="room")
    circuit_points: Mapped[list["CircuitPoint"]] = relationship(back_populates="room")


class Panel(Base):
    __tablename__ = "panels"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(nullable=False)
    room_id: Mapped[int | None] = mapped_column(ForeignKey("rooms.id"), nullable=True)
    amperage: Mapped[int | None] = mapped_column(nullable=True)
    fed_from_panel_id: Mapped[int | None] = mapped_column(
        ForeignKey("panels.id"), nullable=True
    )

    room: Mapped[Room | None] = relationship(back_populates="panels")
    fed_from: Mapped["Panel | None"] = relationship(remote_side="Panel.id")
    circuits: Mapped[list["Circuit"]] = relationship(
        back_populates="panel", cascade="all, delete-orphan"
    )


class Circuit(Base):
    __tablename__ = "circuits"

    id: Mapped[int] = mapped_column(primary_key=True)
    panel_id: Mapped[int] = mapped_column(ForeignKey("panels.id"), nullable=False)
    breaker_label: Mapped[str] = mapped_column(nullable=False)
    amperage: Mapped[int | None] = mapped_column(nullable=True)
    poles: Mapped[int] = mapped_column(default=1, server_default="1")
    # What the panel sticker literally says, kept even when it's wrong.
    panel_sticker_text: Mapped[str | None] = mapped_column(nullable=True)
    # What's actually confirmed to be on this circuit.
    verified_description: Mapped[str | None] = mapped_column(nullable=True)

    panel: Mapped[Panel] = relationship(back_populates="circuits")
    circuit_points: Mapped[list["CircuitPoint"]] = relationship(
        back_populates="circuit", cascade="all, delete-orphan"
    )


class CircuitPoint(Base):
    __tablename__ = "circuit_points"

    id: Mapped[int] = mapped_column(primary_key=True)
    circuit_id: Mapped[int] = mapped_column(ForeignKey("circuits.id"), nullable=False)
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id"), nullable=False)
    # outlet / switch / light / appliance / smoke_detector / ... — free text, no enum table.
    kind: Mapped[str] = mapped_column(nullable=False)
    x: Mapped[float] = mapped_column(nullable=False)
    y: Mapped[float] = mapped_column(nullable=False)
    label: Mapped[str | None] = mapped_column(nullable=True)

    circuit: Mapped[Circuit] = relationship(back_populates="circuit_points")
    room: Mapped[Room] = relationship(back_populates="circuit_points")
