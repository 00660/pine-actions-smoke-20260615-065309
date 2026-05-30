# Sync handoff

更新时间：2026-05-30 22:40

## 目标

把 `pine` 和 `riva` 两个机型迁到 GitHub 私有仓库 `00660/android-docker-boot-builder`，仓库只保留轻量构建输入和 workflow。

## 当前策略

- 不把 `boot.img`、已构建 `boot-docker.img`、Docker runtime zip 进 git。
- 不把大文件放 Release 长期保存。
- workflow 手动触发时通过 `boot_img_url` 下载匹配 ROM 的 boot.img。
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
