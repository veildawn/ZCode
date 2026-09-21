#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SRC_DIR="${REPO_ROOT}/.zcode-src"
UPSTREAM_URL="https://github.com/zai-org/ZCode.git"
UPSTREAM_TAG="${1:-main}"

echo "=================================================="
echo "  ZCode Meta-Repo: Local Dev Setup"
echo "=================================================="

if [ -d "${SRC_DIR}" ]; then
  echo "Existing source directory found at ${SRC_DIR}."
  read -p "Do you want to reset and re-clone? (y/N) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -rf "${SRC_DIR}"
  else
    echo "Aborted."
    exit 0
  fi
fi

echo "--> Cloning upstream ZCode (${UPSTREAM_TAG})..."
git clone --depth 1 --branch "${UPSTREAM_TAG}" "${UPSTREAM_URL}" "${SRC_DIR}" 2>/dev/null || \
git clone --depth 1 "${UPSTREAM_URL}" "${SRC_DIR}"

echo "--> Copying brand assets..."
mkdir -p "${SRC_DIR}/packages/ui/src/assets/provider-icons"
cp -f "${REPO_ROOT}/downstream-patches/assets/"* "${SRC_DIR}/packages/ui/src/assets/provider-icons/"

echo "--> Applying downstream patches..."
cd "${SRC_DIR}"
for patch in "${REPO_ROOT}/downstream-patches"/*.patch; do
  echo "    Applying $(basename "${patch}")..."
  git apply --3way --ignore-whitespace --ignore-space-change "${patch}"
done

echo "--> Installing dependencies..."
pnpm install --frozen-lockfile=false

echo ""
echo "🎉 Setup complete! You can now start developing:"
echo "   cd .zcode-src"
echo "   pnpm dev:desktop"
