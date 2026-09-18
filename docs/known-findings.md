# Known findings

There are currently no HIGH or CRITICAL findings in the complete Hearth image.
This is dated evidence, not a promise that the image stays empty.

## Measured baseline

Measured 2026-09-18 from the application image built against Python runtime
release [`e3ec311769752a59`](https://github.com/R055LE/runtime-images/releases/tag/python-3.14-e3ec311769752a59):

- runtime digest:
  `sha256:5f877edcd076bbcfc2f5b1fbd49f98ad469676cadf6d030279f01b875fc7bb91`
- build digest:
  `sha256:a5a6835b51b829772c977f85110976cfc12fb2a20ea6cb8ea34fdd05df95f767`
- runtime packages: 26
- build packages: 50
- scanned local application image ID:
  `sha256:5178d6fb2a1a1b6b1525348304eefa0acef8b5777d74ca6d6d31aff36cc1ea91`
- complete application image: zero HIGH or CRITICAL findings across the Wolfi
  and Python package inventories, scanned with Trivy 0.74.0 and a vulnerability
  database updated 2026-09-18T07:09Z; the fixable-finding gate also passed

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
