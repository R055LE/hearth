# Known findings

There are currently no HIGH or CRITICAL findings in the complete Hearth image.
This is dated evidence, not a promise that the image stays empty.

## Measured baseline

Measured 2026-09-15 from the application image built against Python runtime
release [`d9c6793894b54929`](https://github.com/R055LE/runtime-images/releases/tag/python-3.14-d9c6793894b54929):

- runtime digest:
  `sha256:68ddb601f72a34e1d4c50dbc848945cf71495eda621859a26bbb90fe52d4c5c4`
- build digest:
  `sha256:7d20a35e5ed457628e2d5c140ef2f854754b5e5c5ea4c18409e7f1b94cf430d5`
- runtime packages: 26
- build packages: 50
- complete application image: zero HIGH or CRITICAL findings across the Wolfi
  and Python package inventories, scanned with Trivy 0.74.0 and a freshly
  downloaded vulnerability database; the fixable-finding gate also passed

The prior distroless baseline had 15 HIGH findings across five CVEs. Moving to
the owned runtime removed those affected Debian Python, ncurses, and OpenSSL
packages rather than suppressing their scanner output. The previous evidence
remains in repository history.

## Trust boundary

`R055LE/runtime-images` owns composition and daily package-risk evaluation for
the shared runtime. Hearth pins its runtime and ABI-matched build companion by
digest. Both must match the latest producer release manifest, and CI verifies
the producer workflow's cosign identity, provenance, and SPDX attestation before
Docker consumes either image.

Hearth still scans the complete application image. The producer's signature is
evidence of origin and contents, not evidence that Hearth's dependencies or
application behavior are safe.

Nothing is hidden from Trivy. The release workflow prints every HIGH and
CRITICAL finding, then applies the current Hearth release gate. Any future
non-blocking finding must be documented here with image-level or
application-specific evidence while remaining visible in scanner output.

## Review triggers

Re-run the complete image scan and update this file when any of these changes:

- either runtime image digest;
- the Python or JavaScript dependency locks;
- the release scan reports a HIGH or CRITICAL finding;
- Hearth adds an input path relevant to a recorded vulnerability; or
- 90 days pass without an evidence review.

The immutable application digest and scan output from each publication remain
in the release workflow record. Do not add findings to `.trivyignore`.
