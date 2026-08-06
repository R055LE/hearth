from pydantic import BaseModel, ConfigDict

Point = tuple[float, float]


class RoomBase(BaseModel):
    name: str
    floor: str
    polygon: list[Point]
    measurement_source: dict | None = None


class RoomCreate(RoomBase):
    pass


class RoomUpdate(BaseModel):
    name: str | None = None
    floor: str | None = None
    polygon: list[Point] | None = None
    measurement_source: dict | None = None


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


class CircuitPointRead(CircuitPointBase):
    model_config = ConfigDict(from_attributes=True)

    id: int


class FloorplanResponse(BaseModel):
    rooms: list[RoomRead]
    circuit_points: list[CircuitPointRead]
