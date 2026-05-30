# Sync handoff

更新时间：2026-05-30 22:25

## 目标

把本地 `pine` 和 `riva` Docker boot 构建输入迁移到 GitHub 私有仓库 `00660/android-docker-boot-builder`，并删除本地对应目录。

## 同步内容

- `devices/pine/current.config`
- `devices/pine/config/docker-required.fragment`
- GitHub Release `boot-inputs` asset：`pine-boot-current.img`
- GitHub Release `boot-inputs` asset：`pine-boot-docker-devicebase.img`
- GitHub Release `boot-inputs` asset：`pine-docker-engine-29.5.2-20260530-210819-magisk.zip`
- GitHub Release `boot-inputs` asset：`pine-docker-engine-29.5.2-20260530-210819-recovery.zip`
- `devices/riva/current.config`
- `devices/riva/config/docker-required.fragment`
- GitHub Release `boot-inputs` asset：`riva-boot-current.img`
- GitHub Release `boot-inputs` asset：`riva-boot-docker.img`
- `tools/mkbootimg/`
- `.github/workflows/build-boot.yml`

## 自动构建

workflow 每天 UTC `03:17` 运行，也可以手动运行。构建时从上游源码分支拉取最新 commit，合并 Docker 配置，生成 kernel image，再用当前 ROM 的 base boot 重新打包 `boot-docker.img`。

## 状态

- `pine`：verified。
- `riva`：experimental，boot 可进系统，但 Docker runtime 曾触发 soft reboot 风险。
