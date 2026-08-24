# Known findings

CRITICAL and HIGH vulnerabilities currently reported for the published image,
why they do not block release today, and what would change that decision.

Per runbook `decisions/0011`, the release workflow prints every finding and only
blocks on findings with a fix available. Nothing listed here is suppressed from
the report.

## Measured baseline

Measured 2026-08-24 against the immutable distroless image digest published from
commit `54c7f9f`:

```
trivy image --image-src remote --scanners vuln --severity CRITICAL,HIGH \
  ghcr.io/r055le/hearth@sha256:bf6861f89353bd7760b912a83d15c693dbeecedbc97101a30c45aa5694c25741
```

`--image-src remote` is load-bearing when scanning a registry tag from a deploy
host. Without it, Trivy may prefer a stale image with the same tag in the local
Docker daemon. That happened during the review which produced this register: a
scan labelled `ghcr.io/r055le/hearth:main` reported the retired slim image until
the registry digest and release log were checked independently.

Summary: 15 HIGH findings, 5 unique CVEs, zero CRITICAL, and no fixed versions
available in Debian 13 at measurement time.

| cluster | CVEs | findings | worst |
|---|---:|---:|---:|
| Python 3.13 stdlib | 3 | 12 | HIGH |
| ncurses libraries | 1 | 2 | HIGH |
| OpenSSL library | 1 | 1 | HIGH |

The previous `python:3.14-slim` runtime reported 23 findings including four
CRITICAL findings in `perl-base`. Moving the final stage to distroless removed
Perl, gzip, and most of util-linux from the runtime. It also made Debian's Python
packages visible to the scanner, so interpreter findings which the application
does not exercise are now explicit rather than absent from inventory.

## CVE-2026-11940: Python tar extraction filter bypass

```yaml
id: CVE-2026-11940
last_reviewed: 2026-08-24
review_interval_days: 90
status: affected
fixed_version: null
```

- **Reported packages:** `libpython3.13-minimal`, `libpython3.13-stdlib`,
  `python3.13-minimal`, and `python3.13-venv` at `3.13.5-2+deb13u4`.
- **Affected path:** extraction of a crafted tar archive through Python's
  `tarfile` filters can write outside the destination directory.
- **Hearth reachability:** the runtime service has no archive upload or
  extraction path and does not import `tarfile`. User-controlled input cannot
  reach the affected operation in the current application.
- **Resolution:** upgrade when Debian 13 publishes a fixed Python package or
  when a base image update removes the affected packages. Reassess immediately
  if Hearth adds archive upload, inspection, or extraction.
- **Source:** [Debian security tracker](https://security-tracker.debian.org/tracker/CVE-2026-11940).

## CVE-2026-15308: Python incremental HTML parser denial of service

```yaml
id: CVE-2026-15308
last_reviewed: 2026-08-24
review_interval_days: 90
status: affected
fixed_version: null
```

- **Reported packages:** `libpython3.13-minimal`, `libpython3.13-stdlib`,
  `python3.13-minimal`, and `python3.13-venv` at `3.13.5-2+deb13u4`.
- **Affected path:** repeated unterminated markup declarations fed
  incrementally to `html.parser.HTMLParser` can cause excessive CPU use.
- **Hearth reachability:** Hearth does not import the standard library HTML
  parser and has no endpoint that parses user-provided HTML. User-controlled
  input cannot reach the affected parser in the current application.
- **Resolution:** upgrade when Debian 13 publishes a fixed Python package or
  when a base image update removes the affected packages. Reassess immediately
  if Hearth adds HTML ingestion or incremental HTML parsing.
- **Source:** [Debian security tracker](https://security-tracker.debian.org/tracker/CVE-2026-15308).

## CVE-2026-7210: Python XML hash-flooding protection

```yaml
id: CVE-2026-7210
last_reviewed: 2026-08-24
review_interval_days: 90
status: affected
fixed_version: null
```

- **Reported packages:** `libpython3.13-minimal`, `libpython3.13-stdlib`,
  `python3.13-minimal`, and `python3.13-venv` at `3.13.5-2+deb13u4`.
- **Affected path:** crafted XML parsed through `xml.parsers.expat` or
  `xml.etree.ElementTree` can trigger hash flooding.
- **Hearth reachability:** the running service has no XML endpoint and does not
  import either affected parser. The repository's local draw.io importer uses
  `defusedxml` and is not copied into the runtime image. User-controlled runtime
  input cannot reach the affected parser in the current application.
- **Resolution:** upgrade after Debian 13 ships both the Python and Expat fixes,
  or when a base image update removes the affected packages. Reassess
  immediately if XML parsing moves into the runtime service.
- **Source:** [Debian security tracker](https://security-tracker.debian.org/tracker/CVE-2026-7210).

## CVE-2025-69720: ncurses `infocmp` buffer overflow

```yaml
id: CVE-2025-69720
last_reviewed: 2026-08-24
review_interval_days: 90
status: affected
fixed_version: null
```

- **Reported packages:** `libncursesw6` and `libtinfo6` at
  `6.5+20250216-2`.
- **Affected path:** the `infocmp` command-line utility can overflow a stack
  buffer while analyzing a crafted terminal description.
- **Hearth reachability:** Hearth is a headless HTTP service and does not invoke
  `infocmp` or accept terminal descriptions. The distroless image has no shell
  or interactive command path. The libraries remain present, so this is weaker
  evidence than proving the vulnerable code is absent.
- **Resolution:** upgrade when Debian 13 publishes a fixed ncurses package or
  when a base image update removes the affected libraries. Reassess immediately
  if terminal capability tooling becomes executable in the runtime.
- **Source:** [Debian security tracker](https://security-tracker.debian.org/tracker/CVE-2025-69720).

## CVE-2026-14456: OpenSSL QUIC listener memory growth

```yaml
id: CVE-2026-14456
last_reviewed: 2026-08-24
review_interval_days: 90
status: fix_deferred
fixed_version: null
```

- **Reported package:** `libssl3t64` at `3.5.6-1~deb13u2`.
- **Affected path:** an OpenSSL QUIC server listener can queue unbounded incoming
  channels when valid Initial packets arrive faster than the application accepts
  them, causing memory-exhaustion denial of service.
- **Hearth reachability:** the container runs Uvicorn as a plain HTTP server and
  configures no TLS or QUIC listener. Network input cannot reach OpenSSL's QUIC
  server path through the current application.
- **Resolution:** upgrade when Debian 13 publishes an OpenSSL package containing
  the 3.5 branch fix or when a base image update removes the affected library.
  Reassess immediately if TLS or QUIC termination moves into the container.
- **Sources:** [OpenSSL advisory](https://openssl-library.org/news/secadv/20260813.txt),
  [Debian security tracker](https://security-tracker.debian.org/tracker/CVE-2026-14456).

## Review triggers

Re-run the remote digest scan and update every entry's `last_reviewed` field when
any of these changes:

- the distroless base digest;
- Debian publishes a fixed version;
- Hearth adds an input path which reaches one of the affected code paths;
- the release scan reports a different HIGH/CRITICAL inventory; or
- an entry reaches 90 days since `last_reviewed`.

Finding counts and severities are a measured snapshot. The release output is
the current operational record. Keep every finding visible in scanner output;
do not add these entries to `.trivyignore`.
