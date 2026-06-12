#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="${WORK_DIR:-$ROOT_DIR/work}"
KERNEL_REPO="${KERNEL_REPO:-https://github.com/AlphaDroid-devices/kernel_xiaomi_mido.git}"
KERNEL_REF="${KERNEL_REF:-alpha-14}"
DEFCONFIG="${DEFCONFIG:-mido_defconfig}"
ARCH="${ARCH:-arm64}"
BASE_CONFIG="${BASE_CONFIG:-}"
FRAGMENT="${FRAGMENT:-$ROOT_DIR/config/docker-droidspaces-audio.fragment}"
OUT_DIR="${OUT_DIR:-$WORK_DIR/out}"
SRC_DIR="${SRC_DIR:-$WORK_DIR/kernel}"
JOBS="${JOBS:-$(nproc)}"
IMAGE_TARGET="${IMAGE_TARGET:-Image.gz-dtb}"
KERNEL_RELEASE="${KERNEL_RELEASE:-}"

export DEBIAN_FRONTEND=noninteractive

log() {
  printf '\n==> %s\n' "$*"
}

require_config_y() {
  local config_file="$1"
  shift
  local missing=0 key
  for key in "$@"; do
    if ! grep -q "^${key}=y$" "$config_file"; then
      echo "missing required kernel config: ${key}=y" >&2
      missing=1
    fi
  done
  if [[ "$missing" -ne 0 ]]; then
    exit 1
  fi
}

log "Install build dependencies"
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  bc bison build-essential ca-certificates ccache curl flex git \
  device-tree-compiler dwarves libelf-dev liblzma-dev libssl-dev lld llvm clang \
  gcc-aarch64-linux-gnu gcc-arm-linux-gnueabi \
  python3 rsync unzip xz-utils

mkdir -p "$WORK_DIR" "$OUT_DIR"

if [[ ! -d "$SRC_DIR/.git" ]]; then
  log "Clone kernel source: $KERNEL_REPO ($KERNEL_REF)"
  git clone --depth 1 --branch "$KERNEL_REF" "$KERNEL_REPO" "$SRC_DIR"
else
  log "Reuse existing kernel source"
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

log "Prepare base config"
if [[ -n "$BASE_CONFIG" && -f "$BASE_CONFIG" ]]; then
  cp "$BASE_CONFIG" "$OUT_DIR/.config"
else
  make "${MAKE_ARGS[@]}" "$DEFCONFIG"
fi

log "Merge Docker/Droidspaces/audio config fragment"
"$SRC_DIR/scripts/kconfig/merge_config.sh" -m -O "$OUT_DIR" "$OUT_DIR/.config" "$FRAGMENT"
make "${MAKE_ARGS[@]}" olddefconfig

log "Pin required container and virtual-audio options"
"$SRC_DIR/scripts/config" --file "$OUT_DIR/.config" \
  --enable IKCONFIG \
  --enable IKCONFIG_PROC \
  --enable SYSVIPC \
  --enable POSIX_MQUEUE \
  --enable IPC_NS \
  --enable PID_NS \
  --disable USER_NS \
  --enable CGROUP_PIDS \
  --enable CGROUP_DEVICE \
  --enable CFS_BANDWIDTH \
  --enable OVERLAY_FS \
  --enable BRIDGE \
  --enable BRIDGE_NETFILTER \
  --enable VETH \
  --enable MACVLAN \
  --enable NETFILTER_XT_MATCH_ADDRTYPE \
  --enable SOUND \
  --enable SND \
  --enable SND_TIMER \
  --enable SND_PCM \
  --enable SND_HWDEP \
  --enable SND_RAWMIDI \
  --enable SND_ALOOP
make "${MAKE_ARGS[@]}" olddefconfig

require_config_y "$OUT_DIR/.config" \
  CONFIG_SYSVIPC \
  CONFIG_POSIX_MQUEUE \
  CONFIG_IPC_NS \
  CONFIG_PID_NS \
  CONFIG_CGROUP_PIDS \
  CONFIG_CGROUP_DEVICE \
  CONFIG_OVERLAY_FS \
  CONFIG_BRIDGE \
  CONFIG_BRIDGE_NETFILTER \
  CONFIG_VETH \
  CONFIG_MACVLAN \
  CONFIG_NETFILTER_XT_MATCH_ADDRTYPE \
  CONFIG_SOUND \
  CONFIG_SND \
  CONFIG_SND_TIMER \
  CONFIG_SND_PCM \
  CONFIG_SND_HWDEP \
  CONFIG_SND_RAWMIDI \
  CONFIG_SND_ALOOP

log "Build kernel image and dtbs"
if [[ -n "$KERNEL_RELEASE" ]]; then
  make -j"$JOBS" "${MAKE_ARGS[@]}" KERNELRELEASE="$KERNEL_RELEASE" "$IMAGE_TARGET" dtbs
else
  make -j"$JOBS" "${MAKE_ARGS[@]}" "$IMAGE_TARGET" dtbs
fi

KERNEL_IMAGE="$OUT_DIR/arch/$ARCH/boot/$IMAGE_TARGET"
if [[ ! -f "$KERNEL_IMAGE" ]]; then
  echo "missing built kernel image: $KERNEL_IMAGE" >&2
  exit 1
fi

ARTIFACT_DIR="$ROOT_DIR/artifacts"
mkdir -p "$ARTIFACT_DIR"

cp -f "$OUT_DIR/.config" "$ARTIFACT_DIR/config-docker-final"
cp -f "$KERNEL_IMAGE" "$ARTIFACT_DIR/$IMAGE_TARGET"
cp -f "$KERNEL_IMAGE" "$ARTIFACT_DIR/Image.gz-dtb"
make "${MAKE_ARGS[@]}" kernelrelease > "$ARTIFACT_DIR/kernel-release"
printf '%s\n' "$KERNEL_REPO" > "$ARTIFACT_DIR/upstream-repo"
printf '%s\n' "$KERNEL_REF" > "$ARTIFACT_DIR/upstream-ref"
printf '%s\n' "$UPSTREAM_COMMIT" > "$ARTIFACT_DIR/upstream-commit"

log "Docker/Droidspaces/audio config summary"
grep -E 'CONFIG_(SYSVIPC|POSIX_MQUEUE|CGROUP_PIDS|CGROUP_DEVICE|PID_NS|IPC_NS|USER_NS|VETH|MACVLAN|OVERLAY_FS|BRIDGE_NETFILTER|NETFILTER_XT_MATCH_ADDRTYPE|SOUND|SND|SND_ALOOP)=' "$ARTIFACT_DIR/config-docker-final" || true

log "Artifacts"
find "$ARTIFACT_DIR" -maxdepth 1 -type f -printf '%f %s bytes\n' | sort
