# Pinned by digest (not just the moving tag) so builds are reproducible; Dependabot bumps
# the digest + comment on a new base release. Tags retained for readability.
FROM node:26-slim@sha256:4ebb5ace66f15a24c14c492e01a8beeed4fddf970a856109f5126e703e5fe503 AS frontend-build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./
RUN npm run build

# The build and runtime images are one release set from R055LE/runtime-images.
# Shared package locks keep their Python ABI exact, and Hearth's CI verifies both
# digests against that producer's signed release manifest and workflow identity.
# The rolling tags are readable discovery channels; the digests are the build input.
FROM ghcr.io/r055le/runtime-python:3.14-build@sha256:7c951603514686397880623806d0f03f9d64575d2e2a4fbdbd78796de1683cd6 AS builder
WORKDIR /build

# Install the dependency set recorded in uv.lock into a prefix that can be copied
# wholesale into the final stage. Resolving pyproject ranges independently here made
# the committed lockfile decorative and allowed repeat builds of one commit to differ.
COPY backend/pyproject.toml backend/uv.lock backend/README.md ./
COPY backend/hearth ./hearth
RUN UV_PROJECT_ENVIRONMENT=/install uv sync --locked --no-dev --no-editable

# /data has to exist in the image with the right ownership before the bind mount lands.
# There is no shell in the final stage to mkdir with, so it gets built here and copied.
RUN mkdir -p /skeleton/data && chown 65532:65532 /skeleton/data

# The Wolfi runtime is composed by R055LE/runtime-images from signed packages. It has
# no shell, package manager, pip, or compiler. That repository owns package refreshes,
# contract tests, risk gating, signatures, and attestations; Hearth still scans and
# tests the complete application image before publishing it.
#
# Consequences, all deliberate:
#   - No shell, so CMD and HEALTHCHECK are exec-array form and the entrypoint that ran
#     migrations before startup is now backend/hearth/entrypoint.py.
#   - The runtime user is the image's built-in nonroot (65532), not hearth (10001).
#     user creation tools do not exist. **The /data bind mount on the deploy host
#     must be chowned to 65532 or the container cannot write its database.**
#   - Debugging is `docker cp` and logs, not `docker exec sh`.
FROM ghcr.io/r055le/runtime-python:3.14@sha256:e179ae5027ea72c8d81254d82ec78bf343868c15362d021c856ff7887a99f40f

# /app precedes site-packages so `import hearth` resolves to the source tree, which is
# what main.py's FRONTEND_DIST walks up from to find ./static.
COPY --from=builder --chown=nonroot:nonroot /install/lib/python3.14/site-packages /app/site-packages
ENV PYTHONPATH=/app:/app/site-packages

WORKDIR /app

COPY --from=builder --chown=nonroot:nonroot /build/hearth ./hearth
COPY --chown=nonroot:nonroot backend/alembic.ini ./alembic.ini
COPY --chown=nonroot:nonroot backend/alembic ./alembic
COPY --from=frontend-build --chown=nonroot:nonroot /app/dist ./static
COPY --from=builder --chown=nonroot:nonroot /skeleton/data /data

# Declared explicitly even though the base image already defaults to it, so the
# guarantee is visible here and survives a base image change.
USER 65532:65532

ENV PYTHONUNBUFFERED=1
ENV DB_PATH=/data/hearth.db

EXPOSE 8000

# Exec-array form: no shell exists to interpret a string command.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/usr/bin/python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/rooms')"]

# Migrations run at container start (not at build time) so the schema always matches
# whatever DB_PATH volume is actually mounted. entrypoint.py does that and then serves.
ENTRYPOINT ["/usr/bin/python", "-m", "hearth.entrypoint"]
