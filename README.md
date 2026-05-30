# Android Docker Boot Builder

私有轻量构建仓库。仓库只保留 recipe、kernel config fragment、当前 ROM 导出的 config、mkbootimg 工具和 GitHub Actions workflow。

不把本地 boot.img、已构建 boot.img、Docker runtime zip 塞进 git。

## Build

手动运行 `.github/workflows/build-boot.yml`：

- `device`: `pine` 或 `riva`
- `boot_source_url`: 与目标 ROM 完全匹配的 `boot.img` 或 ROM zip 直链；留空则用 repo variables
- `kernel_repo`: 可选，上游内核源码仓库覆盖
- `kernel_ref`: 可选，上游分支/tag/commit 覆盖

workflow 会：

1. 从 `boot_source_url` 下载匹配 boot.img；如果是 ROM zip，则从里面抽 `boot.img`。
2. 从上游 kernel repo/ref 拉源码。
3. 用本仓库的 `current.config` 和 Docker fragment 构建 `Image.gz-dtb`。
4. 用下载的 boot.img 作为基线 repack 出 `boot-docker.img`。
5. 上传 Actions artifact。

定时构建需要在私有仓库设置 repo variables：

- `PINE_BOOT_SOURCE_URL`
- `RIVA_BOOT_SOURCE_URL`

这两个值必须是匹配 ROM 的 `boot.img` 或 ROM zip 直链，不能跨版本复用。

当前 repo variables 已按已验证 ROM 设置：

- `PINE_BOOT_SOURCE_URL=https://sourceforge.net/projects/pixelextended/files/pine/PixelExtended_pine-12.0-20220227-0902-OFFICIAL.zip/download`
- `RIVA_BOOT_SOURCE_URL=https://sourceforge.net/projects/crdroid/files/rova/10.x/crDroidAndroid-14.0-20241015-rova-v10.9.zip/download`

## Devices

### pine

- 设备：Redmi 7A / `pine`
- ROM：`PixelExtended_pine-12.0-20220227-0902-OFFICIAL`
- 上游内核：`https://github.com/hsx02/kernel_xiaomi_sdm439.git`
- 默认分支：`a12/main`
- defconfig：`pine-perf_defconfig`
- 状态：verified。已在本地实机验证过 Docker Engine、容器、bridge 网络和 Web panel。

### riva

- 设备：Redmi 5A / `riva`，ROM family `rova`
- ROM：`crDroidAndroid-14.0-20241015-rova-v10.9`
- 上游内核：`https://github.com/crdroidandroid/android_kernel_xiaomi_rova.git`
- 默认分支：`14.0`
- defconfig：`vendor/msm8937-perf_defconfig`
- 状态：experimental。boot 可进系统，但 Docker runtime 曾触发 userspace soft reboot 风险。

## Notes

- `boot_source_url` 必须和 ROM、设备、boot header 匹配。
- 不跨设备、不跨 ROM 复用 boot 基线。
- scheduled workflow 会使用 repo variables 里的 boot URL；没有对应变量时会停止，避免生成不匹配 boot。
