def _make_panel(client, **overrides):
    payload = {"name": "Main Panel", "amperage": 200}
    payload.update(overrides)
    return client.post("/panels", json=payload).json()


def test_create_panel_and_circuit(client):
    panel = _make_panel(client)

    resp = client.post(
        "/circuits",
        json={
            "panel_id": panel["id"],
            "breaker_label": "12",
            "amperage": 20,
            "panel_sticker_text": "Kitchen",
            "verified_description": "Kitchen outlets + fridge",
        },
    )
    assert resp.status_code == 201
    circuit = resp.json()
    assert circuit["panel_id"] == panel["id"]
    assert circuit["poles"] == 1


def test_subpanel_fed_from(client):
    main_panel = _make_panel(client, name="Main Panel")
    sub_panel = _make_panel(client, name="Garage Subpanel", fed_from_panel_id=main_panel["id"])

    assert sub_panel["fed_from_panel_id"] == main_panel["id"]


def test_update_panel_rejects_self_as_upstream(client):
    panel = _make_panel(client)

    resp = client.patch(
        f"/panels/{panel['id']}", json={"fed_from_panel_id": panel["id"]}
    )

    assert resp.status_code == 409
    assert resp.json()["detail"] == "Panel feed relationship would create a cycle"


def test_update_panel_rejects_descendant_as_upstream(client):
    main_panel = _make_panel(client)
    sub_panel = _make_panel(
        client, name="Garage Subpanel", fed_from_panel_id=main_panel["id"]
    )

    resp = client.patch(
        f"/panels/{main_panel['id']}",
        json={"fed_from_panel_id": sub_panel["id"]},
    )

    assert resp.status_code == 409
    assert resp.json()["detail"] == "Panel feed relationship would create a cycle"


def test_list_panel_circuits(client):
    panel = _make_panel(client)
    other_panel = _make_panel(client, name="Subpanel")
    client.post("/circuits", json={"panel_id": panel["id"], "breaker_label": "1"})
    client.post("/circuits", json={"panel_id": panel["id"], "breaker_label": "2"})
    client.post("/circuits", json={"panel_id": other_panel["id"], "breaker_label": "1"})

    resp = client.get(f"/panels/{panel['id']}/circuits")
    assert resp.status_code == 200
    assert {c["breaker_label"] for c in resp.json()} == {"1", "2"}


def test_delete_panel_cascades_circuits(client):
    panel = _make_panel(client)
    circuit = client.post(
        "/circuits", json={"panel_id": panel["id"], "breaker_label": "1"}
    ).json()

    resp = client.delete(f"/panels/{panel['id']}")
    assert resp.status_code == 204

    resp = client.get(f"/circuits/{circuit['id']}")
    assert resp.status_code == 404


def test_circuit_point_links_circuit_and_room(client):
    room = client.post(
        "/rooms", json={"name": "Kitchen", "floor": "main", "polygon": [[0, 0]]}
    ).json()
    panel = _make_panel(client)
    circuit = client.post(
        "/circuits", json={"panel_id": panel["id"], "breaker_label": "12"}
    ).json()

    resp = client.post(
        "/circuit-points",
        json={
            "circuit_id": circuit["id"],
            "room_id": room["id"],
            "kind": "outlet",
            "x": 3.5,
            "y": 4.0,
            "label": "counter outlet",
        },
    )
    assert resp.status_code == 201
    point = resp.json()
    assert point["circuit_id"] == circuit["id"]
    assert point["room_id"] == room["id"]


def test_delete_panel_feeding_subpanel_returns_conflict(client):
    main_panel = _make_panel(client)
    _make_panel(client, name="Garage Subpanel", fed_from_panel_id=main_panel["id"])

    resp = client.delete(f"/panels/{main_panel['id']}")

    assert resp.status_code == 409
    assert resp.json()["detail"] == "Panel still feeds another panel"


def test_create_circuit_with_missing_panel_returns_conflict(client):
    resp = client.post("/circuits", json={"panel_id": 999, "breaker_label": "1"})

    assert resp.status_code == 409
    assert resp.json()["detail"] == "Circuit references a missing panel"
