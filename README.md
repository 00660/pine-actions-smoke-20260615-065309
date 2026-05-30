# Android Docker Boot Builder

私有仓库，用来自动跟随上游 kernel source，为已经验证过的机型重新构建 Docker 支持 boot。

## Devices

### pine

- 设备：Redmi 7A / `pine`
- ROM：`PixelExtended_pine-12.0-20220227-0902-OFFICIAL`
- 上游内核：`https://github.com/hsx02/kernel_xiaomi_sdm439.git`
- 分支：`a12/main`
- defconfig：`pine-perf_defconfig`
- 状态：verified。当前已验证 boot 和 Docker runtime 包放在 GitHub Release `boot-inputs` 里。

### riva

- 设备：Redmi 5A / `riva`，ROM family `rova`
- ROM：`crDroidAndroid-14.0-20241015-rova-v10.9`
- 上游内核：`https://github.com/crdroidandroid/android_kernel_xiaomi_rova.git`
- 分支：`14.0`
- defconfig：`vendor/msm8937-perf_defconfig`
- 状态：experimental。boot 已验证能进 Android，但 Docker runtime 曾触发 userspace soft reboot 风险。

## Automation

`.github/workflows/build-boot.yml` 支持：

- `workflow_dispatch` 手动选择 `all`、`pine` 或 `riva`
- 每天 UTC `03:17` 定时跟随上游分支重新构建

每次构建会输出：

- `boot-docker.img`
- `boot-docker.img.sha256`
- `Image.gz-dtb`
- `config-docker-final`
- `kernel-release`
- `upstream-repo`
- `upstream-ref`
- `upstream-commit`
- `build-manifest.env`

workflow 会先从私有 Release `boot-inputs` 下载对应 base boot：

- `pine-boot-current.img`
- `riva-boot-current.img`

当前已出的交付文件也放在同一个 Release：

- `pine-boot-docker-devicebase.img`
- `pine-docker-engine-29.5.2-20260530-210819-magisk.zip`
- `pine-docker-engine-29.5.2-20260530-210819-recovery.zip`
- `riva-boot-docker.img`

## Rules

- 只对源码链闭合的机型自动构建。
- `base/boot-current.img` 由 workflow 从 Release asset 下载，是 repack 基线，不能跨 ROM/机型复用。
- `current.config` 是当前 ROM 的运行配置基线，避免无关硬件配置漂移。
- `riva` artifact 只作为 experimental，未解决 runtime soft reboot 前不要标成 verified。
