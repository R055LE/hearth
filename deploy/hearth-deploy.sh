#!/usr/bin/env bash
# hearth-deploy — pull the latest published image and (re)deploy hearth.
#
# Installed to /usr/local/bin/hearth-deploy and run by hearth-deploy.timer every few minutes
# (also runnable by hand). Pulls ghcr.io/r055le/hearth:main; `docker compose up -d` only
# recreates the container when the image digest (or config) actually changed, so a run with
# no new image is a cheap no-op. hearth has no secrets, so nothing here decrypts or injects
# an env file — compare to roger's version of this script if you're looking for that piece.
set -euo pipefail

DEPLOY_DIR="${HEARTH_DEPLOY_DIR:-/opt/hearth}"
cd "$DEPLOY_DIR"

# Serialize with the timer so an overlapping tick can't race a redeploy.
exec 9>"${DEPLOY_DIR}/.deploy.lock"
flock -n 9 || { echo "hearth-deploy: another run holds the lock, skipping"; exit 0; }

echo "hearth-deploy: pulling"
TRACKED_IMAGE="ghcr.io/r055le/hearth:main"
export HEARTH_IMAGE="$TRACKED_IMAGE"
docker compose pull --quiet

# Resolve the image Docker actually pulled, then verify and run that immutable digest. Verifying
# the moving tag separately leaves a race where the registry tag can change between pull and
# verify, causing cosign to approve a different image from the one Compose starts.
IMAGE_REPOSITORY="${TRACKED_IMAGE%:*}"
IMAGE_DIGEST="$(docker image inspect --format '{{index .RepoDigests 0}}' "$TRACKED_IMAGE")"
case "$IMAGE_DIGEST" in
  "$IMAGE_REPOSITORY"@sha256:*) ;;
  *) echo "hearth-deploy: could not resolve pulled digest for $TRACKED_IMAGE" >&2; exit 1 ;;
esac

# Supply-chain gate: only run an image this repo's release workflow signed. set -e means a
# bad/absent signature (or a missing cosign) aborts before `up`. cosign must be on PATH for the
# systemd service (install to /usr/local/bin); see deploy/README.md.
COSIGN_IDENTITY="https://github.com/R055LE/hearth/.github/workflows/release.yml@refs/heads/main"
COSIGN_ISSUER="https://token.actions.githubusercontent.com"
echo "hearth-deploy: verifying image signature for $IMAGE_DIGEST"
cosign verify \
  --certificate-identity "$COSIGN_IDENTITY" \
  --certificate-oidc-issuer "$COSIGN_ISSUER" \
  "$IMAGE_DIGEST" >/dev/null

PULLED_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$IMAGE_DIGEST")"
CONTAINER_ID="$(docker compose ps -q hearth)"
CURRENT_IMAGE_ID=""
if [ -n "$CONTAINER_ID" ]; then
  CURRENT_IMAGE_ID="$(docker inspect --format '{{.Image}}' "$CONTAINER_ID")"
fi

export HEARTH_IMAGE="$IMAGE_DIGEST"
WAIT_SECONDS="${HEARTH_DEPLOY_WAIT_SECONDS:-60}"

if [ "$CURRENT_IMAGE_ID" = "$PULLED_IMAGE_ID" ]; then
  echo "hearth-deploy: verified image already running; checking health"
  docker compose up -d --wait --wait-timeout "$WAIT_SECONDS"
  exit 0
fi

# The new, verified image carries the backup code. SQLite's online backup API produces a
# consistent snapshot while the old container is still serving. Backups stay inside /data and
# are bounded by BACKUP_KEEP so the deploy loop cannot grow the volume forever.
echo "hearth-deploy: backing up database"
docker run --rm \
  --read-only \
  --network none \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --user 65532:65532 \
  --volume "$DEPLOY_DIR/data:/data" \
  --env DB_PATH=/data/hearth.db \
  --env BACKUP_DIR=/data/backups \
  --env "BACKUP_KEEP=${HEARTH_BACKUP_KEEP:-10}" \
  --entrypoint /usr/bin/python3.13 \
  "$IMAGE_DIGEST" -m hearth.backup

echo "hearth-deploy: applying"
docker compose up -d --wait --wait-timeout "$WAIT_SECONDS"

echo "hearth-deploy: pruning superseded images"
docker image prune -f >/dev/null

echo "hearth-deploy: done"
