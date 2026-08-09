# Known findings

CRITICAL and HIGH CVEs currently present in the published image, why they
haven't been fixed, and what would fix them.

Per runbook `decisions/0011`: everything the scanner finds stays visible, and
only a subset blocks a release. Nothing here is suppressed. `release.yml` prints
all of these on every run and blocks on the ones with a fix available.

**These were invisible until 2026-08-08.** The release gate ran a single Trivy
scan with `ignore-unfixed: true`, which filters unfixable findings out of the
*output*, not just out of the blocking decision. The workflow reported a clean
scan while the image carried 23 findings, 4 of them CRITICAL. The gate was not
wrong about what it blocked on. It was silent about everything else, and silence
read as safety.

## Summary

23 findings, 12 unique CVEs, none with a Debian fix released.

| cluster | CVEs | findings | worst |
|---|---|---|---|
| `perl-base` | 6 | 6 | **CRITICAL** ×4 |
| `util-linux` family | 1 | 9 | HIGH |
| `ncurses` | 1 | 4 | HIGH |
| `gzip` | 1 | 1 | HIGH |
| `libacl1` | 1 | 1 | HIGH |

## The honest summary

**Every one of these comes from the Debian base image, and none of them is
code hearth calls.** The application is FastAPI and SQLAlchemy behind uvicorn.
It does not invoke perl, does not read partition tables, does not use a
terminal, and does not shell out to gzip.

That is an argument about reachability, not about absence, and it is weaker than
it sounds. Verified in the published image on 2026-08-08:

```
infocmp  PRESENT     perl     PRESENT
tic      PRESENT     gzip     PRESENT
tput     PRESENT     mount    PRESENT
```

Every vulnerable program is on disk, not merely a linked library. This is the
opposite of the distroless lab images, where the same ncurses CVE is genuinely
unreachable because `infocmp` does not exist in the image at all. Here, an
attacker who achieves execution in the container has perl and a working
toolchain of shell utilities available. "The application doesn't call it" is a
statement about the application, not about what an attacker can reach.

**The real fix is a base image that doesn't ship them.** `container-hardening-lab`
took its python image from 11 findings to 1 by moving the final stage to
distroless, which removes perl, util-linux, ncurses and gzip outright rather
than arguing they're unreachable. hearth should follow. Tracked separately;
until then this file is the record rather than the resolution.

---

## `perl-base` — 6 CVEs, 4 CRITICAL

`CVE-2026-13221`, `CVE-2026-42496`, `CVE-2026-57433`, `CVE-2026-8376`
(CRITICAL), `CVE-2026-42497`, `CVE-2026-48962`, `CVE-2026-57432`,
`CVE-2026-9538` (HIGH). No fix released.

**Why it's here at all:** `python:3.14-slim` ships `perl-base` as part of the
Debian base. Nothing in hearth uses it.

**Why it isn't blocking a deploy today:** no fix exists to apply, and the
runtime has no path that invokes perl.

**Why that's an uncomfortable answer:** these are the highest-severity findings
in the image, and "the app doesn't call it" is a statement about the app, not
about the attack surface. `container-hardening-lab`'s Debian-based images used
to force-purge the dpkg record with
`dpkg --purge --force-depends --force-remove-essential perl-base`, because
`apt remove` won't take it and deleting the binary leaves the package registered
where scanners still see it. That is available as an interim if a distroless
migration is delayed.

**Resolved by:** a distroless base, or purging `perl-base` as above.

## `util-linux` family — `CVE-2026-53615`, 9 findings

`bsdutils`, `libblkid1`, `liblastlog2-2`, `libmount1`, `libsmartcols1`,
`libuuid1`, `login`, `mount`, `util-linux`. No fix released.

Integer overflow in `libblkid/src/partitions/dos.c`, reached when parsing a DOS
partition table. This container has no block devices and never calls the
partition parser.

Nine findings, one defect — Debian splits util-linux across many packages, so
the count overstates the problem. Finding counts are a poor proxy for risk.

**Resolved by:** a Debian fix, or a base image that doesn't ship util-linux.

## `ncurses` — `CVE-2025-69720`, 4 findings

`libncursesw6`, `libtinfo6`, `ncurses-base`, `ncurses-bin`. No fix released.

Stack overflow in `analyze_string` in `progs/infocmp.c`.

**Verified 2026-08-08: `infocmp`, `tic` and `tput` are all present in this
image.** In the distroless lab images they are absent, which makes the
"vulnerable code isn't here" argument a fact. Here it is not available: the
vulnerable program ships.

**Resolved by:** a Debian fix, or a base without ncurses.

## `gzip` — `CVE-2026-41992`, 1 finding

No fix released. The application does not shell out to gzip, and Python's `gzip`
module is stdlib rather than a wrapper around this binary. The binary is present
regardless (verified above).

## `libacl1` — `CVE-2026-54369`, 1 finding

No fix released. POSIX ACL library, pulled in transitively. Nothing in hearth
manipulates ACLs.

---

## Review

The right trigger for revisiting this file is a base image change, not a
calendar reminder. If hearth moves to distroless, most of this file should
disappear rather than be re-justified. If it hasn't moved and Debian has shipped
fixes, the release will start blocking on them by itself, which is the gate
working as intended.
