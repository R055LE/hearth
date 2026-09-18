from __future__ import annotations

import json
import os
import shlex
import shutil
import stat
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "verify-runtime-images.sh"
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from runtime_image_refs import parse_dockerfile  # noqa: E402

PAIR = parse_dockerfile((REPO_ROOT / "Dockerfile").read_text())
PYTHON = shlex.quote(sys.executable)
BASH = shutil.which("bash")
assert BASH is not None

RELEASE_ID = "099a0c5173305d79"
RELEASE_TAG = f"python-{PAIR.python}-{RELEASE_ID}"
RUNTIME_REF = PAIR.runtime.ref
BUILD_REF = PAIR.build.ref


def write_shim(path: Path, body: str) -> None:
    path.write_text(f"#!/bin/sh\n{body}\n")
    path.chmod(path.stat().st_mode | stat.S_IEXEC)


def manifest(
    runtime_digest: str = PAIR.runtime.digest,
    build_digest: str = PAIR.build.digest,
) -> dict[str, object]:
    return {
        "release_id": RELEASE_ID,
        "architecture": "amd64",
        "images": {
            "runtime": {
                "image": PAIR.runtime.image,
                "digest": runtime_digest,
            },
            "build": {
                "image": PAIR.build.image,
                "digest": build_digest,
            },
        },
    }


@pytest.fixture
def environment(tmp_path: Path) -> dict[str, str]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()

    write_shim(
        bin_dir / "jq",
        f"""case " $* " in
*" --arg prefix "*)
    {PYTHON} - "$6" "$4" <<'PYEOF'
import json, sys
entries = json.load(open(sys.argv[1]))
prefix = sys.argv[2]
matches = [entry["tagName"] for entry in entries if entry["tagName"].startswith(prefix)]
print(matches[0] if matches else "")
PYEOF
    ;;
*" .release_id "*)
    {PYTHON} -c 'import json,sys; print(json.load(sys.stdin)["release_id"])'
    ;;
*" .runtime_ref "*)
    {PYTHON} -c 'import json,sys; print(json.load(sys.stdin)["runtime_ref"])'
    ;;
*" .build_ref "*)
    {PYTHON} -c 'import json,sys; print(json.load(sys.stdin)["build_ref"])'
    ;;
*" .python "*)
    {PYTHON} -c 'import json,sys; print(json.load(sys.stdin)["python"])'
    ;;
esac
""",
    )

    write_shim(
        bin_dir / "gh",
        """case "$1 $2" in
"release list")
    echo "release-list" >> "$TRACE"
    if [ "${FAIL_STAGE:-}" = "release lookup" ]; then
        echo "gh: lookup unavailable" >&2
        exit 1
    fi
    printf '%s\n' "${RELEASE_LIST:-[]}"
    ;;
"release download")
    echo "release-download:$3" >> "$TRACE"
    if [ "${FAIL_STAGE:-}" = "release download" ]; then
        echo "gh: download unavailable" >&2
        exit 1
    fi
    printf '%s' "$MANIFEST_JSON" > "${9}/release-manifest.json"
    ;;
"attestation verify")
    kind=provenance
    case " $* " in
        *" --predicate-type "*) kind=spdx ;;
    esac
    ref=${3#oci://}
    printf 'attestation:%s:%s\n' "$kind" "$ref" >> "$TRACE"
    if [ "${FAIL_STAGE:-}" = "$kind" ] && [ "$FAIL_REF" = "$ref" ]; then
        echo "gh: no $kind attestation" >&2
        exit 1
    fi
    echo "verified $kind attestation for $ref"
    ;;
esac
""",
    )

    write_shim(
        bin_dir / "cosign",
        """for arg do ref=$arg; done
echo "signature:$ref" >> "$TRACE"
if [ "${FAIL_STAGE:-}" = "signature" ] && [ "$FAIL_REF" = "$ref" ]; then
    echo "cosign: signature verification failed" >&2
    exit 1
fi
echo "verified signature for $ref"
""",
    )

    env = dict(os.environ)
    env["PATH"] = f"{bin_dir}{os.pathsep}{env['PATH']}"
    env["MANIFEST_JSON"] = json.dumps(manifest())
    env["RELEASE_LIST"] = json.dumps([{"tagName": RELEASE_TAG}])
    env["TRACE"] = str(tmp_path / "trace")
    return env


def run_verifier(env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(  # noqa: S603
        [BASH, str(SCRIPT)],
        capture_output=True,
        text=True,
        env=env,
        timeout=120,
        check=False,
    )


def trace(env: dict[str, str]) -> list[str]:
    trace_path = Path(env["TRACE"])
    return trace_path.read_text().splitlines() if trace_path.exists() else []


def test_successful_verification_identifies_release(environment: dict[str, str]) -> None:
    result = run_verifier(environment)
    assert result.returncode == 0, result.stderr
    assert result.stderr == ""
    assert result.stdout == f"Verified Python {PAIR.python} runtime release {RELEASE_ID}\n"
    assert trace(environment) == [
        "release-list",
        f"release-download:{RELEASE_TAG}",
        f"signature:{RUNTIME_REF}",
        f"attestation:provenance:{RUNTIME_REF}",
        f"attestation:spdx:{RUNTIME_REF}",
        f"signature:{BUILD_REF}",
        f"attestation:provenance:{BUILD_REF}",
        f"attestation:spdx:{BUILD_REF}",
    ]


def test_release_lookup_failure_stops_before_download(environment: dict[str, str]) -> None:
    environment["FAIL_STAGE"] = "release lookup"
    result = run_verifier(environment)
    assert result.returncode != 0
    assert "runtime image verification failed: release lookup" in result.stderr
    assert "repo R055LE/runtime-images" in result.stderr
    assert "gh: lookup unavailable" in result.stderr
    assert trace(environment) == ["release-list"]


def test_release_download_failure_names_tag_and_stops(environment: dict[str, str]) -> None:
    environment["FAIL_STAGE"] = "release download"
    result = run_verifier(environment)
    assert result.returncode != 0
    assert "runtime image verification failed: release download" in result.stderr
    assert RELEASE_TAG in result.stderr
    assert "gh: download unavailable" in result.stderr
    assert trace(environment) == ["release-list", f"release-download:{RELEASE_TAG}"]


def test_missing_release_fails_closed(environment: dict[str, str]) -> None:
    environment["RELEASE_LIST"] = json.dumps([{"tagName": "python-3.13-0123456789abcdef"}])
    result = run_verifier(environment)
    assert result.returncode != 0
    assert f"no python-{PAIR.python}- release in R055LE/runtime-images" in result.stderr
    assert trace(environment) == ["release-list"]


@pytest.mark.parametrize(
    ("manifest_json", "message"),
    [
        (
            json.dumps(manifest(runtime_digest="sha256:" + "f" * 64)),
            "runtime digest does not match the latest release",
        ),
        ("not json", "Expecting value"),
    ],
)
def test_manifest_failure_names_release_and_stops_before_artifacts(
    environment: dict[str, str], manifest_json: str, message: str
) -> None:
    environment["MANIFEST_JSON"] = manifest_json
    result = run_verifier(environment)
    assert result.returncode != 0
    assert "runtime image verification failed: manifest validation" in result.stderr
    assert RELEASE_TAG in result.stderr
    assert message in result.stderr
    assert trace(environment) == ["release-list", f"release-download:{RELEASE_TAG}"]


@pytest.mark.parametrize(
    ("stage", "diagnostic"),
    [
        ("signature", "signature verification"),
        ("provenance", "provenance attestation verification"),
        ("spdx", "SPDX attestation verification"),
    ],
)
@pytest.mark.parametrize("ref", [RUNTIME_REF, BUILD_REF])
def test_artifact_failure_names_stage_and_image_then_stops(
    environment: dict[str, str], stage: str, diagnostic: str, ref: str
) -> None:
    environment["FAIL_STAGE"] = stage
    environment["FAIL_REF"] = ref
    result = run_verifier(environment)
    assert result.returncode != 0
    assert f"runtime image verification failed: {diagnostic}" in result.stderr
    assert ref in result.stderr
    expected_last = {
        "signature": f"signature:{ref}",
        "provenance": f"attestation:provenance:{ref}",
        "spdx": f"attestation:spdx:{ref}",
    }[stage]
    assert trace(environment)[-1] == expected_last


def test_authentication_environment_is_not_expanded(environment: dict[str, str]) -> None:
    credential_value = "test-" + "secret-value"
    environment["GH_TOKEN"] = credential_value
    environment["FAIL_STAGE"] = "release lookup"
    result = run_verifier(environment)
    assert result.returncode != 0
    assert credential_value not in result.stdout
    assert credential_value not in result.stderr
    assert "GH_TOKEN" not in result.stdout
    assert "GH_TOKEN" not in result.stderr
