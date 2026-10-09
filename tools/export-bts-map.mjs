#!/usr/bin/env node
/**
 * Export Boss Tone Studio address_map.js into ToneForge gen3_address_map.json.
 *
 * SysEx addresses use the raw (pre-nibble) 32-bit tree offsets from BTS,
 * formatted as four bytes — e.g. panel gain = 0x20000600 -> "20000600".
 *
 * Usage:
 *   node tools/export-bts-map.mjs [path/to/address_map.js] [output.json]
 */

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultBtsPath =
  "/Applications/BOSS/KATANA Gen 3/BOSS TONE STUDIO for KATANA Gen 3.app/Contents/Resources/html/js/config/address_map.js";
const defaultOut = path.join(__dirname, "../crates/toneforge-core/data/gen3_address_map.json");

const btsPath = process.argv[2] ?? defaultBtsPath;
const outPath = process.argv[3] ?? defaultOut;

const INTEGER1x7 = 0x10006;
const INTEGER2x4 = 0x10007;
const INTEGER2x7 = 0x1000b;
const INTEGER4x4 = 0x10008;
const INTEGER_ENCODING = {
  [INTEGER1x7]: "integer1x7",
  [INTEGER2x4]: "integer2x4",
  [INTEGER2x7]: "integer2x7",
  [INTEGER4x4]: "integer4x4",
};

function toSysexAddressHex(absAddr) {
  const a = absAddr >>> 0;
  return [24, 16, 8, 0]
    .map((shift) => ((a >>> shift) & 0xff).toString(16).padStart(2, "0"))
    .join("");
}

function slugify(name) {
  return name
    .replace(/^PRMID_/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function kindFromSize(size) {
  if (size === INTEGER1x7) return "u8";
  if (size === INTEGER2x4 || size === INTEGER2x7 || size === INTEGER4x4) return "u16";
  if (typeof size === "number" && size > 0 && size < INTEGER1x7) return "text";
  return "u8";
}

const ENUM_OPTIONS = {
  PRMID_PATCH_AMP_TYPE: ["Acoustic", "Clean", "Pushed", "Crunch", "Lead", "Brown"],
  PRMID_PATCH_BOOSTER_TYPE: [
    "Mid Boost",
    "Clean Boost",
    "Treble Boost",
    "Crunch OD",
    "Natural OD",
    "Warm OD",
    "Fat DS",
    "Metal DS",
    "Oct Fuzz",
    "Blues Drive",
    "Overdrive",
    "T-Scream",
    "Turbo OD",
    "Distortion",
    "RAT",
    "GUV DS",
    "DST+",
    "Metal Zone",
    "'60s Fuzz",
    "Muff Fuzz",
    "HM-2",
    "Metal Core",
    "Centa OD",
  ],
  PRMID_PATCH_FX_TYPE: [
    "T.Wah",
    "Auto Wah",
    "Pedal Wah",
    "Comp",
    "Limiter",
    "Graphic EQ",
    "Parametric EQ",
    "Guitar Sim",
    "Slow Gear",
    "Wave Synth",
    "Octave",
    "Pitch Shifter",
    "Harmonist",
    "AC Processor",
    "Phaser",
    "Flanger",
    "Tremolo",
    "Rotary",
    "Uni-V",
    "Slicer",
    "Vibrato",
    "Ring Mod",
    "Humanizer",
    "Chorus",
    "AC Guitar Sim",
    "Phaser 90E",
    "Flanger 117E",
    "Wah 95E",
    "DC-30",
    "Heavy Octave",
    "Pedal Bend",
  ],
  PRMID_PATCH_DELAY_TYPE: [
    "Digital",
    "Pan",
    "Stereo",
    "Analog",
    "Tape Echo",
    "Reverse",
    "Modulate",
    "SDE-3000",
  ],
  PRMID_PATCH_REVERB_TYPE: ["Plate", "Room", "Hall", "Spring", "Modulate"],
  PRMID_PATCH_DELAY_MODE: ["Normal", "Inverse"],
  PRMID_PATCH_REVERB_MODE: ["Normal", "Inverse"],
  PRMID_PATCH_REVERB_LAYER_MODE: ["Delay 2", "Delay 2 + Reverb", "Reverb"],
  PRMID_PATCH_OTHER_CHAIN: [
    "Chain1",
    "Chain2-1",
    "Chain3-1",
    "Chain4-1",
    "Chain2-2",
    "Chain3-2",
    "Chain4-2",
    "Chain5",
    "Chain6",
  ],
  PRMID_PATCH_COLOR_BOOSTER_COLOR: ["Green", "Red", "Yellow"],
  PRMID_PATCH_COLOR_MOD_COLOR: ["Green", "Red", "Yellow"],
  PRMID_PATCH_COLOR_FX_COLOR: ["Green", "Red", "Yellow"],
  PRMID_PATCH_COLOR_DELAY_COLOR: ["Green", "Red", "Yellow"],
  PRMID_PATCH_COLOR_REVERB_COLOR: ["Green", "Red", "Yellow"],
  PRMID_PATCH_OTHER_CABINET_RESONANCE: ["Vintage", "Modern", "Deep"],
  PRMID_PATCH_SW_BOOSTER_SW: ["Off", "On"],
  PRMID_PATCH_SW_MOD_SW: ["Off", "On"],
  PRMID_PATCH_SW_FX_SW: ["Off", "On"],
  PRMID_PATCH_SW_DELAY_SW: ["Off", "On"],
  PRMID_PATCH_SW_DELAY2_SW: ["Off", "On"],
  PRMID_PATCH_SW_REVERB_SW: ["Off", "On"],
  PRMID_PATCH_AMP_POWERAMP_VARIATION: ["Off", "On"],
  PRMID_PATCH_AMP_PREAMP_VARIATION: ["Off", "On"],
};

function placeholderEnumOptions(btsName, max) {
  if (ENUM_OPTIONS[btsName]) return ENUM_OPTIONS[btsName];
  return Array.from({ length: max + 1 }, (_, i) => `Option ${i}`);
}

function inferKind(leaf) {
  const baseKind = kindFromSize(leaf.size);
  if (baseKind !== "u8") return baseKind;
  if (ENUM_OPTIONS[leaf.name]) return "enum";
  if (leaf.max <= 12 && /TYPE|_SW|VARIATION|COLOR|CHAIN|MODE/i.test(leaf.name)) {
    return "enum";
  }
  return "u8";
}

function groupFromPath(pathParts) {
  const block = pathParts[pathParts.length - 1] ?? "";
  if (block.includes("AMP")) return "amp";
  if (block.includes("COLOR")) return "color";
  if (block.includes("SW")) return "fx_switch";
  if (block.includes("OTHER") || block === "COM") return "patch";
  if (block.includes("BOOSTER")) return "booster";
  if (block.includes("DELAY")) return "delay";
  if (block.includes("REVERB")) return "reverb";
  if (block.includes("FX_DETAIL")) return "mod_fx_detail";
  if (block.startsWith("FX")) return "mod_fx";
  if (block.includes("NS")) return "noise_suppressor";
  if (block.includes("SOLO")) return "solo";
  if (block.includes("EQ")) return "eq";
  if (block.includes("CONTOUR")) return "contour";
  if (block.includes("PEDALFX")) return "pedal_fx";
  if (block.includes("SENDRETURN")) return "send_return";
  if (block.includes("ASSIGN")) return "assign";
  return "other";
}

function isWired(_pathParts, entry) {
  if (entry.kind === "text") return false;
  return true;
}

function labelFromName(btsName) {
  const core = btsName.replace(/^PRMID_/, "").replace(/^PATCH_/, "");
  return core
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ")
    .replace(/\(\d+\)/g, "")
    .trim();
}

function loadRawTables(filePath) {
  const jsDir = path.dirname(filePath);
  const source = fs.readFileSync(filePath, "utf8");
  const start = source.indexOf("var SETUP_COM");
  const end = source.indexOf("\tvar TEMP = [");
  if (start < 0 || end < 0) {
    throw new Error("Could not locate parameter tables in address_map.js");
  }
  const body = source.slice(start, end);
  const sandbox = {
    INTEGER1x1: 0x10000,
    INTEGER1x2: 0x10001,
    INTEGER1x3: 0x10002,
    INTEGER1x4: 0x10003,
    INTEGER1x5: 0x10004,
    INTEGER1x6: 0x10005,
    INTEGER1x7,
    INTEGER2x4,
    INTEGER2x7,
    INTEGER4x4,
    PADDING: 0x20000,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(jsDir, "../utilities/constant.js"), "utf8"), sandbox);
  vm.runInContext(
    `function __extractTables() {\n${body}\nreturn { PATCH, PATCH_AMP, PATCH_SW, PATCH_COLOR, PATCH_OTHER, PATCH_BOOSTER, PATCH_FX, PATCH_FX_DETAIL, PATCH_DELAY, PATCH_REVERB, PATCH_NS, PATCH_SOLO_COM, PATCH_SOLO_EQ, PATCH_SOLO_DELAY, PATCH_CONTOUR_COM, PATCH_CONTOUR, PATCH_PEDALFX_COM, PATCH_PEDALFX, PATCH_EQ_EACH, PATCH_EQ_PEQ, PATCH_EQ_GE10, PATCH_SENDRETURN, PATCH_COM, PATCH_PATCH_KNOB_READONLY, PATCH_PATCH_KNOB_SOLO_DELAY_READONLY };\n}\n`,
    sandbox,
  );
  return sandbox.__extractTables();
}

function resolveChild(name, tables) {
  const base = name.replace(/\(\d+\)$/, "");
  return (
    tables[base] ??
    tables[`PATCH_${base}`] ??
    tables[`PATCH_PATCH_${base}`] ??
    null
  );
}

function flattenPanelParams(nodes, tables, baseAddr = 0x20000000, pathParts = [], out = []) {
  for (const node of nodes) {
    const absBlock = (baseAddr + node.addr) >>> 0;
    const blockName = node.name ?? "unknown";
    const nextPath = [...pathParts, blockName];

    if (node.child) {
      const childTable = resolveChild(blockName, tables);
      if (!childTable) continue;
      for (const leaf of childTable) {
        const kind = inferKind(leaf);
        if (kind === "text") continue;

        const absParam = (absBlock + leaf.addr) >>> 0;
        const idBase = slugify(leaf.name);
        const slotSuffix = blockName.match(/\((\d+)\)/)?.[1];
        let id = slotSuffix ? `${idBase}_slot${slotSuffix}` : idBase;

        const entry = {
          id,
          label: labelFromName(leaf.name),
          address: toSysexAddressHex(absParam),
          kind,
          encoding: INTEGER_ENCODING[leaf.size] ?? "integer1x7",
          min: leaf.min,
          max: leaf.max,
          default: typeof leaf.init === "number" ? leaf.init : undefined,
          group: groupFromPath(nextPath),
          bts_name: leaf.name,
          address_space: "live_panel",
          offset: leaf.ofs ?? 0,
          wired: false,
          block: blockName,
        };

        if (entry.kind === "enum") {
          entry.options = placeholderEnumOptions(leaf.name, leaf.max);
        }

        entry.wired = isWired(nextPath, entry);
        out.push(entry);
      }
      continue;
    }
  }
  return out;
}

function dedupeParams(params) {
  const seen = new Map();
  for (const p of params) {
    let id = p.id;
    if (seen.has(id)) {
      id = `${id}_${p.address.slice(-4)}`;
    }
    seen.set(id, { ...p, id });
  }
  return [...seen.values()].sort((a, b) => a.address.localeCompare(b.address));
}

function main() {
  if (!fs.existsSync(btsPath)) {
    console.error(`BTS address map not found: ${btsPath}`);
    process.exit(1);
  }

  const tables = loadRawTables(btsPath);
  let params = flattenPanelParams(tables.PATCH, tables, 0x20000000);
  params = dedupeParams(params);

  const wiredCount = params.filter((p) => p.wired).length;

  const output = {
    device_family: "boss-katana",
    device_model: "katana-gen3",
    device_id: "41 10 01 05 07",
    live_panel_base: "20000000",
    patch_query: {
      current_channel_address: "00000000",
      patch_select_address: "7F000100",
      channel_count: 3,
      patch_data_address: "60000000",
      patch_data_length: 5888,
      editor_mode_address: "7F000001",
      editor_mode_value: 1,
    },
    params: params.map(({ block, ...rest }) => rest),
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");
  console.log(`Exported ${params.length} panel params (${wiredCount} wired) -> ${outPath}`);
}

main();
