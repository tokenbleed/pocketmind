# F-Droid distribution plan

Status: NOT on F-Droid yet. Everything needed to request inclusion is in
place (see below); the remaining step is filing the packaging request.

## What already works (verified)

The `fdroid` product flavor (commit `8ebc2657`) produces an APK with no
proprietary or blob components in it. Verified against
`android/app/build/outputs/apk/fdroid/release/app-fdroid-release.apk`:

- zero `assets/ggml-hexagon/**` entries (Qualcomm DSP blobs never packaged;
  the sync task is skipped and stale copies are deleted)
- zero `*hexagon_opencl.so` / `libcdsprpc.so` native libraries (jniLibs
  packaging excludes, plus the CMake variant list is narrowed so the
  hexagon variant is never even built; no Hexagon SDK is needed on the
  build machine)
- zero `com.android.billingclient` references in any `classes.dex` (billing
  dependency is `prodImplementation` only; the fdroid
  ExternalContentLinkModule is a noop that reports ineligible, and the JS
  store layer already fails closed to info text)
- correct package id and version metadata (`io.github.tokenbleed.pocketmind`
  1.18.1 / 148)

Build command on a clean checkout:

```
npm install          # postinstall applies patches via patch-package
cd android
./gradlew assembleFdroidRelease
```

The variant narrowing and blob stripping trigger automatically from the
task name; `-P` flags are not required. `assembleProdRelease` remains the
Play build and still passes `scripts/verify-android-payload.js`.

## Remaining acceptance questions (for the F-Droid MR)

- **Hermes**: `libhermesvm.so` comes from the
  `com.facebook.react:hermes-android` Maven artifact (built by React
  Native upstream CI from open source; not built by F-Droid). The JS
  compiler `hermesc` is a prebuilt binary inside
  `node_modules/react-native/sdks/hermesc/` (scanignore). Precedent:
  React Native apps are on F-Droid (LessPass historically, others since).
  Fallback lever if maintainers object: `-PhermesEnabled=false` builds with
  JSC, but `io.github.react-native-community:jsc-android` is also a Maven
  prebuilt, so this trades one prebuilt VM for another.
- **onnxruntime**: `libonnxruntime.so` is fetched at build time from the
  `onnxruntime-android` Maven AAR (open source, built by Microsoft CI).
  Only the JSI wrapper (`libonnxruntimejsi.so`) compiles from source in
  our tree. Same class of question as Hermes.
- **No lockfile**: the repo has no `package-lock.json`, so dependency
  resolution at F-Droid build time is whatever npm resolves that day.
  Adding a lockfile before the request removes an easy objection.
- **Node version**: `engines.node >= 22.21.0`; the F-Droid buildserver node
  must satisfy it (verify in MR CI).
- **Scanner entries**: `node_modules/llama.rn/bin/` (prebuilt DSP and
  OpenCL .so that never enter the fdroid APK) and
  `node_modules/react-native/sdks/hermesc/` need scanignore.

## Draft metadata

To be submitted to fdroiddata (RFP issue or merge request; app id matches
the `io.github.*` convention):

```yaml
Categories:
  - Science & Education
License: MIT
AuthorName: tokenbleed
SourceCode: https://github.com/tokenbleed/pocketmind
IssueTracker: https://github.com/tokenbleed/pocketmind/issues
Changelog: https://github.com/tokenbleed/pocketmind/releases

AutoName: PocketMind
Summary: Private on-device AI assistant with local models
Description: |-
  PocketMind runs a full local AI stack on the phone: GGUF model inference
  (CPU/GPU), a knowledge base with on-device embeddings and hybrid
  retrieval, sandboxed agent tools, and an OpenAI-compatible server
  bound to localhost. No cloud, no account, no telemetry. Ships without
  Google Play services dependencies; the fdroid build excludes the
  Qualcomm Hexagon backend and Play Billing entirely.

RepoType: git
Repo: https://github.com/tokenbleed/pocketmind.git

Builds:
  - versionName: 1.18.1
    versionCode: 148
    commit: v1.18.1
    subdir: android
    init: npm install
    gradle:
      - fdroid
    output: app/build/outputs/apk/fdroid/release/app-fdroid-release.apk
    ndk: r27
    scanignore:
      - node_modules/react-native/sdks/hermesc
      - node_modules/llama.rn/bin

AutoUpdateMode: Version v%v
UpdateCheckMode: Tags
CurrentVersion: 1.18.1
CurrentVersionCode: 148
```

## After acceptance

- Add the F-Droid badge to the README install table next to Obtainium
  (badge source: https://gitlab.com/fdroid/artwork/-/raw/master/badge/get-it-on-en.png,
  link to https://f-droid.org/packages/io.github.tokenbleed.pocketmind/)
- Note in the release notes that F-Droid builds lag GitHub releases by a
  few days and do not include the NPU backend
- Keep this file updated as flavors change
