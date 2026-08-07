# Deploy hearth to hermes — design

Date: 2026-08-06

## Problem

hearth is Phase 1 complete and CI-green, but it has never run outside a dev
checkout. ARCHITECTURE.md's "Deferred" section has said since the first
commit that the GHCR-publish + systemd-timer deploy workflow "deliberately
not wired up yet" — this document is that workflow. Ross wants to actually
see the app running on real hardware rather than keep adding features to
something nobody has opened in a browser yet.

The target host, `hermes` (10.0.40.40, VLAN 40 "Services"), already runs
`roger` — the other long-running self-hosted app in this workspace — using
a pull-based GHCR pattern documented in the `homelab` repo
(`docs/hosts.md`, `docs/remote-access.md`). That repo's `hosts.md` already
notes hearth is "planned... meant to land on this host next to roger,"
which is exactly what this builds.

One real difference from roger: roger is a Discord bot with no inbound
listener, so it never needed to be *reachable* — only SSH-manageable.
hearth is a web UI Ross needs to open in a browser, and hermes' VLAN 40 is
locked to Admin-VLAN-only access today. hermes isn't yet on the Tailscale
mesh that Barnabas, MATTHIAS, and (planned) Thaddeus/TrueNAS use.

## Scope

This spans two repositories plus live infrastructure:

- **hearth repo**: a GHCR release workflow and a `deploy/` directory,
  mirroring roger's pattern minus the parts hearth doesn't need.
- **homelab repo**: enrolling hermes into the tailnet with a new scoped
  tag/ACL rule, following the pattern already used for Barnabas and
  planned for Thaddeus/TrueNAS.
- **Live infrastructure**: commands run against the real hermes host and
  the real Tailscale admin console.

The first two are ordinary spec'd-and-planned work. The third is
explicitly **not** something to hand to an autonomous subagent-driven
build — it's live, shared, real infrastructure, run interactively with
Ross watching each step (see "Execution model" below).

Out of scope: auth (ARCHITECTURE.md's ambient "no auth, tailnet-only"
posture is unchanged — the new ACL rule is what makes "tailnet-only" true
in practice, not a new auth layer), a subnet router (never
`--advertise-routes`, per `homelab/docs/remote-access.md`'s existing rule),
and any change to roger's own deploy pipeline (untouched, just referenced
as the pattern to mirror).

## Architecture

```
push to main ──▶ GitHub Actions (release.yml) ──▶ ghcr.io/r055le/hearth:main
                    (build → Trivy scan → push → cosign sign)
                                                        │
                                    hermes: hearth-deploy.timer (poll every 5 min)
                                                        │
                              cosign verify → docker compose pull + up -d
                                                        │
                                          hermes joins the tailnet (tag:services)
                                                        │
                                    phone/laptop ──▶ hearth over the mesh
```

hearth has zero secrets today — no auth, no external API keys, and both
`DB_PATH` and `PORT` already have safe non-secret defaults in
`compose.yaml`. That means the whole sops/age layer roger needs (it holds
a Discord bot token) doesn't apply here: `/opt/hearth` needs no encrypted
env file at all, just the compose file and a `data/` directory. Everything
else — Trivy scan, cosign sign/verify, pull-based timer, non-root
read-only container — mirrors roger's proven pattern exactly, on the
recommendation that the supply-chain gate (a compromised/tampered GHCR
image gets rejected before it runs) is worth keeping even with nothing
secret to protect.

hermes already has Docker, the compose plugin, sops, and cosign installed
(from roger's `bootstrap.sh`), so no host bootstrap step is needed —
hearth's deploy only adds its own timer/service/script on top.

## hearth-repo changes

**`.github/workflows/release.yml`** (new) — triggered on push to `main`
(`paths-ignore: ["**.md"]`, matching roger's). Steps: checkout → Buildx →
GHCR login → install cosign → build image locally (`load: true`, no push
yet) → Trivy scan (`severity: CRITICAL,HIGH`, `ignore-unfixed: true`,
`exit-code: 1`) → push with SBOM + provenance attestations → cosign sign
keyless (Fulcio/Rekor, no private key). No build-arg equivalent to
roger's `ROGER_VERSION` — hearth doesn't report a version string anywhere
today, so none is added just to mirror the shape.

**`deploy/` directory** (new):

- `hearth-deploy.sh` — `docker compose pull` → `cosign verify` (identity
  pinned to `https://github.com/R055LE/hearth/.github/workflows/release.yml@refs/heads/main`)
  → `docker compose up -d` → `docker image prune -f`. A `flock` lock file
  serializes against overlapping timer ticks, same as roger's. No
  `sops exec-env` wrapper anywhere — there's no encrypted env to decrypt.
- `hearth-deploy.service` / `hearth-deploy.timer` — same oneshot +
  5-minute `OnUnitActiveSec` poll shape as roger's, renamed.
  `SuccessExitStatus=0` so a transient pull failure doesn't disable the
  timer.
- `install-systemd.sh` — same idempotent installer as roger's: installs
  the script to `/usr/local/bin/hearth-deploy`, fills the service's
  `__DEPLOY_USER__` placeholder from `$SUDO_USER`, enables the timer.
- No `bootstrap.sh` — hermes is already bootstrapped. `deploy/README.md`
  says so explicitly rather than shipping a step that would just no-op.

**`deploy/README.md`** (new) — shorter than roger's: no sops/age section,
no bot-invite section. Covers the pipeline diagram, first-time
provisioning steps, day-to-day ops (ship = push to main; force a deploy
now; watch logs), and the GHCR-package-defaults-to-private gotcha roger
hit on its first release run.

**`ARCHITECTURE.md`** — the "Deferred" bullet for the GHCR/deploy workflow
changes from "not wired up yet" to a pointer at `deploy/README.md`.

## homelab-repo + live infra changes

**`docs/tailnet-policy.hujson`** (and its readable copy in
`remote-access.md`):

- New `tagOwners` entry: `"tag:services": ["autogroup:admin"]`.
- New ACL rule: `{ "action": "accept", "src": ["autogroup:member"], "dst": ["tag:services:8000"] }`
  — personal devices can reach hearth's port on hermes and nothing else on
  that host.

**`docs/remote-access.md`** — hermes added to the "Node plan" table, plus
a new runbook section (following the Thaddeus/TrueNAS section shape):
tag hermes, note the "host firewalls see the Tailscale source, not the
LAN source" gotcha (check hermes' own firewall state before assuming the
new ACL rule alone is sufficient), verify reachability.

**`docs/hosts.md`** — the hermes section's "Planned (2026-08-02, not yet
deployed)" hearth paragraph is rewritten to reflect a live deployment,
with a Tailscale enrollment line matching how Barnabas's entry reads (tag,
tailnet IP, MagicDNS name).

## Execution model

The two repos' file changes go through the normal spec → plan →
implementation flow, including review. The live steps do not:

1. `ssh hermes` to `tailscale up --advertise-tags=tag:services` (operator
   flag matched to hermes' existing convention, confirmed before running).
2. Paste the updated ACL into the Tailscale admin console.
3. Provision `/opt/hearth` (directory + `data/` chowned to `10001:10001`
   for the non-root container).
4. Copy `compose.yaml` and `deploy/` to hermes, run `install-systemd.sh`.
5. Trigger the first deploy, tail logs, confirm the container's healthy.
6. Flip the new GHCR package to public (one-time, by hand).
7. Verify reachability from a tailnet device that isn't hermes itself.

Each of these runs one at a time with Ross watching the result before the
next command goes out — not batched, and not delegated to an autonomous
implementer subagent, because the blast radius (a live host, a live
network ACL) is real even though every step is individually reversible.

## Error handling

- **Bad/unsigned image → fail closed.** `cosign verify` runs between pull
  and `up`; a failure exits before `up -d`, so the last-good container
  keeps running.
- **Timer hiccup → non-fatal.** `SuccessExitStatus=0` plus the `flock`
  lock means a transient GHCR/network failure just retries on the next
  5-minute tick.
- **Port collision.** Checked: roger only binds `9108` (metrics); hearth's
  `8000` default is free on hermes.
- **GHCR package private by default.** First `release.yml` run publishes
  the package private; the deploy host's pull 401s until it's flipped to
  public once, by hand. Documented in `deploy/README.md` so it isn't a
  surprise, same gotcha roger's README already flags.
- **ACL scoped to one port.** The new rule opens only
  `tag:services:8000` — no SSH, no other port on hermes is exposed by
  this change, so a mistake here can't widen access to roger's box.
- **Reversibility.** Every live step undoes independently: `tailscale
  down`/untag hermes, drop the ACL rule, `systemctl disable --now
  hearth-deploy.timer`, `docker compose down`. Nothing here is one-way.

## Testing

- `release.yml` is exercised for real on its first push to `main` — no
  separate CI-of-CI, same as how roger's was validated.
- Before pushing: `docker build .` already works against the existing,
  unchanged Dockerfile — a local sanity check that nothing about the
  image itself needs to change.
- `deploy/hearth-deploy.sh` is a thin shell wrapper over `docker compose`
  + `cosign verify`, not meaningfully unit-testable in isolation;
  correctness comes from the live first-deploy step and from mirroring
  roger's already-proven version line-by-line.
- End-to-end verification is the live smoke test at the end of the
  provisioning runbook: `docker ps` + the existing `HEALTHCHECK` (hits
  `/api/rooms`) confirm the container's healthy, then load the UI from a
  tailnet device that isn't hermes.

## Rejected approaches

- **Reuse roger's sops/age machinery for hearth's (nonexistent) secrets**
  — provision an empty encrypted env file anyway, for consistency with
  roger's shape. Rejected: there is nothing to encrypt today, and an
  empty encrypted file is a maintenance burden (key rotation, backup)
  with no security benefit. Easy to add later if hearth grows a real
  secret (e.g. an auth token in a future phase).
- **Admin-VLAN-only access instead of tailnet enrollment** — no new
  ACL/tailnet work, reachable only from Admin Wi-Fi or wired VLAN 10.
  Rejected per Ross: not "see it from the couch" convenient, and the
  tailnet approach is already the documented direction for every other
  service host in `homelab`.
- **Subnet router on hermes** instead of a scoped host tag — one ACL
  change exposes hermes' whole VLAN instead of one port. Rejected: it's
  explicitly ruled out project-wide in `remote-access.md` ("Never
  `--advertise-routes` on these nodes") because it would re-flatten the
  VLAN segmentation the switch enforces.
- **Skip the Trivy/cosign supply-chain gate** since hearth has no secrets
  to protect. Rejected per Ross: the gate protects the image pull path
  itself (a tampered/compromised GHCR image gets rejected regardless of
  what the app holds), and hermes already has cosign installed, so
  keeping it costs nothing extra.
