// Unit test for the pure helpers extracted verbatim from client.js.
// Extracts the ALIAS / stableKey / keyOf / unwrap / hiddenKeys / readValue /
// _labelMap definitions from the real source so the test exercises shipped code.
import fs from "node:fs";
import path from "node:path";

const SRC = fs.readFileSync(
  path.join("C:\\Users\\xx\\sidebar-menu-control", "client.js"),
  "utf8",
);

function sliceBetween(startMarker, endMarker) {
  const i = SRC.indexOf(startMarker);
  if (i < 0) throw new Error("start marker not found: " + startMarker);
  const j = SRC.indexOf(endMarker, i);
  if (j < 0) throw new Error("end marker not found: " + endMarker);
  return SRC.slice(i, j);
}

// BASE_MANAGEABLE list
const baseSrc = sliceBetween("const BASE_MANAGEABLE = [", "];") + "];";
// ALIAS table
const aliasSrc = sliceBetween("const ALIAS = {", "};") + "};";
// stableKey + keyOf
const keySrc = sliceBetween("const stableKey = (label) =>", "/* ----") ;
// unwrap + DEFAULT_VALUE + readValue + hiddenKeys
const unwrapSrc = sliceBetween("const unwrap = (v) =>", "/* ----");
// _discovered map, _addDiscovered, _labelMap, _allLabels
const labelMapSrc = sliceBetween("const _discovered = new Map()", "function _onDiscover");

const factorySrc = `
${baseSrc}
${aliasSrc}
${keySrc}
${unwrapSrc}
${labelMapSrc}
return { stableKey, keyOf, unwrap, readValue, hiddenKeys, _labelMap, _allLabels, ALIAS };
`;

const mod = new Function(factorySrc)();
const { stableKey, keyOf, unwrap, readValue, hiddenKeys, _labelMap, _allLabels } = mod;

let pass = 0, fail = 0;
const eq = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + "\n        got      " + a + "\n        expected " + e); }
};

console.log("== stableKey normalization ==");
eq("trims + lowercases + strips separators",
  stableKey("  Skill / MCP  "), "skillmcp");
eq("empty / null safe", stableKey(null), "");
eq("collapses runs of separators", stableKey("MCP - Connector"), "mcpconnector");

console.log("== keyOf locale aliasing ==");
eq("MCP Connector <-> MCP连接器",
  keyOf("MCP Connector"), keyOf("MCP连接器"));
eq("Plugins <-> 插件",
  keyOf("Plugins"), keyOf("插件"));
eq("Marketplace <-> 插件市场",
  keyOf("Marketplace"), keyOf("插件市场"));
eq("Skill Market <-> 技能市场",
  keyOf("Skill Market"), keyOf("技能市场"));
eq("Automation <-> 自动化任务",
  keyOf("Automation"), keyOf("自动化任务"));
eq("Remote Control <-> 远程控制",
  keyOf("Remote Control"), keyOf("远程控制"));
eq("More <-> 更多", keyOf("More"), keyOf("更多"));
eq("Lunheng <-> 论衡运行", keyOf("Lunheng"), keyOf("论衡运行"));

console.log("== distinct menus stay distinct ==");
eq("MCP != MCP Connector",
  keyOf("MCP") !== keyOf("MCP Connector"), true);
eq("Skills != Skill Market",
  keyOf("Skills") !== keyOf("Skill Market"), true);
eq("Skills != Skill / MCP",
  keyOf("Skills") !== keyOf("Skill / MCP"), true);
eq("unknown label keeps own key",
  keyOf("Brand New Menu"), "brandnewmenu");

console.log("== dedupe: 19 base labels collapse to one row per menu ==");
const baseLabels = [...SRC.matchAll(/"([^"]+)",?\n/g)].map((m) => m[1])
  .filter((l) => l && !l.startsWith("//"));
const map = _labelMap();
console.log("  base label rows rendered: " + map.size + " (base labels listed: " + baseLabels.length + ")");
eq("no locale duplicates in the rendered list",
  new Set(_allLabels()).size, _allLabels().length);
eq("panel renders one row per distinct menu", map.size >= 10 && map.size <= 12, true);

console.log("== hiddenKeys migration (legacy raw labels -> stable keys) ==");
eq("legacy zh raw labels normalize",
  [...hiddenKeys({ hidden: ["插件市场", "论衡运行", "MCP Connector"] })].sort(),
  ["lunheng", "marketplace", "mcpconnector"]);
eq("already-keyed entries are idempotent",
  [...hiddenKeys({ hidden: ["marketplace", "lunheng"] })].sort(),
  ["lunheng", "marketplace"]);
eq("missing/garbage hidden is tolerated",
  hiddenKeys({}).size, 0);
eq("non-array hidden is tolerated",
  hiddenKeys({ hidden: "pluginmarketplace" }).size, 0);

console.log("== readValue / unwrap ==");
eq("plain object passes through",
  readValue({ value: { global: true, hidden: ["x"] } }).global, true);
eq("missing value falls back to defaults",
  readValue({ status: "unavailable" }), { global: false, hidden: [] });
eq("null snapshot falls back to defaults",
  readValue(null), { global: false, hidden: [] });
eq("cosmokit Volatile box is unwrapped",
  readValue({ value: { get: () => ({ global: true, hidden: [] }) } }).global, true);
eq("Volatile box is not mistaken for truthy-but-inert",
  readValue({ value: { get: () => ({ global: false, hidden: [] }) } }).global, false);
eq("Volatile box exposing a real array still works",
  [...readValue({ value: { get: () => ({ global: false, hidden: ["插件"] }) } }).hidden.map(keyOf)],
  ["plugins"]);

console.log("== global switch cannot be silently defeated by a box ==");
eq("box with global=true hides everything",
  readValue({ value: { get: () => ({ global: true, hidden: [] }) } }).global, true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
