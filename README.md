# Android Docker Boot Builder

私有 GitHub Actions 构建仓库，用于从匹配 ROM 的 boot 基线和对应 kernel 源码生成支持 Docker/container runtime 的 `boot.img`。

仓库只保存轻量构建输入、recipe、config fragment、mkbootimg 工具和 workflow；不把原始 ROM、`boot.img`、构建后的 boot 镜像或 Docker runtime 压进 git。

## LineageOS Xiaomi

LineageOS Xiaomi 自动链路使用官方来源：

- 设备数据：`https://wiki.lineageos.org/devices/`
- 源码组织：`https://github.com/LineageOS`
- 官方 OTA：`https://download.lineageos.org/api/v2/devices/<codename>/builds`

生成 catalog 和 recipe：

- workflow：`.github/workflows/discover-lineage-xiaomi.yml`
- 输出：`catalog/lineage-xiaomi-devices.json`
- 输出：`catalog/lineage-xiaomi-recipes.json`
- 输出：`catalog/lineage-xiaomi-blocked.json`
- recipe：`recipes/lineage/<codename>.json`

构建单个公开机型对应的 LineageOS boot：

- workflow：`.github/workflows/build-lineage-recipe.yml`
- 输入 `codename`，例如 `alioth`
- 或输入现有 recipe 路径，例如 `recipes/lineage/alioth.json`

构建全部 `build_ready` 的 Xiaomi recipe：

- workflow：`.github/workflows/build-lineage-xiaomi-ready.yml`
- `devices` 留空时构建全部 ready recipe
- `devices` 可传逗号分隔 codename，只构建指定机型

## Downloads

构建成功后会发布到 GitHub Releases 下载区。

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

workflow：`.github/workflows/build-boot.yml`

输入：

- `device`
- `boot_source_url`
- `kernel_repo`
- `kernel_ref`

定时构建使用 repo variables：

- `PINE_BOOT_SOURCE_URL`
- `RIVA_BOOT_SOURCE_URL`

`boot_source_url` 必须匹配目标 ROM 和设备，不能跨设备或跨 ROM 复用 boot 基线。
