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
    /*  Manageable panel labels (matched against button aria-label)       */
    /* ---------------------------------------------------------------- */
    const MANAGEABLE = [
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
    /*  Settings section UI                                               */
    /* ---------------------------------------------------------------- */
    function SettingsSection(props) {
      const { form } = props;
      const [snapshot, setSnapshot] = React.useState(form.getSnapshot());

      React.useEffect(() => {
        const off = form.subscribe(() => setSnapshot(form.getSnapshot()));
        return off;
      }, [form]);

      const value = snapshot.value ?? { global: false, hidden: [] };

      const saveField = async (field, val) => {
        await form.set(field, val);
      };

      const isHidden = (label) =>
        value.global || (value.hidden || []).includes(label);

      const togglePanel = (label) => {
        const hidden = value.hidden || [];
        const next = hidden.includes(label)
          ? hidden.filter((l) => l !== label)
          : [...hidden, label];
        saveField("hidden", next);
      };

      const toggleGlobal = () => saveField("global", !value.global);

      const row = (label) =>
        h(
          "label",
          {
            key: label,
            style: {
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "5px 0",
              cursor: "pointer",
              userSelect: "none",
            },
          },
          h("input", {
            type: "checkbox",
            checked: !isHidden(label),
            onChange: () => togglePanel(label),
          }),
          h("span", { style: { fontSize: 13 } }, label),
        );

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
            checked: value.global,
            onChange: toggleGlobal,
          }),
          h("span", { style: { fontSize: 13, fontWeight: 600 } }, "一键隐藏全部管理菜单"),
        ),
        h(
          "div",
          { style: { borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 8 } },
          MANAGEABLE.map((label) => row(label)),
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
        const getHidden = () => {
          const v = form.getSnapshot().value;
          return v ?? { global: false, hidden: [] };
        };

        const applyVisibility = () => {
          const state = getHidden();
          const root = document.getElementById("root");
          if (!root) return;
          root.querySelectorAll("button[aria-label]").forEach((btn) => {
            const label = btn.getAttribute("aria-label");
            if (!label || !MANAGEABLE.includes(label)) return;
            // skip buttons outside the sidebar area (x > 260)
            if (btn.getBoundingClientRect().x > 260) return;
            btn.style.display =
              state.global || (state.hidden || []).includes(label)
                ? "none"
                : "";
          });
        };

        const target = document.getElementById("root") || document.body;
        let lastRun = 0;
        const observer = new MutationObserver(() => {
          const now = Date.now();
          if (now - lastRun < 200) return;
          lastRun = now;
          applyVisibility();
        });
        observer.observe(target, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["aria-label", "style"],
        });
        applyVisibility();

        /* re-apply when our own settings change */
        form.subscribe(() => {
          lastRun = 0;
          applyVisibility();
        });

        /* cleanup */
        ctx.effect(
          () => () => observer.disconnect(),
          "sidebar-menu-control: observer",
        );
      },
    };
  },
});
