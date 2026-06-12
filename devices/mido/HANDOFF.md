# Redmi Note 4/4X mido Docker / Droidspaces / virtual mic handoff

## Target

- Device: Xiaomi Redmi Note 4/4X, codename `mido`.
- ROM: `crDroidAndroid-15.0-20260531-mido-v11.16.zip`.
- ROM public URL: `https://sourceforge.net/projects/kamisroms/files/Mido/Crdroid/A15/crDroidAndroid-15.0-20260531-mido-v11.16.zip/download`.
- Local ROM SHA256 observed: `E6DFF82977C04093379EB74FCBCD2891D0E6678CE4E54C13FDE2B773D6781CC3`.
- OTA metadata: Android SDK `35`, security patch `2026-05-01`, `pre-device=mido`.
- Extracted boot SHA256 observed locally: `6a5b960c382751091ed4d3cc26e6cbcd222f3055de0c186dcb206e26461a250b`.
- Boot format: Android boot header v0, page size `2048`; kernel and ramdisk are repackable.

## Kernel source

- Kernel repo: `https://github.com/AlphaDroid-devices/kernel_xiaomi_mido`.
- Selected branch: `alpha-14`.
- Branch head observed via GitHub API: `c1c2dddd6ed4ad24b92ccd482e1aa3f546bde933`.
- Kernel version in Makefile: `4.9.337`.
- Defconfig: `arch/arm64/configs/mido_defconfig`.
- Current upstream `mido_defconfig` already has `CONFIG_SOUND=y` and `CONFIG_SND=y`.
- Current upstream `mido_defconfig` does not explicitly enable `CONFIG_SND_ALOOP`.

## GitHub build entry

- Workflow: `.github/workflows/build-boot.yml`.
- Device input: `mido`.
- Build script: `devices/mido/scripts/build-mido-docker-kernel.sh`.
- Config fragment: `devices/mido/config/docker-droidspaces-audio.fragment`.
- Default kernel repo/ref are set to `AlphaDroid-devices/kernel_xiaomi_mido.git` and `alpha-14`.
- `boot_source_url` can use the SourceForge ROM URL above. Repository variable fallback is `MIDO_BOOT_SOURCE_URL`.

## Kernel config requirements

The mido fragment includes Docker / Droidspaces container support plus ALSA loopback:

```text
CONFIG_SOUND=y
CONFIG_SND=y
CONFIG_SND_TIMER=y
CONFIG_SND_PCM=y
CONFIG_SND_HWDEP=y
CONFIG_SND_RAWMIDI=y
CONFIG_SND_ALOOP=y
```

`CONFIG_SND_ALOOP=y` is preferred over `m` because Android Audio HAL startup should not depend on module install/load timing. If it is changed to `CONFIG_SND_ALOOP=m`, the ROM must package `snd-aloop.ko` and load it before Audio HAL opens capture devices.

## ROM / vendor audio requirement

Kernel support alone is not enough. `snd-aloop` can create `/proc/asound/cards`, `/proc/asound/pcm`, and `/dev/snd/pcmC?D?c`, but Android apps will not see it until ROM/vendor exposes the loopback capture PCM as an AudioPolicy input device/profile.

The ROM build must inspect and patch:

- `audio_policy_configuration.xml`
- `audio_platform_info.xml`
- `mixer_paths*.xml`
- primary Audio HAL / vendor Audio HAL
- SELinux rules for `audioserver` / `hal_audio` access to the loopback capture PCM node

The goal is a real input profile/device route usable by `AudioRecord`, WeChat voice recording, and capture presets such as `MIC`, `VOICE_COMMUNICATION`, or `VOICE_RECOGNITION`.

## On-device verification

Run after flashing the built boot/ROM pair:

```sh
su -c 'zcat /proc/config.gz | egrep "CONFIG_SOUND=|CONFIG_SND=|CONFIG_SND_TIMER=|CONFIG_SND_PCM=|CONFIG_SND_HWDEP=|CONFIG_SND_RAWMIDI=|CONFIG_SND_ALOOP="'
su -c 'cat /proc/asound/cards'
su -c 'cat /proc/asound/pcm'
dumpsys media.audio_policy
```

Success criteria:

- `/proc/asound/cards` shows `Loopback`.
- `/proc/asound/pcm` shows a capture PCM for the loopback card.
- `dumpsys media.audio_policy` shows the corresponding input profile/device/route.
- `AudioRecord` / WeChat recording can be routed to that input.

Short conclusion: enable `CONFIG_SND_ALOOP=y` in the kernel, then wire loopback capture into ROM Audio HAL and `audio_policy_configuration.xml` as a mic/input path. Kernel-only changes are not enough for WeChat.
