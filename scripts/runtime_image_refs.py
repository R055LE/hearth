#!/usr/bin/env python3
"""Parse and cross-check Hearth's owned Python runtime image references."""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

FROM_RE = re.compile(
    r"^FROM "
    r"(?P<image>ghcr\.io/r055le/runtime-python):"
    r"(?P<version>[0-9]+\.[0-9]+)(?P<build>-build)?@"
    r"(?P<digest>sha256:[0-9a-f]{64})"
    r"(?: AS [A-Za-z0-9._-]+)?$"
)
OWNED_FROM_RE = re.compile(
    r"^\s*FROM\s+.*ghcr\.io/r055le/runtime-python(?=[:@])", re.IGNORECASE
)
RELEASE_RE = re.compile(r"[0-9a-f]{16}")


class ReferenceError(Exception):
    pass


@dataclass(frozen=True)
class ImageReference:
    image: str
    tag: str
    digest: str

    @property
    def ref(self) -> str:
        return f"{self.image}:{self.tag}@{self.digest}"


@dataclass(frozen=True)
class ImagePair:
    python: str
    runtime: ImageReference
    build: ImageReference


def parse_dockerfile(text: str) -> ImagePair:
    lines = text.splitlines()
    owned_lines = [line for line in lines if OWNED_FROM_RE.match(line)]
    matches = [match for line in owned_lines if (match := FROM_RE.fullmatch(line))]
    if len(matches) != len(owned_lines):
        raise ReferenceError("owned image references must use the expected pinned form")
    runtime = [match for match in matches if match.group("build") is None]
    build = [match for match in matches if match.group("build") is not None]
    if len(runtime) != 1 or len(build) != 1:
        raise ReferenceError("Dockerfile must contain one owned runtime and one build image")
    if runtime[0].group("version") != build[0].group("version"):
        raise ReferenceError("runtime and build image versions do not match")

    version = runtime[0].group("version")
    image = runtime[0].group("image")
    return ImagePair(
        python=version,
        runtime=ImageReference(image, version, runtime[0].group("digest")),
        build=ImageReference(image, f"{version}-build", build[0].group("digest")),
    )


def validate_manifest(pair: ImagePair, payload: Any) -> str:
    if not isinstance(payload, dict):
        raise ReferenceError("release manifest must be a JSON object")
    release_id = payload.get("release_id")
    if not isinstance(release_id, str) or not RELEASE_RE.fullmatch(release_id):
        raise ReferenceError("release manifest has an invalid release ID")
    if payload.get("architecture") != "amd64":
        raise ReferenceError("release manifest is not for amd64")
    images = payload.get("images")
    if not isinstance(images, dict):
        raise ReferenceError("release manifest has no images object")

    for variant, reference in (("runtime", pair.runtime), ("build", pair.build)):
        record = images.get(variant)
        if not isinstance(record, dict):
            raise ReferenceError(f"release manifest has no {variant} image")
        if record.get("image") != reference.image:
            raise ReferenceError(f"{variant} image repository does not match the manifest")
        if record.get("digest") != reference.digest:
            raise ReferenceError(f"{variant} digest does not match the latest release")
    return release_id


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dockerfile", type=Path, default=Path("Dockerfile"))
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--github-output", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        pair = parse_dockerfile(args.dockerfile.read_text())
        release_id = ""
        if args.manifest:
            release_id = validate_manifest(
                pair, json.loads(args.manifest.read_text())
            )
        output = {
            "python": pair.python,
            "runtime_ref": pair.runtime.ref,
            "build_ref": pair.build.ref,
            "release_id": release_id,
        }
        print(json.dumps(output, sort_keys=True))
        if args.github_output:
            with args.github_output.open("a") as stream:
                for key, value in output.items():
                    if value:
                        stream.write(f"{key}={value}\n")
    except (OSError, json.JSONDecodeError, ReferenceError) as exc:
        print(f"runtime image reference check failed: {exc}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
