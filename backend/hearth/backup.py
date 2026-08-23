import os
import sqlite3
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path


def backup_database(database: Path, backup_dir: Path, keep: int = 10) -> Path | None:
    if keep < 1:
        raise ValueError("keep must be at least 1")
    if not database.is_file():
        return None

    backup_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S.%fZ")
    destination = backup_dir / f"hearth-{timestamp}.db"
    temporary = destination.with_suffix(".tmp")

    with (
        closing(sqlite3.connect(f"file:{database}?mode=ro", uri=True)) as source,
        closing(sqlite3.connect(temporary)) as target,
    ):
        source.backup(target)
    temporary.chmod(0o600)
    temporary.replace(destination)

    backups = sorted(backup_dir.glob("hearth-*.db"))
    for obsolete in backups[:-keep]:
        obsolete.unlink()
    return destination


def main() -> None:
    database = Path(os.environ.get("DB_PATH", "/data/hearth.db"))
    backup_dir = Path(os.environ.get("BACKUP_DIR", "/data/backups"))
    keep = int(os.environ.get("BACKUP_KEEP", "10"))
    backup = backup_database(database, backup_dir, keep)
    print(f"backup: {backup if backup else 'database does not exist yet'}")


if __name__ == "__main__":
    main()
