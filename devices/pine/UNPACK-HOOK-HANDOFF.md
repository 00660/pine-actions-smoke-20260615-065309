# Redmi 7A pine unpack hook handoff

更新时间：2026-06-14

## 目标

把当前 7A / `pine` 的 Android 12 ROM 线扩展成内部授权脱壳测试环境：

- 上传 APK
- 安装到 7A
- 启动应用
- 调用设备端 hook dumper
- 回传 DEX 输出包

面板和文档均注明：仅用于内部授权测试，禁止用于非法目的。

## 当前基线

- ROM：`PixelExtended_pine-12.0-20220227-0902-OFFICIAL`
- Android：12 / SDK 31
- Kernel：`4.9.297-perf/pine-g3ce83b96c7ea`
- ADB：历史可用地址 `192.168.2.103:5555`
- Root：历史可用入口 `/debug_ramdisk/su`
- Docker：已验证 `29.5.2`、bridge/DNS/Web panel 可用

当前 ADB 未在线，本次没有刷机或真机验证。

## 关键判断

`devices/pine/current.config` 已有：

```text
CONFIG_BPF=y
CONFIG_BPF_SYSCALL=y
CONFIG_PERF_EVENTS=y
CONFIG_TRACEPOINTS=y
CONFIG_FTRACE=y
CONFIG_RING_BUFFER=y
```

但当前缺：

```text
# CONFIG_KPROBES is not set
# CONFIG_UPROBES is not set
# CONFIG_BPF_JIT is not set
```

Linux 4.9 没有新版 BPF ringbuf map，所以不能直接照搬 Android 13-17 的 ringbuf eBPF DEX dumper。pine 这条线应走 4.9 兼容方案：perf events、tracefs uprobes，或 ROM/ART 侧 hook backend。

## xiaojianbang stealth hook 结论

用户给出的参考项目：

```text
https://github.com/xiaojianbang8888/xiaojianbang-stealth-hook
```

已核对 README。它提供：

```text
xiaojianbang-stealth-hook.kpm
xiaojianbang_hook
```

它的定位是 KernelPatch/APatch KPM + ARM64 硬件断点 hook，要求：

```text
5.4+ Android GKI kernel
KernelPatch 0.13.x
APatch
```

当前 7A / `pine` 是 Android 12 + 4.9 非 GKI 内核，所以这个项目不能原样接进当前 ROM/kernel。现在只把它作为 hook primitive 参考和后续 GKI/APatch 迁移候选；当前落地仍以 `unpack-hook-android12.fragment` + pine 兼容 dumper backend 为主。

## 新增文件

- `devices/pine/config/unpack-hook-android12.fragment`
- `devices/pine/scripts/build-pine-unpack-kernel.sh`
- `devices/pine/unpack-system/device/pine-run-dumper.sh`
- `devices/pine/unpack-system/panel/server.js`
- `devices/pine/unpack-system/panel/package.json`
- `devices/pine/unpack-system/README.md`

## 构建内核

Linux/GitHub Actions 环境执行：

```bash
bash devices/pine/scripts/build-pine-unpack-kernel.sh
```

它会合并：

```text
devices/pine/config/docker-required.fragment
devices/pine/config/unpack-hook-android12.fragment
```

必须保持原 Docker/VINTF 约束，尤其是：

```text
# CONFIG_FHANDLE is not set
# CONFIG_USER_NS is not set
```

刷入前检查最终 `.config`，确认 hook 必需项存在，同时不要破坏已验证 Docker baseline。

## 面板运行

```powershell
cd C:\Users\16547\Desktop\android-docker-boot-builder-github-work\devices\pine\unpack-system\panel
$env:ADB_SERIAL='192.168.2.103:5555'
$env:PINE_ROOT_SU='/debug_ramdisk/su'
node server.js
```

打开：

```text
http://127.0.0.1:8787/
```

面板会自动部署：

```text
/data/local/tmp/pine-run-dumper.sh
```

然后调用：

```text
/data/local/tmp/pine-run-dumper.sh --package <package> --out <remote-out> --seconds 45
```

## 设备端 dumper 要求

必须至少安装一个 backend：

```text
/data/local/tmp/pine-art-dexdump
/data/local/tmp/eBPFDexDumper
/data/local/tmp/xiaojianbang_hook
```

其中 `xiaojianbang_hook` 只会被识别并写入兼容性说明，不会被误当作 DEX dumper。它需要另写 DEX 输出集成层，且当前 4.9 非 GKI 线不满足其官方环境要求。

如果 backend 不存在，面板仍会回传 `diagnostics.txt` 和 `README-NO-DUMPER.txt`，但不会产生脱壳 DEX。

## 验证清单

真机上线后按这个顺序验证：

```sh
adb connect 192.168.2.103:5555
adb -s 192.168.2.103:5555 shell /debug_ramdisk/su -c 'zcat /proc/config.gz | egrep "CONFIG_(BPF|BPF_SYSCALL|BPF_JIT|KPROBES|KPROBE_EVENTS|UPROBES|UPROBE_EVENTS|PERF_EVENTS|TRACEPOINTS|FTRACE|TRACEFS_FS|DEBUG_FS)="'
adb -s 192.168.2.103:5555 shell /debug_ramdisk/su -c 'ls -ld /sys/kernel/tracing /sys/kernel/debug/tracing'
```

再启动本地面板上传一个自有测试 APK，下载 `downloads/<job>-<package>-dex.tar.gz`，确认里面有目标 DEX 和 `diagnostics.txt`。

## 备份

变更前快照：

```text
C:\Users\16547\Desktop\android-docker-boot-builder-github-work\.backups\pine-unpack-20260614-201404
```
