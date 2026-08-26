def _make_room(client):
    return client.post(
        "/rooms",
        json={"name": "Utility room", "floor": "basement", "polygon": [[0, 0]]},
    ).json()


def test_create_list_and_update_maintenance_task(client):
    room = _make_room(client)

    response = client.post(
        "/maintenance-tasks",
        json={
            "title": "Replace furnace filter",
            "room_id": room["id"],
            "due_date": "2026-09-01",
            "recurrence_days": 90,
            "notes": "Use the 16x25x1 filters.",
        },
    )

    assert response.status_code == 201
    task = response.json()
    assert task == {
        "id": task["id"],
        "title": "Replace furnace filter",
        "room_id": room["id"],
        "due_date": "2026-09-01",
        "recurrence_days": 90,
        "notes": "Use the 16x25x1 filters.",
        "is_active": True,
        "completions": [],
    }

    response = client.patch(
        f"/maintenance-tasks/{task['id']}",
        json={"title": "Replace HVAC filter", "room_id": None, "recurrence_days": None},
    )

    assert response.status_code == 200
    assert response.json()["title"] == "Replace HVAC filter"
    assert response.json()["room_id"] is None
    assert response.json()["recurrence_days"] is None

    response = client.get("/maintenance-tasks")
    assert response.status_code == 200
    assert [stored["id"] for stored in response.json()] == [task["id"]]


def test_rejects_invalid_recurrence_and_missing_room(client):
    response = client.post(
        "/maintenance-tasks",
        json={"title": "Flush water heater", "due_date": "2026-09-01", "recurrence_days": 0},
    )
    assert response.status_code == 422

    response = client.post(
        "/maintenance-tasks",
        json={"title": "Flush water heater", "due_date": "2026-09-01", "room_id": 999},
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "Maintenance task references a missing room"


def test_completing_recurring_task_preserves_occurrence_and_rolls_from_completion(client):
    task = client.post(
        "/maintenance-tasks",
        json={
            "title": "Replace furnace filter",
            "due_date": "2026-08-01",
            "recurrence_days": 30,
        },
    ).json()

    response = client.post(
        f"/maintenance-tasks/{task['id']}/completions",
        json={"completed_on": "2026-08-25"},
    )

    assert response.status_code == 201
    updated = response.json()
    assert updated["is_active"] is True
    assert updated["due_date"] == "2026-09-24"
    assert updated["completions"] == [
        {
            "id": updated["completions"][0]["id"],
            "task_id": task["id"],
            "scheduled_for": "2026-08-01",
            "completed_on": "2026-08-25",
        }
    ]


def test_completing_one_time_task_closes_it_and_rejects_duplicate_completion(client):
    task = client.post(
        "/maintenance-tasks",
        json={"title": "Seal the deck", "due_date": "2026-08-25"},
    ).json()

    response = client.post(
        f"/maintenance-tasks/{task['id']}/completions",
        json={"completed_on": "2026-08-26"},
    )

    assert response.status_code == 201
    assert response.json()["is_active"] is False
    assert response.json()["due_date"] == "2026-08-25"
    assert response.json()["completions"][0]["scheduled_for"] == "2026-08-25"

    response = client.post(
        f"/maintenance-tasks/{task['id']}/completions",
        json={"completed_on": "2026-08-27"},
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "Maintenance task is already closed"


def test_deleting_room_keeps_maintenance_task(client):
    room = _make_room(client)
    task = client.post(
        "/maintenance-tasks",
        json={
            "title": "Inspect utility sink",
            "room_id": room["id"],
            "due_date": "2026-10-01",
        },
    ).json()

    response = client.delete(f"/rooms/{room['id']}")

    assert response.status_code == 204
    tasks = client.get("/maintenance-tasks").json()
    assert tasks[0]["id"] == task["id"]
    assert tasks[0]["room_id"] is None
