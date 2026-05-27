# Releases

ToneForge binaries are **not** committed to git. Installers are published as **GitHub Release assets** (attached to version tags).

## Do you need GitHub Actions?

**No** — but it is the easiest way to get repeatable builds, especially for macOS/Linux.

| Method | Best for |
|--------|----------|
| **GitHub Actions** (recommended) | Automated builds on tag, Windows + macOS + Linux |
| **Local build + manual upload** | Quick personal builds on your own machine |

## Automated releases (GitHub Actions)

When you push a version tag, the [Release workflow](../.github/workflows/release.yml) builds ToneForge and uploads installers to a **draft** GitHub Release.

```bash
git checkout main
git pull origin main

# bump version in package.json, src-tauri/Cargo.toml, src-tauri/tauri.conf.json first

git tag -a v0.1.0 -m "ToneForge v0.1.0"
git push origin v0.1.0
```

Then on GitHub:

1. Open **Releases**
2. Edit the draft release
3. Publish when ready

Installers appear under **Assets** (`.msi`, `.exe`, `.dmg`, `.deb`, etc.).

## Local build (no Actions)

On your machine:

```bash
npm ci
npm run tauri build
```

Output:

- **Windows:** `src-tauri/target/release/bundle/msi/` and `nsis/`
- **macOS:** `src-tauri/target/release/bundle/dmg/`
- **Linux:** `src-tauri/target/release/bundle/deb/` and `appimage/`

Upload those files manually:

1. GitHub → **Releases** → **Draft a new release**
2. Choose tag `v0.1.0`
3. Attach the built files
4. Publish

## CI on every push/PR

The [CI workflow](../.github/workflows/ci.yml) runs on `main`, `develop`, and pull requests:

- `cargo test`
- `npm run build`

It does **not** produce installable desktop bundles (that only happens on release tags).

## Auto-updates (optional, later)

To ship in-app updates later you can add the [Tauri updater plugin](https://v2.tauri.app/plugin/updater/) and configure [`tauri-apps/tauri-action`](https://github.com/tauri-apps/tauri-action) with signing keys. Not required for MVP downloads.

## Notes

- **Windows builds** require a Windows runner (or your Windows laptop locally).
- **macOS builds** require a macOS runner (or a Mac locally) — you cannot cross-compile a signed `.dmg` from Windows.
- Free GitHub accounts include limited Actions minutes; release builds for 3 OSes consume minutes each run.
