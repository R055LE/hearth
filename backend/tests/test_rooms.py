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
