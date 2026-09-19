import pytest


def test_create_and_get_room(client):
    resp = client.post(
        "/rooms",
        json={"name": "Kitchen", "floor": "main", "polygon": [[0, 0], [10, 0], [10, 10], [0, 10]]},
    )
    assert resp.status_code == 201
    room = resp.json()
    assert room["name"] == "Kitchen"
    assert room["polygon"] == [[0, 0], [10, 0], [10, 10], [0, 10]]

    resp = client.get(f"/rooms/{room['id']}")
    assert resp.status_code == 200
    assert resp.json()["name"] == "Kitchen"


def test_list_rooms(client):
    client.post("/rooms", json={"name": "Kitchen", "floor": "main", "polygon": [[0, 0]]})
    client.post("/rooms", json={"name": "Garage", "floor": "main", "polygon": [[0, 0]]})

    resp = client.get("/rooms")
    assert resp.status_code == 200
    assert {r["name"] for r in resp.json()} == {"Kitchen", "Garage"}


def test_update_room(client):
    room = client.post(
        "/rooms", json={"name": "Kitchen", "floor": "main", "polygon": [[0, 0]]}
    ).json()

    resp = client.patch(f"/rooms/{room['id']}", json={"name": "Kitchen (renovated)"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Kitchen (renovated)"
    assert resp.json()["floor"] == "main"


def test_delete_room(client):
    room = client.post(
        "/rooms", json={"name": "Kitchen", "floor": "main", "polygon": [[0, 0]]}
    ).json()

    resp = client.delete(f"/rooms/{room['id']}")
    assert resp.status_code == 204

    resp = client.get(f"/rooms/{room['id']}")
    assert resp.status_code == 404


def test_get_missing_room_404(client):
    resp = client.get("/rooms/999")
    assert resp.status_code == 404


def test_create_room_with_measurement_source(client):
    source = {
        "unit": "ft_in",
        "start": {"mode": "absolute", "x": 0, "y": 0, "heading_deg": 0},
        "walls": [
            {"length_in": 120, "turn": "right"},
            {"length_in": 120, "turn": "right"},
            {"length_in": 120, "turn": "right"},
            {"length_in": 120, "turn": "right"},
        ],
    }
    resp = client.post(
        "/rooms",
        json={
            "name": "Kitchen",
            "floor": "main",
            "polygon": [[0, 0], [10, 0], [10, 10], [0, 10]],
            "measurement_source": source,
        },
    )
    assert resp.status_code == 201
    room = resp.json()
    assert room["measurement_source"] == source

    resp = client.get(f"/rooms/{room['id']}")
    assert resp.json()["measurement_source"] == source


def test_create_room_without_measurement_source(client):
    resp = client.post(
        "/rooms", json={"name": "Garage", "floor": "main", "polygon": [[0, 0]]}
    )
    assert resp.status_code == 201
    assert resp.json()["measurement_source"] is None


def test_rejects_malformed_measurement_source(client):
    resp = client.post(
        "/rooms",
        json={
            "name": "Garage",
            "floor": "main",
            "polygon": [[0, 0], [10, 0], [10, 10]],
            "measurement_source": {},
        },
    )

    assert resp.status_code == 422


def test_patch_rejects_null_required_field(client):
    room = client.post(
        "/rooms", json={"name": "Kitchen", "floor": "main", "polygon": [[0, 0]]}
    ).json()

    resp = client.patch(f"/rooms/{room['id']}", json={"name": None})

    assert resp.status_code == 422


def test_delete_room_with_circuit_point_returns_conflict(client):
    room = client.post(
        "/rooms", json={"name": "Kitchen", "floor": "main", "polygon": [[0, 0]]}
    ).json()
    panel = client.post("/panels", json={"name": "Main Panel"}).json()
    circuit = client.post(
        "/circuits", json={"panel_id": panel["id"], "breaker_label": "1"}
    ).json()
    client.post(
        "/circuit-points",
        json={
            "circuit_id": circuit["id"],
            "room_id": room["id"],
            "kind": "outlet",
            "x": 1,
            "y": 1,
        },
    )

    resp = client.delete(f"/rooms/{room['id']}")

    assert resp.status_code == 409
    assert resp.json()["detail"] == "Room still has circuit points"


def _room_with_point(client, polygon=None):
    room = client.post(
        "/rooms",
        json={
            "name": "Kitchen",
            "floor": "main",
            "polygon": polygon or [[0, 0], [10, 0], [10, 10], [0, 10]],
        },
    ).json()
    panel = client.post("/panels", json={"name": "Main Panel"}).json()
    circuit = client.post(
        "/circuits", json={"panel_id": panel["id"], "breaker_label": "1"}
    ).json()
    point = client.post(
        "/circuit-points",
        json={
            "circuit_id": circuit["id"],
            "room_id": room["id"],
            "kind": "outlet",
            "x": 2,
            "y": 4,
        },
    ).json()
    return room, point


def test_moving_room_moves_mapped_points_by_same_offset(client):
    room, point = _room_with_point(client)

    resp = client.patch(
        f"/rooms/{room['id']}",
        json={"polygon": [[20, 5], [30, 5], [30, 15], [20, 15]]},
    )

    assert resp.status_code == 200
    moved = client.get(f"/circuit-points/{point['id']}").json()
    assert (moved["x"], moved["y"]) == (22, 9)


def test_resizing_rectangle_scales_mapped_points_relative_to_room(client):
    room, point = _room_with_point(client)

    resp = client.patch(
        f"/rooms/{room['id']}",
        json={"polygon": [[0, 0], [20, 0], [20, 5], [0, 5]]},
    )

    assert resp.status_code == 200
    moved = client.get(f"/circuit-points/{point['id']}").json()
    assert (moved["x"], moved["y"]) == (4, 2)


def test_resizing_wall_walk_rectangle_tolerates_cardinal_float_noise(client):
    room, point = _room_with_point(
        client,
        [[0, 0], [10, 0], [10.0000000001, 10], [0.0000000001, 10]],
    )

    resp = client.patch(
        f"/rooms/{room['id']}",
        json={"polygon": [[0, 0], [20, 0], [20, 5], [0, 5]]},
    )

    assert resp.status_code == 200
    moved = client.get(f"/circuit-points/{point['id']}").json()
    assert moved["x"] == pytest.approx(4)
    assert moved["y"] == pytest.approx(2)


def test_rejects_shape_change_that_would_orphan_mapped_point(client):
    room, point = _room_with_point(
        client, [[0, 0], [10, 0], [10, 10], [5, 5], [0, 10]]
    )

    resp = client.patch(
        f"/rooms/{room['id']}",
        json={"polygon": [[0, 0], [1, 0], [1, 1], [0, 1]]},
    )

    assert resp.status_code == 409
    assert "mapped circuit point" in resp.json()["detail"]
    unchanged = client.get(f"/circuit-points/{point['id']}").json()
    assert (unchanged["x"], unchanged["y"]) == (2, 4)
