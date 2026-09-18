#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
release_repo="R055LE/runtime-images"
signer_workflow="R055LE/runtime-images/.github/workflows/release.yml"
identity="https://github.com/${signer_workflow}@refs/heads/main"
issuer="https://token.actions.githubusercontent.com"
spdx_predicate="https://spdx.dev/Document"
verify_dir=$(mktemp -d)
trap 'rm -rf "$verify_dir"' EXIT
stage_err="$verify_dir/stage.err"

fail_stage() {
    local stage=$1 detail=$2
    printf 'runtime image verification failed: %s' "$stage" >&2
    if [ -n "$detail" ]; then
        printf ' (%s)' "$detail" >&2
    fi
    printf '\n' >&2
    if [ -s "$stage_err" ]; then
        sed 's/^/  /' "$stage_err" >&2
    fi
    exit 1
}

run_stage() {
    local stage=$1 detail=$2
    shift 2
    : >"$stage_err"
    if ! "$@" 2>"$stage_err"; then
        fail_stage "$stage" "$detail"
    fi
}

references=$(python3 "${repo_root}/scripts/runtime_image_refs.py" \
    --dockerfile "${repo_root}/Dockerfile")
python_version=$(jq -r .python <<<"$references")
release_prefix="python-${python_version}-"

run_stage "release lookup" "repo ${release_repo}, prefix ${release_prefix}" \
    gh release list --repo "$release_repo" --limit 100 --json tagName \
    >"${verify_dir}/releases.json"
release_tag=$(run_stage "release lookup" \
    "repo ${release_repo}, prefix ${release_prefix}" \
    jq -r --arg prefix "$release_prefix" \
        '[.[] | select(.tagName | startswith($prefix))][0].tagName // empty' \
        "${verify_dir}/releases.json")
[ -n "$release_tag" ] || {
    echo "runtime image verification failed: no ${release_prefix} release in ${release_repo}" >&2
    exit 1
}

run_stage "release download" "release ${release_tag}" \
    gh release download "$release_tag" \
    --repo "$release_repo" \
    --pattern release-manifest.json \
    --dir "$verify_dir"
references=$(run_stage "manifest validation" "release ${release_tag}" \
    python3 "${repo_root}/scripts/runtime_image_refs.py" \
        --dockerfile "${repo_root}/Dockerfile" \
        --manifest "${verify_dir}/release-manifest.json")

for variant in runtime build; do
    ref=$(jq -r ".${variant}_ref" <<<"$references")
    run_stage "signature verification" "image ${ref}" \
        cosign verify \
        --certificate-identity "$identity" \
        --certificate-oidc-issuer "$issuer" \
        "$ref" >/dev/null
    run_stage "provenance attestation verification" "image ${ref}" \
        gh attestation verify "oci://${ref}" \
        --repo "$release_repo" \
        --signer-workflow "$signer_workflow" >/dev/null
    run_stage "SPDX attestation verification" "image ${ref}" \
        gh attestation verify "oci://${ref}" \
        --repo "$release_repo" \
        --signer-workflow "$signer_workflow" \
        --predicate-type "$spdx_predicate" >/dev/null
done

release_id=$(jq -r .release_id <<<"$references")
printf 'Verified Python %s runtime release %s\n' "$python_version" "$release_id"
