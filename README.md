# ToneForge

A desktop editor for the BOSS Katana Gen 3. I built it because I got tired of BOSS Tone Studio.

It's been tested on my own Katana and works for my day to day use, but it's a personal project, so expect some rough edges. Not affiliated with BOSS or Roland in any way.

## Download

Grab the installer for your OS from the [releases page](https://github.com/Solrak97/ToneForge/releases/latest). There are builds for macOS (Apple Silicon only for now), Windows and Linux.

The builds aren't signed, so the OS will complain the first time you open it:

- macOS: if it says the app is damaged, run `xattr -dr com.apple.quarantine /Applications/ToneForge.app`
- Windows: click "More info" and then "Run anyway"

Also, close Tone Studio before connecting. Only one app can talk to the amp at a time.

## What it does

- Connects to the amp over USB, reads the current patch and lets you switch channels.
- Two editor views: a quick one with the stuff you actually touch (amp, booster, mod, fx, delay, reverb, noise gate), and an advanced one with every parameter the amp has.
- Proper support for the green/red/yellow memories. Every effect block keeps three full versions, and you can edit any of them without making it the live one. Delay 2 follows the reverb button's color, same as on the amp.
- A tone library with livesets. You can import and export `.tsl` files, and they open fine in Tone Studio.
- The library works kind of like Finder: livesets on the left, a searchable list or grid of tones, and the details on the right. Each tone shows a small colored signal chain so you can tell what's on at a glance.
- Send any saved tone to the amp, or open it in the editor.

There's also some extra stuff:

- A local API and an MCP server, so you can control the amp from Cursor or any MCP client ("set gain to 70 and turn on the reverb").
- An experimental mode in Settings that unlocks a debug log, a fake Katana for testing without hardware, and an AI chat agent that's still a work in progress.

## Building it yourself

You need Node 20+ and Rust. On Linux you also need `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf` and `libasound2-dev`.

```bash
git checkout develop
npm install
npm run tauri dev
```

To run the tests, build the frontend first (Tauri embeds it when compiling):

```bash
npm run build
cargo test
```

I use Gitflow for branches, see [`docs/GITFLOW.md`](docs/GITFLOW.md). Release steps are in [`docs/RELEASE.md`](docs/RELEASE.md).

## MCP

While ToneForge is open it runs an HTTP API on `127.0.0.1:17352` (localhost only). The MCP server in `tools/mcp-server` talks to that API.

1. Open ToneForge.
2. Run `npm run mcp:install` once.
3. Cursor picks up [`.cursor/mcp.json`](.cursor/mcp.json) on its own. Reload MCP in Cursor's settings if it doesn't show up.

You can change the port with `TONEFORGE_MCP_PORT`, and point the MCP server somewhere else with `TONEFORGE_MCP_URL`.

Tools: `toneforge_status`, `toneforge_list_devices`, `toneforge_connect`, `toneforge_disconnect`, `toneforge_read_patch`, `toneforge_get_patch`, `toneforge_set_param`, `toneforge_set_params`, `toneforge_list_params`, `toneforge_list_channels`, `toneforge_select_channel`, `toneforge_list_library_tones`, `toneforge_load_library_tone`, `toneforge_save_library_tone`.

## Other bits

`tools/tsl/tsl.mjs` builds and decodes `.tsl` files from the command line. There are a couple of example livesets in [`examples/livesets`](examples/livesets).

```bash
node tools/tsl/tsl.mjs build spec.json out.tsl
node tools/tsl/tsl.mjs decode file.tsl
```

The parameter map comes from Tone Studio itself and lives in [`crates/toneforge-core/data/gen3_address_map.json`](crates/toneforge-core/data/gen3_address_map.json). If you have Tone Studio installed you can regenerate it with `npm run export:map`.

## How it's put together

Tauri 2 with a Rust backend and a React + TypeScript + Tailwind frontend.

```text
React UI -> Tauri commands -> Katana driver -> Roland SysEx -> USB MIDI -> amp
```

The Rust side is split into `toneforge-core` (parameter map, SysEx, `.tsl` files), `toneforge-devices` (the Katana driver and the emulator) and `toneforge-library` (the SQLite tone library). The driver sits behind a `DeviceDriver` trait in case I ever add other amps.
