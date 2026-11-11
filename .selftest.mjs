// Unit test for the pure helpers extracted verbatim from client.js.
// Extracts the new-architecture functions (identityOf, keysOf, readHidden,
// collectRows, manageablePanels) from the real source so the test exercises
// shipped code.
import fs from "node:fs";
import path from "node:path";

const SRC = fs.readFileSync(
  path.join("C:\\Users\\xx\\sidebar-menu-control", "client.js"),
  "utf8",
);

function sliceBetween(startMarker, endMarker, startFrom = 0) {
  const i = SRC.indexOf(startMarker, startFrom);
  if (i < 0) throw new Error("start marker not found: " + startMarker);
  const j = SRC.indexOf(endMarker, i);
  if (j < 0) throw new Error("end marker not found: " + endMarker);
  return SRC.slice(i, j);
}

// BASE_MANAGEABLE list
const baseSrc = sliceBetween("const BASE_MANAGEABLE = [", "];") + "];";
// ALIAS table
const aliasSrc = sliceBetween("const ALIAS = {", "};") + "};";
// keyOf
const keySrc = sliceBetween("const keyOf = (label) =>", "/* ----");
// unwrap + DEFAULT_VALUE + readValue
const unwrapSrc = sliceBetween("const unwrap = (v) =>", "/* ----");
// resolveSlotLabel (stubbed — real pkg not on disk)
const resolveSlotLabelSrc = sliceBetween("const resolveSlotLabel = (v) =>", "};");
// PANEL_LIST_SLOT / PANEL_ROW_ANCHOR / PLUGIN_ROW_HOOK
const slotConstantsSrc = sliceBetween(
  "const PANEL_LIST_SLOT =",
  "/* ----",
);
// readLedger (incl. its warn latch)
const readLedgerSrc = sliceBetween("let _slotsWarned = false;", "/* ----");
// identityOf
const identityOfSrc = sliceBetween("function identityOf(entry)", "/* ----");
// keysOf
const keysOfSrc = sliceBetween("function keysOf(panel)", "/* ----");
// manageablePanels
const manageableSrc = sliceBetween(
  "function manageablePanels(ctx)",
  "/* ----",
);
// _discovered + _addDiscovered (state needed by manageablePanels fallback)
const discoveredSrc = sliceBetween(
  "const _discovered = new Map()",
  "/* ----",
);
// readHidden
const readHiddenSrc = sliceBetween("function readHidden(value, panels)", "/* ----");
// collectRows
const collectRowsSrc = sliceBetween("function collectRows(scope)", "/* ----");

const factorySrc = `
${baseSrc}
${aliasSrc}
${keySrc}
${unwrapSrc}
${slotConstantsSrc}
${discoveredSrc}
// Stub resolveSlotLabel: identity (no real pkg in test)
const resolveSlotLabel = (v) => (v == null ? "" : String(v));
${readLedgerSrc}
${identityOfSrc}
${keysOfSrc}
${manageableSrc}
${readHiddenSrc}
${collectRowsSrc}
return { identityOf, keysOf, readHidden, collectRows, manageablePanels, keyOf, unwrap, readValue, ALIAS, BASE_MANAGEABLE, _addDiscovered, _discovered, _onDiscover };
`;

const mod = new Function(factorySrc)();
const { identityOf, keysOf, readHidden, collectRows, manageablePanels, keyOf, unwrap, readValue, BASE_MANAGEABLE, _addDiscovered, _discovered, _onDiscover } = mod;
const freshFactory = () => new Function(factorySrc)();

let pass = 0, fail = 0;
const eq = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + "\n        got      " + a + "\n        expected " + e); }
};

console.log("== identityOf ==");
eq("basic entry with id + label",
  identityOf({ options: { id: "panel-a", label: "Panel A", order: 1 } }),
  { id: "panel-a", label: "Panel A", order: 1 });
eq("missing order defaults to 9999",
  identityOf({ options: { id: "panel-b", label: "Panel B" } }),
  { id: "panel-b", label: "Panel B", order: 9999 });
eq("no id/key returns null",
  identityOf({ options: { label: "No ID" } }), null);
eq("null entry returns null",
  identityOf(null), null);
eq("opts.key used as fallback id",
  identityOf({ options: { key: "k1", label: "K" } }),
  { id: "k1", label: "K", order: 9999 });

console.log("== keysOf ==");
const panel1 = { id: "plugins", label: "Plugins" };
const panelZh = { id: "plugins", label: "插件" };
eq("id always in keys", keysOf(panel1).has("plugins"), true);
eq("locale alias: Plugins and 插件 share a key",
  keysOf(panel1).has(keyOf("Plugins")) && keysOf(panelZh).has(keyOf("插件")), true);
eq("both map to same canonical key",
  keyOf("Plugins"), keyOf("插件"));
eq("distinct panels have distinct keys",
  !keysOf({ id: "mcp", label: "MCP" }).has(keyOf("MCP Connector")) &&
  !keysOf({ id: "mcpconnector", label: "MCP Connector" }).has(keyOf("MCP")), true);

console.log("== manageablePanels (ledger path) ==");
const ledgerCtx = {
  slots: {
    entriesOfSlot: (slot) =>
      slot === "sidebar.panellist"
        ? [
            { options: { id: "panel-a", label: "Alpha", order: 2 } },
            { options: { id: "panel-b", label: "Beta", order: 1 } },
            { options: { id: "panel-a", label: "Alpha dup", order: 99 } },
          ]
        : [],
  },
};
const ledgerPanels = manageablePanels(ledgerCtx);
eq("ledger panels returned", ledgerPanels.length, 2);
eq("sorted by order ascending", ledgerPanels[0].id, "panel-b");
eq("duplicate id deduped", ledgerPanels.filter((p) => p.id === "panel-a").length, 1);
eq("label preserved from ledger", ledgerPanels.find((p) => p.id === "panel-b").label, "Beta");

console.log("== manageablePanels (fallback path) ==");
const noLedgerCtx = { slots: null };
const fallbackPanels = manageablePanels(noLedgerCtx);
eq("fallback produces panels (deduped via alias)", fallbackPanels.length >= 9, true);
eq("fallback panels marked", fallbackPanels.every((p) => p.fallback === true), true);
eq("each has a distinct id", new Set(fallbackPanels.map((p) => p.id)).size, fallbackPanels.length);

console.log("== readHidden (ledger id normalization) ==");
const panels = [
  { id: "plugins", label: "Plugins" },
  { id: "marketplace", label: "Marketplace" },
  { id: "panel-xyz", label: "Custom Panel" },
];
eq("ledger id passes through",
  [...readHidden({ hidden: ["plugins", "marketplace"] }, panels)].sort(),
  ["marketplace", "plugins"]);
eq("legacy zh label migrates to ledger id",
  [...readHidden({ hidden: ["插件", "插件市场"] }, panels)].sort(),
  ["marketplace", "plugins"]);
eq("unknown entry keeps its normalized key",
  readHidden({ hidden: ["brand-new-menu"] }, panels).has("brandnewmenu"), true);
eq("empty hidden -> empty set", readHidden({ hidden: [] }, panels).size, 0);
eq("null value -> empty set", readHidden(null, panels).size, 0);
eq("non-array hidden -> empty set", readHidden({ hidden: "bad" }, panels).size, 0);

console.log("== collectRows (stub DOM) ==");
function stubBtn(label) {
  return {
    getAttribute: (attr) => (attr === "aria-label" ? label : null),
    style: { properties: new Map(), setProperty(k, v) { this.properties.set(k, v); }, removeProperty(k) { this.properties.delete(k); }, getPropertyValue(k) { return this.properties.get(k) || ""; } },
  };
}
function stubAnchor({ btnLabel, hasPluginHook = false, closestBtn = true }) {
  return {
    querySelector: (sel) => (hasPluginHook && sel === "[data-dsh-panel-entry]" ? stubBtn("x") : null),
    closest: (sel) => (closestBtn && sel === "button" ? stubBtn(btnLabel) : null),
  };
}
const scope = {
  querySelectorAll: (sel) =>
    sel === '[data-slot="sidebar.panellist"]'
      ? [
          stubAnchor({ btnLabel: "Plugins" }),
          stubAnchor({ btnLabel: "MCP" }),
          stubAnchor({ btnLabel: "Has Hook", hasPluginHook: true }),
          stubAnchor({ btnLabel: "No Closest", closestBtn: false }),
          stubAnchor({ btnLabel: "Plugins" }), // duplicate
        ]
      : [],
};
const rows = collectRows(scope);
eq("rows found (no plugin hook, no null btn, no dup)", rows.size, 2);
eq("Plugins row present", rows.has("Plugins"), true);
eq("MCP row present", rows.has("MCP"), true);
eq("hooked row excluded", rows.has("Has Hook"), false);
eq("non-button row excluded", rows.has("No Closest"), false);
eq("null scope returns empty", collectRows(null).size, 0);

console.log("== keyOf normalization ==");
eq("trims + lowercases + strips separators", keyOf("  Skill / MCP  "), "skillmcp");
eq("empty / null safe", keyOf(null), "");
eq("collapses runs of separators", keyOf("MCP - Connector"), "mcpconnector");
eq("alias: 插件 -> plugins", keyOf("插件"), "plugins");
eq("alias: MCP连接器 -> mcpconnector", keyOf("MCP连接器"), "mcpconnector");
eq("unknown label keeps own key", keyOf("Brand New Menu"), "brandnewmenu");

console.log("== readValue / unwrap ==");
eq("plain object passes through", readValue({ value: { global: true, hidden: ["x"] } }).global, true);
eq("missing value falls back to defaults", readValue({ status: "unavailable" }), { global: false, hidden: [] });
eq("null snapshot falls back to defaults", readValue(null), { global: false, hidden: [] });
eq("cosmokit Volatile box is unwrapped", readValue({ value: { get: () => ({ global: true, hidden: [] }) } }).global, true);
eq("Volatile box with global=false stays false", readValue({ value: { get: () => ({ global: false, hidden: [] }) } }).global, false);

console.log("== DOM-discovered menus join the ledger list (更多/远程控制 scenario) ==");
{
  const m = freshFactory(); // isolated _discovered state
  const before = m.manageablePanels(ledgerCtx);
  eq("ledger list has no discovered items yet",
    before.some((p) => p.id === "more"), false);

  m._addDiscovered("更多");
  m._addDiscovered("远程控制");
  const after = m.manageablePanels(ledgerCtx);
  const ids = after.map((p) => p.id);
  eq("discovered menus appear alongside ledger panels",
    ids.includes("more") && ids.includes("remotecontrol") && ids.includes("panel-a") && ids.includes("panel-b"),
    true, JSON.stringify(ids));
  eq("discovered rows carry stable locale-alias ids", ids.includes("more"), true);
  eq("discovered rows marked fallback",
    after.filter((p) => p.fallback === true).length, 2);

  // Locale switch refreshes the displayed label, key stays put.
  m._addDiscovered("More");
  eq("label refreshed to current locale, key stable",
    m._discovered.get("more"), "More");
  eq("no duplicate key created",
    m.manageablePanels(ledgerCtx).filter((p) => p.id === "more").length, 1);

  // Discovery notifies listeners once (coalesced) outside the render phase.
  let notified = 0;
  const off = m._onDiscover(() => { notified++; });
  m._addDiscovered("Brand New Menu");
  m._addDiscovered("Brand New Menu"); // unchanged -> no re-notify
  await Promise.resolve();
  await Promise.resolve();
  eq("listener notified exactly once (coalesced, unchanged skipped)", notified, 1);
  off();
}
{
  // readHidden keeps legacy 更多 entries applied to the discovered panel.
  const m = freshFactory();
  m._addDiscovered("更多");
  const list = m.manageablePanels({ slots: null }); // BASE + discovered
  const h = m.readHidden({ hidden: ["更多", "More"] }, list);
  eq("legacy 更多 hidden entry maps to discovered id",
    h.has("more"), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
