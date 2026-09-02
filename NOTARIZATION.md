---
type: Playbook
title: Electron macOS release
description: Build, sign, notarize, verify, and publish the macOS arm64 Electron application.
when: Preparing or diagnosing a Riffle macOS release.
status: active
generated: { by: codex/gpt-5, at: 2026-08-03T20:45:00+08:00 }
---

# Release boundary

Riffle publishes one desktop target: Electron on macOS arm64. The release path does not invoke Tauri, Rust
bundling, minisign, a custom update server, Linux builders, or Intel builders.

The executable contract is split across three files:

- [`electron-builder.yml`](./electron-builder.yml) owns ASAR layout, signing inputs, GitHub updater provider,
  target architecture, and artifact naming;
- [`scripts/verify-electron-package.mjs`](./scripts/verify-electron-package.mjs) fails closed on native payload,
  updater metadata, and stale or extra artifacts;
- [`.github/workflows/release-macos.yml`](./.github/workflows/release-macos.yml) owns tag validation, signing,
  notarization, Gatekeeper checks, installed-app journeys, updater promotion, and publication.

# Local package gate

Authenticate private `@celados` dependencies through the team `publish-package` workflow. A clean checkout
must copy the managed template, then render its sibling `.npmrc` before install:

```bash
cp "$HOME/.agents/.skills/celados/agents/publish-package/resources/.npmrc.tpl" .npmrc.tpl
latch render "{ file: '.npmrc.tpl', format: 'raw' }"
pnpm install --frozen-lockfile
pnpm test
pnpm run package:test
```

Both `.npmrc.tpl` and the rendered `.npmrc` are local-only and gitignored: the template contains a secret
locator, while the rendered file contains the registry credential. Neither may be committed.

`package:test` builds an unsigned local macOS arm64 DMG and ZIP, checks the exact ASAR-unpacked fff/ffi native
payload, validates `latest-mac.yml`, and launches the packaged app with `RIFFLE_E2E_BACKGROUND=1`. The packaged
journeys cover Settings, Vault selection, editor-to-disk writes, fff search/watch, assets, Quick Capture, and
the empty-Untitled Trash regression without taking foreground focus.

# Release workflow

Create a `v<package.json version>` tag whose commit is reachable from `origin/main`, then run or observe the
`Release Electron macOS` workflow for that tag. A manual branch dispatch fails before reaching the persistent
runner. The self-hosted build uses `[self-hosted, macOS, ARM64]` and installs private dependencies with the
step-scoped `NPM_TOKEN`.

The workflow accepts these secrets only at their owning steps:

- `NPM_TOKEN` for private dependency installation;
- `DEVELOPER_ID_CERT_BASE64` and `P12_PASSWORD` for Developer ID signing;
- `APPLE_ID`, `APPLE_PASSWORD`, and `APPLE_TEAM_ID` for Apple notarization;
- the workflow-scoped GitHub token for release upload.

The canonical release payload for version `<version>` is exactly:

```text
Riffle-<version>-mac-arm64.dmg
Riffle-<version>-mac-arm64.zip
Riffle-<version>-mac-arm64.zip.blockmap
latest-mac.yml
```

The workflow mounts the DMG read-only, copies `Riffle.app` into a unique isolated `Applications` directory, and
then verifies signing, stapling, Gatekeeper, bundle identity, version, and the background packaged journeys on
that installed copy. It also builds a temporary signed Electron `0.1.10` app and proves that the exact final ZIP
replaces and relaunches it through Squirrel/ShipIt. The public Tauri `0.1.9` build is a different runtime and is
therefore not a meaningful updater baseline for the Electron bootstrap release.

# Publication boundary

Publication is a promotion, not a blind upload. The workflow creates or resumes a draft, rejects unexpected
assets, refuses to clobber bytes already present, downloads every draft asset through the authenticated API,
and checks its size plus SHA-256/SHA-512 against the local canonical payload. Only that verified draft is made
public and explicitly marked latest. Anonymous readback then verifies both the tag endpoint and `/releases/latest`
before the production GitHub updater performs the same signed install-and-relaunch journey.

Failure before promotion leaves a draft for byte-identical resumption. Failure after promotion leaves the public
release intact for diagnosis; published releases are never deleted or overwritten by recovery logic. Shared
Squirrel cache, preferences, launchd state, and per-run `app.usemarkd.ShipIt.*` temporary entries are isolated and
restored by exact path. Only after anonymous asset readback and the production updater smoke pass may #15 land its
follow-up website commit/PR, switch `site/lib/config.ts` and the changelog to the canonical DMG, and verify the
public download button. The implementation PR must not point the site at an asset that is not public yet.
