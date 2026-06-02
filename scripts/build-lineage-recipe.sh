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
RECIPE_FOR_ARTIFACT="$RECIPE"

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
RESOLVED_BOOT_DATE=""
RESOLVED_BOOT_DATETIME=""
RESOLVED_BOOT_FILENAME=""
RESOLVED_BOOT_FILEPATH=""

log() {
  printf '\n==> %s\n' "$*"
}

sanitize_appended_dtb_names() {
  local config_file="$OUT_DIR/.config"
  local line names cleaned=() item new_names

  line="$(grep -E '^CONFIG_BUILD_ARM64_APPENDED_DTB_IMAGE_NAMES=' "$config_file" || true)"
  if [[ -z "$line" || "$line" != *".dtbo"* ]]; then
    return
  fi

  names="${line#*=}"
  names="${names%\"}"
  names="${names#\"}"
  read -r -a items <<< "$names"
  for item in "${items[@]}"; do
    if [[ "$item" == *".dtbo" ]]; then
      echo "drop separated dtbo from appended dtb list: $item"
      continue
    fi
    cleaned+=("$item")
  done

  if [[ "${#cleaned[@]}" -eq 0 ]]; then
    echo "all appended dtb names were dtbo entries; refusing to guess a replacement" >&2
    exit 1
  fi

  new_names="${cleaned[*]}"
  sed -i "s#^CONFIG_BUILD_ARM64_APPENDED_DTB_IMAGE_NAMES=.*#CONFIG_BUILD_ARM64_APPENDED_DTB_IMAGE_NAMES=\"$new_names\"#" "$config_file"
}

refresh_boot_source_from_lineage_api() {
  local api_url version builds_json latest

  api_url="$(jq -r '.source_facts.download_api_url // empty' "$RECIPE")"
  if [[ -z "$api_url" || "$api_url" == "null" ]]; then
    api_url="https://download.lineageos.org/api/v2/devices/$DEVICE/builds"
  fi
  version="${KERNEL_REF#lineage-}"
  builds_json="$WORK_DIR/lineage-builds.json"

  if ! curl -L --fail --retry 5 --retry-delay 5 -o "$builds_json" "$api_url"; then
    echo "cannot refresh LineageOS OTA URL from API; using recipe URL: $BOOT_SOURCE_URL"
    return
  fi

  latest="$(jq -r --arg version "$version" '
    [
      .[]
      | select((.version // "") == $version)
      | .files[]?
      | select((.filename // "") | test("^lineage-[0-9.]+-[0-9]{8}-nightly-.+-signed[.]zip$"))
    ]
    | sort_by(.datetime // 0)
    | reverse
    | .[0] // empty
    | [
        .url // "",
        .sha256 // "",
        .date // "",
        ((.datetime // "") | tostring),
        .filename // "",
        .filepath // ""
      ]
    | @tsv
  ' "$builds_json")"
  if [[ -z "$latest" ]]; then
    echo "LineageOS API has no matching $version signed zip for $DEVICE; using recipe URL: $BOOT_SOURCE_URL"
    return
  fi

  IFS=$'\t' read -r BOOT_SOURCE_URL BOOT_SOURCE_SHA256 RESOLVED_BOOT_DATE RESOLVED_BOOT_DATETIME RESOLVED_BOOT_FILENAME RESOLVED_BOOT_FILEPATH <<< "$latest"
  if [[ -z "$BOOT_SOURCE_URL" ]]; then
    echo "LineageOS API returned an empty OTA URL for $DEVICE; using recipe URL"
    BOOT_SOURCE_URL="$(need '.build.boot_source_url')"
    BOOT_SOURCE_SHA256="$(jq -r '.build.boot_source_sha256 // empty' "$RECIPE")"
    return
  fi

  RECIPE_FOR_ARTIFACT="$WORK_DIR/recipe-resolved.json"
  jq \
    --arg url "$BOOT_SOURCE_URL" \
    --arg sha "$BOOT_SOURCE_SHA256" \
    --arg date "$RESOLVED_BOOT_DATE" \
    --arg datetime "$RESOLVED_BOOT_DATETIME" \
    --arg filename "$RESOLVED_BOOT_FILENAME" \
    --arg filepath "$RESOLVED_BOOT_FILEPATH" \
    '
      .build.boot_source_url = $url
      | .build.boot_source_sha256 = $sha
      | .source_facts.latest_official_build.url = $url
      | .source_facts.latest_official_build.sha256 = $sha
      | .source_facts.latest_official_build.date = $date
      | .source_facts.latest_official_build.datetime = ($datetime | if . == "" then null else tonumber end)
      | .source_facts.latest_official_build.filename = $filename
      | .source_facts.latest_official_build.filepath = $filepath
    ' "$RECIPE" > "$RECIPE_FOR_ARTIFACT"
  echo "resolved LineageOS OTA URL: $BOOT_SOURCE_URL"
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
  device-tree-compiler dwarves libelf-dev liblzma-dev libssl-dev lld llvm clang \
  gcc-aarch64-linux-gnu gcc-arm-linux-gnueabi \
  python3 rsync unzip xz-utils

log "Install payload dumper"
go install github.com/ssut/payload-dumper-go@latest

mkdir -p "$WORK_DIR" "$OUT_DIR" "$ARTIFACT_DIR"

log "Refresh official LineageOS OTA URL"
refresh_boot_source_from_lineage_api

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

log "Preflight kernel Kconfig sources"
node "$ROOT_DIR/scripts/check-local-kconfig-sources.mjs" "$SRC_DIR" "$ARCH"

MAKE_ARGS=(
  -C "$SRC_DIR"
  O="$OUT_DIR"
  ARCH="$ARCH"
  LLVM=1
  LLVM_IAS=1
  CC=clang
  LD=ld.lld
  DTC=/usr/bin/dtc
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
sanitize_appended_dtb_names
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
cp -f "$RECIPE_FOR_ARTIFACT" "$ARTIFACT_DIR/recipe.json"
printf '%s\n' "$DEVICE" > "$ARTIFACT_DIR/device"
printf '%s\n' "$KERNEL_REPO" > "$ARTIFACT_DIR/upstream-repo"
printf '%s\n' "$KERNEL_REF" > "$ARTIFACT_DIR/upstream-ref"
printf '%s\n' "$UPSTREAM_COMMIT" > "$ARTIFACT_DIR/upstream-commit"

log "Artifacts"
find "$ARTIFACT_DIR" -maxdepth 1 -type f -printf '%f %s bytes\n' | sort
