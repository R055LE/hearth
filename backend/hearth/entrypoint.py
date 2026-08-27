"""Container entrypoint: apply migrations, then serve.

The runtime image has no shell, so the previous
``sh -c "alembic upgrade head && exec uvicorn ..."`` has nothing to run it.
Both steps happen here instead, in one process.

Migrations still run at container start rather than at build time, so the
schema matches whatever ``DB_PATH`` volume is actually mounted.
"""

import os

import uvicorn
from alembic.command import upgrade
from alembic.config import Config


def main() -> None:
    # Relative to the working directory, matching how `alembic upgrade head`
    # was invoked before. alembic.ini resolves script_location from its own
    # location (%(here)s), so the versions directory is found either way.
    upgrade(Config(os.environ.get("ALEMBIC_CONFIG", "alembic.ini")), "head")
    uvicorn.run(
        "hearth.main:app",
        # S104: binding the container's own loopback would make the published
        # port unreachable, so this isn't a setting that can be tightened here.
        # What hearth is reachable from is decided by the port publishing in
        # compose.yaml and by the network policy in front of the deploy host.
        #
        # This is not a new exposure. The old image passed `--host 0.0.0.0` in
        # the Dockerfile CMD, where ruff's S rules never looked. Moving the
        # entrypoint into Python is what put an existing property in scope.
        host=os.environ.get("HOST", "0.0.0.0"),  # noqa: S104
        port=int(os.environ.get("PORT", "8000")),
    )


if __name__ == "__main__":
    main()
