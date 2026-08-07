# hearth Release & Deploy Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give hearth a GHCR publish workflow and a pull-based systemd deploy pipeline, mirroring the proven pattern already running for `roger` (the other self-hosted app in this workspace) minus the parts hearth doesn't need.

**Architecture:** A new `.github/workflows/release.yml` builds, Trivy-scans, publishes, and cosign-signs the image on every push to `main`. A new `deploy/` directory holds the host-side half: a poll script that pulls the image, verifies its cosign signature, and redeploys via `docker compose up -d`, wired up as a systemd oneshot service + 5-minute timer. hearth has no secrets today, so — unlike roger — there is no sops/age layer anywhere in this pipeline.

**Tech Stack:** GitHub Actions (docker/build-push-action, docker/metadata-action, aquasecurity/trivy-action, sigstore/cosign-installer), bash, systemd units.

## Global Constraints

- This is a **CI/deploy-plumbing-only** plan. Do not modify `Dockerfile`, `compose.yaml`, `compose.dev.yaml`, or any backend/frontend application code.
- Mirror `roger`'s proven pattern (`/home/ross/code/github/R055LE/roger/.github/workflows/release.yml` and `/home/ross/code/github/R055LE/roger/deploy/*`) exactly, except for the explicit differences called out in each task below.
- hearth has **zero secrets** (no auth, no external API keys). There is no sops, no age, and no encrypted env file anywhere in this plan. `DB_PATH` and `PORT` already have safe non-secret defaults in the existing `compose.yaml` — do not add an env file.
- Image reference: `ghcr.io/r055le/hearth:main`.
- Cosign identity string (used only in Task 2, `hearth-deploy.sh`): `https://github.com/R055LE/hearth/.github/workflows/release.yml@refs/heads/main`.
- No `bootstrap.sh` in this plan — the target host already has Docker, the compose plugin, and cosign installed from setting up `roger`. `deploy/README.md` must say this explicitly rather than silently omitting the step.
- `deploy/README.md` must **not** include a sops/age section or a bot-invite section (both are roger-specific and don't apply to hearth).
- This plan covers only the hearth-repo half of the deploy design. The homelab-repo tailnet/ACL work and the live `ssh hermes` provisioning steps are a separate plan, out of scope here.

---

### Task 1: GHCR release workflow

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Produces: on every push to `main` (docs-only pushes excluded), publishes `ghcr.io/r055le/hearth:main` (and a `sha-<short>` tag), keyless-signed with cosign. The signing identity is fixed by GitHub OIDC to this exact workflow's repo+path+ref — Task 2's `hearth-deploy.sh` verifies against `https://github.com/R055LE/hearth/.github/workflows/release.yml@refs/heads/main`, so this file must live at exactly this path on `main` for that verification to succeed later.

- [ ] **Step 1: Write the workflow file**

```yaml
name: release

# Build the runtime image and publish it to GHCR on every push to main.
# The deploy host polls ghcr.io/r055le/hearth:main and redeploys when the digest changes.
# hearth has no secrets — nothing is injected into the image or the deploy at runtime.

on:
  push:
    branches: [main]
    # Docs-only pushes don't change runtime behaviour — skip the rebuild/redeploy. GitHub runs the
    # workflow only when a push touches at least one non-markdown path (mixed code+docs still builds).
    paths-ignore:
      - "**.md"

permissions:
  contents: read
  packages: write
  id-token: write # provenance attestation

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false

jobs:
  image:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1

      - name: Set up Buildx
        # docker-container driver: required for gha cache export and SBOM/provenance attestations.
        uses: docker/setup-buildx-action@bb05f3f5519dd87d3ba754cc423b652a5edd6d2c # v4.2.0

      - name: Log in to GHCR
        uses: docker/login-action@af1e73f918a031802d376d3c8bbc3fe56130a9b0 # v4.4.0
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Install cosign
        uses: sigstore/cosign-installer@6f9f17788090df1f26f669e9d70d6ae9567deba6 # v4.1.2
        with:
          cosign-release: v3.1.2 # pin the signer; matches the verifier on the deploy host

      - name: Image metadata
        id: meta
        uses: docker/metadata-action@dc802804100637a589fabce1cb79ff13a1411302 # v6.2.0
        with:
          images: ghcr.io/${{ github.repository }} # lowercased automatically
          tags: |
            type=raw,value=main
            type=sha,prefix=sha-,format=short

      # Build locally first (load, no push) so Trivy can gate on it. The host pulls :main on a timer
      # independent of this workflow, so a scan *after* push wouldn't gate anything — the image only
      # reaches GHCR if it's clean.
      - name: Build (load for scanning)
        uses: docker/build-push-action@53b7df96c91f9c12dcc8a07bcb9ccacbed38856a # v7.3.0
        with:
          context: .
          load: true
          tags: ${{ steps.meta.outputs.tags }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Resolve lowercase image ref
        id: img
        run: |
          repo="ghcr.io/${GITHUB_REPOSITORY,,}"
          echo "name=$repo" >> "$GITHUB_OUTPUT"
          echo "ref=$repo:main" >> "$GITHUB_OUTPUT"

      - name: Scan image (Trivy)
        uses: aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25 # v0.36.0
        with:
          image-ref: ${{ steps.img.outputs.ref }}
          severity: CRITICAL,HIGH
          ignore-unfixed: true # only fixable vulns block a release
          exit-code: "1"

      # Cache-hit rebuild (same inputs) that pushes with attestations only after the scan passes.
      - name: Push
        id: push
        uses: docker/build-push-action@53b7df96c91f9c12dcc8a07bcb9ccacbed38856a # v7.3.0
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          provenance: true # signed build provenance attestation
          sbom: true # SBOM attestation
          cache-from: type=gha
          cache-to: type=gha,mode=max

      # Keyless signature (Fulcio/Rekor) tied to this workflow's OIDC identity — no private key.
      # The deploy host verifies it before running the image (see deploy/hearth-deploy.sh).
      - name: Sign image (keyless)
        env:
          IMAGE: ${{ steps.img.outputs.name }}
          DIGEST: ${{ steps.push.outputs.digest }}
        run: cosign sign --yes "${IMAGE}@${DIGEST}"
```

- [ ] **Step 2: Validate YAML syntax**

Run (from the repo root):
```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml')); print('valid')"
```
Expected: prints `valid`, exit code 0. (PyYAML is already available on this system — confirmed separately; no new dependency to install.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "Add GHCR release workflow"
```

---

### Task 2: Deploy directory + ARCHITECTURE.md pointer

**Files:**
- Create: `deploy/hearth-deploy.sh`
- Create: `deploy/hearth-deploy.service`
- Create: `deploy/hearth-deploy.timer`
- Create: `deploy/install-systemd.sh`
- Create: `deploy/README.md`
- Modify: `ARCHITECTURE.md:78-79`

**Interfaces:**
- Consumes: the image `ghcr.io/r055le/hearth:main` and the cosign identity string from Task 1 (fixed by that workflow's repo path — no code dependency, just must match).
- Produces: everything a deploy host needs to run hearth on a poll timer. Nothing here is consumed by later tasks in this plan (this is the last task); the separate homelab-repo plan's live provisioning steps consume these files by `scp`-ing this directory to the host.

- [ ] **Step 1: Write `deploy/hearth-deploy.sh`**

```bash
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
```

- [ ] **Step 2: Make it executable and check syntax**

Run:
```bash
chmod +x deploy/hearth-deploy.sh
bash -n deploy/hearth-deploy.sh && echo "syntax OK"
```
Expected: prints `syntax OK`, exit code 0.

- [ ] **Step 3: Write `deploy/hearth-deploy.service`**

```ini
[Unit]
Description=Pull and (re)deploy hearth from GHCR
Wants=network-online.target
After=network-online.target docker.service
Requires=docker.service

[Service]
Type=oneshot
User=__DEPLOY_USER__
ExecStart=/usr/local/bin/hearth-deploy
# Non-fatal: a failed poll (e.g. registry hiccup) shouldn't disable the timer.
SuccessExitStatus=0
```

- [ ] **Step 4: Verify the unit file**

Run:
```bash
systemd-analyze verify deploy/hearth-deploy.service
```
Expected: exit code 1, with exactly one relevant line:
```
deploy/hearth-deploy.service: Command /usr/local/bin/hearth-deploy is not executable: No such file or directory
```
That specific error is expected and correct — the binary only exists once `install-systemd.sh` runs it on a real host. (You may also see one or two unrelated lines about `CPUAccounting=` from pre-existing system-wide units like `xfs_scrub_all.service` — those are host noise, not from this file; ignore them.) Any *other* error about `deploy/hearth-deploy.service` itself is a real problem — fix it before continuing.

- [ ] **Step 5: Write `deploy/hearth-deploy.timer`**

```ini
[Unit]
Description=Poll GHCR for new hearth images and redeploy

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
```

- [ ] **Step 6: Verify the timer file**

Run:
```bash
systemd-analyze verify deploy/hearth-deploy.timer
```
Expected: exit code 0, clean (aside from the same unrelated `xfs_scrub` host noise from Step 4, if present).

- [ ] **Step 7: Write `deploy/install-systemd.sh`**

```bash
#!/usr/bin/env bash
# install-systemd.sh — install the hearth-deploy script + poll timer on the host. Idempotent.
#
# Run from a checkout of deploy/ (not piped over stdin — it reads its sibling files):
#   scp -r deploy <host>:/tmp/hearth-src
#   ssh <host> 'sudo bash /tmp/hearth-src/install-systemd.sh'
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)." >&2; exit 1; }

install -m 0755 "$SRC/hearth-deploy.sh" /usr/local/bin/hearth-deploy

# The deploy runs as the (non-root) invoking user so Docker isn't driven as root. Fill the
# unit's placeholder with whoever ran sudo.
DEPLOY_USER="${SUDO_USER:?run via sudo so the deploy user is known}"
sed "s/__DEPLOY_USER__/${DEPLOY_USER}/" "$SRC/hearth-deploy.service" \
  > /etc/systemd/system/hearth-deploy.service
chmod 0644 /etc/systemd/system/hearth-deploy.service
install -m 0644 "$SRC/hearth-deploy.timer" /etc/systemd/system/hearth-deploy.timer

systemctl daemon-reload
systemctl enable --now hearth-deploy.timer

echo "Installed. Timer:"
systemctl list-timers hearth-deploy.timer --no-pager || true
echo
echo "Trigger an immediate deploy with:  sudo systemctl start hearth-deploy.service"
echo "Follow deploy logs with:           journalctl -u hearth-deploy.service -f"
```

- [ ] **Step 8: Make it executable and check syntax**

Run:
```bash
chmod +x deploy/install-systemd.sh
bash -n deploy/install-systemd.sh && echo "syntax OK"
```
Expected: prints `syntax OK`, exit code 0.

- [ ] **Step 9: Write `deploy/README.md`**

```markdown
# Deploying hearth

Pull-based continuous deployment: nothing pushes *in* to the deploy host, it only ever
reaches *out* to GHCR.

```
push to main ──▶ GitHub Actions ──▶ ghcr.io/r055le/hearth:main
                                              │
                        deploy host: hearth-deploy.timer (every 5 min)
                                              │
                          docker compose pull + up -d  (cosign-verified)
```

- **`release.yml`** builds the image on every push to `main`, scans it with **Trivy** (build →
  scan → push, so a vulnerable image never reaches GHCR), publishes it (public, no secrets baked
  in — SBOM + provenance attestations), and **signs it keyless with cosign** (Fulcio/Rekor, no
  private key).
- **`hearth-deploy.timer`** on the host polls that tag every 5 minutes, **verifies the cosign
  signature** against the release workflow's OIDC identity, and redeploys only when the image
  digest changed. A bad or missing signature fails the deploy closed. Docker's
  `restart: unless-stopped` keeps hearth running across reboots; the timer keeps it *current*.

hearth has no secrets today (no auth, no external API keys) — `DB_PATH` and `PORT` both have
safe defaults baked into `compose.yaml`, so there's no encrypted env file to manage here.
`/opt/hearth` is just the compose file plus the `data/` bind mount.

## Pieces

| File | Role |
|---|---|
| `hearth-deploy.sh` | Pull + **cosign verify** + `up -d` + prune. Installed as `/usr/local/bin/hearth-deploy`. |
| `hearth-deploy.service` / `.timer` | systemd oneshot + 5-minute poll timer. |
| `install-systemd.sh` | Install the above and enable the timer (runs the deploy as the invoking user). |

There's no `bootstrap.sh` here — this assumes the host already has Docker, the compose plugin,
and cosign installed (true for any host already running another app with this same deploy
pattern). If the host is genuinely fresh, install those three first.

## First-time provision

Run from a checkout, against a host you can reach over SSH. Set `HOST` to that host.

```bash
HOST=your-deploy-host

# 1. Provision the deploy dir. 10001 matches the image's runtime uid (see ../Dockerfile) so
#    the read-only container can write the SQLite DB into the bind mount.
ssh "$HOST" 'sudo install -d -o "$USER" -g "$USER" /opt/hearth && \
             sudo install -d /opt/hearth/data && sudo chown 10001:10001 /opt/hearth/data'
scp ../compose.yaml "$HOST":/opt/hearth/

# 2. Install the deploy timer (must run via sudo so it picks up the deploy user).
scp -r . "$HOST":/tmp/hearth-src
ssh "$HOST" 'sudo bash /tmp/hearth-src/install-systemd.sh'

# 3. First deploy (the timer also fires within ~2 min of boot / install).
ssh "$HOST" 'sudo systemctl start hearth-deploy.service'
ssh "$HOST" 'docker logs --tail 20 "$(docker ps -q --filter name=hearth)"'
```

> **One-time GHCR step:** the first `release.yml` run publishes the package **private** by
> default. Make it public once in the package's settings → *Change visibility → Public*, so the
> host can pull without a token. After that, nothing else is manual.

## Day-to-day

- **Ship a change:** push to `main`. CI gates it, the image builds, the host redeploys within
  ~5 minutes. Nothing else to do.
- **Deploy now:** `ssh "$HOST" 'sudo systemctl start hearth-deploy.service'`.
- **Watch logs:** `journalctl -u hearth-deploy.service -f` (deploys) or
  `docker logs -f "$(docker ps -q --filter name=hearth)"` (the app).
- **Reach the running app:** this covers getting the container running on the host only.
  Making its port reachable from your own devices (VPN/tailnet, VLAN policy, etc.) is a
  network-level decision made outside this repo.

## Notes

- **Pinning vs. tracking.** hearth's own image tracks the `:main` channel on purpose — that's
  what continuous deploy is. For release-gated prod, point `compose.yaml` at a `:sha-<...>` tag
  and bump it deliberately.
- **Signature gate.** `hearth-deploy.sh` runs `cosign verify` between pull and `up`, pinned to
  the release workflow's identity (`…/release.yml@refs/heads/main`) and the GitHub OIDC issuer.
  The gate fails **closed**: no cosign, or an unsigned/tampered image, aborts the deploy and the
  last-good container keeps running.
```

- [ ] **Step 10: Update `ARCHITECTURE.md`'s Deferred section**

In `ARCHITECTURE.md`, find this text (currently lines 78-79):

```markdown
- GHCR publish workflow + systemd-timer deploy to the actual host (roger's pattern)
  — deliberately not wired up yet; this repo only covers the app itself so far.
```

Replace it with:

```markdown
- ~~GHCR publish workflow + systemd-timer deploy to the actual host~~ — done, see
  `deploy/README.md`.
```

- [ ] **Step 11: Commit**

```bash
git add deploy/ ARCHITECTURE.md
git commit -m "Add pull-based deploy pipeline for hearth"
```
