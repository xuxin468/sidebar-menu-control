/**
 * Client half: hides/shows sidebar panel rows based on a persisted setting.
 *
 * Persistence: the host plugin (index.js) declares a settings namespace
 * keyed by the entry id `sidebar-menu-control` (kebab-case, from
 * cordis.patch.yml insert) with volatile fields. The client reads/writes it
 * through `ctx.configForms` (the ui-settings provider), which gives a
 * per-namespace `ConfigFormController` with `getSnapshot()`, `set()`,
 * `mutate()`, and `subscribe()`.
 *
 * Hiding: the sidebar renders panel icon rows as
 *   <nav aria-label="…"> <button aria-label="<PanelLabel>"> …
 * A MutationObserver on the sidebar root re-applies
 * `style.display = none` to buttons whose aria-label matches a hidden
 * panel. The observer also re-applies on settings changes.
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
    /*  Manageable panel labels                                            */
    /* ---------------------------------------------------------------- */
    /*  Base list: known sidebar menu labels (English + Chinese).       */
    /*  New menus are discovered dynamically at runtime — see below.     */
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
    /*  Locale-stable identity                                            */
    /* ---------------------------------------------------------------- */
    /*  The same sidebar menu carries a different aria-label depending on */
    /*  the UI locale. `hidden` stores a locale-stable key so switching    */
    /*  locale does not orphan the persisted list and so the settings     */
    /*  panel does not render one row per locale for the same menu.       */
    /* ---------------------------------------------------------------- */
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

    const stableKey = (label) =>
      String(label == null ? "" : label).trim().toLowerCase().replace(/[\s_\-/]+/g, "");

    const keyOf = (label) => {
      const k = stableKey(label);
      return ALIAS[k] || k;
    };

    /* ---------------------------------------------------------------- */
    /*  Dynamic discovery state                                            */
    /* ---------------------------------------------------------------- */
    /*  New sidebar menu items get a new aria-label. We discover them   */
    /*  by scanning the sidebar DOM and add them to `_discovered`, then */
    /*  notify the settings panel to re-render.                         */
    const _discovered = new Map(); /* stable key -> display label (latest seen) */
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

    /** stable key -> display label. Base labels first, discovered override. */
    function _labelMap() {
      const map = new Map();
      for (const label of BASE_MANAGEABLE) {
        const key = keyOf(label);
        if (!map.has(key)) map.set(key, label);
      }
      for (const [key, label] of _discovered) map.set(key, label);
      return map;
    }

    const _allLabels = () => [..._labelMap().values()];

    function _onDiscover(cb) {
      _discoverListeners.push(cb);
      return () => {
        const i = _discoverListeners.indexOf(cb);
        if (i >= 0) _discoverListeners.splice(i, 1);
      };
    }

    /* ---------------------------------------------------------------- */
    /*  Volatile-ref unwrap                                               */
    /* ---------------------------------------------------------------- */
    /*  `.volatile()` fields may arrive as a cosmokit `{ get() }` box on */
    /*  some hosts. Unwrap defensively so reads never see a box object.  */
    /* ---------------------------------------------------------------- */
    const unwrap = (v) =>
      v && typeof v === "object" && typeof v.get === "function" ? v.get() : v;

    const DEFAULT_VALUE = { global: false, hidden: [] };

    const readValue = (snapshot) => {
      const v = unwrap(snapshot && snapshot.value);
      return v && typeof v === "object" ? v : DEFAULT_VALUE;
    };

    /** `hidden` entries normalized to locale-stable keys. */
    const hiddenKeys = (value) => {
      const raw = unwrap(value && value.hidden);
      return new Set(Array.isArray(raw) ? raw.map(keyOf) : []);
    };

    /* ---------------------------------------------------------------- */
    /*  Sidebar scoping                                                   */
    /* ---------------------------------------------------------------- */
    /*  Prefer a structural sidebar container over the old `x > 260`     */
    /*  pixel band, which broke under zoom/RTL/wide windows and skipped  */
    /*  discovery for anything past 260px.                              */
    /* ---------------------------------------------------------------- */
    function _sidebarScope(root) {
      return (
        root.querySelector("nav[aria-label]") ||
        root.querySelector("[data-sidebar]") ||
        root.querySelector("aside[aria-label]") ||
        root.querySelector("nav") ||
        root.querySelector("aside") ||
        root
      );
    }

    /* ---------------------------------------------------------------- */
    /*  Settings section UI                                               */
    /* ---------------------------------------------------------------- */
    function SettingsSection(props) {
      const { form } = props;
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
      const hidden = hiddenKeys(value);
      const globalOn = !!value.global;

      const saveField = async (field, val) => {
        await form.set(field, val);
      };

      const isHidden = (key) => hidden.has(key);

      const togglePanel = (label) => {
        const key = keyOf(label);
        const next = new Set(hidden);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        // Persist stable keys; this also migrates legacy raw-label entries.
        saveField("hidden", [...next]);
      };

      const toggleGlobal = () => saveField("global", !globalOn);

      const row = (label) => {
        const key = keyOf(label);
        return h(
          "label",
          {
            key,
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
            checked: !isHidden(key),
            // With the global switch on every panel is hidden; the per-item
            // rows are inert so they cannot silently accumulate entries the
            // user cannot see or undo.
            disabled: globalOn,
            onChange: () => togglePanel(label),
          }),
          h("span", { style: { fontSize: 13 } }, label),
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
          _allLabels().map(row),
        ),
      );
    }

    /* ---------------------------------------------------------------- */
    /*  Entry point                                                       */
    /* ---------------------------------------------------------------- */
    return {
      inject: ["slots", "locale", "configForms"],
      apply(ctx) {
        const form = ctx.configForms.get(NS);

        /* ---- 1. Settings section (follows the namespace) ---- */
        ctx.effect(
          () =>
            ctx.configForms.whileServed([NS], () => {
              const off = ctx.slots.inject("settings.section", () =>
                ctx.slots.register(
                  {
                    name: "settings.section",
                    id: "sidebar-menu-control",
                    order: 60,
                    label: () => "侧栏菜单",
                  },
                  (props) => h(SettingsSection, { form }),
                ),
              );
              return off;
            }),
          "sidebar-menu-control: settings section",
        );

        /* ---- 2. MutationObserver: hide/show sidebar buttons ---- */
        const applyVisibility = () => {
          const state = readValue(form.getSnapshot());
          const root = document.getElementById("root");
          if (!root) return;

          const scope = _sidebarScope(root);
          // Only fall back to the x-band heuristic when no structural
          // sidebar container was found.
          const useXBand = scope === root;
          const hidden = hiddenKeys(state);

          scope.querySelectorAll("button[aria-label]").forEach((btn) => {
            const label = btn.getAttribute("aria-label");
            if (!label) return;
            if (useXBand && btn.getBoundingClientRect().x > 260) return;

            /* ---- Dynamic discovery ---- */
            /* If this sidebar button's label is not in the base list, */
            /* add it so the settings panel can render a row for it. */
            if (!BASE_MANAGEABLE.includes(label)) {
              _addDiscovered(label);
            }

            /* ---- Apply visibility ---- */
            /* Hidden if global is on OR the label's stable key is hidden. */
            const shouldHide = state.global || hidden.has(keyOf(label));
            btn.style.display = shouldHide ? "none" : "";
          });
        };

        // rAF-coalesced trailing apply: a burst of mutations collapses to one
        // run and the final state is always applied.
        let applyScheduled = false;
        const scheduleApply = () => {
          if (applyScheduled) return;
          applyScheduled = true;
          const run = () => {
            applyScheduled = false;
            applyVisibility();
          };
          if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
          else setTimeout(run, 0);
        };

        let disposed = false;
        let observer = null;
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

        /* cleanup */
        ctx.effect(
          () => () => {
            disposed = true;
            if (observer) observer.disconnect();
          },
          "sidebar-menu-control: observer",
        );

        /* re-apply when our own settings change */
        form.subscribe(() => scheduleApply());
      },
    };
  },
});
