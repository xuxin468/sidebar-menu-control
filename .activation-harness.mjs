// Activation harness: replays client.js's factory + apply() under cordis
// context-proxy semantics, for every boot-order scenario the web boot can
// produce. Proves apply() can never fail entry activation.
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

const settingsController = {
  getSnapshot: () => ({ value: { global: false, hidden: [] } }),
  set: async () => {},
  subscribe: () => () => {},
};
const configFormsStub = {
  get: (ns) => (ns === "sidebar-menu-control" ? settingsController : undefined),
  whileServed: (ns, cb) => cb(),
};

/** Fresh module instance + a fresh cordis-like ctx. */
function boot({ services = {}, moduleInject = ["slots", "locale"] } = {}) {
  let registration;
  globalThis.window = { __ModuleLoader__: { load: (r) => { registration = r; } } };

  const rafCbs = [];
  const warnings = [];
  const qsCalls = [];
  const realWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.map(String).join(" ")); };

  const rootStub = {
    querySelector: () => null,                 // no sidebar container -> falls back to root
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
    entriesOfSlot: () => [],
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

  return { registrationRan, mod, ctx, state, rafCbs, warnings, qsCalls,
    restore: () => { console.warn = realWarn; } };
}

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
  try { b.ctx.arrive("configForms", configFormsStub); }
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
  const b = boot({ services: { configForms: configFormsStub } });
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
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
