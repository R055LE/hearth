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
    client.post(
        "/rooms",
        json={"name": "Kitchen", "floor": "main", "polygon": [[0, 0], [10, 0], [10, 10], [0, 10]]},
    )
    client.post(
        "/rooms",
        json={"name": "Garage", "floor": "main", "polygon": [[0, 0], [10, 0], [10, 10], [0, 10]]},
    )

    resp = client.get("/rooms")
    assert resp.status_code == 200
    assert {r["name"] for r in resp.json()} == {"Kitchen", "Garage"}


def test_update_room(client):
    room = client.post(
        "/rooms",
        json={"name": "Kitchen", "floor": "main", "polygon": [[0, 0], [10, 0], [10, 10], [0, 10]]},
    ).json()

    resp = client.patch(f"/rooms/{room['id']}", json={"name": "Kitchen (renovated)"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Kitchen (renovated)"
    assert resp.json()["floor"] == "main"


def test_delete_room(client):
    room = client.post(
        "/rooms",
        json={"name": "Kitchen", "floor": "main", "polygon": [[0, 0], [10, 0], [10, 10], [0, 10]]},
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
        "/rooms",
        json={"name": "Garage", "floor": "main", "polygon": [[0, 0], [10, 0], [10, 10], [0, 10]]},
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
        "/rooms",
        json={"name": "Kitchen", "floor": "main", "polygon": [[0, 0], [10, 0], [10, 10], [0, 10]]},
    ).json()

    resp = client.patch(f"/rooms/{room['id']}", json={"name": None})

    assert resp.status_code == 422


def test_delete_room_with_circuit_point_returns_conflict(client):
    room = client.post(
        "/rooms",
        json={"name": "Kitchen", "floor": "main", "polygon": [[0, 0], [10, 0], [10, 10], [0, 10]]},
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


def _source(x=0, y=0):
    return {
        "unit": "ft_in",
        "start": {"mode": "absolute", "x": x, "y": y, "heading_deg": 0},
        "walls": [{"length_in": 120, "turn": "right"} for _ in range(4)],
    }


@pytest.mark.parametrize(
    "polygon",
    [
        [[0, 0]],
        [[0, 0], [1, 0], [2, 0]],
        [[0, 0], [2, 0], [2, 2], [0, 0]],
        [[0, 0], [2, 2], [0, 2], [2, 0]],
        [[0, 0], [3, 0], [1, 0], [1, 2], [0, 2]],
        [[0, 0], [4, 0], [1, 3], [3, 3], [0, 1]],
    ],
)
def test_invalid_geometry_rejected_on_create_and_patch(client, polygon):
    assert (
        client.post(
            "/rooms", json={"name": "Invalid", "floor": "main", "polygon": polygon}
        ).status_code
        == 422
    )
    room, point = _room_with_point(client)
    assert client.patch(f"/rooms/{room['id']}", json={"polygon": polygon}).status_code == 422
    assert client.get(f"/rooms/{room['id']}").json() == room
    assert client.get(f"/circuit-points/{point['id']}").json() == point


def test_effective_source_pair_and_atomic_rejection(client):
    room, point = _room_with_point(client)
    url = f"/rooms/{room['id']}"
    assert client.patch(url, json={"measurement_source": _source()}).status_code == 200
    original = client.get(url).json()
    for changes in [
        {"polygon": [[20, 0], [30, 0], [30, 10], [20, 10]]},
        {"measurement_source": _source(20)},
        {"measurement_source": None},
    ]:
        assert client.patch(url, json=changes).status_code == 422
        assert client.get(url).json() == original
        assert client.get(f"/circuit-points/{point['id']}").json() == point
    assert client.patch(url, json={"polygon": room["polygon"]}).status_code == 200
    assert client.patch(url, json={"measurement_source": _source()}).status_code == 200
    resp = client.patch(
        url,
        json={"polygon": [[20, 0], [30, 0], [30, 10], [20, 10]], "measurement_source": _source(20)},
    )
    assert resp.status_code == 200
    moved = client.get(f"/circuit-points/{point['id']}").json()
    assert moved == {**point, "x": 22}
    assert resp.json()["name"] == room["name"]
    assert resp.json()["floor"] == room["floor"]


def test_anchor_validation_and_metadata_only_legacy_edits(client, migrated_engine):
    from sqlalchemy.orm import Session

    from hearth import models

    anchor, _ = _room_with_point(client)
    source = _source()
    source["start"] = {
        "mode": "anchor",
        "anchor_room_id": anchor["id"],
        "wall_index": 0,
        "corner": "start",
        "offset_in": 0,
        "heading_deg": 0,
    }
    created = client.post(
        "/rooms",
        json={
            "name": "Anchored",
            "floor": "main",
            "polygon": anchor["polygon"],
            "measurement_source": source,
        },
    )
    assert created.status_code == 201
    room = created.json()
    url = f"/rooms/{room['id']}"
    for change in [{"anchor_room_id": room["id"]}, {"anchor_room_id": 999}, {"wall_index": 4}]:
        invalid = {**source, "start": {**source["start"], **change}}
        assert client.patch(url, json={"measurement_source": invalid}).status_code == 422
    assert client.patch(url, json={"floor": "upper", "polygon": room["polygon"]}).status_code == 422
    # Legacy mismatches are readable and metadata stays repairable without a migration.
    with Session(migrated_engine) as db:
        db.get(models.Room, anchor["id"]).polygon = [[20, 0], [30, 0], [30, 10], [20, 10]]
        db.commit()
    assert client.patch(url, json={"name": "Still editable"}).status_code == 200
    assert client.patch(url, json={"polygon": room["polygon"]}).status_code == 422
    assert client.patch(url, json={"measurement_source": _source()}).status_code == 200
    with Session(migrated_engine) as db:
        legacy = db.get(models.Room, room["id"])
        legacy.polygon = [[0, 0]]
        db.commit()
    assert client.patch(url, json={"floor": "upper"}).status_code == 200


def test_source_projection_precision_closure_and_nonfinite_inputs(client):
    source = _source(-0.05, 0.025)
    source["walls"] = [{"length_in": 120.123456789, "turn": {"deg": 90}} for _ in range(4)]
    polygon = [[0, 0], [10, 0], [10, 10], [-0.1, 10]]
    created = client.post(
        "/rooms",
        json={"name": "Exact", "floor": "main", "polygon": polygon, "measurement_source": source},
    )
    assert created.status_code == 201
    assert created.json()["measurement_source"] == source
    source["walls"][-1]["length_in"] -= 2
    assert (
        client.patch(
            f"/rooms/{created.json()['id']}", json={"measurement_source": source}
        ).status_code
        == 422
    )
    for value in ["NaN", "Infinity", "-Infinity"]:
        invalid = _source()
        invalid["walls"][0]["length_in"] = value
        assert (
            client.post(
                "/rooms",
                json={
                    "name": "Bad",
                    "floor": "main",
                    "polygon": polygon,
                    "measurement_source": invalid,
                },
            ).status_code
            == 422
        )
        assert (
            client.patch(
                f"/rooms/{created.json()['id']}", json={"polygon": [[value, 0], [10, 0], [0, 10]]}
            ).status_code
            == 422
        )


def test_stranded_point_rejects_polygon_and_source_together(client):
    room, point = _room_with_point(client, [[0, 0], [10, 0], [10, 10], [5, 5], [0, 10]])
    replacement = _source()
    replacement["walls"] = [{"length_in": 12, "turn": "right"} for _ in range(4)]
    response = client.patch(
        f"/rooms/{room['id']}",
        json={"polygon": [[0, 0], [1, 0], [1, 1], [0, 1]], "measurement_source": replacement},
    )
    assert response.status_code == 409
    assert client.get(f"/rooms/{room['id']}").json() == room
    assert client.get(f"/circuit-points/{point['id']}").json() == point


def test_projection_matches_javascript_at_rotated_negative_half_steps(client):
    source = _source(-10.05, -10.05)
    source["start"]["heading_deg"] = 315
    source["walls"] = [{"length_in": 12, "turn": "right"} for _ in range(4)]
    response = client.post(
        "/rooms",
        json={
            "name": "Rotated",
            "floor": "main",
            "polygon": [[-10, -10], [-9.3, -10.8], [-8.6, -10.1], [-9.3, -9.3]],
            "measurement_source": source,
        },
    )
    assert response.status_code == 201
    assert response.json()["measurement_source"] == source


def test_diagonal_anchor_projection_matches_editor_half_steps(client):
    anchor = client.post(
        "/rooms",
        json={
            "name": "Diagonal",
            "floor": "main",
            "polygon": [[0, 0], [3, 4], [0, 4]],
        },
    ).json()
    source = _source()
    source["start"] = {
        "mode": "anchor",
        "anchor_room_id": anchor["id"],
        "wall_index": 0,
        "corner": "start",
        "offset_in": 3,
        "heading_deg": 0,
    }
    source["walls"] = [{"length_in": 12, "turn": "right"} for _ in range(4)]
    response = client.post(
        "/rooms",
        json={
            "name": "Attached",
            "floor": "main",
            "polygon": [[0.2, 0.2], [1.2, 0.2], [1.2, 1.2], [0.1, 1.2]],
            "measurement_source": source,
        },
    )
    assert response.status_code == 201
    assert response.json()["measurement_source"] == source


@pytest.mark.parametrize(
    "field", ["x", "y", "heading_deg", "length_in", "turn", "offset_in", "polygon"]
)
def test_numeric_overflow_returns_serializable_422_without_mutation(client, field):
    import json

    room, point = _room_with_point(client)
    source = _source()
    if field == "length_in":
        source["walls"][0][field] = "OVERFLOW"
    elif field == "turn":
        source["walls"][0]["turn"] = {"deg": "OVERFLOW"}
    elif field == "offset_in":
        anchor = client.post(
            "/rooms",
            json={
                "name": "Anchor",
                "floor": "main",
                "polygon": room["polygon"],
            },
        ).json()
        source["start"] = {
            "mode": "anchor",
            "anchor_room_id": anchor["id"],
            "wall_index": 0,
            "corner": "start",
            "offset_in": "OVERFLOW",
            "heading_deg": 0,
        }
    elif field != "polygon":
        source["start"][field] = "OVERFLOW"
    changes = {"measurement_source": source}
    if field == "polygon":
        changes = {"polygon": [["OVERFLOW", 0], [10, 0], [10, 10], [0, 10]]}
    for overflow in ("1e999", "-1e999"):
        body = json.dumps(changes).replace('"OVERFLOW"', overflow)
        response = client.patch(
            f"/rooms/{room['id']}", content=body, headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 422
        assert response.json()["detail"]
        assert client.get(f"/rooms/{room['id']}").json() == room
        assert client.get(f"/circuit-points/{point['id']}").json() == point
        creation = {"name": "Invalid", "floor": "main", "polygon": room["polygon"], **changes}
        response = client.post(
            "/rooms",
            content=json.dumps(creation).replace('"OVERFLOW"', overflow),
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 422
