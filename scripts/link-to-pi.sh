#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PI_EXT_DIR="${HOME}/.pi/agent/extensions"
TARGET_NAME="pi-search"
TARGET_PATH="${PI_EXT_DIR}/${TARGET_NAME}"

mkdir -p "${PI_EXT_DIR}"

# Safety guard: only allow deleting target paths inside PI_EXT_DIR
EXT_REAL="$(realpath "${PI_EXT_DIR}")"
TARGET_PARENT_REAL="$(realpath "$(dirname "${TARGET_PATH}")")"
if [[ "${TARGET_PARENT_REAL}" != "${EXT_REAL}" ]]; then
  echo "Refusing to modify path outside ${EXT_REAL}: ${TARGET_PATH}" >&2
  exit 1
fi

if [ -L "${TARGET_PATH}" ] || [ -e "${TARGET_PATH}" ]; then
  rm -rf "${TARGET_PATH}"
fi

ln -s "${REPO_DIR}" "${TARGET_PATH}"

echo "Linked ${REPO_DIR} -> ${TARGET_PATH}"
echo "Run /reload in pi to load the updated extension."
