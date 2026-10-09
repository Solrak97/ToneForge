#!/usr/bin/env node
/**
 * Build and inspect BOSS TONE STUDIO liveset files (.tsl) for the Katana Gen 3.
 *
 *   node tools/tsl/tsl.mjs build  <spec.json> [out.tsl]
 *   node tools/tsl/tsl.mjs decode <file.tsl>
 *
 * A .tsl is JSON: { name, formatRev, device, data: [[ { memo, paramSet } ]] }.
 * Each paramSet maps a patch block ("PATCH%AMP", "PATCH%FX_DETAIL(1)", …) to that
 * block's memory as an array of 2-digit hex bytes. Block layouts, defaults and
 * value encodings come from BOSS TONE STUDIO's own address_map.js, so patches are
 * byte-compatible with what the app exports.
 *
 * Spec params use ToneForge param ids; enum values may be given by option name.
 */

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BTS_JS =
  process.env.BTS_JS_DIR ??
  "/Applications/BOSS/KATANA Gen 3/BOSS TONE STUDIO for KATANA Gen 3.app/Contents/Resources/html/js";
const TONEFORGE_MAP = path.join(__dirname, "../../crates/toneforge-core/data/gen3_address_map.json");

const FORMAT_REV = "0000";
const DEVICE = "KATANA Gen3";
const NAME_LENGTH = 16;

function loadBts() {
  const sandbox = {};
  vm.createContext(sandbox);
  for (const file of ["utilities/constant.js", "utilities/converter.js", "config/address_map.js"]) {
    vm.runInContext(fs.readFileSync(path.join(BTS_JS, file), "utf8"), sandbox, { filename: file });
  }
  const map = vm.runInContext("new AddressMap()", sandbox);
  const patch = map.root.find((node) => node.name === "PATCH");
  return { c: sandbox, blocks: patch.child };
}

const { c, blocks } = loadBts();
const toneforgeParams = JSON.parse(fs.readFileSync(TONEFORGE_MAP, "utf8")).params;
const toneforgeById = new Map(toneforgeParams.map((p) => [p.id, p]));

function hex2(x) {
  const s = x.toString(16).toUpperCase();
  return x < 0x10 ? `0${s}` : s;
}

function isInteger1(size) {
  return size >= c.INTEGER1x1 && size <= c.INTEGER1x7;
}

/** Mirrors Parameter.toHexArray in BTS common/parameter.js. */
function toHexArray(v, size) {
  if (isInteger1(size)) return [hex2(v & 0x7f)];
  if (size === c.INTEGER2x4) return [hex2((v & 0xf0) >> 4), hex2(v & 0x0f)];
  if (size === c.INTEGER2x7) return [hex2((v & 0x3f80) >> 7), hex2(v & 0x7f)];
  if (size === c.INTEGER4x4) {
    return [hex2((v & 0xf000) >> 12), hex2((v & 0x0f00) >> 8), hex2((v & 0x00f0) >> 4), hex2(v & 0x000f)];
  }
  if (size & c.PADDING) return Array(size & ~c.PADDING).fill(hex2(v & 0x7f));
  return Array.from({ length: size }, (_, i) => (i < v.length ? hex2(v.charCodeAt(i) & 0x7f) : "20"));
}

/** Mirrors Parameter.toValue in BTS common/parameter.js. */
function toValue(data, addr, size, ofs) {
  let factor = 0;
  if (Array.isArray(ofs)) [ofs, factor] = ofs;
  const byte = (i) => parseInt(data[addr + i], 16);
  let v;
  if (isInteger1(size)) v = byte(0);
  else if (size === c.INTEGER2x4) v = (byte(0) << 4) | byte(1);
  else if (size === c.INTEGER2x7) v = (byte(0) << 7) | byte(1);
  else if (size === c.INTEGER4x4) v = (byte(0) << 12) | (byte(1) << 8) | (byte(2) << 4) | byte(3);
  else return Array.from({ length: size }, (_, i) => String.fromCharCode(byte(i))).join("");
  v -= ofs;
  return factor ? (v / factor) | 0 : v;
}

/** Mirrors the default-patch construction (init) in BTS common/parameter.js. */
function defaultBlockData(block) {
  const data = Array(block.size).fill("00");
  for (const p of block.child) {
    if (p.init === 0 && p.ofs === 0) continue;
    let init = p.init;
    if (p.size >= c.INTEGER1x1) init += Array.isArray(p.ofs) ? p.ofs[0] : p.ofs;
    toHexArray(init, p.size).forEach((byte, i) => {
      data[p.addr + i] = byte;
    });
  }
  return data;
}

function slugify(name) {
  return name.replace(/^PRMID_/, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/** ToneForge param id -> { bid, leaf }, using the same id scheme as tools/export-bts-map.mjs. */
const leafById = new Map();
for (const block of blocks) {
  const slot = block.name.match(/\((\d+)\)/)?.[1];
  for (const leaf of block.child ?? []) {
    const id = slot ? `${slugify(leaf.name)}_slot${slot}` : slugify(leaf.name);
    if (!leafById.has(id)) leafById.set(id, { bid: `PATCH%${block.name}`, leaf });
  }
}

function resolveValue(id, value) {
  if (typeof value === "number") return value;
  const options = toneforgeById.get(id)?.options ?? [];
  const index = options.findIndex((o) => o.toLowerCase() === String(value).toLowerCase());
  if (index < 0) throw new Error(`${id}: unknown option "${value}" (expected one of: ${options.join(", ")})`);
  return index;
}

function buildPatch(tone) {
  const paramSet = Object.fromEntries(blocks.map((b) => [`PATCH%${b.name}`, defaultBlockData(b)]));

  const name = tone.name.slice(0, NAME_LENGTH).replace(/[^\x20-\x7d]/g, " ");
  paramSet["PATCH%COM"].splice(0, NAME_LENGTH, ...toHexArray(name, NAME_LENGTH));

  for (const [id, raw] of Object.entries(tone.params ?? {})) {
    const entry = leafById.get(id);
    if (!entry) throw new Error(`${tone.name}: unknown param "${id}"`);
    const { bid, leaf } = entry;
    const value = resolveValue(id, raw);
    if (value < leaf.min || value > leaf.max) {
      throw new Error(`${tone.name}: ${id}=${value} outside ${leaf.min}..${leaf.max}`);
    }
    const [ofs, factor] = Array.isArray(leaf.ofs) ? leaf.ofs : [leaf.ofs, 1];
    const stored = ((value * factor) | 0) + ofs;
    toHexArray(stored, leaf.size).forEach((byte, i) => {
      paramSet[bid][leaf.addr + i] = byte;
    });
  }

  return {
    memo: { memo: tone.memo ?? "", isToneCentralPatch: false },
    paramSet,
  };
}

function build(specPath, outPath) {
  const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
  const liveset = {
    name: spec.name,
    formatRev: FORMAT_REV,
    device: DEVICE,
    data: [spec.tones.map(buildPatch)],
  };
  const target = outPath ?? specPath.replace(/\.json$/, ".tsl");
  fs.writeFileSync(target, JSON.stringify(liveset));
  console.log(`Wrote ${spec.tones.length} patches -> ${target}`);
}

function readParam(paramSet, id) {
  const entry = leafById.get(id);
  if (!entry) return undefined;
  const value = toValue(paramSet[entry.bid], entry.leaf.addr, entry.leaf.size, entry.leaf.ofs);
  const options = toneforgeById.get(id)?.options;
  return options?.[value] && !/^Option \d+$/.test(options[value]) ? options[value] : value;
}

function decode(file) {
  const liveset = JSON.parse(fs.readFileSync(file, "utf8"));
  console.log(`${liveset.name}  (device ${liveset.device}, formatRev ${liveset.formatRev})`);
  for (const [i, patch] of liveset.data[0].entries()) {
    const ps = patch.paramSet;
    const name = readParam(ps, "patch_com_name") ?? toValue(ps["PATCH%COM"], 0, NAME_LENGTH, 0);
    const amp = ["type", "gain", "volume", "bass", "middle", "treble", "presence"]
      .map((p) => `${p}=${readParam(ps, `patch_amp_${p}`)}`)
      .join(" ");
    const sw = ["booster", "mod", "fx", "delay", "reverb"]
      .filter((b) => readParam(ps, `patch_sw_${b}_sw`) === "On")
      .join(", ");
    console.log(`\n${i + 1}. ${String(name).trim()}${patch.memo?.memo ? ` — ${patch.memo.memo}` : ""}`);
    console.log(`   amp: ${amp}`);
    console.log(`   on:  ${sw || "(none)"}${readParam(ps, "patch_ns_sw") === 1 ? ", noise gate" : ""}`);
    if (readParam(ps, "patch_sw_booster_sw") === "On") {
      console.log(
        `   booster: ${readParam(ps, "patch_booster_type_slot1")} drive=${readParam(ps, "patch_booster_drive_slot1")} tone=${readParam(ps, "patch_booster_tone_slot1")} level=${readParam(ps, "patch_booster_effect_level_slot1")}`,
      );
    }
    if (readParam(ps, "patch_sw_mod_sw") === "On") console.log(`   mod: ${readParam(ps, "patch_fx_type_slot1")}`);
    if (readParam(ps, "patch_sw_fx_sw") === "On") console.log(`   fx:  ${readParam(ps, "patch_fx_type_slot4")}`);
    if (readParam(ps, "patch_sw_delay_sw") === "On") {
      console.log(
        `   delay: ${readParam(ps, "patch_delay_type_slot1")} ${readParam(ps, "patch_delay_time_slot1")}ms fb=${readParam(ps, "patch_delay_feedback_slot1")} level=${readParam(ps, "patch_delay_effect_level_slot1")}`,
      );
    }
    if (readParam(ps, "patch_sw_reverb_sw") === "On") {
      console.log(
        `   reverb: ${readParam(ps, "patch_reverb_type_slot1")} time=${readParam(ps, "patch_reverb_time_slot1")} level=${readParam(ps, "patch_reverb_effect_level_slot1")}`,
      );
    }
  }
}

const ENCODING_BY_SIZE = {
  [c.INTEGER1x7]: "integer1x7",
  [c.INTEGER2x4]: "integer2x4",
  [c.INTEGER2x7]: "integer2x7",
  [c.INTEGER4x4]: "integer4x4",
};

/** Writes the block layout ToneForge's Rust .tsl codec embeds. */
function exportLayout(outPath) {
  const layout = {
    device: DEVICE,
    format_rev: FORMAT_REV,
    blocks: blocks.map((b) => ({ name: `PATCH%${b.name}`, defaults: defaultBlockData(b).join("") })),
    params: {},
  };
  const problems = [];
  for (const param of toneforgeParams) {
    const entry = leafById.get(param.id);
    if (!entry) {
      problems.push(`${param.id}: no BTS leaf`);
      continue;
    }
    const encoding = ENCODING_BY_SIZE[entry.leaf.size];
    if (encoding !== param.encoding) problems.push(`${param.id}: encoding ${param.encoding} vs BTS ${encoding}`);
    const ofs = Array.isArray(entry.leaf.ofs) ? entry.leaf.ofs[0] : entry.leaf.ofs;
    if (ofs !== param.offset) problems.push(`${param.id}: offset ${param.offset} vs BTS ${ofs}`);
    layout.params[param.id] = [entry.bid, entry.leaf.addr];
  }
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  const target = outPath ?? path.join(__dirname, "../../crates/toneforge-core/data/gen3_tsl_layout.json");
  fs.writeFileSync(target, JSON.stringify(layout) + "\n");
  console.log(`Wrote ${layout.blocks.length} blocks, ${Object.keys(layout.params).length} params -> ${target}`);
}

const [command, ...args] = process.argv.slice(2);
if (command === "build" && args[0]) build(args[0], args[1]);
else if (command === "decode" && args[0]) decode(args[0]);
else if (command === "layout") exportLayout(args[0]);
else {
  console.error("usage: tsl.mjs build <spec.json> [out.tsl] | decode <file.tsl> | layout [out.json]");
  process.exit(1);
}
