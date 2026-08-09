"""Container entrypoint: apply migrations, then serve.

The runtime image is distroless and has no shell, so the previous
``sh -c "alembic upgrade head && exec uvicorn ..."`` has nothing to run it.
Both steps happen here instead, in one process.

Migrations still run at container start rather than at build time, so the
schema matches whatever ``DB_PATH`` volume is actually mounted.
"""

import os

import uvicorn
from alembic import command
from alembic.config import Config


def main() -> None:
    # Relative to the working directory, matching how `alembic upgrade head`
    # was invoked before. alembic.ini resolves script_location from its own
    # location (%(here)s), so the versions directory is found either way.
    command.upgrade(Config(os.environ.get("ALEMBIC_CONFIG", "alembic.ini")), "head")
    uvicorn.run(
        "hearth.main:app",
        host=os.environ.get("HOST", "0.0.0.0"),
        port=int(os.environ.get("PORT", "8000")),
    )


if __name__ == "__main__":
    main()
