#!/system/bin/sh
set -eu

PACKAGE=""
OUT=""
SECONDS_TO_RUN="45"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --package)
      PACKAGE="${2:-}"
      shift 2
      ;;
    --out)
      OUT="${2:-}"
      shift 2
      ;;
    --seconds)
      SECONDS_TO_RUN="${2:-45}"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [ -z "$PACKAGE" ] || [ -z "$OUT" ]; then
  echo "usage: pine-run-dumper.sh --package <package> --out <dir> [--seconds 45]" >&2
  exit 2
fi

mkdir -p "$OUT"

{
  echo "package=$PACKAGE"
  echo "out=$OUT"
  echo "seconds=$SECONDS_TO_RUN"
  echo "date=$(date 2>/dev/null || true)"
  echo "kernel=$(uname -a 2>/dev/null || true)"
  echo "android=$(getprop ro.build.version.release 2>/dev/null || true)"
  echo "sdk=$(getprop ro.build.version.sdk 2>/dev/null || true)"
  echo "fingerprint=$(getprop ro.build.fingerprint 2>/dev/null || true)"
  echo "config_hooks="
  if [ -r /proc/config.gz ]; then
    zcat /proc/config.gz 2>/dev/null | grep -E 'CONFIG_(BPF|BPF_SYSCALL|BPF_JIT|KPROBES|KPROBE_EVENTS|UPROBES|UPROBE_EVENTS|PERF_EVENTS|TRACEPOINTS|FTRACE|TRACEFS_FS|DEBUG_FS)=' || true
  else
    echo "/proc/config.gz not readable"
  fi
  echo "tracefs="
  ls -ld /sys/kernel/tracing /sys/kernel/debug/tracing 2>/dev/null || true
  echo "libart="
  ls -l /apex/com.android.art/lib64/libart.so /system/lib64/libart.so 2>/dev/null || true
  echo "pm_path="
  pm path "$PACKAGE" 2>/dev/null || true
} > "$OUT/diagnostics.txt"

if [ -x /data/local/tmp/pine-art-dexdump ]; then
  /data/local/tmp/pine-art-dexdump --package "$PACKAGE" --out "$OUT" --seconds "$SECONDS_TO_RUN"
  exit $?
fi

if [ -x /data/local/tmp/eBPFDexDumper ]; then
  (
    /data/local/tmp/eBPFDexDumper dump -n "$PACKAGE" -o "$OUT" > "$OUT/eBPFDexDumper.log" 2>&1
  ) &
  dump_pid="$!"
  sleep "$SECONDS_TO_RUN"
  kill -INT "$dump_pid" 2>/dev/null || true
  wait "$dump_pid" 2>/dev/null || true
  exit 0
fi

if [ -x /data/local/tmp/xiaojianbang_hook ]; then
  cat > "$OUT/XIAOJIANBANG-HOOK-NOTE.txt" <<'EOF'
xiaojianbang_hook is present, but it is a low-level ARM64 HWBP tracing tool,
not a DEX dumper by itself.

The upstream project requires:

- 5.4+ Android GKI kernel
- KernelPatch 0.13.x / APatch KPM loader
- xiaojianbang-stealth-hook.kpm loaded through APatch

The current Redmi 7A / pine baseline is Android 12 with a 4.9 non-GKI kernel,
so this tool is not treated as a working DEX output backend here. Keep it as a
reference or porting candidate only unless the 7A is moved to a compatible
GKI/APatch kernel line.
EOF
  exit 21
fi

cat > "$OUT/README-NO-DUMPER.txt" <<'EOF'
No device dumper backend was found.

Expected one of:

- /data/local/tmp/pine-art-dexdump
- /data/local/tmp/eBPFDexDumper
- /data/local/tmp/xiaojianbang_hook plus a compatible GKI/APatch kernel and a
  DEX-writing integration layer

For the current Redmi 7A / pine Android 12 kernel 4.9 baseline, the newer
Android 13-17 eBPF ringbuf dumper cannot be assumed to work. Build and flash
the internal hook kernel fragment first, then install a pine-compatible ART
hook backend that writes dex files into the output directory passed here.
EOF

exit 20
