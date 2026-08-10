from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Point = tuple[float, float]


class AbsoluteStart(BaseModel):
    mode: Literal["absolute"]
    x: float
    y: float
    heading_deg: float


class AnchorStart(BaseModel):
    mode: Literal["anchor"]
    anchor_room_id: int
    wall_index: int = Field(ge=0)
    corner: Literal["start", "end"]
    offset_in: float
    heading_deg: float


MeasurementStart = Annotated[AbsoluteStart | AnchorStart, Field(discriminator="mode")]


class CustomTurn(BaseModel):
    deg: float


class MeasurementWall(BaseModel):
    length_in: float = Field(gt=0)
    turn: Literal["left", "right", "straight"] | CustomTurn


class MeasurementSource(BaseModel):
    unit: Literal["ft_in"]
    start: MeasurementStart
    walls: list[MeasurementWall] = Field(min_length=3)


def _required(value):
    if value is None:
        raise ValueError("required field must not be null")
    return value


class RoomBase(BaseModel):
    name: str
    floor: str
    polygon: list[Point]
    measurement_source: MeasurementSource | None = None


class RoomCreate(RoomBase):
    pass


class RoomUpdate(BaseModel):
    name: str | None = None
    floor: str | None = None
    polygon: list[Point] | None = None
    measurement_source: MeasurementSource | None = None

    _required_fields = field_validator("name", "floor", "polygon")(_required)


class RoomRead(RoomBase):
    model_config = ConfigDict(from_attributes=True)

    id: int


class PanelBase(BaseModel):
    name: str
    room_id: int | None = None
    amperage: int | None = None
    fed_from_panel_id: int | None = None


class PanelCreate(PanelBase):
    pass


class PanelUpdate(BaseModel):
    name: str | None = None
    room_id: int | None = None
    amperage: int | None = None
    fed_from_panel_id: int | None = None

    _required_fields = field_validator("name")(_required)


class PanelRead(PanelBase):
    model_config = ConfigDict(from_attributes=True)

    id: int


class CircuitBase(BaseModel):
    panel_id: int
    breaker_label: str
    amperage: int | None = None
    poles: int = 1
    panel_sticker_text: str | None = None
    verified_description: str | None = None


class CircuitCreate(CircuitBase):
    pass


class CircuitUpdate(BaseModel):
    panel_id: int | None = None
    breaker_label: str | None = None
    amperage: int | None = None
    poles: int | None = None
    panel_sticker_text: str | None = None
    verified_description: str | None = None

    _required_fields = field_validator("panel_id", "breaker_label", "poles")(_required)


class CircuitRead(CircuitBase):
    model_config = ConfigDict(from_attributes=True)

    id: int


class CircuitPointBase(BaseModel):
    circuit_id: int
    room_id: int
    kind: str
    x: float
    y: float
    label: str | None = None


class CircuitPointCreate(CircuitPointBase):
    pass


class CircuitPointUpdate(BaseModel):
    circuit_id: int | None = None
    room_id: int | None = None
    kind: str | None = None
    x: float | None = None
    y: float | None = None
    label: str | None = None

    _required_fields = field_validator("circuit_id", "room_id", "kind", "x", "y")(_required)


class CircuitPointRead(CircuitPointBase):
    model_config = ConfigDict(from_attributes=True)

    id: int


class FloorplanResponse(BaseModel):
    rooms: list[RoomRead]
    circuit_points: list[CircuitPointRead]
