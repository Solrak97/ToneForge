# ToneForge

Modern cross-platform desktop editor for Boss Katana amplifiers.

Repository: [github.com/Solrak97/ToneForge](https://github.com/Solrak97/ToneForge)

## Stack

- **Desktop:** Tauri 2
- **Backend:** Rust (`toneforge-core`, `toneforge-devices`, `src-tauri`)
- **Frontend:** React, TypeScript, Tailwind CSS, Zustand

## MVP Features

- Detect Katana Gen 3 MIDI ports
- Connect / disconnect and enter editor mode
- Read current patch from the amp
- Edit core amp, EQ, and FX parameters
- Save and load offline JSON presets

## Prerequisites

- Node.js 20+
- Rust stable
- Boss/Roland USB driver for your Katana model

Close Boss Tone Studio before connecting — only one app can use the Katana MIDI port at a time.

## Development

Branching follows Gitflow — see [`docs/GITFLOW.md`](docs/GITFLOW.md).

```bash
git checkout develop
npm install
npm run tauri dev
```

## Tests

```bash
cargo test
npm run build
```

## Address Maps

Gen 3 parameter metadata lives in [`crates/toneforge-core/data/gen3_address_map.json`](crates/toneforge-core/data/gen3_address_map.json).

To import a richer map from Boss Tone Studio, export `address_map.js` into the BTS JSON format supported by `AddressMap::from_bts_export()` (see fixture in `crates/toneforge-core/tests/fixtures/gen3_bts_export.json`).

## Architecture

```text
React UI → Tauri commands/events → AppState → KatanaGen3Driver → Roland SysEx → midir → Katana
```

Device logic is isolated behind the `DeviceDriver` trait so additional amp models can be added later.
