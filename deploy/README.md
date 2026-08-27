# Deploying hearth

Pull-based continuous deployment: nothing pushes *in* to the deploy host, it only ever
reaches *out* to GHCR.

```
push to main ──▶ GitHub Actions ──▶ ghcr.io/r055le/hearth:main
                                              │
                        deploy host: hearth-deploy.timer (every 5 min)
                                              │
                    pull → verify digest → backup → up --wait
```

- **`release.yml`** builds the image on every push to `main`, scans it with **Trivy**, and blocks
  fixable HIGH/CRITICAL findings before push. It publishes the full scan output, the public image
  with SBOM and provenance attestations, and a **keyless cosign signature** (Fulcio/Rekor, no
  private key).
- **`hearth-deploy.timer`** on the host polls that tag every 5 minutes, resolves the image Docker
  pulled to an immutable digest, **verifies that digest's cosign signature** against the release
  workflow's OIDC identity, and redeploys only when the digest changed. Before a change it takes a
  bounded SQLite online backup, then waits for the new container to become healthy. A bad
  signature, failed backup, migration error, or unhealthy container fails the deploy visibly.
  Docker's `restart: unless-stopped` keeps hearth running across reboots; the timer keeps it
  *current*.

hearth has no secrets today (no auth, no external API keys) — `DB_PATH` and `PORT` both have
safe defaults baked into `compose.yaml`, so there's no encrypted env file to manage here.
`/opt/hearth` is just the compose file plus the `data/` bind mount.

## Pieces

| File | Role |
|---|---|
| `hearth-deploy.sh` | Pull + exact-digest **cosign verify** + SQLite backup + health-gated deploy. Installed as `/usr/local/bin/hearth-deploy`. |
| `hearth-deploy.service` / `.timer` | systemd oneshot + 5-minute poll timer. |
| `install-systemd.sh` | Install the above and enable the timer (runs the deploy as the invoking user). |

There's no `bootstrap.sh` here — this assumes the host already has Docker, a current Compose v2
plugin with `up --wait`, and cosign installed (true for any host already running another app with
this same deploy pattern). If the host is genuinely fresh, install those three first.

## First-time provision

Run from a checkout, against a host you can reach over SSH. Set `HOST` to that host.

```bash
HOST=your-deploy-host

# 1. Provision the deploy dir. 65532 matches the image's runtime uid (see ../Dockerfile) so
#    the read-only container can write the SQLite DB into the bind mount.
ssh "$HOST" 'sudo install -d -o "$USER" -g "$USER" /opt/hearth && \
             sudo install -d /opt/hearth/data && sudo chown 65532:65532 /opt/hearth/data'
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

## Existing data directory ownership

The runtime uid changed from `10001` to `65532` during the earlier distroless
migration. The owned Wolfi runtime deliberately keeps uid `65532`, so that move
does not require another ownership change. A deploy which predates the earlier
migration still needs this one-time correction or the container cannot open its
database:

```bash
ssh "$HOST" 'sudo systemctl stop hearth-deploy.timer && \
             sudo chown -R 65532:65532 /opt/hearth/data && \
             sudo systemctl start hearth-deploy.timer'
```

It fails loudly rather than quietly, which is worth knowing before you do it. On
a directory the runtime user cannot write, the container exits 1 during
migrations with `sqlite3.OperationalError: unable to open database file`. There
is no state where it starts and serves with a database it cannot write, so a
missed chown costs a restart, not data.

## Day-to-day

- **Ship a change:** push to `main`. CI gates it, the image builds, the host redeploys within
  ~5 minutes. Nothing else to do.
- **Deploy now:** `ssh "$HOST" 'sudo systemctl start hearth-deploy.service'`.
- **Watch logs:** `journalctl -u hearth-deploy.service -f` (deploys) or
  `docker logs -f "$(docker ps -q --filter name=hearth)"` (the app).
- **List deploy backups:** `ls -lt /opt/hearth/data/backups`. A backup is created only when the
  pulled digest differs from the running container, and the newest 10 are retained by default.
- **Reach the running app:** this covers getting the container running on the host only.
  Making its port reachable from your own devices (VPN/tailnet, VLAN policy, etc.) is a
  network-level decision made outside this repo.

## Notes

- **Pinning vs. tracking.** hearth's own image tracks the `:main` channel on purpose — that's
  what continuous deploy is. For release-gated prod, point `compose.yaml` at a `:sha-<...>` tag
  and bump it deliberately.
- **Signature gate.** `hearth-deploy.sh` resolves the image returned by `docker compose pull` to a
  repository digest and verifies that immutable reference, pinned to the release workflow's
  identity (`…/release.yml@refs/heads/main`) and the GitHub OIDC issuer. Compose starts the same
  digest. This closes the tag race where verification could otherwise approve a newer manifest
  than the local tag points to.
- **Backup and health gate.** The verified image runs Python's SQLite online backup API against
  the live database before replacement. Compose then waits on the image healthcheck. No automatic
  database restore or image rollback is attempted, because startup migrations are not assumed to
  be backward-compatible. On failure, stop the timer and container, preserve the current database
  plus any WAL/SHM files, restore a selected standalone backup, and start a known-compatible image.
  The failed systemd unit and container logs are the evidence for choosing that image.

## Updating the host-side deploy controls

The image poll does not update `compose.yaml` or `/usr/local/bin/hearth-deploy` itself. After a
change to either file, copy the new Compose file and reinstall the timer before relying on the new
control:

```bash
scp ../compose.yaml "$HOST":/opt/hearth/
scp -r . "$HOST":/tmp/hearth-src
ssh "$HOST" 'sudo bash /tmp/hearth-src/install-systemd.sh'
```
