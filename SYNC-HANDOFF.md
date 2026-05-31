# Sync handoff

更新时间：2026-05-31 07:10

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

按用户要求，构建成功后发布到 GitHub Releases 下载区：

- 新增 `scripts/prepare-lineage-release.sh`
- Release tag: `lineage-<version>-<date>-<public-models>-docker-boot`
- boot asset: `<public-models>-lineage-<version>-<date>-docker-boot.img`
- 同时上传 `.sha256`、`.config`、`.recipe.json`
- 单机 workflow 和全量 ready workflow 都会发布 release；如果 release 已存在就 `--clobber` 覆盖同名 asset。
- 旧的全量构建 run `26696044385` 已取消，因为它还没有 release 发布逻辑。

codename 只保留在 release notes 和 recipe 技术元数据里。

README 已清理为项目使用说明，只保留 workflow、输入、产物和命名规则；调试过程、失败记录和备份记录只放在本交接文档里。

全量 ready 构建 run `26696262658` 已取消。取消原因：`beryllium` 老内核在 32-bit vDSO 链接阶段使用宿主 `/usr/bin/ld`，真实错误为 `unrecognised emulation mode: armelf_linux_eabi`。先加入 `CROSS_COMPILE_COMPAT=arm-linux-gnueabi-` 后仍不够，因为该内核的 `arch/arm64/kernel/vdso32/Makefile` 使用 `CLANG_TARGET_ARM32`、`CLANG_GCC32_TC`、`CLANG_PREFIX32` 组装 32-bit clang 命令。已继续在 `scripts/build-lineage-recipe.sh` 的 kernel `MAKE_ARGS` 中加入：

- `CLANG_TARGET_ARM32=--target=arm-linux-gnueabi`
- `CLANG_GCC32_TC=--gcc-toolchain=/usr`
- `CLANG_PREFIX32=-B/usr/bin/arm-linux-gnueabi-`

这样旧内核 vdso32 链接应走 ARM32 binutils，而不是宿主 `/usr/bin/ld`。

下载区 release 与 boot asset 命名已按公开型号生成，不再把内部 codename 放进文件名和 tag。codename 只保留在 release notes 与 recipe 技术元数据里，方便溯源。

按用户要求，32 位设备太老，后续不构建。`scripts/lineage-xiaomi-catalog.mjs` 已加入 `LINEAGE_SUPPORTED_ARCHES`，默认只允许 `arm64`；非 `arm64` 设备会进入 blocked。`.github/workflows/build-lineage-xiaomi-ready.yml` 也在矩阵生成阶段再次过滤 `build.arch == arm64`，并把全量 job 名和 Actions artifact 名改为公开型号。

等待 Xiaomi 全量构建期间新增全厂商 LineageOS 官方链路，仍只使用 LineageOS wiki、LineageOS GitHub 和官方 download API：

- `scripts/lineage-xiaomi-catalog.mjs` 泛化为可配置厂商，默认仍是 Xiaomi，兼容原 workflow。
- 新增 `LINEAGE_VENDOR_SHORTS`，默认 `xiaomi`；传 `*` 或 `all` 时采集全部厂商。
- 新增 `LINEAGE_OUTPUT_PREFIX`，默认 `lineage-xiaomi`；全厂商 workflow 使用 `lineage-vendors`。
- 新增 `LINEAGE_RECIPE_LAYOUT`，默认 `flat`；全厂商 workflow 使用 `vendor`，recipe 路径为 `recipes/lineage-vendors/<vendor_short>/<codename>.json`。
- device tree 默认仓库从硬编码 `android_device_xiaomi_<codename>` 改为 `android_device_<vendor_short>_<codename>`。
- BoardConfig include 解析从 `device/xiaomi/...` 泛化为 `device/<vendor>/<device>/...`。
- 新增 `.github/workflows/discover-lineage-vendors.yml`，生成 `catalog/lineage-vendors-*.json` 和全厂商 recipe。
- 新增 `.github/workflows/build-lineage-vendors-ready.yml`，按公开型号发布 release；支持 `vendors` 和 `devices` 过滤，单次超过 250 个 ready 项会拒绝，要求拆分运行以避开 GitHub Actions matrix 上限。
- 不中断正在跑的 Xiaomi 全量构建；等 `26696815773` 结束后按失败项逐个修，不在结果出来前继续改共享编译脚本。

全厂商单进程 discover 曾跑到 30 分钟超时，已改为厂商矩阵实现：

- `LINEAGE_LIST_VENDORS=1` 只读取官方 wiki 设备 YAML，快速生成 `catalog/lineage-vendors-vendors.json`。
- 新增 `LINEAGE_WIKI_DIR`，workflow 会 sparse clone `LineageOS/lineage_wiki` 的 `_data/devices`，脚本从本地目录读 YAML，不再用 GitHub Contents API 逐文件读取 wiki。
- 同时生成 `catalog/lineage-vendors-device-data.json`，后续厂商 job 使用 `LINEAGE_DEVICE_DATA_FILE` 从本地 JSON 过滤设备，避免每个厂商重复读取整个 wiki。
- `discover-lineage-vendors.yml` 先生成 vendor matrix，再按厂商并行 discover，最后用 `scripts/merge-lineage-vendor-catalog.mjs` 合并 catalog。
- 厂商 discover 并发降为 `max-parallel=2`，降低 GitHub API 403 风险。
- 本地验证 `samsung,oneplus` vendor list 成功，返回 `oneplus 50`、`samsung 115`。
- 本地验证 Samsung/OnePlus 小样本 merge 成功：4 个 recipe，3 个 `build_ready`，1 个 blocked。
- 本地验证默认 Xiaomi 兼容输出成功：`alioth`、`apollon` 小样本仍生成 `catalog/lineage-xiaomi-*.json` 和 `recipes/lineage/<codename>.json`。
- API 错误处理已收紧：`branchExists`、BoardConfig include、kernel repo 校验和 download API 只把 404 当作缺失；403/限流等错误会让 workflow 失败，避免把可构建设备误写成 blocked。

Xiaomi 全量构建 run `26696815773` 当前观察到 `beryllium`、`alioth`、`apollon`、`chiron` 成功，`cupid` 失败。按用户要求先等 54 个跑完，再按失败项日志逐个修，不中途改共享编译脚本。

全厂商 discover run `26698230007` 已确认失败原因是各厂商 job 重复读取全量 wiki 设备 YAML，导致 GitHub API 403。已改为 prepare 阶段 sparse clone wiki 并生成本地 device-data；修复后需要取消该 run，重新触发 `discover-lineage-vendors.yml`。

修复后的全厂商 discover run `26698886477` 成功完成，Action 提交 `6371182` 已合并到 `main`：

- 43 个官方 vendor_short
- 606 个 LineageOS recipe
- 239 个 `build_ready`
- 367 个 blocked
- 架构分布：`arm64=415`、`arm=168`、`arm64-arm=18`、`x86_64-x86=4`、`x86=1`
- `build_ready` 前几名：`xiaomi=54`、`motorola=47`、`oneplus=33`、`samsung=32`、`sony=21`、`lge=10`
- 全厂商 `build_ready` 数量 239，低于 `build-lineage-vendors-ready.yml` 的 250 matrix 上限，可以单次触发全厂商 build；但当前先不抢 Xiaomi 全量编译资源。

按用户要求触发“排除 Xiaomi 的全厂商 build”。`build-lineage-vendors-ready.yml` 已新增 `max_parallel` 输入，默认 3；本次排除 Xiaomi 的 run 使用 `max_parallel=1`，降低对 Xiaomi run `26696815773` 的并发挤压。排除 Xiaomi 后共有 185 个 `build_ready` recipe。

- workflow run: `https://github.com/00660/android-docker-boot-builder/actions/runs/26702623715`
- commit: `41127b9a2de7dd5e3fa16fa3c1a9666fd0bacc16`
- vendors: `asus,essential,fairphone,fxtec,google,lenovo,lge,motorola,nintendo,nokia,nothing,nubia,nvidia,oneplus,osom,razer,realme,samsung,shift,smartisan,sony,vsmart,xelex,zte`
- 初始状态：prepare 成功，`ZenFone 8` 开始编译，后续构建按 `max_parallel=1` 串行推进。

Xiaomi 全量构建 run `26696815773` 已完成：30 success，25 failure。已确认失败类型：

- 多数新高通 GKI 设备的 recipe 包含 `vendor/$(PRODUCT_DEVICE)_GKI.config`，构建时被当成字面路径，导致 `merge_config.sh` 报文件不存在。
- `miatoll` 旧内核使用 `aarch64-linux-gnu-ld.gold` 链接 ThinLTO，报 `--thinlto-cache-dir=.thinlto-cache: unknown option`。
- `peridot` 内核开启 BTF，但 runner 没有 `pahole`，报 `pahole (pahole) is not available`。
- `garnet` 在 LTO 阶段收到 runner shutdown signal，按基础设施/瞬时失败处理，重跑验证。
- `sweet/thor/thyme/tucana/umi/unicorn/ursa/vayu/vela/venus/vermeer/violet/zeus/zizhan` 这些 job API 无 steps，日志下载返回 `BlobNotFound`，按基础设施/无日志失败处理，重跑验证。

已修 `scripts/build-lineage-recipe.sh`：

- 安装依赖增加 `dwarves`，提供 `pahole`。
- kernel `MAKE_ARGS` 显式加入 `LD=ld.lld`，避免旧内核误走 `ld.gold`。
- 合并 fragment 前把 `$(PRODUCT_DEVICE)` 替换为当前 recipe 的 `build.device`。

下一步只重跑 Xiaomi 失败子集，不重跑 30 个已成功设备。

已尝试触发 Xiaomi 失败子集重跑：

- `https://github.com/00660/android-docker-boot-builder/actions/runs/26704843177`
- `https://github.com/00660/android-docker-boot-builder/actions/runs/26704931599`

两次 run 都在 `prepare` 前被 GitHub 平台拒绝启动。check annotation 原文为：`The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings`。这不是 workflow 脚本错误；需要 GitHub Billing/Actions spending limit 恢复后再重跑失败子集。

用户查到后续阻塞更可能是 Actions 存储上限导致。已确认本仓库 Actions cache 为 0，清理前 Actions artifacts 有 85 个，合计约 750,925,131 bytes。已完成处理：

- workflow 中所有 `actions/upload-artifact@v4` 均设置 `retention-days: 1`。
- Actions artifact 只作短期中转；长期下载继续使用 GitHub Releases。
- 清理前已导出远端 artifacts JSON：`C:\Users\16547\AppData\Local\Temp\android-docker-boot-builder-artifacts-before-cleanup-20260531-143841.json`。
- 已删除远端旧 Actions artifacts：85 个成功，0 个失败。
- 清理后复查：Actions artifacts `total_count=0`，Actions cache `active_caches_count=0`、`active_caches_size_in_bytes=0`。
- 旧 artifacts 删除不会删除 Releases 下载区文件。
- 清理并推送 `a0a518f` 后重试 Xiaomi 失败子集 run `26705636542`，仍在 `prepare` 前被同一条 Billing annotation 拦截。GitHub 文档说明删除 artifacts 后会释放当前空间，但存储用量展示和账单侧状态可能需要 6 到 12 小时更新；如果账户付款失败或 spending limit 仍不足，job 仍会被平台拒绝启动。
- 账户级 billing REST 接口对当前 token 返回 404，无法从命令行确认个人账户/组织账户的账单页状态；需要在 GitHub 网页 `Settings -> Billing and plans` 里确认 Actions spending limit、付款方式和共享存储用量。

按用户要求试用临时公开仓库绕过私有仓库 Actions Billing 拦截：

- 临时公开仓库：`https://github.com/00660/android-docker-boot-builder-public-run-20260531-1450`
- 公开仓库 workflow 索引只识别历史里的 `build-boot.yml`，因此在本地临时分支 `public-run-index-20260531-1450` 上把该 workflow 临时替换为 Xiaomi LineageOS 构建入口，只推送到公开仓库，没有推回私有仓库。
- 公开构建 run：`https://github.com/00660/android-docker-boot-builder-public-run-20260531-1450/actions/runs/26706067039`
- run 已成功通过 `prepare`，25 个 Xiaomi 失败子集机型进入 matrix，当前公开仓库没有 Billing 秒拦。
- 后台监控脚本：`C:\Users\16547\AppData\Local\Temp\public-run-monitor-26706067039.ps1`
- 监控输出目录：`C:\Users\16547\AppData\Local\Temp\android-docker-boot-public-run-26706067039`
- 监控日志：`C:\Users\16547\AppData\Local\Temp\android-docker-boot-public-run-26706067039\monitor.log`
- 监控进程：`powershell.exe` PID `24124`
- 监控行为：每 5 分钟轮询 run；run 完成后下载公开仓库 Releases 资产到本地，创建/更新私有仓库同名 release 并上传资产；只有整批 run 结论为 `success` 且下载数量与上传数量一致时才删除临时公开仓库。
- 当前有效 run 是 `26706067039`。公开仓库中 `26705876671`、`26705959887` 是前两次 workflow 未索引/未替换成功时的失败尝试，不是当前构建批次。
- 用户指出失败后应停止且应使用 Ubuntu 24。原因确认：
  - 原先公开临时 workflow 沿用正式仓库 `ubuntu-22.04`，是为了先验证公开仓库能否绕开私有 Billing，不同时更换 runner 环境。
  - 原先 matrix 使用 `fail-fast: false`，单个机型失败不会停止其它机型；这适合收集全量失败面，但会浪费时间。
  - 已取消旧 run `26706067039`，结论为 `cancelled`。
  - 公开临时 workflow 已改为 `ubuntu-24.04` 和 `fail-fast: true`。
  - Ubuntu 24 首次 run `26707619796` 失败原因是缺 `lzma.h`，已补 `liblzma-dev`。
  - 当前 Ubuntu 24 有效 run：`https://github.com/00660/android-docker-boot-builder-public-run-20260531-1450/actions/runs/26707803977`
  - 当前监控脚本：`C:\Users\16547\AppData\Local\Temp\public-run-monitor-26707803977.ps1`
  - 当前监控输出目录：`C:\Users\16547\AppData\Local\Temp\android-docker-boot-public-run-26707803977`
  - 当前监控进程：`powershell.exe` PID `4624`
  - `diting` 单机型验证结论：保留 LTO/CFI，给 runner 增加 swap，并设置 `JOBS=1` 后，run `26710910848` 成功。
  - 成功 release：`lineage-23.2-20260527-12t-pro-redmi-k50-ultra-docker-boot`
  - 本地下载目录：`C:\Users\16547\AppData\Local\Temp\android-docker-boot-public-run-26710910848\release-assets`
  - 已上传到私有仓库 release：`https://github.com/00660/android-docker-boot-builder/releases/tag/lineage-23.2-20260527-12t-pro-redmi-k50-ultra-docker-boot`
  - 正式 Lineage 构建 workflow 已补同类修复：保留 LTO，不改官方 kernel config；增加 12G 动态 swap；构建环境设置 `JOBS=1`，避免 `LTO vmlinux.o` 阶段被标准 runner OOM 杀掉。
  - 剩余 Xiaomi 失败子集已排除成功的 `diting` 后继续跑公开仓库 run：`https://github.com/00660/android-docker-boot-builder-public-run-20260531-1450/actions/runs/26713200515`
  - 剩余 run 输入设备：`cupid,garnet,fuxi,mayfly,marble,mondrian,miatoll,nuwa,peridot,socrates,sweet,thor,thyme,tucana,unicorn,umi,vayu,ursa,vermeer,venus,vela,violet,zeus,zizhan`
  - 剩余 run watcher：`C:\Users\16547\AppData\Local\Temp\watch-public-run-26713200515.ps1`
  - 剩余 run watcher 输出目录：`C:\Users\16547\AppData\Local\Temp\android-docker-boot-public-run-26713200515`
  - 剩余 run watcher 进程：`powershell.exe` PID `5348`

本次修改前备份：

- `SYNC-HANDOFF.md.bak-20260531-205738`
- `.github/workflows/build-lineage-xiaomi-ready.yml.bak-20260531-205113`
- `.github/workflows/build-lineage-recipe.yml.bak-20260531-205113`
- `.github/workflows/build-lineage-vendors-ready.yml.bak-20260531-205113`
- `SYNC-HANDOFF.md.bak-20260531-205113`
- `scripts/build-lineage-recipe.sh.bak-20260531-165547`
- `SYNC-HANDOFF.md.bak-20260531-165547`
- `SYNC-HANDOFF.md.bak-20260531-152242`
- `SYNC-HANDOFF.md.bak-20260531-151738`
- `SYNC-HANDOFF.md.bak-20260531-144355`
- `.github/workflows/build-lineage-recipe.yml.bak-20260531-143409`
- `.github/workflows/build-lineage-vendors-ready.yml.bak-20260531-143409`
- `.github/workflows/discover-lineage-xiaomi.yml.bak-20260531-143409`
- `.github/workflows/build-boot.yml.bak-20260531-143409`
- `.github/workflows/discover-lineage-vendors.yml.bak-20260531-143409`
- `.github/workflows/build-lineage-xiaomi-ready.yml.bak-20260531-143409`
- `README.md.bak-20260531-143409`
- `SYNC-HANDOFF.md.bak-20260531-143409`
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
- `.github/workflows/build-lineage-recipe.yml.bak-20260531-060242`
- `.github/workflows/build-lineage-xiaomi-ready.yml.bak-20260531-060242`
- `README.md.bak-20260531-060242`
- `SYNC-HANDOFF.md.bak-20260531-060242`
- `scripts/prepare-lineage-release.sh.bak-20260531-060814`
- `README.md.bak-20260531-060814`
- `SYNC-HANDOFF.md.bak-20260531-060814`
- `scripts/build-lineage-recipe.sh.bak-20260531-061800`
- `SYNC-HANDOFF.md.bak-20260531-061800`
- `scripts/build-lineage-recipe.sh.bak-20260531-062935`
- `SYNC-HANDOFF.md.bak-20260531-062935`
- `scripts/lineage-xiaomi-catalog.mjs.bak-20260531-063654`
- `.github/workflows/build-lineage-xiaomi-ready.yml.bak-20260531-063654`
- `README.md.bak-20260531-063654`
- `SYNC-HANDOFF.md.bak-20260531-063654`
- `scripts/lineage-xiaomi-catalog.mjs.bak-20260531-075655`
- `.github/workflows/discover-lineage-vendors.yml.bak-20260531-075655`
- `SYNC-HANDOFF.md.bak-20260531-075655`
- `scripts/lineage-xiaomi-catalog.mjs.bak-20260531-075920`
- `.github/workflows/discover-lineage-vendors.yml.bak-20260531-075920`
- `SYNC-HANDOFF.md.bak-20260531-075920`
- `SYNC-HANDOFF.md.bak-20260531-085816`
- `.github/workflows/build-lineage-vendors-ready.yml.bak-20260531-115331`
- `README.md.bak-20260531-115331`
- `SYNC-HANDOFF.md.bak-20260531-115331`
- `SYNC-HANDOFF.md.bak-20260531-115625`
- `scripts/build-lineage-recipe.sh.bak-20260531-135304`
- `SYNC-HANDOFF.md.bak-20260531-135304`
- `SYNC-HANDOFF.md.bak-20260531-141051`
