# Sync handoff

更新时间：2026-05-30 22:40

## 目标

把 `pine` 和 `riva` 两个机型迁到 GitHub 私有仓库 `00660/android-docker-boot-builder`，仓库只保留轻量构建输入和 workflow。

## 当前策略

- 不把 `boot.img`、已构建 `boot-docker.img`、Docker runtime zip 进 git。
- 不把大文件放 Release 长期保存。
- workflow 手动触发时通过 `boot_source_url` 下载匹配 ROM 的 boot.img 或 ROM zip。
- workflow 定时触发时通过 repo variables `PINE_BOOT_SOURCE_URL` / `RIVA_BOOT_SOURCE_URL` 下载匹配 ROM 的 boot.img 或 ROM zip。
- kernel source 始终从上游仓库拉取。

## 仓库内容

- `.github/workflows/build-boot.yml`
- `devices/pine/current.config`
- `devices/pine/config/docker-required.fragment`
- `devices/pine/scripts/build-pine-docker-kernel.sh`
- `devices/riva/current.config`
- `devices/riva/config/docker-required.fragment`
- `devices/riva/scripts/build-riva-docker-kernel.sh`
- `scripts/repack-boot.sh`
- `tools/mkbootimg/`

## 设备状态

- `pine`：verified。
- `riva`：experimental，boot 可进系统，但 Docker runtime 曾触发 soft reboot 风险。

## repo variables

- `PINE_BOOT_SOURCE_URL=https://sourceforge.net/projects/pixelextended/files/pine/PixelExtended_pine-12.0-20220227-0902-OFFICIAL.zip/download`
- `RIVA_BOOT_SOURCE_URL=https://sourceforge.net/projects/crdroid/files/rova/10.x/crDroidAndroid-14.0-20241015-rova-v10.9.zip/download`

## 2026-05-30 LineageOS Xiaomi 采集更新

按最新方向，停止 XDA 采集，改为只使用 LineageOS 官方来源：

- `https://wiki.lineageos.org/devices/`
- `https://github.com/LineageOS`
- `https://download.lineageos.org/api/v2/devices/<codename>/builds`

新增事实采集链路：

- `.github/workflows/discover-lineage-xiaomi.yml`
- `scripts/lineage-xiaomi-catalog.mjs`
- `catalog/README.md`
- `recipes/lineage/README.md`

采集路径固定为 `LineageOS wiki 设备数据 -> LineageOS GitHub device/kernel repo -> BoardConfig -> LineageOS 官方 download API`。脚本会校验 device tree 与 kernel repo 是否存在同一个 LineageOS 分支，并检查 kernel repo 根目录是否为完整源码树。

新增通用 recipe 构建入口：

- `.github/workflows/build-lineage-recipe.yml`
- `scripts/build-lineage-recipe.sh`
- `config/docker-required.fragment`

构建 workflow 只接受 `status=build_ready` 的 recipe。也可以直接输入 LineageOS codename；这时 workflow 会先运行 `scripts/lineage-xiaomi-catalog.mjs` 生成该 codename 的 recipe。之后它下载官方 LineageOS OTA zip，从 `boot.img` 或 `payload.bin` 提取 boot 基线，编译同分支 LineageOS kernel，合并 Docker config fragment，并用 `scripts/repack-boot.sh` 生成 `boot-docker.img`。

如果缺官方 OTA、缺完整 kernel 源码、缺共享 LineageOS 分支或缺 `TARGET_KERNEL_CONFIG`，recipe 会进入 `lineage-xiaomi-blocked.json`，构建 workflow 会拒绝猜参数。

`alioth` 首次 GitHub Actions 构建验证失败在 kernel 编译阶段，真实错误为 `drivers/staging/qcacld-3.0/.../wlan_hdd_assoc.o: /bin/sh: Argument list too long`。原因是 kernel 源码和 out 目录位于 GitHub workspace 的长路径下，qcacld 编译命令超过参数长度限制。已把 `scripts/build-lineage-recipe.sh` 默认 `WORK_DIR` 改到 `${RUNNER_TEMP:-/tmp}/lrec`，并缩短 `SRC_DIR=k`、`OUT_DIR=o`。

第二次 `alioth` 构建验证失败在 recipe 解析阶段，真实错误为 GitHub code search `429 Too Many Requests`。构建单个 codename 不再使用 code search，已改为直接读取 `codename.yml` 和 `codename_variantN.yml`，例如 `alioth_variant1.yml`。

第三次 `alioth` GitHub Actions 构建验证成功：

- workflow run: `https://github.com/00660/android-docker-boot-builder/actions/runs/26689978219`
- commit: `1795d71f8e1491afdbe2679dba06a7d46c83ee0f`
- artifact: `lineage-docker-boot`
- artifact id: `7310275308`
- artifact zip size: `49,846,068` bytes
- `boot-docker.img` size: `55,001,088` bytes
- artifact 内容包含 `boot-docker.img`、`boot-docker.img.sha256`、`Image`、`config-docker-final`、`recipe.json`、`upstream-commit`、`upstream-ref`、`upstream-repo`

2026-05-31 全量 LineageOS Xiaomi discover 验证成功：

- workflow run: `https://github.com/00660/android-docker-boot-builder/actions/runs/26695933160`
- commit: `ea969bc5e7e4689800d9b809523242994a25a68b`
- 官方页面 Xiaomi recipe: `81`
- `build_ready`: `54`
- blocked: `27`
- blocked 只记录官方来源缺失原因，不猜参数。

新增全量 ready 构建入口：

- `.github/workflows/build-lineage-xiaomi-ready.yml`
- 默认构建 `catalog/lineage-xiaomi-recipes.json` 里所有 `build_ready` 机型。
- 可用 `devices` 输入指定逗号分隔 codename 子集。
- 每个机型上传独立 artifact：`lineage-docker-boot-<codename>`。
- 矩阵 `max-parallel=3`，避免一次性拉爆 runner/下载/编译资源。

本次修改前备份：

- `README.md.bak-20260530-225835`
- `SYNC-HANDOFF.md.bak-20260530-225835`
- `README.md.bak-20260530-232513`
- `SYNC-HANDOFF.md.bak-20260530-232513`
- `scripts/xda-xiaomi-catalog.mjs.bak-20260530-232513`
- `.github/workflows/discover-xiaomi-xda.yml.bak-20260530-232513`
- `scripts/build-lineage-recipe.sh.bak-20260531-010801`
- `SYNC-HANDOFF.md.bak-20260531-010801`
- `scripts/lineage-xiaomi-catalog.mjs.bak-20260531-011048`
- `SYNC-HANDOFF.md.bak-20260531-011048`
- `SYNC-HANDOFF.md.bak-20260531-021421`
- `README.md.bak-20260531-055900`
- `SYNC-HANDOFF.md.bak-20260531-055900`
