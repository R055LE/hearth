# Known findings

CRITICAL and HIGH vulnerabilities currently reported for the published image,
why they do not block release today, and what would change that decision.

Per runbook `decisions/0011`, the release workflow prints every finding and only
blocks on findings with a fix available. Nothing listed here is suppressed from
the report.

## Measured baseline

Measured 2026-08-10 against the immutable distroless image digest published from
commit `46018df`:

```
trivy image --image-src remote --severity CRITICAL,HIGH \
  ghcr.io/r055le/hearth@sha256:dceee0b0a14faa8e92f9ee9bfacea3c0bcab69d31c728ebff97d9ddef6e381bd
```

`--image-src remote` is load-bearing when scanning a registry tag from a deploy
host. Without it, Trivy may prefer a stale image with the same tag in the local
Docker daemon. That happened during the review which produced this update: a
scan labelled `ghcr.io/r055le/hearth:main` reported the retired slim image until
the registry digest and release log were checked independently.

Summary: 15 HIGH findings, 5 unique CVEs, zero CRITICAL, and no fixed versions
available in Debian 13 at measurement time.

| cluster | CVEs | findings | worst |
|---|---:|---:|---:|
| Python 3.13 stdlib | 3 | 12 | HIGH |
| ncurses libraries | 1 | 2 | HIGH |
| util-linux library | 1 | 1 | HIGH |

The previous `python:3.14-slim` runtime reported 23 findings including four
CRITICAL findings in `perl-base`. Moving the final stage to distroless removed
Perl, gzip, and most of util-linux from the runtime. It also made Debian's Python
packages visible to the scanner, so interpreter findings which the application
does not exercise are now explicit rather than absent from inventory.

## Python 3.13 stdlib

`CVE-2026-11940`, `CVE-2026-15308`, and `CVE-2026-7210` are each reported
against four Debian packages, producing 12 findings for three defects.

The affected code paths are tar extraction filters, the HTML parser, and Expat
XML parsing. The running Hearth service exposes no upload, archive extraction,
HTML parsing, or XML parsing endpoint. The drawio importer uses `defusedxml`, is
a local command-line tool, and is not copied into the runtime image.

This is an application-specific reachability statement. It must be revisited if
Hearth gains file uploads, archive handling, HTML ingestion, or XML parsing. A
Debian fixed version would make the release gate block automatically.

## ncurses libraries

`CVE-2025-69720` is reported against `libncursesw6` and `libtinfo6`. Hearth is a
headless HTTP service and does not use terminal capability parsing. Distroless
also removes the shell and interactive debugging path that made the old slim
image's terminal utilities useful to an attacker after code execution.

The packages remain present, so this is weaker evidence than proving the
vulnerable code is absent. Keep the finding visible until the base image removes
it or Debian publishes a fix.

## util-linux library

`CVE-2026-53615` is reported against `libuuid1`. The defect is in DOS partition
table parsing. The container has no block devices and Hearth does not parse
partition tables.

The package remains part of the distroless base. Keep the finding visible until
the base removes it or Debian publishes a fix.

## Review triggers

Re-run the remote digest scan and update this file when any of these changes:

- the distroless base digest;
- Debian publishes a fixed version;
- Hearth adds an input path which reaches one of the affected parsers; or
- the release scan reports a different HIGH/CRITICAL inventory.

Finding counts and severities are a measured snapshot. The release output is
the current operational record.
