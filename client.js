/**
 * Client half: hides/shows sidebar panel rows based on a persisted setting.
 *
 * Identity: the shell exposes a global panel list seat, `sidebar.panellist`.
 * Every rendered panel row carries a `[data-slot="sidebar.panellist"]` anchor
 * inside the shell's own `<button aria-label=…>`. The ledger behind that seat
 * (`ctx.slots.entriesOfSlot("sidebar.panellist")`) yields each entry's stable
 * `options.id` plus its `options.label`; the shell resolves the label for the
 * active locale with `resolveSlotLabel`, so matching by the resolved label
 * follows the UI language instead of a hard-coded translation.
 *
 * Panels are therefore identified by their ledger id. The legacy aria-label
 * scan (BASE_MANAGEABLE + pixel band) is kept only as a fallback for hosts
 * that do not expose the slot ledger.
 *
 * Persistence: the host plugin (index.js) declares a settings namespace keyed
 * by the entry id `sidebar-menu-control` (kebab-case, from cordis.patch.yml
 * insert) with volatile fields. The client reads/writes it through
 * `ctx.configForms` (the ui-settings provider), which gives a per-namespace
 * `ConfigFormController` with `getSnapshot()`, `set()`, `mutate()`, and
 * `subscribe()`. `configForms` is injected lazily: in a composition without
 * the settings service a required top-level service would keep the whole
 * browser half from loading, so the lazy inject simply never fires there and
 * the visibility engine still runs on defaults.
 */
window.__ModuleLoader__.load({
  id: "@local/sidebar-menu-control",
  factory(require) {
    const React = require("react");
    const h = React.createElement;

    /* ---------------------------------------------------------------- */
    /*  Namespace (must equal the entry id in cordis.patch.yml insert)    */
    /* ---------------------------------------------------------------- */
    const NS = "sidebar-menu-control";

    /* ---------------------------------------------------------------- */
    /*  Slot ledger (optional but preferred)                             */
    /* ---------------------------------------------------------------- */
    /*  `@deepseek-ai/dsh-client-ui-slots` ships inside the host bundle  */
    /*  and is resolved by the bundler at client-bundle time (the same   */
    /*  require the installed task-board plugin performs). It is not on  */
    /*  disk in the profile, so the require is guarded: when it cannot   */
    /*  be resolved the plugin degrades to the legacy aria-label scan.   */
    let _slotsPkg = null;
    try {
      _slotsPkg = require("@deepseek-ai/dsh-client-ui-slots");
    } catch (_) {
      _slotsPkg = null;
    }

    const resolveSlotLabel = (v) => {
      if (_slotsPkg && typeof _slotsPkg.resolveSlotLabel === "function") {
        try {
          const r = _slotsPkg.resolveSlotLabel(v);
          if (r) return String(r);
        } catch (_) {}
      }
      return v == null ? "" : String(v);
    };

    const PANEL_LIST_SLOT = "sidebar.panellist";
    const PANEL_ROW_ANCHOR = '[data-slot="sidebar.panellist"]';
    /* Rows a plugin owns carry the family's own entry hook; they are skipped. */
    const PLUGIN_ROW_HOOK = "[data-dsh-panel-entry]";

    /* ---------------------------------------------------------------- */
    /*  Legacy fallback labels                                            */
    /* ---------------------------------------------------------------- */
    /*  Used only when the slot ledger is unavailable. New menus are     */
    /*  discovered dynamically at runtime — see _addDiscovered below.    */
    const BASE_MANAGEABLE = [
      "Plugins",
      "Skills",
      "MCP",
      "Marketplace",
      "Automation",
      "Skill Market",
      "MCP Connector",
      "Lunheng",
      "Remote Control",
      "More",
      // Chinese variants (exact aria-labels from the sidebar)
      "插件",
      "Skill / MCP",
      "插件市场",
      "自动化任务",
      "技能市场",
      "MCP连接器",
      "论衡运行",
      "远程控制",
      "更多",
    ];

    /* ---------------------------------------------------------------- */
    /*  Locale-stable key (legacy entries only)                          */
    /* ---------------------------------------------------------------- */
    /*  Persisted `hidden` entries written by older versions are raw     */
    /*  labels. Normalize them so a locale switch does not orphan the    */
    /*  list and the settings panel does not render one row per locale.  */
    const ALIAS = {
      plugins: "plugins",
      插件: "plugins",
      marketplace: "marketplace",
      插件市场: "marketplace",
      skillmarket: "skillmarket",
      技能市场: "skillmarket",
      automation: "automation",
      自动化任务: "automation",
      remotecontrol: "remotecontrol",
      远程控制: "remotecontrol",
      more: "more",
      更多: "more",
      lunheng: "lunheng",
      论衡运行: "lunheng",
      mcpconnector: "mcpconnector",
      mcp连接器: "mcpconnector",
    };

    const keyOf = (label) => {
      const k = String(label == null ? "" : label)
        .trim()
        .toLowerCase()
        .replace(/[\s_\-/]+/g, "");
      return ALIAS[k] || k;
    };

    /* ---------------------------------------------------------------- */
    /*  Volatile-ref unwrap                                               */
    /* ---------------------------------------------------------------- */
    /*  `.volatile()` fields may arrive as a cosmokit `{ get() }` box on */
    /*  some hosts. Unwrap defensively so reads never see a box object.  */
    const unwrap = (v) =>
      v && typeof v === "object" && typeof v.get === "function" ? v.get() : v;

    const DEFAULT_VALUE = { global: false, hidden: [] };

    const readValue = (snapshot) => {
      const v = unwrap(snapshot && snapshot.value);
      return v && typeof v === "object" ? v : DEFAULT_VALUE;
    };

    /* ---------------------------------------------------------------- */
    /*  Ledger reading                                                    */
    /* ---------------------------------------------------------------- */
    function readLedger(ctx) {
      /* `ctx.slots` is a declared inject (top-level `inject` array), so the
       * runtime must be up before apply() runs. If it is not yet, throw a
       * marker and let the caller fall back; a plain access throws the
       * cordis "cannot get required service" error, which is not caught
       * here and would propagate out of apply() and fail the whole entry. */
      let slots;
      try {
        slots = ctx.slots;
      } catch (e) {
        if (e && /inactive context/.test(String(e.message))) return [];
        throw e;
      }
      if (!slots || typeof slots.entriesOfSlot !== "function") return [];
      try {
        return slots.entriesOfSlot(PANEL_LIST_SLOT) || [];
      } catch (_) {
        return [];
      }
    }

    function identityOf(entry) {
      const opts = (entry && entry.options) || {};
      const id = opts.id || opts.key;
      if (!id) return null;
      const label = resolveSlotLabel(opts.label) || opts.label || id;
      return {
        id: String(id),
        label: String(label),
        order: typeof opts.order === "number" ? opts.order : 9999,
      };
    }

    /** Every stable key that identifies this panel: ledger id + label key. */
    function keysOf(panel) {
      const set = new Set([panel.id]);
      const k = keyOf(panel.label);
      if (k) set.add(k);
      return set;
    }

    /**
     * The live manageable-panel list, ledger first.
     * Falls back to the known label list plus dynamic discovery when the
     * slot ledger is not exposed.
     */
    function manageablePanels(ctx) {
      const panels = [];
      const seen = new Set();

      for (const entry of readLedger(ctx)) {
        const p = identityOf(entry);
        if (!p || seen.has(p.id)) continue;
        seen.add(p.id);
        panels.push(p);
      }
      if (panels.length) {
        panels.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
        return panels;
      }

      // Fallback: no ledger. Use the known labels, then discovered ones.
      for (const label of BASE_MANAGEABLE) {
        const key = keyOf(label);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        panels.push({ id: key, label, order: 9999, fallback: true });
      }
      for (const [key, label] of _discovered) {
        if (seen.has(key)) continue;
        seen.add(key);
        panels.push({ id: key, label, order: 9999, fallback: true });
      }
      return panels;
    }

    /* ---------------------------------------------------------------- */
    /*  Dynamic discovery state (fallback path)                          */
    /* ---------------------------------------------------------------- */
    const _discovered = new Map(); /* stable key -> display label */
    const _discoverListeners = [];
    let _discoverScheduled = false;

    function _addDiscovered(label) {
      const key = keyOf(label);
      if (!key || _discovered.has(key)) return;
      _discovered.set(key, label);
      if (_discovered.size > 128) {
        // Bound growth: drop the oldest half once the cap is exceeded.
        [..._discovered.keys()].slice(0, 64).forEach((k) => _discovered.delete(k));
      }
      if (!_discoverListeners.length) return;
      // Notify outside the render phase — listeners call setState.
      if (_discoverScheduled) return;
      _discoverScheduled = true;
      Promise.resolve().then(() => {
        _discoverScheduled = false;
        for (const cb of _discoverListeners.slice()) {
          try {
            cb();
          } catch (err) {
            console.warn("[sidebar-menu-control] discover listener failed", err);
          }
        }
      });
    }

    function _onDiscover(cb) {
      _discoverListeners.push(cb);
      return () => {
        const i = _discoverListeners.indexOf(cb);
        if (i >= 0) _discoverListeners.splice(i, 1);
      };
    }

    /* ---------------------------------------------------------------- */
    /*  Hidden-set normalization                                           */
    /* ---------------------------------------------------------------- */
    /**
     * Persisted `hidden` entries are normalized to ledger ids. A legacy raw
     * label is matched against each panel's id or label key, so entries written
     * by older versions still apply after the identity scheme changed.
     */
    function readHidden(value, panels) {
      const raw = unwrap(value && value.hidden);
      const arr = Array.isArray(raw) ? raw : [];
      const alias = new Map();
      for (const p of panels) {
        for (const k of keysOf(p)) {
          if (!alias.has(k)) alias.set(k, p.id);
        }
      }
      const out = new Set();
      for (const e of arr) {
        const s = String(e == null ? "" : e).trim();
        if (!s) continue;
        if (alias.has(s)) out.add(alias.get(s));
        else {
          const k = keyOf(s);
          out.add(alias.has(k) ? alias.get(k) : k);
        }
      }
      return out;
    }

    /* ---------------------------------------------------------------- */
    /*  DOM row collection                                                */
    /* ---------------------------------------------------------------- */
    /** resolved aria-label -> row button, for every shell-owned panel row. */
    function collectRows(scope) {
      const rows = new Map();
      if (!scope || typeof scope.querySelectorAll !== "function") return rows;
      let anchors;
      try {
        anchors = scope.querySelectorAll(PANEL_ROW_ANCHOR);
      } catch (_) {
        return rows;
      }
      for (const anchor of anchors) {
        try {
          if (anchor.querySelector(PLUGIN_ROW_HOOK)) continue;
          const btn = anchor.closest ? anchor.closest("button") : null;
          if (!btn) continue;
          const label = btn.getAttribute("aria-label");
          if (label && !rows.has(label)) rows.set(label, btn);
        } catch (_) {}
      }
      return rows;
    }

    /* ---------------------------------------------------------------- */
    /*  Display bookkeeping                                               */
    /* ---------------------------------------------------------------- */
    /*  Save what we clobbered so restoring a panel returns it to the state  */
    /*  the shell's own CSS intended, rather than to "".                    */
    const _prevDisplay = typeof WeakMap === "function" ? new WeakMap() : null;

    const hideButton = (btn) => {
      if (!btn || !_prevDisplay) return;
      if (!_prevDisplay.has(btn)) _prevDisplay.set(btn, btn.style.getPropertyValue("display"));
      btn.style.setProperty("display", "none", "important");
    };

    const showButton = (btn) => {
      if (!btn || !_prevDisplay) return;
      if (!_prevDisplay.has(btn)) return; // never touched it
      const prev = _prevDisplay.get(btn);
      _prevDisplay.delete(btn);
      if (prev) btn.style.setProperty("display", prev, "important");
      else btn.style.removeProperty("display");
    };

    /* ---------------------------------------------------------------- */
    /*  Sidebar scoping                                                   */
    /* ---------------------------------------------------------------- */
    /*  Prefer a structural sidebar container over the old `x > 260`     */
    /*  pixel band, which broke under zoom/RTL/wide windows.            */
    /*                                                                      */
    /*  Only unambiguous selectors are used: a bare `nav`/`aside` can     */
    /*  match a non-sidebar element (breadcrumb, footer) and would then  */
    /*  starve the plugin entirely, so those fall back to `#root`.       */
    function _sidebarScope(root) {
      return (
        root.querySelector("nav[aria-label]") ||
        root.querySelector("[data-sidebar]") ||
        root.querySelector("aside[aria-label]") ||
        root.querySelector("[role='navigation']") ||
        root
      );
    }

    /* ---------------------------------------------------------------- */
    /*  Settings section UI                                               */
    /* ---------------------------------------------------------------- */
    function SettingsSection(props) {
      const { form, ctx } = props;
      const [snapshot, setSnapshot] = React.useState(form.getSnapshot());

      React.useEffect(() => {
        const offForm = form.subscribe(() => setSnapshot(form.getSnapshot()));
        const offDiscover = _onDiscover(() => setSnapshot(form.getSnapshot()));
        return () => {
          offForm();
          offDiscover();
        };
      }, [form]);

      const value = readValue(snapshot);
      const panels = manageablePanels(ctx);
      const hidden = readHidden(value, panels);
      const globalOn = !!value.global;

      const saveField = async (field, val) => {
        await form.set(field, val);
      };

      const togglePanel = (panel) => {
        const next = new Set(hidden);
        if (next.has(panel.id)) next.delete(panel.id);
        else next.add(panel.id);
        // Persist the stable ledger id; readHidden migrates legacy entries.
        saveField("hidden", [...next]);
      };

      const toggleGlobal = () => saveField("global", !globalOn);

      const row = (panel) => {
        const off = !hidden.has(panel.id);
        return h(
          "label",
          {
            key: panel.id,
            style: {
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "5px 0",
              cursor: globalOn ? "default" : "pointer",
              opacity: globalOn ? 0.45 : 1,
              userSelect: "none",
            },
          },
          h("input", {
            type: "checkbox",
            checked: off,
            // With the global switch on every panel is hidden; the per-item
            // rows are inert so they cannot silently accumulate entries the
            // user cannot see or undo.
            disabled: globalOn,
            onChange: () => togglePanel(panel),
          }),
          h("span", { style: { fontSize: 13 } }, panel.label),
        );
      };

      return h(
        "div",
        {
          style: {
            padding: "16px 20px",
            fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
            color: "#ccc",
          },
        },
        h("h3", { style: { margin: 0, fontSize: 15 } }, "侧栏菜单显示"),
        h(
          "p",
          { style: { margin: "4px 0 12px", fontSize: 12, opacity: 0.55 } },
          "控制左侧栏中各管理面板图标的显示与隐藏。",
        ),
        h(
          "label",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              borderRadius: 6,
              background: "rgba(255,255,255,0.04)",
              marginBottom: 12,
              cursor: "pointer",
            },
          },
          h("input", {
            type: "checkbox",
            checked: globalOn,
            onChange: toggleGlobal,
          }),
          h("span", { style: { fontSize: 13, fontWeight: 600 } }, "一键隐藏全部管理菜单"),
        ),
        h(
          "div",
          { style: { borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 8 } },
          panels.length
            ? panels.map(row)
            : h("p", { style: { fontSize: 12, opacity: 0.5 } }, "未发现可管理的侧栏菜单。"),
        ),
      );
    }

    /* ---------------------------------------------------------------- */
    /*  Entry point                                                       */
    /* ---------------------------------------------------------------- */
    return {
      /* `configForms` is deliberately NOT here: a required top-level service
       * would keep the whole browser half from loading in a composition
       * that does not provide the settings service. It is injected lazily. */
      inject: ["slots", "locale"],
      apply(ctx) {
        /* The settings controller is attached lazily; until it arrives the
         * visibility engine runs on defaults (everything visible). */
        let form = null;
        let disposed = false;
        let observer = null;

        /* ---- 1. Visibility engine (works without configForms) ---- */
        const applyVisibility = () => {
          const state = form ? readValue(form.getSnapshot()) : DEFAULT_VALUE;
          const root = document.getElementById("root");
          if (!root) return;

          const scope = _sidebarScope(root);
          const rows = collectRows(scope);
          const panels = manageablePanels(ctx);
          const hidden = readHidden(state, panels);
          const globalOn = !!state.global;

          if (rows.size) {
            /* Ledger path: match the shell's own resolved labels. */
            for (const panel of panels) {
              const btn = rows.get(panel.label);
              if (!btn) continue;
              if (globalOn || hidden.has(panel.id)) hideButton(btn);
              else showButton(btn);
            }
            return;
          }

          /* Fallback path: no slot anchors in the DOM. Scan every button in
           * the sidebar by aria-label, as older versions did. */
          const useXBand = scope === root;
          scope.querySelectorAll("button[aria-label]").forEach((btn) => {
            const label = btn.getAttribute("aria-label");
            if (!label) return;
            if (useXBand && btn.getBoundingClientRect().x > 260) return;

            /* ---- Dynamic discovery (fallback path only) ---- */
            if (!BASE_MANAGEABLE.includes(label)) _addDiscovered(label);

            const panel = panels.find((p) => keysOf(p).has(keyOf(label)));
            const shouldHide = globalOn || (panel ? hidden.has(panel.id) : hidden.has(keyOf(label)));
            if (shouldHide) hideButton(btn);
            else showButton(btn);
          });
        };

        // rAF-coalesced trailing apply: a burst of mutations collapses to one
        // run and the final state is always applied.
        let applyScheduled = false;
        const scheduleApply = () => {
          if (disposed || applyScheduled) return;
          applyScheduled = true;
          const run = () => {
            applyScheduled = false;
            applyVisibility();
          };
          if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
          else setTimeout(run, 0);
        };

        const attach = () => {
          if (disposed) return;
          const target = document.getElementById("root");
          if (!target) {
            setTimeout(attach, 50);
            return;
          }
          observer = new MutationObserver(scheduleApply);
          observer.observe(target, {
            childList: true,
            subtree: true,
            attributes: true,
            // "style" is deliberately excluded: applyVisibility writes the
            // inline display itself, and settings changes already re-apply
            // through form.subscribe below.
            attributeFilter: ["aria-label"],
          });
          applyVisibility();
        };
        attach();

        /* ---- 2. Lazy settings injection ---- */
        const setupSettings = (formsCtx) => {
          if (disposed) return;
          const f = formsCtx.configForms && formsCtx.configForms.get(NS);
          if (!f) return;
          form = f;

          /* The Configure control exists exactly while the Host serves the
           * entry; whileServed also waits out the mirror's first read. */
          formsCtx.effect(
            () => {
              try {
                return formsCtx.configForms.whileServed([NS], () => {
                  const off = formsCtx.slots.inject("settings.section", () =>
                    formsCtx.slots.register(
                      {
                        name: "settings.section",
                        id: "sidebar-menu-control",
                        order: 60,
                        label: () => "侧栏菜单",
                      },
                      (props) => h(SettingsSection, { form: f, ctx: formsCtx }),
                    ),
                  );
                  return off;
                });
              } catch (e) {
                console.warn("[sidebar-menu-control] settings section deferred", e);
                return () => {};
              }
            },
            "sidebar-menu-control: settings section",
          );

          /* Re-apply whenever our own settings change. */
          f.subscribe(() => scheduleApply());
          scheduleApply();
        };

        if (ctx.configForms) {
          setupSettings(ctx);
        } else if (typeof ctx.inject === "function") {
          ctx.inject(["configForms"], setupSettings);
        }

        /* cleanup */
        ctx.effect(
          () => () => {
            disposed = true;
            if (observer) observer.disconnect();
          },
          "sidebar-menu-control: observer",
        );
      },
    };
  },
});
