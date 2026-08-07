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
docker compose pull --quiet

# Supply-chain gate: only run an image this repo's release workflow signed. cosign resolves
# :main to its current digest and checks the keyless signature against the workflow's OIDC
# identity. set -e means a bad/absent signature (or a missing cosign) aborts before `up` —
# fail closed. cosign must be on PATH for the systemd service (install to /usr/local/bin);
# see deploy/README.md.
IMAGE="ghcr.io/r055le/hearth:main"
COSIGN_IDENTITY="https://github.com/R055LE/hearth/.github/workflows/release.yml@refs/heads/main"
COSIGN_ISSUER="https://token.actions.githubusercontent.com"
echo "hearth-deploy: verifying image signature (cosign)"
cosign verify \
  --certificate-identity "$COSIGN_IDENTITY" \
  --certificate-oidc-issuer "$COSIGN_ISSUER" \
  "$IMAGE" >/dev/null

echo "hearth-deploy: applying"
docker compose up -d

echo "hearth-deploy: pruning superseded images"
docker image prune -f >/dev/null

echo "hearth-deploy: done"
