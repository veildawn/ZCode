#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SRC_DIR="${REPO_ROOT}/.zcode-src"
PATCH_DIR="${REPO_ROOT}/downstream-patches"

echo "=================================================="
echo "  Export Patches from .zcode-src -> downstream-patches"
echo "=================================================="

if [ ! -d "${SRC_DIR}" ]; then
  echo "Error: Source directory '${SRC_DIR}' not found. Run ./scripts/setup-dev.sh first." >&2
  exit 1
fi

cd "${SRC_DIR}"

mkdir -p "${PATCH_DIR}"

echo "Exporting patches from git commits in .zcode-src..."
git format-patch --binary origin/main -o "${PATCH_DIR}/"

echo "✓ Patches exported to ${PATCH_DIR}/"
