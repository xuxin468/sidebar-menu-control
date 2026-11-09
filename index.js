/**
 * Host half: declares the settings namespace `sidebar-menu-control`
 * (entry id) with volatile fields so the client can read/write
 * panel-visibility preferences through configForms.
 *
 * Pattern mirrors @deepseek-ai/dsh-client-ui-settings-general:
 *   Config = z.object({ <field>: z.<type>().default(...).volatile() })
 *   apply  = ctx.inject(["settings"], child => child.effect(() =>
 *                     child.settings.configure({ auto: false }, ctx.fiber)))
 *
 * `auto: false` tells dsh-settings NOT to auto-generate a settings page —
 * the plugin renders its own via client.js. The ns key is the entry id
 * from cordis.patch.yml insert (`sidebar-menu-control`, kebab-case).
 */
import z from "@deepseek-ai/schemastery";

export const Config = z.object({
  global: z.boolean().default(false).volatile(),
  hidden: z.array(z.string()).default([]).volatile(),
});

export function apply(ctx) {
  ctx.inject(["settings"], (child) =>
    child.effect(() =>
      child.settings.configure({ auto: false }, ctx.fiber),
    ),
  );
}
