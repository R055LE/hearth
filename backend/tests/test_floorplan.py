def test_floorplan_returns_rooms_and_points_for_floor_only(client):
    main_room = client.post(
        "/rooms", json={"name": "Kitchen", "floor": "main", "polygon": [[0, 0], [10, 10]]}
    ).json()
    upstairs_room = client.post(
        "/rooms", json={"name": "Bedroom", "floor": "upstairs", "polygon": [[0, 0], [5, 5]]}
    ).json()
    panel = client.post("/panels", json={"name": "Main Panel"}).json()
    circuit = client.post(
        "/circuits", json={"panel_id": panel["id"], "breaker_label": "12"}
    ).json()
    client.post(
        "/circuit-points",
        json={
            "circuit_id": circuit["id"],
            "room_id": main_room["id"],
            "kind": "outlet",
            "x": 1,
            "y": 1,
        },
    )
    client.post(
        "/circuit-points",
        json={
            "circuit_id": circuit["id"],
            "room_id": upstairs_room["id"],
            "kind": "outlet",
            "x": 2,
            "y": 2,
        },
    )

    resp = client.get("/floorplan/main")
    assert resp.status_code == 200
    body = resp.json()
    assert [r["name"] for r in body["rooms"]] == ["Kitchen"]
    assert len(body["circuit_points"]) == 1
    assert body["circuit_points"][0]["room_id"] == main_room["id"]


def test_floorplan_point_resolves_back_to_breaker(client):
    room = client.post(
        "/rooms", json={"name": "Kitchen", "floor": "main", "polygon": [[0, 0]]}
    ).json()
    panel = client.post("/panels", json={"name": "Main Panel"}).json()
    circuit = client.post(
        "/circuits",
        json={"panel_id": panel["id"], "breaker_label": "12", "verified_description": "Kitchen"},
    ).json()
    client.post(
        "/circuit-points",
        json={"circuit_id": circuit["id"], "room_id": room["id"], "kind": "outlet", "x": 1, "y": 1},
    )

    point = client.get("/floorplan/main").json()["circuit_points"][0]
    resolved_circuit = client.get(f"/circuits/{point['circuit_id']}").json()

    assert resolved_circuit["breaker_label"] == "12"
    assert resolved_circuit["verified_description"] == "Kitchen"


def test_floorplan_empty_floor_returns_empty_lists(client):
    resp = client.get("/floorplan/nonexistent")
    assert resp.status_code == 200
    assert resp.json() == {"rooms": [], "circuit_points": []}
