继续开发 DSH 侧栏菜单显示控制插件（@local/sidebar-menu-control，1.0.0）。

【项目背景】
- 代码位置：C:\Users\xx\sidebar-menu-control\
- GitHub：https://github.com/xuxin468/sidebar-menu-control（remote 已无 token）
- 插件已安装（junction：C:\Users\xx\.dsh\profiles\desktop\node_modules\@local\sidebar-menu-control → 项目目录），改代码即时生效，但重启 DSH 才能清渲染进程模块缓存
- Node：D:\nodejs\node.exe
- DSH Web GUI：http://127.0.0.1:58264（ego 浏览器可直接访问，有登录态；普通浏览器 401）

【当前状态（2026-11-10 20:49 已核实）】
- git：4b51e5e（未推送）→ afd6ede（已推送）→ 线上 5a1a5c5；client.js 有未提交改动（22638 字节，17:36 重写版）
- 磁盘上的 client.js 已是全新架构（slot-ledger 方案，约 540 行，node --check 通过）：
  - 主路径：ctx.slots.entriesOfSlot("sidebar.panellist") 读 ledger → identityOf(entry) 用 options.id 作稳定标识 → resolveSlotLabel(options.label) 解析当前语言标签（guarded require @deepseek-ai/dsh-client-ui-slots，失败降级）
  - DOM 匹配：[data-slot="sidebar.panellist"] 锚点 → 跳过 [data-dsh-panel-entry] → anchor.closest("button") → 按 aria-label 建 Map
  - 隐藏：_prevDisplay WeakMap 保存原 display，setProperty("display","none","important") 隐藏，还原恢复
  - 降级路径：ledger 为空时回退 querySelectorAll("button[aria-label]") + BASE_MANAGEABLE 19 项硬编码 + _addDiscovered 动态发现（rAF 合并通知）
  - configForms 已改为 ctx.inject(["configForms"], setupSettings) 惰性注入（不在顶层 inject，防止 settings 服务缺失时整个 client half 加载失败）
- .selftest.mjs（5270 字节，16:42）仍是旧版测试，引用已不存在的函数（stableKey、_labelMap、_allLabels、hiddenKeys）——跑必挂
- index.js（28 行）未动，.volatile() 保留正确（三个独立插件注释证实其是 configForms 服务字段的必要条件，勿去掉）
- DSH 渲染进程当前仍服务陈旧 rev be27a68749d6，日志 407 条 "MANAGEABLE is not defined"——插件实际不工作，只有重启 DSH 能修复
- cordis.patch.yml 已配 global: false + hidden: 12 个 legacy raw labels（新架构的 readHidden 会自动迁移为 ledger id）

【按顺序执行】
1. 重写自测：更新 .selftest.mjs 覆盖新函数——identityOf、keysOf、readHidden（含 legacy 迁移）、collectRows（stub DOM）、manageablePanels（stub ctx.slots）。运行 D:\nodejs\node.exe .selftest.mjs，全绿后再 commit。
2. 提交推送：git add client.js .selftest.mjs && git commit。推送前必须在同一 pwsh 命令内先置空代理：$env:HTTP_PROXY=$env:HTTPS_PROXY=$env:ALL_PROXY=$env:http_proxy=$env:https_proxy=""（Clash 未运行占 7890 会失败）。若凭据管理器不给凭据，用 MEMORY.md 里的 ghp_ classic token（有 repo scope）临时拼进 remote URL，推完立即恢复无 token 的 remote。
3. 重启 DSH 验证（需要用户配合或授权后自行重启）：确认设置面板出现「侧栏菜单」section（全局开关 + 逐项 checkbox）、隐藏/显示实时生效、"MANAGEABLE is not defined" 不再新增。
4. 边界测试：
   - ① 重启后动态发现功能（降级路径）：新增侧栏菜单 → 设置面板自动出现对应 checkbox
   - ② locale 切换（中/英文）：已隐藏项在切换语言后仍隐藏（ledger id 稳定，不应丢）
   - ③ hidden 列表持久化：重启 DSH 后隐藏状态保持
   - ④ 全局开关与逐项冲突：全局开时逐项 checkbox 应 disabled（当前实现如此）
5. 有问题先看：client.js 的 applyVisibility（主路径 + 降级分叉点）和 collectRows；ledger 主路径依赖宿主 slot 锚点 [data-slot="sidebar.panellist"]，若实际 DOM 无此锚点会静默落入降级路径——用 ego 浏览器或 DevTools 确认真实 DOM 结构再下结论。

【关键参考（已验证，勿重复推导）】
- task-board 参考实现：C:\Users\xx\.dsh\profiles\desktop\node_modules\@linxin666\dsh-client-ui-task-board\lib\client.js:11698-11820（findPanelRow、createScheduleRowGuard、subscribeBodyInvalidations），契约文档同目录 lib\types\client\suppress-schedule-row.d.ts
- @deepseek-ai/dsh-client-ui-slots 不在磁盘（asar 内，bundler 解析），task-board 同样 require 且工作正常，所以 guarded require 可行
- configForms 快照形状：{status:'loading'|'ready'|'unavailable', value, base, user, revision, writable}；.volatile() 是引用类型（.get() 读取），不是持久化标志
- 注意：第 3 步重启 DSH 前，所有会话会中断——建议先完成第 1、2 步再重启
