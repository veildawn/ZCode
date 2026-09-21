#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TARGET_DIR="${1:-.}"
PATCH_DIR="${REPO_ROOT}/downstream-patches"

echo "Applying downstream patches to ${TARGET_DIR}..."

if [ -d "${PATCH_DIR}/assets" ]; then
  echo "--> Copying brand assets to packages/ui/src/assets/provider-icons/..."
  mkdir -p "${TARGET_DIR}/packages/ui/src/assets/provider-icons"
  cp -f "${PATCH_DIR}/assets/"* "${TARGET_DIR}/packages/ui/src/assets/provider-icons/"
fi

shopt -s nullglob
PATCH_FILES=("${PATCH_DIR}"/*.patch)
shopt -u nullglob

if [ ${#PATCH_FILES[@]} -eq 0 ]; then
  echo "No .patch files found in ${PATCH_DIR}."
  exit 0
fi

cd "${TARGET_DIR}"

for patch in "${PATCH_FILES[@]}"; do
  patch_name="$(basename "${patch}")"
  echo "--> Applying [${patch_name}]..."
  if ! git apply --3way --ignore-whitespace --ignore-space-change "${patch}"; then
    echo "❌ ERROR: Failed to apply patch '${patch_name}'." >&2
    exit 1
  fi
  echo "    ✓ Successfully applied [${patch_name}]"
done

echo "🎉 All downstream patches applied cleanly."
