#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 recipes/lineage/<codename>.json" >&2
  exit 2
fi

RECIPE="$1"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="${WORK_DIR:-${RUNNER_TEMP:-/tmp}/lrec}"
SRC_DIR="${SRC_DIR:-$WORK_DIR/k}"
OUT_DIR="${OUT_DIR:-$WORK_DIR/o}"
BASE_BOOT="$WORK_DIR/base/boot.img"
ARTIFACT_DIR="$ROOT_DIR/artifacts/lineage-recipe"
JOBS="${JOBS:-$(nproc)}"

need() {
  local key="$1"
  local value
  value="$(jq -r "$key // empty" "$RECIPE")"
  if [[ -z "$value" || "$value" == "null" ]]; then
    echo "missing required recipe field: $key" >&2
    exit 1
  fi
  printf '%s' "$value"
}

if [[ "$(jq -r '.status // empty' "$RECIPE")" != "build_ready" ]]; then
  echo "recipe is not build_ready; refusing to guess build parameters" >&2
  jq -r '.blocked_reasons[]? | "- " + .' "$RECIPE" >&2
  exit 1
fi

DEVICE="$(need '.build.device')"

expand_recipe_value() {
  local value="$1"
  value="${value//'$(PRODUCT_DEVICE)'/$DEVICE}"
  value="${value//\$PRODUCT_DEVICE/$DEVICE}"
  value="${value//\$\{PRODUCT_DEVICE\}/$DEVICE}"
  printf '%s' "$value"
}

BOOT_SOURCE_URL="$(need '.build.boot_source_url')"
BOOT_SOURCE_SHA256="$(jq -r '.build.boot_source_sha256 // empty' "$RECIPE")"
KERNEL_REPO="$(need '.build.kernel_repo')"
KERNEL_REF="$(need '.build.kernel_ref')"
ARCH="$(jq -r '.build.arch // "arm64"' "$RECIPE")"
IMAGE_TARGET="$(jq -r '.build.image_target // "Image.gz-dtb"' "$RECIPE")"
FRAGMENT_PATH="$(jq -r '.build.fragment_path // "config/docker-required.fragment"' "$RECIPE")"

log() {
  printf '\n==> %s\n' "$*"
}

extract_boot() {
  local ota_zip="$1"
  mkdir -p "$WORK_DIR/base" "$WORK_DIR/payload"

  if unzip -l "$ota_zip" boot.img >/dev/null 2>&1; then
    unzip -p "$ota_zip" boot.img > "$BASE_BOOT"
    return
  fi

  if unzip -l "$ota_zip" payload.bin >/dev/null 2>&1; then
    unzip -p "$ota_zip" payload.bin > "$WORK_DIR/payload/payload.bin"
    "$(go env GOPATH)/bin/payload-dumper-go" -p boot -o "$WORK_DIR/payload/out" "$WORK_DIR/payload/payload.bin"
    cp -f "$WORK_DIR/payload/out/boot.img" "$BASE_BOOT"
    return
  fi

  echo "cannot find boot.img or payload.bin in OTA zip" >&2
  exit 1
}

export DEBIAN_FRONTEND=noninteractive

log "Install build dependencies"
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  bc bison build-essential ca-certificates ccache curl file flex git jq \
  dwarves libelf-dev liblzma-dev libssl-dev lld llvm clang \
  gcc-aarch64-linux-gnu gcc-arm-linux-gnueabi \
  python3 rsync unzip xz-utils

log "Install payload dumper"
go install github.com/ssut/payload-dumper-go@latest

mkdir -p "$WORK_DIR" "$OUT_DIR" "$ARTIFACT_DIR"

log "Download official LineageOS OTA"
OTA_ZIP="$WORK_DIR/lineage.zip"
curl -L --fail --retry 5 --retry-delay 5 -o "$OTA_ZIP" "$BOOT_SOURCE_URL"
if [[ -n "$BOOT_SOURCE_SHA256" ]]; then
  printf '%s  %s\n' "$BOOT_SOURCE_SHA256" "$OTA_ZIP" | sha256sum -c -
fi
extract_boot "$OTA_ZIP"
file "$BASE_BOOT"
sha256sum "$BASE_BOOT"

log "Clone LineageOS kernel source"
if [[ ! -d "$SRC_DIR/.git" ]]; then
  git clone --depth 1 --branch "$KERNEL_REF" "$KERNEL_REPO" "$SRC_DIR"
else
  git -C "$SRC_DIR" fetch --depth 1 origin "$KERNEL_REF"
  git -C "$SRC_DIR" checkout FETCH_HEAD
fi
UPSTREAM_COMMIT="$(git -C "$SRC_DIR" rev-parse HEAD)"

MAKE_ARGS=(
  -C "$SRC_DIR"
  O="$OUT_DIR"
  ARCH="$ARCH"
  LLVM=1
  LLVM_IAS=1
  CC=clang
  LD=ld.lld
  HOSTCC=clang
  HOSTCXX=clang++
  CLANG_TRIPLE=aarch64-linux-gnu-
  CROSS_COMPILE=aarch64-linux-gnu-
  CROSS_COMPILE_ARM32=arm-linux-gnueabi-
  CLANG_TARGET_ARM32=--target=arm-linux-gnueabi
  CLANG_GCC32_TC=--gcc-toolchain=/usr
  CLANG_PREFIX32=-B/usr/bin/arm-linux-gnueabi-
  CROSS_COMPILE_COMPAT=arm-linux-gnueabi-
)

mapfile -t KERNEL_CONFIGS < <(jq -r '.build.kernel_configs[]' "$RECIPE")
if [[ "${#KERNEL_CONFIGS[@]}" -eq 0 ]]; then
  echo "recipe has no kernel configs" >&2
  exit 1
fi
for i in "${!KERNEL_CONFIGS[@]}"; do
  KERNEL_CONFIGS[$i]="$(expand_recipe_value "${KERNEL_CONFIGS[$i]}")"
done
BASE_DEFCONFIG=""
FRAGMENT_CONFIGS=()
for config in "${KERNEL_CONFIGS[@]}"; do
  if [[ -z "$BASE_DEFCONFIG" && "$config" == *defconfig ]]; then
    BASE_DEFCONFIG="$config"
  else
    FRAGMENT_CONFIGS+=("$config")
  fi
done
if [[ -z "$BASE_DEFCONFIG" ]]; then
  echo "recipe has no base defconfig in kernel_configs" >&2
  exit 1
fi

log "Prepare kernel config"
make "${MAKE_ARGS[@]}" "$BASE_DEFCONFIG"
FRAGMENTS=()
for config in "${FRAGMENT_CONFIGS[@]}"; do
  config="$(expand_recipe_value "$config")"
  FRAGMENTS+=("$SRC_DIR/arch/$ARCH/configs/$config")
done
FRAGMENTS+=("$ROOT_DIR/$FRAGMENT_PATH")
"$SRC_DIR/scripts/kconfig/merge_config.sh" -m -O "$OUT_DIR" "$OUT_DIR/.config" "${FRAGMENTS[@]}"
make "${MAKE_ARGS[@]}" olddefconfig

log "Build kernel image"
make -j"$JOBS" "${MAKE_ARGS[@]}" "$IMAGE_TARGET"

KERNEL_IMAGE="$OUT_DIR/arch/$ARCH/boot/$IMAGE_TARGET"
if [[ ! -f "$KERNEL_IMAGE" ]]; then
  echo "missing built kernel image: $KERNEL_IMAGE" >&2
  exit 1
fi

log "Repack official boot image"
chmod +x "$ROOT_DIR/scripts/repack-boot.sh"
"$ROOT_DIR/scripts/repack-boot.sh" \
  "$BASE_BOOT" \
  "$KERNEL_IMAGE" \
  "$ARTIFACT_DIR/boot-docker.img"

cp -f "$OUT_DIR/.config" "$ARTIFACT_DIR/config-docker-final"
cp -f "$KERNEL_IMAGE" "$ARTIFACT_DIR/$IMAGE_TARGET"
cp -f "$RECIPE" "$ARTIFACT_DIR/recipe.json"
printf '%s\n' "$DEVICE" > "$ARTIFACT_DIR/device"
printf '%s\n' "$KERNEL_REPO" > "$ARTIFACT_DIR/upstream-repo"
printf '%s\n' "$KERNEL_REF" > "$ARTIFACT_DIR/upstream-ref"
printf '%s\n' "$UPSTREAM_COMMIT" > "$ARTIFACT_DIR/upstream-commit"

log "Artifacts"
find "$ARTIFACT_DIR" -maxdepth 1 -type f -printf '%f %s bytes\n' | sort
