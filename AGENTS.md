# hearth

Self-hosted home information tracker. Python/FastAPI backend, React frontend,
SQLite, shipped as one container. `ARCHITECTURE.md` has the layout,
`deploy/README.md` has the deploy pipeline.

## Merging to main deploys to a live host

There's no separate deploy step and no staging. `release.yml` builds on every
push to `main`, and the host polls the published tag **every 5 minutes**, so a
merge reaches the running service in about that long.

Two things gate it, and both matter:

- `release.yml` runs on `workflow_run` of `ci` with
  `conclusion == 'success'`, so a red or cancelled CI can't publish.
- It builds, **scans with Trivy, and only then pushes**. A fixable HIGH or
  CRITICAL finding does not reach GHCR under the current gate. The scan is the
  last thing standing between a merge and the host.
- **Two scans, one blocking.** Per runbook `decisions/0011` everything the
  scanner finds is printed and only findings with a fix available block the
  release. The unfixable ones are recorded in `docs/known-findings.md`, not
  hidden. Before 2026-08-08 a single scan used `ignore-unfixed: true`, which
  filtered them out of the output entirely, so the workflow reported clean
  while the image carried 23 CRITICAL/HIGH findings.

**The Trivy gate does not run on pull requests.** A PR can be green on all
three checks and still fail the release. That happened on 2026-08-08: the
python 3.14 bump passed CI, merged, and then blocked the deploy. If a change
touches the image, scan it locally before merging:

```
docker build -t hearth-check .
trivy image --severity CRITICAL,HIGH --ignore-unfixed hearth-check
```

## Invariants worth knowing before you edit

**Runtime versions come from the Dockerfile.** `ci.yml` has a `runtimes` job
that parses the `FROM` lines and feeds `setup-python` and `setup-node`. Don't
hardcode a version back into `ci.yml`. The point is that a base image bump
can't move what ships without moving what's tested, and nothing catches you if
you undo it: the tests stay green either way, which is exactly the failure the
job exists to prevent.

**The distroless runtime has no pip or shell on purpose.** Python dependencies
are installed from `uv.lock` in the builder and only site-packages are copied to
the runtime. Do not copy the builder's package manager or shell into the final
stage; doing so expands the attack surface and changes Trivy's inventory.

**`uv.lock` is part of the release input.** CI uses `uv sync --frozen`, and the
Docker builder does the same. A dependency change is incomplete until the lock
is refreshed. `backend/requirements-uv.txt` separately pins the build tool that
reads it.

**The base images are pinned by digest, not just tag.** Dependabot bumps the
digest and the comment together. Keep both in sync when editing by hand.

**`/data` is the only writable path.** The rootfs is read-only and the process
runs as the distroless `nonroot` uid 65532. Anything that needs to write goes in
the volume.

## Working here

Review before starting a development slice, then review again as the seams move.
At minimum, compare the application behavior, migrations, tests, dependency
inputs, image, deploy controls, and docs. A green check proves its assertions
passed; it does not prove those pieces still agree. Record decisions where the
next change will find them, and keep the security posture and known findings
current. Review is recurring maintenance, not a one-time certification.

One issue, one branch, one worktree under `.claude/worktrees/<slug>` (already
gitignored), one PR. `main` is protected with `enforce_admins`, so the PR path
is forced rather than encouraged. Reviews aren't required, this is solo work.

Fleet-wide decisions that govern this repo live in
[`R055LE/runbook/decisions`](https://github.com/R055LE/runbook/tree/main/decisions),
indexed in that directory's README. `0009` is the one that explains why
dependency automation here is Dependabot and nothing else.
