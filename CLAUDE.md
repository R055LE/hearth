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
- It builds, **scans with Trivy, and only then pushes**, so a vulnerable image
  never reaches GHCR. The scan is the last thing standing between a merge and
  the host.

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

**pip is uninstalled from the runtime image on purpose.** Nothing at runtime
invokes it, and pip ships a CycloneDX SBOM describing its own vendored bundle
that Trivy reads as installed inventory. Leaving pip in means the release gate
reports vulnerabilities in packages the image doesn't expose. If you reinstate
it, the gate will fail and it will look like an unrelated dependency problem.

**The base images are pinned by digest, not just tag.** Dependabot bumps the
digest and the comment together. Keep both in sync when editing by hand.

**`/data` is the only writable path.** The rootfs is read-only and the process
runs as uid 10001. Anything that needs to write goes in the volume.

## Working here

One issue, one branch, one worktree under `.claude/worktrees/<slug>` (already
gitignored), one PR. `main` is protected with `enforce_admins`, so the PR path
is forced rather than encouraged. Reviews aren't required, this is solo work.

Fleet-wide decisions that govern this repo live in
[`R055LE/runbook/decisions`](https://github.com/R055LE/runbook/tree/main/decisions),
indexed in that directory's README. `0009` is the one that explains why
dependency automation here is Dependabot and nothing else.
