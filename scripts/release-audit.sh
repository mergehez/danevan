#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

status=0
tmp_matches_file="$(mktemp)"
audit_script_path="scripts/release-audit.sh"
benign_lockfile_glob_deprecation='"deprecated": "Old versions of glob are not supported, and contain widely publicized security vulnerabilities, which have been fixed in the current version. Please update. Support for old versions may be purchased (at exorbitant rates) by contacting the npm support team."'
cleanup() {
    rm -f "$tmp_matches_file"
}
trap cleanup EXIT

echo '==> Checking tracked files for publish-sensitive text'
tracked_files=()
while IFS= read -r file; do
    if [[ -f "$file" && "$file" != "$audit_script_path" ]]; then
        tracked_files+=("$file")
    fi
done < <(git ls-files)

if ((${#tracked_files[@]} == 0)); then
    echo 'No tracked files found.'
else
    : > "$tmp_matches_file"

    rg -n -H \
        -e '/Users/' \
        -e 'ELECTROBUN_DEVELOPER_ID="Apple Development:[^"]+"' \
        -e 'ELECTROBUN_DEVELOPER_ID="Developer ID Application:[^"]+"' \
        --glob '!release/**' \
        --glob '!dist/**' \
        --glob '!dist-electron/**' \
        --glob '!node_modules/**' \
        --glob '!.vite/**' \
        "${tracked_files[@]}" \
        | rg -Fv "rg -n '/Users/|Apple Development:|@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' . --glob '!.git' --glob '!node_modules' --glob '!dist' --glob '!dist-electron' --glob '!release'" \
        | rg -v "ELECTROBUN_DEVELOPER_ID=\"Apple Development:|ELECTROBUN_DEVELOPER_ID=\"Developer ID Application:" \
        | rg -Fv "$benign_lockfile_glob_deprecation" >> "$tmp_matches_file" || true

    rg -n -H \
        -e '[A-Za-z0-9._%+-]+@[A-Za-z][A-Za-z0-9.-]*\.[A-Za-z]{2,}' \
        --glob '!release/**' \
        --glob '!dist/**' \
        --glob '!dist-electron/**' \
        --glob '!node_modules/**' \
        --glob '!.vite/**' \
        "${tracked_files[@]}" \
        | rg -v '@([A-Za-z0-9-]+\.)?example\.com\b' \
        | rg -Fv "$benign_lockfile_glob_deprecation" >> "$tmp_matches_file" || true

    if [[ -s "$tmp_matches_file" ]]; then
        cat "$tmp_matches_file"
        echo
        echo 'Found publish-sensitive matches in tracked files.'
        status=1
    else
        echo 'No publish-sensitive matches found in tracked files.'
    fi
fi

echo
echo '==> Checking working tree status'
git status --short

echo
echo '==> Checking for generated outputs tracked by git'
if git ls-files | rg '^(release|dist|dist-electron|node_modules|\.vite)/'; then
    echo
    echo 'Generated outputs are tracked by git.'
    status=1
else
    echo 'No generated outputs are tracked by git.'
fi

exit "$status"