from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from runtime_image_refs import ReferenceError, parse_dockerfile, validate_manifest  # noqa: E402

RUNTIME_DIGEST = "sha256:" + "a" * 64
BUILD_DIGEST = "sha256:" + "b" * 64


def dockerfile(runtime_version: str = "3.14", build_version: str = "3.14") -> str:
    return (
        "FROM node:26-slim@sha256:" + "c" * 64 + " AS frontend-build\n"
        f"FROM ghcr.io/r055le/runtime-python:{build_version}-build@{BUILD_DIGEST} AS builder\n"
        f"FROM ghcr.io/r055le/runtime-python:{runtime_version}@{RUNTIME_DIGEST}\n"
    )


def manifest(runtime_digest: str = RUNTIME_DIGEST) -> dict:
    return {
        "release_id": "0123456789abcdef",
        "architecture": "amd64",
        "images": {
            "runtime": {
                "image": "ghcr.io/r055le/runtime-python",
                "digest": runtime_digest,
            },
            "build": {
                "image": "ghcr.io/r055le/runtime-python",
                "digest": BUILD_DIGEST,
            },
        },
    }


def test_current_dockerfile_has_one_matching_owned_pair() -> None:
    pair = parse_dockerfile((REPO_ROOT / "Dockerfile").read_text())
    assert pair.python == "3.14"
    assert pair.runtime.digest.startswith("sha256:")
    assert pair.build.digest.startswith("sha256:")


def test_mismatched_versions_fail() -> None:
    with pytest.raises(ReferenceError, match="versions do not match"):
        parse_dockerfile(dockerfile(runtime_version="3.13"))


def test_missing_build_image_fails() -> None:
    with pytest.raises(ReferenceError, match="one owned runtime and one build"):
        parse_dockerfile(
            f"FROM ghcr.io/r055le/runtime-python:3.14@{RUNTIME_DIGEST}\n"
        )


def test_malformed_owned_image_reference_fails() -> None:
    with pytest.raises(ReferenceError, match="expected pinned form"):
        parse_dockerfile(
            dockerfile()
            + "FROM ghcr.io/r055le/runtime-python:latest AS unexpected\n"
        )


def test_manifest_accepts_exact_release_pair() -> None:
    pair = parse_dockerfile(dockerfile())
    assert validate_manifest(pair, manifest()) == "0123456789abcdef"


def test_manifest_digest_mismatch_fails() -> None:
    pair = parse_dockerfile(dockerfile())
    with pytest.raises(ReferenceError, match="runtime digest"):
        validate_manifest(pair, manifest("sha256:" + "d" * 64))
