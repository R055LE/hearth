# Known findings

There are currently no HIGH or CRITICAL findings in the complete Hearth image.
This is dated evidence, not a promise that the image stays empty.

## Measured baseline

Measured 2026-10-01 from the application image built against Python runtime
release [`ab32280d127a56fd`](https://github.com/R055LE/runtime-images/releases/tag/python-3.14-ab32280d127a56fd):

- runtime digest:
  `sha256:450086562d690e735f0ca7648d1840482f4007124e1e43b0d37688c44eb12ae3`
- build digest:
  `sha256:46f6ce19fd1e25b10c11b84adf0d965855c314c23515bab47b5fb0d60a284a14`
- runtime packages: 31
- build packages: 55
- scanned local application image ID:
  `sha256:a22781b3e7b38286d0fd87319ea48f9f9d5262787c3f5cc2cdfa9caaf58aabb9`
- complete application image: zero HIGH or CRITICAL findings across the Wolfi
  and Python package inventories, scanned with Trivy 0.74.0 and a vulnerability
  database updated 2026-10-01T13:01Z; the fixable-finding gate also passed

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
