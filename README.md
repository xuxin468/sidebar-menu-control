# sidebar-menu-control

DSH（DeepSeek Harness）插件：控制左侧栏中各管理面板图标的显示与隐藏。

## 功能

- 在 DSH 设置面板中提供「侧栏菜单显示」section
- **全局开关**：一键隐藏/显示所有管理面板图标
- **逐项控制**：每个面板独立 checkbox，可精细控制
- **Locale 稳定**：基于 slot ledger 的 `options.id` 作为面板标识，切换中/英文后隐藏状态不丢失
- **动态发现**：降级路径下自动发现新增侧栏菜单，无需硬编码
- **无 settings 服务时安全降级**：`configForms` 惰性注入，缺失 settings 服务不影响可见性引擎运行

## 安装

```bash
# 方式 1：junction（开发时即时生效，需重启 DSH 清模块缓存）
# 假设项目克隆到 C:\Users\xx\sidebar-menu-control
mklink /J "%USERPROFILE%\.dsh\profiles\desktop\node_modules\@local\sidebar-menu-control" "C:\Users\xx\sidebar-menu-control"

# 方式 2：npm link（需要 profile 下先 npm install）
cd C:\Users\xx\sidebar-menu-control
npm link
# 在 DSH profile 目录下
cd %USERPROFILE%\.dsh\profiles\desktop
npm link @local/sidebar-menu-control
```

安装后**重启 DSH**（渲染进程模块缓存不会热更）。

## 使用

1. 打开 DSH 设置 → 找到「侧栏菜单」section（全局开关 + 逐项 checkbox）
2. 勾选「一键隐藏全部管理菜单」→ 所有面板图标隐藏
3. 取消全局开关后，逐项 checkbox 可独立控制每个面板
4. 隐藏/显示实时生效（MutationObserver + rAF 合并）
5. 重启 DSH 后隐藏状态保持（volatile 字段 + configForms 持久化）

## 架构

### 面板标识（Identity）

```
主路径（slot ledger）:
  ctx.slots.entriesOfSlot("sidebar.panellist")
    → identityOf(entry)  # options.id 作稳定标识
    → resolveSlotLabel(options.label)  # 解析当前语言标签

降级路径（无 ledger）:
  BASE_MANAGEABLE（19 项硬编码）+ _addDiscovered（动态发现）
  → keyOf(label)  # 小写 + 去分隔符 + ALIAS 归一
```

### DOM 匹配

```
[data-slot="sidebar.panellist"] 锚点
  → 跳过 [data-dsh-panel-entry]（插件自有行）
  → anchor.closest("button")
  → 按 aria-label 建 Map
```

### 隐藏/显示

```
hideButton: _prevDisplay WeakMap 保存原 display
            → setProperty("display", "none", "important")
showButton: 还原 _prevDisplay 中的原值
            （无原值时 removeProperty("display")）
```

### 设置面板

```
configForms 惰性注入（ctx.inject(["configForms"], setupSettings)）
  → formsCtx.slots.inject("settings.section", ...)
  → 注册 SettingsSection 组件
  → form.subscribe → scheduleApply（rAF 合并）
```

## 文件结构

| 文件 | 说明 |
|------|------|
| `index.js` | 宿主侧：声明 settings namespace（`global` + `hidden`，volatile 字段） |
| `client.js` | 渲染进程侧：可见性引擎 + 设置面板 UI（~540 行） |
| `cordis.patch.yml` | 插件注册：`insert: sidebar-menu-control` |
| `.selftest.mjs` | 自测：覆盖 `identityOf`/`keysOf`/`readHidden`/`collectRows`/`manageablePanels`（39 项断言） |
| `package.json` | 包元信息 + DSH 插件配置（`dsh.client.platform: web`） |
| `icon.svg` | 插件图标 |

## 自测

```bash
D:\nodejs\node.exe .selftest.mjs
# 39 passed, 0 failed
```

## 已知限制

- 需要 DSH 宿主支持 `ctx.slots.entriesOfSlot`（slot ledger API）；不支持时自动降级
- 降级路径的 `BASE_MANAGEABLE` 是硬编码列表，新增面板依赖动态发现（rAF 合并通知）
- `@deepseek-ai/dsh-client-ui-slots` 不在磁盘（asar 内，bundler 解析），guarded require 失败时降级
- 修改代码后需重启 DSH（渲染进程模块缓存不热更）

## 开发

- 代码位置：`C:\Users\xx\sidebar-menu-control\`
- GitHub：https://github.com/xuxin468/sidebar-menu-control
- Node：`D:\nodejs\node.exe`
- DSH Web GUI：`http://127.0.0.1:58264`（ego 浏览器可直接访问）

### 参考实现

- task-board：`C:\Users\xx\.dsh\profiles\desktop\node_modules\@linxin666\dsh-client-ui-task-board\lib\client.js:11698-11820`（`findPanelRow`、`createScheduleRowGuard`、`subscribeBodyInvalidations`）
- 契约文档：同目录 `lib\types\client\suppress-schedule-row.d.ts`

## 版本历史

| 版本 | 变更 |
|------|------|
| 1.0.0 | 初始版本：全局开关 + 逐项 checkbox + volatile 持久化 |
| — | 动态发现：`_addDiscovered`（rAF 合并通知） |
| — | Locale 稳定 key + observer 节流 + 全局/逐项冲突处理 |
| — | 侧栏 scope 限制为无歧义选择器 |
| — | **slot-ledger 架构**：`identityOf`/`keysOf`/`readHidden`/`collectRows`/`manageablePanels`；`configForms` 惰性注入；自测重写（39 项） |

## License

MIT
