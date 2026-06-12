# Android Docker Boot Builder

私有 GitHub Actions 构建仓库，用于从匹配 ROM 的 boot 基线和对应 kernel 源码生成支持 Docker/container runtime 的 `boot.img`。

仓库只保存轻量构建输入、recipe、config fragment、mkbootimg 工具和 workflow；不把原始 ROM、`boot.img`、构建后的 boot 镜像或 Docker runtime 压进 git。

## LineageOS Recipes

LineageOS 自动链路使用官方来源：

- 设备数据：`https://wiki.lineageos.org/devices/`
- 源码组织：`https://github.com/LineageOS`
- 官方 OTA：`https://download.lineageos.org/api/v2/devices/<codename>/builds`
- 构建范围：只构建 `arm64` 设备；32 位或非 `arm64` 设备只记录 blocked，不生成 boot。

Xiaomi 兼容入口：

- workflow：`.github/workflows/discover-lineage-xiaomi.yml`
- 输出：`catalog/lineage-xiaomi-devices.json`
- 输出：`catalog/lineage-xiaomi-recipes.json`
- 输出：`catalog/lineage-xiaomi-blocked.json`
- recipe：`recipes/lineage/<codename>.json`

全厂商入口：

- workflow：`.github/workflows/discover-lineage-vendors.yml`
- `vendors` 留空或传 `*` 时采集官方页面公开的全部厂商
- `vendors` 可传逗号分隔 `vendor_short`，例如 `samsung,oneplus,sony`
- 输出：`catalog/lineage-vendors-devices.json`
- 输出：`catalog/lineage-vendors-recipes.json`
- 输出：`catalog/lineage-vendors-blocked.json`
- recipe：`recipes/lineage-vendors/<vendor_short>/<codename>.json`

构建单个公开机型对应的 LineageOS boot：

- workflow：`.github/workflows/build-lineage-recipe.yml`
- 输入 `codename`，例如 `alioth`
- 或输入现有 recipe 路径，例如 `recipes/lineage/alioth.json`

构建全部 `build_ready` 的 Xiaomi recipe：

- workflow：`.github/workflows/build-lineage-xiaomi-ready.yml`
- `devices` 留空时构建全部 ready recipe
- `devices` 可传逗号分隔 codename，只构建指定机型
- Actions artifact 名和 Releases 下载文件名都使用公开机型名。

构建全部厂商的 `build_ready` recipe：

- workflow：`.github/workflows/build-lineage-vendors-ready.yml`
- `vendors` 留空时构建全厂商 catalog 里的 ready recipe
- `vendors` 可传逗号分隔 `vendor_short`
- `devices` 可传逗号分隔 codename，或 `vendor_short/codename`
- `max_parallel` 控制该 workflow 自己的并发数；默认 3，可传 1 降低对其他构建的影响
- 为避免 GitHub Actions matrix 上限，单次 ready 项超过 250 时需要按 `vendors` 或 `devices` 拆分运行

## Downloads

构建成功后会发布到 GitHub Releases 下载区。

Actions artifact 只作为构建过程里的短期中转产物，保留 1 天。长期下载请使用 GitHub Releases，避免 Actions artifact 存储占满后阻塞新 job。

下载区展示名使用公开机型名，不使用 LineageOS 内部 codename。文件名格式：

```text
<public-models>-lineage-<version>-<date>-docker-boot.img
```

同一个 release 会包含：

- `*.img`
- `*.img.sha256`
- `*.config`
- `*.recipe.json`

Release tag 格式：

```text
lineage-<version>-<date>-<public-models>-docker-boot
```

## Manual Devices

保留两个手动维护设备 workflow：

- `pine`：Redmi 7A
- `riva`：Redmi 5A
- `mido`：Redmi Note 4/4X，Docker / Droidspaces / ALSA loopback virtual mic build entry

workflow：`.github/workflows/build-boot.yml`

输入：

- `device`
- `boot_source_url`
- `kernel_repo`
- `kernel_ref`

定时构建使用 repo variables：

- `PINE_BOOT_SOURCE_URL`
- `RIVA_BOOT_SOURCE_URL`
- `MIDO_BOOT_SOURCE_URL`，可选；未设置时默认使用 `crDroidAndroid-15.0-20260531-mido-v11.16.zip` 的 SourceForge 地址

`boot_source_url` 必须匹配目标 ROM 和设备，不能跨设备或跨 ROM 复用 boot 基线。

`mido` 额外要求 ROM/vendor audio 同步接入 ALSA loopback capture。只启用 `CONFIG_SND_ALOOP=y` 会产生内核 PCM 节点，但 Android 应用层仍需要 Audio HAL 和 `audio_policy_configuration.xml` 暴露 input profile/device，详见 `devices/mido/HANDOFF.md`。
