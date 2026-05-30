# Redmi 7A pine Docker kernel handoff

## Target

- Device: Redmi 7A, codename `pine`
- ADB endpoint used: `192.168.2.103:38657`
- Current kernel observed from device: `4.9.297-perf/pine-g3ce83b96c7ea`
- Current Android userspace: Android 12 / SDK 31
- ROM identified from device properties: `PixelExtended_pine-12.0-20220227-0902-OFFICIAL`
- Boot partition observed: `/dev/block/by-name/boot -> /dev/block/mmcblk0p52`
- User stated recovery backup of the kernel already exists for rollback.

## Local files

- `current-config.gz`: raw `/proc/config.gz` pulled from the device.
- `current.config`: decompressed current kernel config.
- `config/docker-required.fragment`: Docker/container kernel option fragment.
- `scripts/build-pine-docker-kernel.sh`: Linux/GitHub Actions build script.
- `.github/workflows/build-pine-docker-kernel.yml`: manual and branch-push GitHub Actions workflow.

## Backup

- Work directory backup before edits: `android-pine-docker-kernel-20260529-090250.bak-20260529-090539`
- `.github` backup before workflow creation: `.github.bak-20260529-091223`
- Device rollback backup: user reported it was created from recovery.

## Build strategy

The Windows checkout of Xiaomi official `MiCode/Xiaomi_Kernel_OpenSource` fails because the tree contains Windows-reserved paths such as `drivers/gpu/drm/nouveau/nvkm/subdev/i2c/aux.c`. The build is therefore delegated to GitHub Actions Linux runners.

Default source in the workflow is the PixelExtended/XDA kernel source for this ROM family:

```text
https://github.com/hsx02/kernel_xiaomi_sdm439.git
branch: a12/main
defconfig: pine-perf_defconfig
arch: arm64
```

The script defaults to the device-exported `current.config`, merges Docker-required options, runs `olddefconfig`, then builds `Image.gz-dtb` and `dtbs`. This keeps the ROM's boot-tested kernel config as the baseline. To fall back to the selected kernel branch's `pine-perf_defconfig`, run with `BASE_CONFIG=` and `DEFCONFIG=pine-perf_defconfig`.

## Expected artifacts

GitHub Actions uploads an artifact named `pine-docker-kernel` containing:

- `Image.gz-dtb`
- `Image.gz`
- `dts.tar.gz`
- `config-docker-final`

The result is a kernel image, not a flashable boot image yet. Repacking requires the current matching `boot.img` or a recovery backup export.

## Notes

- `adb root` does not work on the current production build.
- Magisk exists, but normal `su` is not in `PATH`; observed root entry is `/debug_ramdisk/su`.
- Before flashing a repacked boot image, verify the final config with Docker's `check-config.sh` or `dockerd --debug` on-device.
- First GitHub Actions run `26612148198` failed because `yes "" | make olddefconfig` trips `set -o pipefail` after `olddefconfig` exits. The script now calls `make olddefconfig` directly.
- Second GitHub Actions run `26612323135` failed in `arch/arm64/kernel/vdso32` because clang used host `/usr/bin/as`, which does not accept ARM `-EL`. The script now passes `CLANG_PREFIX32=-B/usr/bin/arm-linux-gnueabi-` and `CLANG_GCC32_TC=--gcc-toolchain=/usr`.
- Third GitHub Actions run `26612499711` failed because `CLANG_PREFIX32=arm-linux-gnueabi-` was interpreted by clang as a file path.
- Fourth GitHub Actions run `26612631168` still selected host `/usr/bin/as` with `CLANG_PREFIX32=-B/usr/bin/`, so the script now uses the full binutils prefix `-B/usr/bin/arm-linux-gnueabi-`.
- Fifth GitHub Actions run `26612755663` passed the vdso32 toolchain stage but failed in `drivers/media/platform/msm/camera_v2` with `enum v4l2_mbus_pixelcode`, indicating the pulled device `current.config` does not match the selected Lineage kernel branch headers. The script now defaults to the branch defconfig and only uses `current.config` when `BASE_CONFIG` is explicitly set.
- Sixth GitHub Actions run `26613157486` still used the Lineage source and failed; the device was then identified as `PixelExtended_pine-12.0-20220227-0902-OFFICIAL`.
- Seventh GitHub Actions run `26613620370` succeeded after switching to `https://github.com/hsx02/kernel_xiaomi_sdm439.git`, branch `a12/main`, defconfig `pine-perf_defconfig`.
- Successful artifact: `pine-docker-kernel`, about 27 MB, created `2026-05-29T02:17:25Z`, expires `2026-08-27T02:05:03Z`.
- Local debug backups and downloaded run logs created during setup were removed per project preference; do not create more local backups/log dumps for this kernel debug flow.
- The Android 12 "internal problem with your device" dialog is triggered by `ActivityTaskManagerService` after `Build.isBuildConsistent()` fails. On this Treble ROM that path calls `VintfObject.verifyWithoutAvb()`, which checks runtime kernel config against framework VINTF matrices. The local Android 12 `compatibility_matrix.3.xml` for kernel `4.9.84` requires `CONFIG_FHANDLE=n`; `boot-docker-pinned.img` had `CONFIG_FHANDLE=y`, so it can boot but fail VINTF. The next build should use `current.config` as the baseline and force `CONFIG_FHANDLE` off.
- Device-config baseline build `90497b6` / GitHub Actions run `26623257355` succeeded. Artifact `pine-docker-kernel-devicebase.zip` SHA256 is `1ce602d0660b25b3b7b74ff9be135323e40ae31a53782363550da5d84ad52412`. Repacked boot is `artifacts/boot-docker-devicebase.img`, SHA256 `d387f36ed8e6e705cc68ee2aff60469a3691887cfa37cdbfe4f14c377dd26819`. TWRP-format copy is `artifacts/twrp-boot-docker-devicebase-20260529/boot.emmc.win` with matching `.sha2`. Offline matrix check against local Android 12 `compatibility_matrix.3.xml` for `4.9.84` reports `failures=0`.

## 2026-05-29 boot verification

- Device booted and ADB is available at `192.168.2.103:5555`.
- Root verified through Magisk: `uid=0(root) gid=0(root) context=u:r:magisk:s0`.
- Running kernel: `4.9.297-perf/pine-g3ce83b96c7ea`.
- Docker Engine is running from persistent storage under `/data/adb/docker`; Docker version is `29.5.2`.
- Persistent rootfs/data paths: `/data/adb/docker-rootfs-v2`, `/data/adb/docker-data`, `/data/adb/docker/run/docker.sock`.
- Magisk module autostart is active at `/data/adb/modules/pine_docker_engine/service.sh`; it starts both `start-dockerd.sh boot` and `start-panel.sh boot`.
- Web panel is served by Docker container `pine-docker-panel`, using image `python:3.13-alpine`, restart policy `unless-stopped`, host network, and URL `http://192.168.2.103:8088/`.
- Verified panel endpoints from the Windows host: `/`, `/api/images`, `/api/containers`.
- Verified containers:
  - `hello-world` with `--network=none` completed successfully.
  - `busybox:latest` with `--network=none` printed `BUSYBOX_OK`, `aarch64`, and root id.
  - `busybox:latest` on default bridge printed route via `172.17.0.1` and `DNS_OK`.
- Temporary test script pushed to `/data/local/tmp/test-docker-containers.sh` was removed after verification.
- Backup before this handoff edit: `HANDOFF.md.bak-20260529-194802`.

## 2026-05-29 panel performance update

- The lightweight Docker panel was upgraded with a host performance section on the dashboard.
- New endpoint: `GET /api/performance`.
- Metrics shown in the UI: CPU usage and load average, memory usage, Docker data disk usage, network RX/TX rate and totals, and host uptime.
- The panel container now mounts host `/proc` read-only at `/host/proc` and Docker data read-only at `/docker-data`.
- Updated persistent files:
  - `/data/adb/docker-rootfs-v2/opt/docker-panel/app.py`
  - `/data/adb/docker/scripts/start-panel.sh`
- Backups before this change:
  - Local `docker-persist/panel/app.py.bak-20260529-210157`
  - Local `docker-persist/scripts/start-panel.sh.bak-20260529-210157`
  - Device `/data/adb/docker-rootfs-v2/opt/docker-panel/app.py.bak-20260529-210157`
  - Device `/data/adb/docker/scripts/start-panel.sh.bak-20260529-210157-device`
  - Local `HANDOFF.md.bak-20260529-210157`
- Verification:
  - `pine-docker-panel` is running after rebuild.
  - Container mounts include `/proc -> /host/proc` and `/data/adb/docker-data -> /docker-data`.
  - `http://192.168.2.103:8088/api/performance` returned CPU, memory, disk, network, and uptime data.

## 2026-05-29 Docker one-click install packages

- Generated reusable packaging script: `packaging/build-docker-install-packages.ps1`.
- Docker static aarch64 version bundled into the packages: `29.5.2`.
- Final install packages:
  - Magisk App module zip: `artifacts/docker-install-packages/pine-docker-engine-29.5.2-20260529-222010-magisk.zip`
  - Recovery/TWRP flashable zip: `artifacts/docker-install-packages/pine-docker-engine-29.5.2-20260529-222010-recovery.zip`
  - SHA256 file: `artifacts/docker-install-packages/pine-docker-engine-29.5.2-20260529-222010.sha256.txt`
- SHA256:
  - `53b8692a6960b452438963c8d9f347a4a16f6563ca93ae9fc23eb675b5aa6c1d  pine-docker-engine-29.5.2-20260529-222010-magisk.zip`
  - `04859e4fe44ba51a6bf3c2898a7b91ecb0a70416511aafc5587eb9c1b72948af  pine-docker-engine-29.5.2-20260529-222010-recovery.zip`
- Package behavior:
  - Installs Docker binaries and scripts to `/data/adb/docker`.
  - Installs panel file to `/data/adb/docker-rootfs-v2/opt/docker-panel/app.py`.
  - Installs Magisk module to `/data/adb/modules/pine_docker_engine`.
  - Preserves Docker data under `/data/adb/docker-data`.
  - Replaces only runtime binaries/scripts/panel; previous `bin`, `scripts`, and `opt/docker-panel` directories are renamed with timestamped `.bak-*` suffix on-device.
- Panel network page was reduced to status and ARP/neighbor-device display. Hotspot start/stop controls were removed because this device/ROM does not support Wi-Fi STA and SoftAP concurrently.
- Local backups before packaging edits:
  - `docker-persist/panel/app.py.bak-20260529-215552-package`
  - `docker-persist/scripts/start-panel.sh.bak-20260529-215552-package`
  - `packaging/build-docker-install-packages.ps1.bak-20260529-221827-modefix`
  - `packaging/build-docker-install-packages.ps1.bak-20260529-221951-ps5path`
  - `HANDOFF.md.bak-20260529-221555-docker-package`
- Verification completed locally:
  - `python -m py_compile docker-persist/panel/app.py`
  - hotspot control strings no longer appear in panel/start script.
  - both zip files passed `python -m zipfile -t`.
  - zip entries for `update-binary`, module wrappers, Docker binaries, Docker scripts, and panel script have executable mode `0755`.
- Not verified on-device in this packaging pass because ADB was offline during local packaging. Boot/kernel/recovery backup files were not modified.

## 2026-05-30 103 panel SMS and title fix

- Target device: `192.168.2.103:5555`, Redmi 7A / `pine`.
- Scope: Docker web panel and persistent Docker runtime scripts only. Kernel, boot image, Magisk root files, and recovery backups were not modified.
- Fixed SMS database discovery for PixelExtended/Android 12 path variants by mounting and checking:
  - `/data/data/com.android.providers.telephony/databases/mmssms.db`
  - `/data/user/0/com.android.providers.telephony/databases/mmssms.db`
  - `/data/user_de/0/com.android.providers.telephony/databases/mmssms.db`
- Fixed panel host identity so installed devices display their own model/device instead of a hard-coded `Pine Docker` title. On 103 the API now reports `Redmi 7A` with subtitle `pine`.
- Fixed `start-panel.sh` to clear stale Python listeners on port `8088` before starting the Docker panel. This handles orphaned `containerd-shim-runc-v2`/`python /app/app.py` processes that can survive daemon recovery and keep serving the old panel.
- Updated persistent files on 103:
  - `/data/adb/docker-rootfs-v2/opt/docker-panel/app.py`
  - `/data/adb/docker/scripts/start-dockerd.sh`
  - `/data/adb/docker/scripts/start-panel.sh`
- Final SHA256 on 103:
  - `5ab2b0ec8c100bc2581260d8fee8148cb459a8e80b928457511090c49caf8c0f  /data/adb/docker-rootfs-v2/opt/docker-panel/app.py`
  - `0c0f76b3c06f5b1670f011f1b5d98c7acb3d5a560d891f48f893c53fac40a46a  /data/adb/docker/scripts/start-dockerd.sh`
  - `6065672edecc56f0212ffb49380ac143205294374a4c68cc2cda000ab99e8728  /data/adb/docker/scripts/start-panel.sh`
- Backups before the 103 changes:
  - Device: `/data/adb/docker/backups/panel-20260530-103-sms-remount/`
  - Device: `/data/adb/docker/backups/panel-20260530-103-port-conflict/start-panel.sh.bak`
  - Device: `/data/adb/docker/backups/panel-20260530-103-port-listener/start-panel.sh.bak`
  - Device: `/data/adb/docker/backups/panel-20260530-103-port-kill9/start-panel.sh.bak`
  - Local: `artifacts/103-sms-fix/*.bak-20260530-*`
  - Local handoff backup: `HANDOFF.md.bak-20260530-103-sms-portfix`
- Verification on 103:
  - Docker daemon running; Docker Server version `29.5.2`.
  - `pine-docker-panel` container running from `python:3.13-alpine`, host network, port `8088`.
  - `GET http://192.168.2.103:8088/api/sms?limit=2` returned `available=true`, `path=/telephony-db/mmssms.db`, `count=2`.
  - `GET http://192.168.2.103:8088/api/state` returned host `name=Redmi 7A`, `subtitle=pine`, `model=Redmi 7A`, `device=pine`.
- Temporary diagnostic scripts pushed under `/data/local/tmp` during this fix were removed after verification.

## 2026-05-30 103 Docker autostart repair

- Target device: `192.168.2.103:5555`, Redmi 7A / `pine`.
- Scope: Magisk module service entry and persistent Docker runtime script only. Kernel, boot image, Docker data, images, and containers were not modified.
- Root cause 1: `/data/adb/modules/pine_docker_engine/disable` existed, so Magisk skipped the `pine_docker_engine` module and did not run `service.sh` at boot.
- Root cause 2: after re-enabling the module, `/data/adb/docker/scripts/start-dockerd.sh` failed under `set -eu` because the optional telephony directory `/data/data/com.android.providers.telephony/databases` was absent on this boot path.
- Re-enabled the Magisk module by removing `/data/adb/modules/pine_docker_engine/disable`.
- Updated `/data/adb/modules/pine_docker_engine/service.sh` so it starts Docker first, waits up to 90 seconds for `docker info` to succeed on `/data/adb/docker/run/docker.sock`, then starts the web panel.
- Updated `/data/adb/docker/scripts/start-dockerd.sh` with `mount_dir_if_exists()` and changed the three telephony directory bind mounts to skip missing source directories instead of aborting Docker startup.
- Backups before the 103 autostart changes:
  - Device: `/data/adb/docker/backups/autostart-fix-20260530-171610/`
  - Device: `/data/adb/docker/backups/autostart-order-20260530-171811/service.sh.before`
  - Device: `/data/adb/docker/backups/autostart-dockerd-mount-20260530-162605/start-dockerd.sh.before`
  - Local handoff backup: `HANDOFF.md.bak-20260530-170137-103-autostart`
- Verification on 103:
  - Manual Magisk service entry run succeeded; `service.log` showed `docker ready after 5s; starting panel`.
  - Controlled reboot completed; `sys.boot_completed=1`.
  - Docker daemon came up automatically; Docker Server version `29.5.2`.
  - `pine-docker-panel` came up automatically from `python:3.13-alpine`.
  - Host checks passed for `192.168.2.103:5555`, `192.168.2.103:8088`, and `GET http://192.168.2.103:8088/api/state`.

## 2026-05-30 103 service delay and disable recovery

- Target device: `192.168.2.103:5555`, Redmi 7A / `pine`.
- Scope: Magisk module service entry only. Kernel, boot image, Docker data, images, and containers were not modified.
- After a later cold boot, Docker did not start because `/data/adb/modules/pine_docker_engine/disable` had reappeared. Magisk skips the module completely when this file exists, so `service.sh` was not executed.
- Removed `/data/adb/modules/pine_docker_engine/disable`.
- Updated `/data/adb/modules/pine_docker_engine/service.sh` to wait for `sys.boot_completed=1` for up to 180 seconds, then sleep an additional 60 seconds before starting Docker. This gives Android userspace, `/data`, networking, and provider databases time to settle before Docker and the panel are started.
- Backups before this change:
  - Device: `/data/adb/docker/backups/service-delay-disable-20260530-174857/service.sh.before`
  - Device: `/data/adb/docker/backups/service-delay-disable-20260530-174857/disable.before`
  - Local handoff backup: `HANDOFF.md.bak-20260530-175346-103-service-delay`
- Final SHA256 on 103:
  - `d617189b07546373c618927961955cada6d31e8f66a80a56a2a751547e071ab0  /data/adb/modules/pine_docker_engine/service.sh`
  - `4a7ec515a34d8aee05ec594cea680e63a09a30a8b9e298ae05b0002c78dfc624  /data/adb/docker/scripts/start-dockerd.sh`
  - `a4d6dff6fbffc12845295b24c47a6598abac0e9cbfc4fbe4341e50e0ab3aceea  /data/adb/docker/scripts/start-panel.sh`
- Verification on 103 after manual service trigger:
  - `/data/adb/modules/pine_docker_engine/disable` is absent.
  - `service.log` showed `boot_completed after 0s; settling 60s before docker start`, then `docker ready after 12s; starting panel`.
  - Docker daemon running; Docker Server version `29.5.2`.
  - `pine-docker-panel` container running from `python:3.13-alpine`.
  - `GET http://192.168.2.103:8088/api/state` returned host `Redmi 7A` / `pine`.
  - `GET http://192.168.2.103:8088/api/sms?limit=2` returned `available=true`, `path=/telephony-db/mmssms.db`, and two SMS rows.

## 2026-05-30 Magisk autostart safety change

- User-observed issue: enabling the `pine_docker_engine` Magisk module can put 103 into a repeated reboot/offline loop. This matches the earlier riva finding where Docker/containerd autostart destabilized Android userspace.
- Safety decision: the Magisk module must not start Docker automatically at boot. Keep Docker as a manual service until the runtime startup path is reduced and tested without soft reboot.
- Updated local package source `docker-persist/module/service.sh` to a no-op service entry. It only logs:
  - `pine_docker_engine service autostart skipped`
  - manual start command: `/data/adb/docker/scripts/start-dockerd.sh restart && /data/adb/docker/scripts/start-panel.sh manual`
- Local backup before this source edit: `docker-persist/module/service.sh.bak-20260530-185131-safe-noop`.
- Rebuilt safe install packages:
  - Magisk App module zip: `artifacts/docker-install-packages/pine-docker-engine-29.5.2-20260530-185432-magisk.zip`
  - Recovery/TWRP flashable zip: `artifacts/docker-install-packages/pine-docker-engine-29.5.2-20260530-185432-recovery.zip`
  - SHA256 file: `artifacts/docker-install-packages/pine-docker-engine-29.5.2-20260530-185432.sha256.txt`
- SHA256:
  - `afad16cb43df2e693782c3b61ae365cbb8ef78e8d514b48fbe287c7f8b7f73b3  pine-docker-engine-29.5.2-20260530-185432-magisk.zip`
  - `22b1d84635fbfafbcff3849f20d501a07ed8d8601cd9a20769fe032ad95a5d99  pine-docker-engine-29.5.2-20260530-185432-recovery.zip`
- Verification completed locally:
  - `python -m zipfile -t` passed for the safe Magisk zip.
  - Inspected `service.sh` inside the safe Magisk zip; it is the no-op autostart-skipped script.
- Applied on 103 after ADB recovered: `/data/adb/modules/pine_docker_engine/service.sh` was replaced with the no-op script, `/data/adb/modules/pine_docker_engine/disable` was created, and `/data/adb/docker/scripts/root-start-docker.sh` was installed for root/manual startup.
- Local handoff backup before this edit: `HANDOFF.md.bak-20260530-191539-module-safe-noop`.

## 2026-05-30 103 root launch without Magisk autostart

- Target device: `192.168.2.103:5555`, Redmi 7A / `pine`.
- Final startup policy: do not use Magisk module autostart for Docker. Keep `/data/adb/modules/pine_docker_engine/disable` present and launch Docker only through root.
- Device-side backup before this change:
  - `/data/adb/docker/backups/root-launch-no-magisk-20260530-191932/service.sh.before`
  - `/data/adb/docker/backups/root-launch-no-magisk-20260530-191932/disable.before`
- Updated device files:
  - `/data/adb/modules/pine_docker_engine/service.sh` is now a no-op logger.
  - `/data/adb/modules/pine_docker_engine/disable` exists with mode `000`.
  - `/data/adb/docker/scripts/root-start-docker.sh` starts Docker and the panel from root context.
- Root start command:
  - `/debug_ramdisk/su -c '/data/adb/docker/scripts/root-start-docker.sh'`
- Final SHA256 on 103:
  - `f0566af7b02bd7ba433134134d4ce21152c5160800d53fcede4e82140f6c63ad  /data/adb/modules/pine_docker_engine/service.sh`
  - `f82e813277b4b3eba9b3a6eec7d1a048befe5c9211ca59061fcb4b9368fec79c  /data/adb/docker/scripts/root-start-docker.sh`
- Rebuilt packages with no-op Magisk service and root launcher included:
  - Magisk App module zip: `artifacts/docker-install-packages/pine-docker-engine-29.5.2-20260530-192457-magisk.zip`
  - Recovery/TWRP flashable zip: `artifacts/docker-install-packages/pine-docker-engine-29.5.2-20260530-192457-recovery.zip`
  - SHA256 file: `artifacts/docker-install-packages/pine-docker-engine-29.5.2-20260530-192457.sha256.txt`
- SHA256:
  - `bd60f7d589f8f230a8b66dc589108678a8097f1be4ba731f1192c590a9c78b0a  pine-docker-engine-29.5.2-20260530-192457-magisk.zip`
  - `2939547e55cc96e654726f9f9ad5851c5e25e65c29a608992c504ac87ba10476  pine-docker-engine-29.5.2-20260530-192457-recovery.zip`
- Verification on 103:
  - Root start command completed successfully.
  - Docker daemon running; Docker Server version `29.5.2`.
  - `pine-docker-panel` container running from `python:3.13-alpine`.
  - `GET http://192.168.2.103:8088/api/state` returned host `Redmi 7A` / `pine`.
  - `GET http://192.168.2.103:8088/api/sms?limit=2` returned `available=true`, `path=/telephony-db/mmssms.db`, and two SMS rows.
- Local handoff backup before this edit: `HANDOFF.md.bak-20260530-192646-root-launch`.

## 2026-05-30 103 desktop-gated Magisk autostart

- Correction: waiting only for `sys.boot_completed=1` was not enough. The Magisk module must wait until Android reaches the desktop/Launcher state before starting Docker.
- Updated local source and device `/data/adb/modules/pine_docker_engine/service.sh` to a desktop-gated wrapper:
  - waits for `sys.boot_completed=1`;
  - accepts optional `dev.bootcomplete=1`;
  - waits for `init.svc.bootanim=stopped`;
  - checks `dumpsys window` for Launcher-like foreground focus (`launcher`, `quickstep`, `trebuchet`, `Launcher3`, or `NexusLauncher`);
  - after desktop is detected, sleeps another 180 seconds before starting Docker through `/data/adb/docker/scripts/root-start-docker.sh`;
  - uses `/data/adb/docker/state/magisk-autostart.pending` as a bootloop guard. If the previous boot did not finish Docker autostart, the next Magisk run creates `/data/adb/modules/pine_docker_engine/disable` and skips Docker.
- Device backup before this change:
  - `/data/adb/docker/backups/magisk-desktop-wrapper-20260530-210450/service.sh.before`
  - `/data/adb/docker/backups/magisk-desktop-wrapper-20260530-210450/disable.before`
- Local backup before this source edit:
  - `docker-persist/module/service.sh.bak-20260530-210450-desktop-wrapper`
  - `HANDOFF.md.bak-20260530-211223-desktop-wrapper`
- Device state after applying:
  - `/data/adb/modules/pine_docker_engine/service.sh` installed and `sh -n` passed.
  - `/data/adb/modules/pine_docker_engine/disable` removed so Magisk can run the new desktop-gated wrapper on next boot.
  - SHA256 observed after install: `897b66584e17fe04a99306c7bb37308bda0d83e0303c6067fa594ade123c31ed  /data/adb/modules/pine_docker_engine/service.sh`.
- Rebuilt packages with desktop-gated Magisk wrapper:
  - Magisk App module zip: `artifacts/docker-install-packages/pine-docker-engine-29.5.2-20260530-210819-magisk.zip`
  - Recovery/TWRP flashable zip: `artifacts/docker-install-packages/pine-docker-engine-29.5.2-20260530-210819-recovery.zip`
  - SHA256 file: `artifacts/docker-install-packages/pine-docker-engine-29.5.2-20260530-210819.sha256.txt`
- SHA256:
  - `4b27f579e199f96fa5fc94e4ee243eace24dc529dc1a1dcfa1454e94da6054d0  pine-docker-engine-29.5.2-20260530-210819-magisk.zip`
  - `4cdd5b7e8534a2e2375cc9851ffa0b47ff5b76c0680f626ad7d66b7823006794  pine-docker-engine-29.5.2-20260530-210819-recovery.zip`
- Verification completed:
  - Safe package zip test passed.
  - Package `service.sh` was inspected and contains `desktop_ready` plus `magisk-autostart.pending` guard.
  - Before ADB went offline again, current foreground focus was observed as Settings (`com.android.settings/.SubSettings`), so the new wrapper would not treat that as desktop-ready and would keep waiting.
- Reboot/autostart verification on 103 completed after this wrapper change:
  - `service.log` showed `pine_docker_engine desktop-gated service start boot_id=c6963f10-f323-4abe-8714-89d16508f50c`.
  - `service.log` showed `desktop ready after 25s; settling 180s before docker start`.
  - `service.log` showed `starting docker through root launcher` at `2026-05-30 22:18:35 JST`.
  - `service.log` showed `docker autostart completed` at `2026-05-30 22:19:00 JST`.
  - `/data/adb/docker/state/magisk-autostart.last` contained `c6963f10-f323-4abe-8714-89d16508f50c success Sat May 30 22:19:00 JST 2026`.
  - Docker daemon running; Docker Server version `29.5.2`.
  - `pine-docker-panel` running from `python:3.13-alpine`, container `b33d595d8aae`.
  - `GET http://192.168.2.103:8088/api/state` returned HTTP `200`, `14504` bytes, about `1.94s` from the Windows host.
- Note: with this design Docker intentionally does not start immediately at boot. It starts only after desktop readiness is detected and the additional 180-second settle delay completes.
- Local handoff backup before this verification edit: `HANDOFF.md.bak-20260530-212253-autostart-verified`.
