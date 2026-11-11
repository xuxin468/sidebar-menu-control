// Activation harness: replays client.js's factory + apply() under cordis
// context-proxy semantics, for every boot-order scenario the web boot can
// produce, plus the sidebar DOM second pass (更多/远程控制 discovery, chrome
// and centre-panel exclusion, hide/show bookkeeping).
//
// Cordis semantics modelled from @deepseek-ai/cordis lib/index.js
// (ReflectService.handler.get):
//   - service present                   -> value
//   - absent + declared in fiber inject -> throws "... in inactive context"
//   - absent + NOT in inject            -> throws "cannot get property ... without inject"
//   - ctx.inject(names, cb)             -> cb now when all present, deferred otherwise
//   - ctx.effect(fn)                    -> runs fn synchronously; a throw propagates
import fs from "node:fs";
import path from "node:path";

const SRC = fs.readFileSync(
  path.join(import.meta.dirname, "client.js"),
  "utf8",
);

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (detail ? " — " + detail : "")); }
};

function button(label, x) {
  const btn = {
    style: {
      _p: new Map(),
      getPropertyValue(k) { return this._p.get(k) ?? ""; },
      setProperty(k, v) { this._p.set(k, v); },
      removeProperty(k) { this._p.delete(k); },
    },
    getAttribute: (n) => (n === "aria-label" ? label : null),
    getBoundingClientRect: () => ({ x, y: 10, width: 24, height: 24 }),
    closest: (sel) => (sel === "button" ? btn : null),
    querySelector: () => null,
    hasAttribute: () => false,
    display() { return btn.style._p.get("display"); },
  };
  return btn;
}

/**
 * Fresh module instance + a fresh cordis-like ctx + an optional sidebar DOM.
 * sideButtons: [{ label, x, anchored }] — anchored rows get a panellist
 * anchor whose closest("button") is that exact button object.
 */
function boot({
  services = {},
  moduleInject = ["slots", "locale"],
  ledger = [],
  sideButtons = [],
} = {}) {
  let registration;
  globalThis.window = { __ModuleLoader__: { load: (r) => { registration = r; } } };

  const rafCbs = [];
  const warnings = [];
  const qsCalls = [];
  const realWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.map(String).join(" ")); };

  const buttons = sideButtons.map((s) => ({ spec: s, btn: button(s.label, s.x) }));
  const anchors = buttons
    .filter((b) => b.spec.anchored)
    .map((b) => ({
      querySelector: () => null, // no plugin hook in these fixtures
      closest: (sel) => (sel === "button" ? b.btn : null),
      getAttribute: () => null,
    }));

  const scopeStub = buttons.length
    ? {
        querySelector: () => null,
        querySelectorAll: (sel) => {
          qsCalls.push(sel);
          if (sel === '[data-slot="sidebar.panellist"]') return anchors;
          if (sel === 'button[aria-label]') return buttons.map((b) => b.btn);
          return [];
        },
      }
    : null;

  const rootStub = {
    querySelector: (sel) => (sel === "nav[aria-label]" && scopeStub ? scopeStub : null),
    querySelectorAll: (sel) => { qsCalls.push(sel); return []; },
  };
  globalThis.document = {
    getElementById: (id) => (id === "root" ? rootStub : null),
  };
  globalThis.MutationObserver = class {
    observe() {} disconnect() {}
  };
  globalThis.requestAnimationFrame = (cb) => { rafCbs.push(cb); };

  (0, eval)(SRC); // registers via window.__ModuleLoader__.load

  const requireStub = (spec) => {
    if (spec === "react") return { createElement: () => null };
    if (spec === "@deepseek-ai/dsh-client-ui-slots") {
      throw new Error("Cannot find module (bundler-resolved, absent in harness)");
    }
    throw new Error("unexpected require: " + spec);
  };

  const registrationRan = !!(registration
    && typeof registration.factory === "function"
    && registration.id === "@local/sidebar-menu-control");
  const mod = registrationRan ? registration.factory(requireStub) : null;

  const state = {
    pendingInjects: [],
    effects: [],
    settingsRegistered: false,
    lazilyInjected: false,
  };

  const slotsStub = {
    entriesOfSlot: (slot) => (slot === "sidebar.panellist" ? ledger : []),
    inject: (name, reg) => {
      if (name === "settings.section") state.settingsRegistered = !!reg;
      return () => {};
    },
    register: () => () => {},
  };
  const provided = { slots: slotsStub, locale: { bind: () => () => {} }, ...services };

  const ctx = {};
  for (const name of ["slots", "locale", "configForms"]) {
    Object.defineProperty(ctx, name, {
      get() {
        if (name in provided) return provided[name];
        if (moduleInject.includes(name) || (name === "configForms" && state.lazilyInjected)) {
          throw new Error(`cannot get required service "${name}" in inactive context`);
        }
        throw new Error(`cannot get property "${name}" without inject`);
      },
    });
  }
  ctx.effect = (fn, label) => {
    const disposer = fn(); // synchronous, throws propagate (cordis activation)
    state.effects.push({ label, disposer });
    return disposer;
  };
  ctx.inject = (names, cb) => {
    const missing = names.filter((n) => !(n in provided));
    if (missing.length === 0) { cb(ctx); return { dispose() {} }; }
    state.pendingInjects.push({ names, cb });
    if (names.includes("configForms")) state.lazilyInjected = true;
    return { dispose() {} };
  };
  ctx.arrive = (name, value) => {
    provided[name] = value;
    for (let i = state.pendingInjects.length - 1; i >= 0; i--) {
      const p = state.pendingInjects[i];
      if (p.names.every((n) => n in provided)) {
        state.pendingInjects.splice(i, 1);
        p.cb(ctx);
      }
    }
  };

  return { registrationRan, mod, ctx, state, rafCbs, warnings, qsCalls, buttons,
    restore: () => { console.warn = realWarn; } };
}

const settingsForm = (value) => ({
  get: (ns) => (ns === "sidebar-menu-control" ? {
    getSnapshot: () => ({ value }),
    set: async () => {},
    subscribe: () => () => {},
  } : undefined),
  whileServed: (ns, cb) => cb(),
});

/* ------------------------------------------------------------------ */
console.log("== module registration ==");
{
  const b = boot();
  ok("registration captured with our id", b.registrationRan);
  ok("factory exports inject + apply",
    b.mod && Array.isArray(b.mod.inject) && typeof b.mod.apply === "function");
  ok("declared module inject lists slots+locale",
    b.mod && JSON.stringify(b.mod.inject) === JSON.stringify(["slots", "locale"]),
    b.mod && JSON.stringify(b.mod.inject));
  b.restore();
}

/* ------------------------------------------------------------------ */
console.log("== S1: boot race — configForms NOT yet provided (the crash scenario) ==");
{
  const b = boot(); // slots+locale present, configForms absent
  let threw = null;
  try { b.mod.apply(b.ctx); } catch (e) { threw = e; }
  ok("apply() does NOT throw during activation", threw === null, threw && threw.message);
  ok("configForms lookup deferred via lazy inject",
    b.state.pendingInjects.some((p) => p.names.includes("configForms")));
  ok("visibility engine ran synchronously in activation",
    b.qsCalls.includes("button[aria-label]"), "qsCalls=" + JSON.stringify(b.qsCalls));
  ok("no activation-fatal warnings",
    !b.warnings.some((w) => w.includes("apply failed")),
    b.warnings.join(" | "));
  b.restore();
}

/* ------------------------------------------------------------------ */
console.log("== S2: configForms arrives later — settings section registers ==");
{
  const b = boot();
  let threw = null;
  try { b.mod.apply(b.ctx); } catch (e) { threw = e; }
  ok("activation clean", threw === null, threw && threw.message);

  let lateThrew = null;
  try { b.ctx.arrive("configForms", settingsForm({ global: false, hidden: [] })); }
  catch (e) { lateThrew = e; }
  ok("late arrival fires deferred setupSettings without throwing",
    lateThrew === null, lateThrew && lateThrew.message);
  ok("settings section registered after arrival", b.state.settingsRegistered === true);
  b.restore();
}

/* ------------------------------------------------------------------ */
console.log("== S3: slots service GONE (runtime teardown) — degrades, never throws ==");
{
  const b = boot();
  const throwingCtx = Object.create(b.ctx);
  Object.defineProperty(throwingCtx, "slots", {
    get() { throw new Error('cannot get required service "slots" in inactive context'); },
    configurable: true,
  });
  let threw = null;
  try { b.mod.apply(throwingCtx); } catch (e) { threw = e; }
  ok("apply() does NOT throw when slots is inactive", threw === null, threw && threw.message);
  ok("a degraded-path warning was emitted once",
    b.warnings.filter((w) => w.includes("slots unavailable")).length === 1,
    b.warnings.join(" | "));
  b.restore();
}

/* ------------------------------------------------------------------ */
console.log("== S4: configForms present at activation (the lucky race) ==");
{
  const b = boot({ services: { configForms: settingsForm({ global: false, hidden: [] }) } });
  let threw = null;
  try { b.mod.apply(b.ctx); } catch (e) { threw = e; }
  ok("apply() does NOT throw", threw === null, threw && threw.message);
  ok("settings section registered synchronously", b.state.settingsRegistered === true);
  b.restore();
}

/* ------------------------------------------------------------------ */
console.log("== S5: settings service absent entirely — visibility still boots ==");
{
  const b = boot(); // configForms never arrives
  let threw = null;
  try { b.mod.apply(b.ctx); } catch (e) { threw = e; }
  ok("apply() does NOT throw", threw === null, threw && threw.message);
  ok("no warnings for a composition without settings",
    b.warnings.length === 0, b.warnings.join(" | "));
  b.restore();
}

/* ------------------------------------------------------------------ */
const domFixtures = () => ({
  ledger: [{ options: { id: "panel-a", label: "Alpha", order: 1 } }],
  sideButtons: [
    { label: "Alpha", x: 50, anchored: true },  // ledger row via anchor
    { label: "更多", x: 100 },                  // known, missing from ledger
    { label: "New Chat", x: 120 },              // sidebar chrome
    { label: "More", x: 800 },                  // centre-panel overflow
  ],
});
const flushRaf = (b) => { const cbs = b.rafCbs.splice(0); cbs.forEach((cb) => cb()); };

console.log("== S6a: DOM second pass with global ON — chrome and centre stay untouched ==");
{
  const f = domFixtures();
  const b = boot({
    ...f,
    services: { configForms: settingsForm({ global: true, hidden: [] }) },
  });
  let threw = null;
  try { b.mod.apply(b.ctx); } catch (e) { threw = e; }
  ok("apply() clean", threw === null, threw && threw.message);
  ok("no visibility warnings", b.warnings.length === 0, b.warnings.join(" | "));
  flushRaf(b); // real browsers fire rAF; the harness flushes it to apply form-backed state
  const alpha = b.buttons.find((x) => x.spec.label === "Alpha").btn;
  const more = b.buttons.find((x) => x.spec.label === "更多").btn;
  const chrome = b.buttons.find((x) => x.spec.label === "New Chat").btn;
  const center = b.buttons.find((x) => x.spec.x === 800).btn;
  ok("ledger row hidden by global", alpha.display() === "none", "display=" + alpha.display());
  ok("sidebar 更多 hidden by global (was missing from the list)",
    more.display() === "none", "display=" + more.display());
  ok("chrome button untouched", chrome.display() === undefined, "display=" + chrome.display());
  ok("centre-panel More untouched", center.display() === undefined, "display=" + center.display());
  b.restore();
}

console.log("== S6b: DOM second pass — hidden:['more'] hides only 更多 ==");
{
  const f = domFixtures();
  const b = boot({
    ...f,
    services: { configForms: settingsForm({ global: false, hidden: ["更多"] }) },
  });
  let threw = null;
  try { b.mod.apply(b.ctx); } catch (e) { threw = e; }
  ok("apply() clean", threw === null, threw && threw.message);
  flushRaf(b);
  const alpha = b.buttons.find((x) => x.spec.label === "Alpha").btn;
  const more = b.buttons.find((x) => x.spec.label === "更多").btn;
  const chrome = b.buttons.find((x) => x.spec.label === "New Chat").btn;
  const center = b.buttons.find((x) => x.spec.x === 800).btn;
  ok("legacy hidden label 更多 applies to the discovered button",
    more.display() === "none", "display=" + more.display());
  ok("visible ledger row untouched", alpha.display() === undefined, "display=" + alpha.display());
  ok("chrome untouched", chrome.display() === undefined);
  ok("centre overflow untouched", center.display() === undefined);
  b.restore();
}

/* ------------------------------------------------------------------ */
console.log("== S6c: ledger row rendered with a plugin hook is still controllable ==");
{
  const b = boot({
    ledger: [{ options: { id: "panel-hook", label: "Remote", order: 1 } }],
    sideButtons: [
      // not anchored: collectRows skips hooked rows, second pass must own it
      { label: "Remote", x: 90 },
    ],
    services: { configForms: settingsForm({ global: false, hidden: ["panel-hook"] }) },
  });
  let threw = null;
  try { b.mod.apply(b.ctx); } catch (e) { threw = e; }
  ok("apply() clean", threw === null, threw && threw.message);
  flushRaf(b);
  const remote = b.buttons[0].btn;
  ok("hooked ledger row hidden via its panel id",
    remote.display() === "none", "display=" + remote.display());
  b.restore();
}

/* ------------------------------------------------------------------ */
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
