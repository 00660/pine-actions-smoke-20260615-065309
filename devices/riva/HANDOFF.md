# Redmi 5A riva Docker kernel handoff

## Target

- Device: Redmi 5A, codename `riva`, ROM device family `rova`.
- ADB endpoint used: `192.168.2.156:5555`.
- ROM observed from properties: `crDroidAndroid-14.0-20241015-rova-v10.9`.
- Running kernel: `4.19.318-4.5-iusmac-Mi8937v2-Mi8917-ga5f398b25ebd`.
- Boot partition: `/dev/block/by-name/boot -> /dev/block/mmcblk0p21`, size `67108864`.
- Root verified through Magisk: `uid=0(root) gid=0(root) context=u:r:magisk:s0`.

## Source Origin

- XDA thread: `https://xdaforums.com/t/rom-14-0-official-non-rdp-rolex-riva-crdroid-10-x.4669720/`
- ROM download family: `https://sourceforge.net/projects/crdroid/files/rova/10.x/`
- Kernel source: `https://github.com/crdroidandroid/android_kernel_xiaomi_rova`
- Selected branch: `14.0`
- Branch head observed locally: `433ac75e5124689d09c58cb08e7a944d7b91834b`

## Local Backups

- Current boot image: `boot-current.img`
- Current config: `current.config`
- Current config gzip: `current-config.gz`
- SHA256:
  - `boot-current.img`: `1AA32E143DA79E16F4961B45BD2513CAA68F3E4F8751ECF710824E86E59F8947`
  - `current.config`: `15BD2E2B75D75BCA86C307B86178B943E40ABA01906FE56410C672E6739502BC`
  - `current-config.gz`: `98C557EEFE098E671BE992836E5FF2136B2B02E56521AE0A21C741C387325E80`

## Docker Config Work

- Current config already has `CONFIG_OVERLAY_FS=y`, `CONFIG_VETH=y`, `CONFIG_NET_NS=y`, `CONFIG_MEMCG=y`, `CONFIG_CGROUP_BPF=y`, `CONFIG_BPF_SYSCALL=y`.
- Current missing Docker options include:
  - `CONFIG_SYSVIPC`
  - `CONFIG_POSIX_MQUEUE`
  - `CONFIG_CGROUP_PIDS`
  - `CONFIG_CGROUP_DEVICE`
  - `CONFIG_PID_NS`
  - `CONFIG_BRIDGE_NETFILTER`
  - `CONFIG_NETFILTER_XT_MATCH_ADDRTYPE`
  - `CONFIG_MACVLAN`
- Added fragment: `config/docker-required.fragment`.
- Added build script: `scripts/build-riva-docker-kernel.sh`.
- Added workflow: `.github/workflows/build-riva-docker-kernel.yml`.
- GitHub Actions branch pushed: `riva-docker-kernel`.
- First run: `https://github.com/00660/AIESP/actions/runs/26644172502`.
- Successful run used for artifacts: `https://github.com/00660/AIESP/actions/runs/26644321600`.
- Artifact id: `7293962809`, artifact name: `riva-docker-kernel`.
- Downloaded artifact copy:
  - `artifacts/riva-docker-kernel-run-26644321600.zip`
  - `artifacts/riva-docker-kernel-run-26644321600/`
- Built files:
  - `artifacts/riva-docker-kernel-run-26644321600/Image.gz-dtb`
  - `artifacts/riva-docker-kernel-run-26644321600/Image.gz`
  - `artifacts/riva-docker-kernel-run-26644321600/config-docker-final`
  - `artifacts/riva-docker-kernel-run-26644321600/dts.tar.gz`
- Verified final config includes `CONFIG_SYSVIPC=y`, `CONFIG_POSIX_MQUEUE=y`, `CONFIG_CGROUP_PIDS=y`, `CONFIG_CGROUP_DEVICE=y`, `CONFIG_PID_NS=y`, `CONFIG_IPC_NS=y`, `CONFIG_BRIDGE_NETFILTER=y`, `CONFIG_NETFILTER_XT_MATCH_ADDRTYPE=y`, `CONFIG_MACVLAN=y`, `CONFIG_VETH=y`, and `CONFIG_OVERLAY_FS=y`.

## Repacked Boot

- Original boot header was unpacked from `boot-current.img`.
- Repacked boot image: `artifacts/boot-docker.img`.
- Repacked boot SHA256: `B940B071BCB3A07DF2CE2DB310E578ACA11501FCC7EB66F7C77EADF997AD3DC2`.
- Repacked boot size: `21100544`, below boot partition size `67108864`.
- TWRP-format copy:
  - `artifacts/twrp-boot-docker-20260529/boot.emmc.win`
  - `artifacts/twrp-boot-docker-20260529/boot.emmc.win.sha2`
- Repacked boot header check:
  - Header version `0`
  - Page size `2048`
  - Kernel load address `0x80008000`
  - Ramdisk load address `0x81000000`
  - Tags load address `0x80000100`
  - OS version `14.0.0`
  - OS patch level `2024-10`

## Notes

- Do not reuse `pine` boot images on this device. This target is `riva/rova` with MSM8937 and Linux 4.19.
- Windows checkout of the kernel tree fails on reserved path `drivers/gpu/drm/nouveau/nvkm/subdev/i2c/aux.c`; build must run on Linux/GitHub Actions.
- A temporary Docker runtime zip push to `/data/local/tmp` was stopped before install. No Docker runtime install or boot flashing was performed in this pass.

## 2026-05-30 Soft Reboot Triage

- The repacked Docker kernel did boot Android successfully after flashing. Verified while running:
  - `sys.boot_completed=1`
  - `uid=0(root) gid=0(root) context=u:r:magisk:s0`
  - `Linux localhost 4.19.318-4.5-iusmac-Mi8937v2-Mi8917 #1 SMP PREEMPT Fri May 29 14:54:18 UTC 2026 aarch64`
- The later boot loop behaved like a userspace soft reboot after Docker autostart, not like an immediate boot-image failure.
- Safety action applied on device `192.168.2.156:5555`:
  - `/data/adb/modules/pine_docker_engine/disable` exists.
  - `/data/adb/modules/pine_docker_engine/service.sh` was renamed to `/data/adb/modules/pine_docker_engine/service.sh.disabled`.
  - No `dockerd`, `containerd`, or `runc` process was intentionally started during this triage.
- Relevant Docker log:
  - `failed to ensure the kernel supports pidfd`
  - `failed to mount overlay: invalid argument`
  - `failed to start daemon: error initializing graphdriver: driver not supported: overlay2`
- Relevant pstore log:
  - `init: Service vold has 'reboot_on_failure' option and failed, shutting down system.`
  - `reboot: Restarting system with command 'shell'`
- Current working assumption: Docker/containerd runtime setup is destabilizing Android userspace, and the module autostart path must stay disabled until dockerd is tested manually with an older/compatible runtime and minimal mounts.
- Do not re-enable `/data/adb/modules/pine_docker_engine/service.sh` until Docker can start manually without triggering `vold` failure or soft reboot.
- Backup created before this handoff edit:
  - `HANDOFF.md.bak-20260530-000921-softreboot`

## 2026-05-30 Web Panel Install on 192.168.2.156

- Installed the Docker web panel on device `192.168.2.156:5555`.
- Persistent panel files:
  - `/data/adb/docker-rootfs-v2/opt/docker-panel/app.py`
  - `/data/adb/docker/scripts/start-panel.sh`
- Device backups created before overwrite:
  - `/data/adb/docker/backups/panel-20260530-062857`
  - `/data/adb/docker/backups/panel-20260530-063029`
- Local script backups / install helpers:
  - `artifacts/riva-dockerd-minimal-test.sh.bak-20260530-0632-ca-certs`
  - `artifacts/riva-start-panel.sh`
  - `artifacts/install-riva-panel-on-device.sh`
- Root cause for the missing panel: Docker engine was running, but the panel container did not exist and Docker images were empty. Pulling `python:3.13-alpine` initially failed because the Docker chroot had no CA certificates:
  - `x509: certificate signed by unknown authority`
- Fix applied: `artifacts/riva-dockerd-minimal-test.sh` now bind-mounts `/system/etc/security/cacerts` into `$ROOTFS/etc/ssl/certs` before starting dockerd.
- Verified running:
  - URL: `http://192.168.2.156:8088/`
  - Container: `riva-docker-panel`
  - Image: `python:3.13-alpine`
  - API check: `/api/state` returns Docker `20.10.24`, kernel `4.19.318-4.5-iusmac-Mi8937v2-Mi8917`, `1` running container and `1` image.

## 2026-05-30 SMS Path Compatibility Fix

- Fixed `sms database not mounted` on the web panel.
- Cause: Docker/dockerd runs inside its own mount namespace. Mounts done only by `riva-start-panel.sh` after dockerd startup were visible on the Android host, but not to dockerd when it created the panel container.
- Panel app now checks multiple Android SMS database locations:
  - `/telephony-db/mmssms.db`
  - `/telephony-db-ce/mmssms.db`
  - `/telephony-db-de/mmssms.db`
  - `/host-data/data/com.android.providers.telephony/databases/mmssms.db`
  - `/host-data/user/0/com.android.providers.telephony/databases/mmssms.db`
  - `/host-data/user_de/0/com.android.providers.telephony/databases/mmssms.db`
  - Android/rootfs absolute fallbacks under `/data/...` and `/data/adb/docker-rootfs-v2/...`
- Dockerd startup script `artifacts/riva-dockerd-minimal-test.sh` now prepares SMS mounts before dockerd starts, inside the same mount namespace dockerd uses.
- `riva-start-panel.sh` still declares the volume mounts for `/telephony-db`, `/telephony-db-ce`, `/telephony-db-de`, and `/host-data`.
- Device backup created during this fix:
  - `/data/adb/docker/backups/panel-20260530-064019`
  - `/data/adb/docker/backups/panel-20260530-064453`
- Local backups created before edits:
  - `artifacts/riva-dockerd-minimal-test.sh.bak-20260530-0646-sms-mountns`
  - `artifacts/riva-start-panel.sh.bak-20260530-0639-sms-paths`
  - `../android-pine-docker-kernel-20260529-090250/docker-persist/panel/app.py.bak-20260530-0639-sms-paths`
- Verification:
  - `http://192.168.2.156:8088/api/sms?limit=5` returns `available: true`.
  - Active path: `/telephony-db/mmssms.db`.
  - The current database returned an empty `items` array during verification, but it is mounted and readable.
