#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="${WORK_DIR:-$ROOT_DIR/work}"
KERNEL_REPO="${KERNEL_REPO:-https://github.com/crdroidandroid/android_kernel_xiaomi_rova.git}"
KERNEL_REF="${KERNEL_REF:-14.0}"
DEFCONFIG="${DEFCONFIG:-vendor/msm8937-perf_defconfig}"
ARCH="${ARCH:-arm64}"
BASE_CONFIG="${BASE_CONFIG-$ROOT_DIR/current.config}"
FRAGMENT="${FRAGMENT:-$ROOT_DIR/config/docker-required.fragment}"
OUT_DIR="${OUT_DIR:-$WORK_DIR/out}"
SRC_DIR="${SRC_DIR:-$WORK_DIR/kernel}"
JOBS="${JOBS:-$(nproc)}"
TOOLCHAIN="${TOOLCHAIN:-clang}"
KERNEL_RELEASE="${KERNEL_RELEASE:-4.19.318-4.5-iusmac-Mi8937v2-Mi8917}"
LOCALVERSION="${LOCALVERSION:--4.5-iusmac-Mi8937v2-Mi8917}"

export DEBIAN_FRONTEND=noninteractive

log() {
  printf '\n==> %s\n' "$*"
}

log "Install build dependencies"
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  bc bison build-essential ca-certificates ccache curl flex git \
  libelf-dev libssl-dev lld llvm clang \
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

log "Prepare base config"
if [[ -f "$BASE_CONFIG" ]]; then
  cp "$BASE_CONFIG" "$OUT_DIR/.config"
else
  make -C "$SRC_DIR" O="$OUT_DIR" ARCH="$ARCH" "$DEFCONFIG"
fi

log "Merge Docker config fragment"
if [[ -x "$SRC_DIR/scripts/kconfig/merge_config.sh" ]]; then
  "$SRC_DIR/scripts/kconfig/merge_config.sh" -m -O "$OUT_DIR" "$OUT_DIR/.config" "$FRAGMENT"
else
  scripts/kconfig/merge_config.sh -m -O "$OUT_DIR" "$OUT_DIR/.config" "$FRAGMENT"
fi

MAKE_ARGS=(
  -C "$SRC_DIR"
  O="$OUT_DIR"
  ARCH="$ARCH"
)

if [[ "$TOOLCHAIN" == "clang" ]]; then
  MAKE_ARGS+=(
    LLVM=1
    LLVM_IAS=1
    CC=clang
    HOSTCC=clang
    HOSTCXX=clang++
    CLANG_TRIPLE=aarch64-linux-gnu-
    CROSS_COMPILE=aarch64-linux-gnu-
    CROSS_COMPILE_ARM32=arm-linux-gnueabi-
  )
else
  MAKE_ARGS+=(
    CROSS_COMPILE=aarch64-linux-gnu-
    CROSS_COMPILE_ARM32=arm-linux-gnueabi-
  )
fi

log "Run olddefconfig"
make "${MAKE_ARGS[@]}" olddefconfig

log "Pin kernel release metadata and Docker options"
"$SRC_DIR/scripts/config" --file "$OUT_DIR/.config" \
  --set-str LOCALVERSION "$LOCALVERSION" \
  --disable LOCALVERSION_AUTO \
  --enable IKCONFIG \
  --enable IKCONFIG_PROC \
  --enable SYSVIPC \
  --enable POSIX_MQUEUE \
  --enable IPC_NS \
  --enable PID_NS \
  --disable USER_NS \
  --enable CGROUP_PIDS \
  --enable CGROUP_DEVICE \
  --enable BRIDGE_NETFILTER \
  --enable NETFILTER_XT_MATCH_ADDRTYPE
make "${MAKE_ARGS[@]}" olddefconfig

log "Build kernel image and dtbs"
make -j"$JOBS" "${MAKE_ARGS[@]}" KERNELRELEASE="$KERNEL_RELEASE" Image.gz-dtb dtbs

ARTIFACT_DIR="$ROOT_DIR/artifacts"
mkdir -p "$ARTIFACT_DIR"

cp -f "$OUT_DIR/.config" "$ARTIFACT_DIR/config-docker-final"
printf '%s\n' "$KERNEL_RELEASE" > "$ARTIFACT_DIR/kernel-release"
printf '%s\n' "$KERNEL_REPO" > "$ARTIFACT_DIR/upstream-repo"
printf '%s\n' "$KERNEL_REF" > "$ARTIFACT_DIR/upstream-ref"
printf '%s\n' "$UPSTREAM_COMMIT" > "$ARTIFACT_DIR/upstream-commit"
cp -f "$OUT_DIR/arch/$ARCH/boot/Image.gz" "$ARTIFACT_DIR/Image.gz" 2>/dev/null || true
cp -f "$OUT_DIR/arch/$ARCH/boot/Image.gz-dtb" "$ARTIFACT_DIR/Image.gz-dtb" 2>/dev/null || true

if [[ -d "$OUT_DIR/arch/$ARCH/boot/dts" ]]; then
  tar -C "$OUT_DIR/arch/$ARCH/boot" -czf "$ARTIFACT_DIR/dts.tar.gz" dts
fi

log "Docker config summary"
grep -E 'CONFIG_(SYSVIPC|POSIX_MQUEUE|CGROUP_PIDS|CGROUP_DEVICE|PID_NS|IPC_NS|USER_NS|VETH|MACVLAN|OVERLAY_FS|BRIDGE_NETFILTER|NETFILTER_XT_MATCH_ADDRTYPE|IP_NF_TARGET_MASQUERADE)=' "$ARTIFACT_DIR/config-docker-final" || true

log "Artifacts"
find "$ARTIFACT_DIR" -maxdepth 1 -type f -printf '%f %s bytes\n' | sort
