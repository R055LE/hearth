from sqlalchemy import text


def test_empty_floor_lifecycle_and_room_creation(client):
    floor = client.post("/floors", json={"name": "  Attic  "})
    assert floor.status_code == 201
    floor = floor.json()
    assert floor["name"] == "Attic"
    assert floor in client.get("/floors").json()
    assert client.get("/floorplan/Attic").json() == {"rooms": [], "circuit_points": []}

    room = client.post(
        "/rooms", json={"name": "Storage", "floor": "Attic", "polygon": [[0, 0]]}
    ).json()
    assert client.delete(f"/floors/{floor['id']}").status_code == 409
    assert client.get(f"/rooms/{room['id']}").json() == room
    assert client.delete(f"/rooms/{room['id']}").status_code == 204
    assert floor in client.get("/floors").json()
    assert client.delete(f"/floors/{floor['id']}").status_code == 204
    assert floor not in client.get("/floors").json()


def test_rename_preserves_room_geometry_and_all_linked_records(client):
    source = {
        "unit": "ft_in",
        "start": {"mode": "absolute", "x": 0, "y": 0, "heading_deg": 0},
        "walls": [{"length_in": 120, "turn": "right"}] * 4,
    }
    rooms = [
        client.post(
            "/rooms",
            json={
                "name": name,
                "floor": "main",
                "polygon": [[0, 0], [10, 0], [10, 10], [0, 10]],
                "measurement_source": source,
            },
        ).json()
        for name in ("Kitchen", "Utility")
    ]
    other_room = client.post(
        "/rooms", json={"name": "Bedroom", "floor": "upper", "polygon": [[0, 0]]}
    ).json()
    panel = client.post("/panels", json={"name": "Panel", "room_id": rooms[0]["id"]}).json()
    circuit = client.post(
        "/circuits", json={"panel_id": panel["id"], "breaker_label": "1"}
    ).json()
    point = client.post(
        "/circuit-points",
        json={
            "circuit_id": circuit["id"], "room_id": rooms[0]["id"],
            "kind": "outlet", "x": 2, "y": 4,
        },
    ).json()
    task = client.post(
        "/maintenance-tasks",
        json={
            "title": "Filter", "room_id": rooms[1]["id"],
            "due_date": "2026-09-01", "recurrence_days": 30,
        },
    ).json()
    client.post(
        f"/maintenance-tasks/{task['id']}/completions", json={"completed_on": "2026-09-02"}
    )
    linked_paths = ("/panels", "/circuits", "/circuit-points", "/maintenance-tasks")
    before = {path: client.get(path).json() for path in linked_paths}
    floor = next(item for item in client.get("/floors").json() if item["name"] == "main")

    response = client.patch(f"/floors/{floor['id']}", json={"name": "Ground"})

    assert response.status_code == 200
    assert response.json() == {**floor, "name": "Ground"}
    assert client.get("/rooms").json() == [
        *[{**room, "floor": "Ground"} for room in rooms], other_room
    ]
    assert {path: client.get(path).json() for path in linked_paths} == before
    assert client.get("/floorplan/Ground").json() == {
        "rooms": [{**room, "floor": "Ground"} for room in rooms], "circuit_points": [point]
    }
    assert client.get("/floorplan/main").json() == {"rooms": [], "circuit_points": []}


def test_blank_and_duplicate_names_leave_floor_and_rooms_unchanged(client):
    floor = client.get("/floors").json()[0]
    room = client.post(
        "/rooms", json={"name": "Kitchen", "floor": "main", "polygon": [[0, 0]]}
    ).json()
    other = client.post("/floors", json={"name": "Upper"}).json()
    for name in ("", "  "):
        assert client.post("/floors", json={"name": name}).status_code == 422
        assert client.patch(f"/floors/{floor['id']}", json={"name": name}).status_code == 422
    assert client.post("/floors", json={"name": "MAIN"}).status_code == 409
    assert client.patch(f"/floors/{floor['id']}", json={"name": "upper"}).status_code == 409
    assert client.get(f"/rooms/{room['id']}").json() == room
    assert client.patch(f"/floors/{floor['id']}", json={"name": "Main"}).status_code == 200
    assert client.get(f"/rooms/{room['id']}").json()["floor"] == "Main"
    assert other in client.get("/floors").json()
    assert client.patch("/floors/999", json={"name": "Missing"}).status_code == 404
    assert client.delete("/floors/999").status_code == 404


def test_rename_rejects_collision_between_legacy_case_variants(client, migrated_engine):
    with migrated_engine.begin() as connection:
        connection.execute(text("INSERT INTO floors (name) VALUES ('Upper'), ('upper')"))
    floor = next(item for item in client.get("/floors").json() if item["name"] == "Upper")

    assert client.patch(f"/floors/{floor['id']}", json={"name": "UPPER"}).status_code == 409


def test_room_api_keeps_floor_records_for_older_clients(client):
    room = client.post(
        "/rooms", json={"name": "Storage", "floor": " basement ", "polygon": [[0, 0]]}
    ).json()
    assert room["floor"] == "basement"
    assert {floor["name"] for floor in client.get("/floors").json()} == {"main", "basement"}
    moved = client.patch(f"/rooms/{room['id']}", json={"floor": "Attic / Storage"})
    assert moved.status_code == 200
    assert client.get("/floorplan/Attic%20%2F%20Storage").json()["rooms"] == [moved.json()]
    assert {floor["name"] for floor in client.get("/floors").json()} == {
        "main", "basement", "Attic / Storage"
    }
    assert client.patch(f"/rooms/{room['id']}", json={"floor": "  "}).status_code == 422
    assert client.get(f"/rooms/{room['id']}").json() == moved.json()
