# Pinned by digest (not just the moving tag) so builds are reproducible; Dependabot bumps
# the digest + comment on a new base release. Tags retained for readability.
FROM node:25-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370 AS frontend-build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./
RUN npm run build

# The builder's python minor version must match the runtime's exactly. Wheels with
# compiled extensions are tagged for one ABI, and hearth ships two of them
# (pydantic-core, uvloop), so a mismatch produces a site-packages the runtime cannot
# import. 3.13-slim is paired with distroless python3-debian13 for that reason.
#
# This is a downgrade from 3.14. requires-python is >=3.12 so the code is fine, and
# CI derives its matrix from this line, so the tests follow the runtime down.
FROM python:3.13-slim@sha256:9662417aace5ae7b8e2609cce472b72a8958e134ba372808abe9cc1a0c0125e6 AS builder
WORKDIR /build

# Install into a prefix that can be copied wholesale into the final stage. pip stays
# in this stage: it was uninstalled from the old runtime image to drop its vendored
# bundle and the CycloneDX SBOM Trivy reads as installed inventory. Distroless has no
# pip at all, so that problem goes away rather than needing the workaround.
COPY backend/pyproject.toml backend/README.md ./
COPY backend/hearth ./hearth
RUN pip install --no-cache-dir --prefix=/install .

# /data has to exist in the image with the right ownership before the bind mount lands.
# There is no shell in the final stage to mkdir with, so it gets built here and copied.
RUN mkdir -p /skeleton/data && chown 65532:65532 /skeleton/data

# Distroless: no shell, no package manager, no coreutils. The findings this removes were
# entirely OS packages the runtime never calls, unfixable by patching because Debian had
# no fix released. Removing the packages removes the finding, which is the honest
# resolution rather than suppressing it.
#
# Consequences, all deliberate:
#   - No shell, so CMD and HEALTHCHECK are exec-array form and the entrypoint that ran
#     migrations before startup is now backend/hearth/entrypoint.py.
#   - The runtime user is the image's built-in nonroot (65532), not hearth (10001).
#     groupadd and useradd no longer exist. **The /data bind mount on the deploy host
#     must be chowned to 65532 or the container cannot write its database.**
#   - Debugging is `docker cp` and logs, not `docker exec sh`.
FROM gcr.io/distroless/python3-debian13:nonroot@sha256:1c680cdb442a9e7a89f64fd1706367c62302ea1f9ab80fdebdb72ae9fcded46f

# Distroless python has no site-packages on sys.path and no /usr/local. Copying the
# prefix to /usr/local, the usual slim-image pattern, puts dependencies where the
# interpreter never looks: the image builds, starts, and only breaks when something
# imports one. Both paths are declared here rather than inferred.
#
# /app precedes site-packages so `import hearth` resolves to the source tree, which is
# what main.py's FRONTEND_DIST walks up from to find ./static.
COPY --from=builder --chown=nonroot:nonroot /install/lib/python3.13/site-packages /app/site-packages
ENV PYTHONPATH=/app:/app/site-packages

WORKDIR /app

COPY --from=builder --chown=nonroot:nonroot /build/hearth ./hearth
COPY --chown=nonroot:nonroot backend/alembic.ini ./alembic.ini
COPY --chown=nonroot:nonroot backend/alembic ./alembic
COPY --from=frontend-build --chown=nonroot:nonroot /app/dist ./static
COPY --from=builder --chown=nonroot:nonroot /skeleton/data /data

# Declared explicitly even though the base image already defaults to it, so the
# guarantee is visible here and survives a base image change.
USER nonroot

ENV PYTHONUNBUFFERED=1
ENV DB_PATH=/data/hearth.db

EXPOSE 8000

# Exec-array form: no shell exists to interpret a string command.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/usr/bin/python3.13", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/rooms')"]

# Migrations run at container start (not at build time) so the schema always matches
# whatever DB_PATH volume is actually mounted. entrypoint.py does that and then serves.
ENTRYPOINT ["/usr/bin/python3.13", "-m", "hearth.entrypoint"]
