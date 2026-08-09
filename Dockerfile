# Pinned by digest (not just the moving tag) so builds are reproducible; Dependabot bumps
# the digest + comment on a new base release. Tags retained for readability.
FROM node:26-slim@sha256:4ebb5ace66f15a24c14c492e01a8beeed4fddf970a856109f5126e703e5fe503 AS frontend-build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./
RUN npm run build

FROM python:3.14-slim@sha256:a7fb1e634c4a578f9e0bd6327f11a3cde11b7a9395f48e24360c0988bcc5c2bc

# Non-root runtime user with a fixed uid/gid so the host can chown the bind-mounted /data
# to match. The app writes only to /data (volume), so the rootfs is read-only.
RUN groupadd --system --gid 10001 hearth \
 && useradd --system --uid 10001 --gid 10001 --home-dir /app --no-create-home hearth

WORKDIR /app

# Install the package (deps are pinned in pyproject.toml).
COPY backend/pyproject.toml backend/README.md ./
COPY backend/hearth ./hearth
COPY backend/alembic.ini ./alembic.ini
COPY backend/alembic ./alembic
# pip is a build-time tool here; nothing at runtime shells out to it. Removing it after the
# install drops pip's vendored bundle from the shipped image, along with the CycloneDX SBOM
# pip publishes about that bundle. Trivy reads that SBOM as installed inventory, so it was
# reporting vendored packages the image doesn't expose as if they were app dependencies.
RUN pip install --no-cache-dir . \
 && python -m pip uninstall -y pip

COPY --from=frontend-build /app/dist ./static

RUN mkdir -p /data && chown hearth:hearth /data

USER hearth
ENV PYTHONUNBUFFERED=1
ENV DB_PATH=/data/hearth.db

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/rooms')"]

# Migrations run at container start (not at build time) so the schema always matches
# whatever DB_PATH volume is actually mounted.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn hearth.main:app --host 0.0.0.0 --port 8000"]
