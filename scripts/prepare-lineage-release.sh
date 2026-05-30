#!/usr/bin/env bash
set -euo pipefail

ARTIFACT_DIR="${1:-artifacts/lineage-recipe}"
RELEASE_DIR="${2:-$ARTIFACT_DIR/release}"
RECIPE="$ARTIFACT_DIR/recipe.json"
BOOT_IMG="$ARTIFACT_DIR/boot-docker.img"
CONFIG_FILE="$ARTIFACT_DIR/config-docker-final"
UPSTREAM_COMMIT_FILE="$ARTIFACT_DIR/upstream-commit"

if [[ ! -f "$RECIPE" ]]; then
  echo "missing recipe: $RECIPE" >&2
  exit 1
fi
if [[ ! -f "$BOOT_IMG" ]]; then
  echo "missing boot image: $BOOT_IMG" >&2
  exit 1
fi

slugify() {
  tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//'
}

shell_env() {
  local key="$1"
  local value="$2"
  printf '%s=%q\n' "$key" "$value"
}

DEVICE="$(jq -r '.build.device' "$RECIPE")"
MODEL_NAME="$(jq -r '.source_facts.names[0] // .build.device' "$RECIPE")"
PUBLIC_NAMES="$(jq -r '[.source_facts.names[]?] | unique | join(" ")' "$RECIPE")"
OTA_FILENAME="$(jq -r '.source_facts.latest_official_build.filename // empty' "$RECIPE")"
OTA_URL="$(jq -r '.build.boot_source_url // empty' "$RECIPE")"
KERNEL_REPO="$(jq -r '.build.kernel_repo // empty' "$RECIPE")"
KERNEL_REF="$(jq -r '.build.kernel_ref // empty' "$RECIPE")"
VERSION="$(jq -r '.source_facts.current_branch // empty' "$RECIPE")"
BUILD_DATE="$(jq -r '.source_facts.latest_official_build.date // empty' "$RECIPE" | tr -d '-')"
UPSTREAM_COMMIT="$(cat "$UPSTREAM_COMMIT_FILE" 2>/dev/null || true)"

if [[ "$OTA_FILENAME" =~ lineage-([0-9.]+)-([0-9]{8})- ]]; then
  VERSION="${BASH_REMATCH[1]}"
  BUILD_DATE="${BASH_REMATCH[2]}"
fi
if [[ -z "$VERSION" || "$VERSION" == "null" ]]; then
  VERSION="${KERNEL_REF#lineage-}"
fi
if [[ -z "$BUILD_DATE" || "$BUILD_DATE" == "null" ]]; then
  BUILD_DATE="$(date -u +%Y%m%d)"
fi

MODEL_SLUG="$(printf '%s' "${PUBLIC_NAMES:-$MODEL_NAME}" | slugify)"
if [[ -z "$MODEL_SLUG" ]]; then
  MODEL_SLUG="$(printf '%s' "$MODEL_NAME" | slugify)"
fi
if [[ -z "$MODEL_SLUG" ]]; then
  MODEL_SLUG="unknown-xiaomi-device"
fi

BASE="${MODEL_SLUG}-lineage-${VERSION}-${BUILD_DATE}-docker-boot"
RELEASE_TAG="lineage-${VERSION}-${BUILD_DATE}-${MODEL_SLUG}-docker-boot"
RELEASE_TITLE="${MODEL_NAME} LineageOS ${VERSION} ${BUILD_DATE} Docker boot"
BOOT_ASSET="${BASE}.img"
SHA_ASSET="${BASE}.img.sha256"
CONFIG_ASSET="${BASE}.config"
RECIPE_ASSET="${BASE}.recipe.json"
NOTES_FILE="$RELEASE_DIR/release-notes.md"

mkdir -p "$RELEASE_DIR"
cp -f "$BOOT_IMG" "$RELEASE_DIR/$BOOT_ASSET"
(cd "$RELEASE_DIR" && sha256sum "$BOOT_ASSET" > "$SHA_ASSET")
cp -f "$RECIPE" "$RELEASE_DIR/$RECIPE_ASSET"
if [[ -f "$CONFIG_FILE" ]]; then
  cp -f "$CONFIG_FILE" "$RELEASE_DIR/$CONFIG_ASSET"
fi

cat > "$NOTES_FILE" <<EOF
Device: ${MODEL_NAME}
Public model names: ${PUBLIC_NAMES:-$MODEL_NAME}
LineageOS codename: ${DEVICE}
LineageOS: ${VERSION}
Build date: ${BUILD_DATE}

Source OTA: ${OTA_URL}
Kernel repo: ${KERNEL_REPO}
Kernel ref: ${KERNEL_REF}
Kernel commit: ${UPSTREAM_COMMIT}

Assets:
- ${BOOT_ASSET}
- ${SHA_ASSET}
- ${CONFIG_ASSET}
- ${RECIPE_ASSET}
EOF

{
  shell_env RELEASE_DIR "$RELEASE_DIR"
  shell_env RELEASE_TAG "$RELEASE_TAG"
  shell_env RELEASE_TITLE "$RELEASE_TITLE"
  shell_env BOOT_ASSET "$BOOT_ASSET"
  shell_env SHA_ASSET "$SHA_ASSET"
  shell_env CONFIG_ASSET "$CONFIG_ASSET"
  shell_env RECIPE_ASSET "$RECIPE_ASSET"
  shell_env NOTES_FILE "$NOTES_FILE"
} > "$ARTIFACT_DIR/release.env"

cat "$ARTIFACT_DIR/release.env"
