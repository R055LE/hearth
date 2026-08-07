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
