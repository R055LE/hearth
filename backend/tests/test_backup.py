import sqlite3
import stat
from contextlib import closing

from hearth.backup import backup_database


def test_backup_database_creates_consistent_copy_and_prunes_old_files(tmp_path):
    database = tmp_path / "hearth.db"
    with closing(sqlite3.connect(database)) as connection:
        connection.execute("create table rooms (name text not null)")
        connection.execute("insert into rooms values ('Kitchen')")
        connection.commit()

    backup_dir = tmp_path / "backups"
    first = backup_database(database, backup_dir, keep=2)
    second = backup_database(database, backup_dir, keep=2)
    third = backup_database(database, backup_dir, keep=2)

    assert first is not None
    assert second is not None
    assert third is not None
    assert not first.exists()
    assert len(list(backup_dir.glob("hearth-*.db"))) == 2
    assert stat.S_IMODE(third.stat().st_mode) == 0o600
    with closing(sqlite3.connect(third)) as connection:
        assert connection.execute("select name from rooms").fetchone() == ("Kitchen",)


def test_backup_database_skips_missing_database(tmp_path):
    result = backup_database(tmp_path / "missing.db", tmp_path / "backups")

    assert result is None
    assert not (tmp_path / "backups").exists()
