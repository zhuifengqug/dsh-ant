# 虫珀·玄驹 Client 轨道罗盘页面设计

状态：设计稿，已获用户批准写入；未实现、未安装、未作为运行时证明。

本稿把已提交的 [轨道罗盘 HTML 视觉基线](../../ant-preview.html) 映射到真实 DSH Client 页面。它遵守已复审的 [Host 状态层与类型化动作契约](ant-host-contract.md)、[T1 架构基线](ant-baseline.md)、[GLOSSARY](../../GLOSSARY.md) 与 [Team WAL ADR](../adr/0001-team-wal-as-canonical-owner.md)。独立 HTML 只提供视觉和交互参考，不构成插件完成证据。

## 1. 目标与非目标

目标是交付一个可从 Harness 主面板打开的 Team 页面设计边界，保留轨道罗盘的盘心、同心环、成员节点、任务 DAG 和检查台语义，同时把数据、动作、错误和权限接入真实 Host Remote。

首版页面必须支持：

- 从独立 `main` keyed slot 打开团队主面板，并从专属 `sidebar.panellist` 入口进入；
- 读取团队列表、选择团队、读取团队详情，显示事实游标和生命周期；
- 在选中任务后显示负责人、attempt、模型路由、依赖、质量门与回执状态；
- 通过唯一 `remote.team.dispatch(request)` 执行允许的人工动作；
- 在动作回执后按游标重新读取 TeamView，并展示 committed、duplicate、stale、lease-conflict、rebuild-required、persistence-failed 与 not-found 等结果；
- 在浅色/深色主题和窄屏布局下保持可读、可操作、可恢复。

非目标：本稿不实现 Host WAL、writer lease、TeamView fold、Typert 生成产物、Client bundle、成员 Session 调度、`team/changed` 事件源或 Agent loop；不读取团队目录，不折叠 Team WAL，不改写 DOM，不使用 iframe，也不覆盖已占用的 `main` key `conversation`。

## 2. 真实运行时边界

### 2.1 Slot 注册

Client bundle 通过 `window.__ModuleLoader__.load({ id: packageName, factory })` 注册懒加载 factory。资源注册在 Client entry 的 `apply(ctx)` 中完成，并由 `ctx.effect`、`ctx.on` 和 slot disposer 管理。

主面板注册到 `main` keyed slot，使用自有 key `ant`；`conversation` 已被占用，不能复用。侧栏注册到 `sidebar.panellist` list slot，使用自有 id `ant`、稳定 label 与显式 order。侧栏点击由宿主选择对应 main key，页面本身不操作导航 DOM。

当前 live inspection 的事实是：`main` registration 必须提供 `key: string`，root owner props 为空，`conversation` 的替换风险为 `shadows-shipped-ui`；`sidebar.panellist` 必须提供 `id: string`，`order` 可选、`label` 可为字符串或随 locale 重读的 thunk，fresh id 的替换风险为 `none`。实现前若宿主 slot registration options 发生变化，必须重新 inspection，不以本稿缓存替代现场契约。

### 2.2 Remote 与读事实

静态 Client 不使用动态 Host/Client package 的 `host.call`/`harness.handle`。Client manifest 注入 `remote` 与 `remote.team`，页面只调用 Typert generated Remote：

```ts
remote.team.list({ includeArchived, cursor, limit })
remote.team.get({ teamId, atLeastEventSeq })
remote.team.dispatch(request)
```

首版只依赖 `team/list`、`team/get`、`team/dispatch`。`team/changed` 仍是后续失效通知面；页面首屏加载、切换团队、动作回执和手动刷新都重新调用 `get/list`，不把通知丢失当作数据丢失。页面显示的 cursor、lifecycle、members、tasks、attempts、mailbox、archiveState 必须来自 #9 产出的共享 `TeamView` DTO 与生成 schema；#3 不自行定义或猜测 Host 返回字段。

#2 只冻结了 Remote 方法和查询游标，不足以支撑页面编译的完整 TeamView DTO。#9 实现时必须为 `team/get` 和 `team/list` 补齐可生成的只读 schema，至少覆盖页面实际读取的稳定字段，并通过同一 `./typert`/`./remote` 产物交付；若字段未进入 schema，页面显示对应的 `unknown`/占位状态，而不是从 Session 或团队目录旁路读取。

## 3. 轨道罗盘页面结构

### 3.1 布局骨架

页面使用全宽工作区和三个可伸缩区域，不嵌套卡片：

```text
┌──────────────────────────────────────────────────────────────────┐
│ 团队选择、生命周期、事实游标、刷新、归档状态                     │
├───────────────┬──────────────────────────────┬───────────────────┤
│ 团队/成员索引   │ 轨道罗盘 + 任务 DAG           │ 任务检查台        │
│ list/get 状态   │ 环/成员节点/任务节点/连线     │ dispatch + receipt │
└───────────────┴──────────────────────────────┴───────────────────┘
```

左侧列出 `TeamView.members` 的成员路由标签和当前状态；中央画布保留 outer/middle/inner 三层环；右侧检查台只显示当前选中任务和当前调用上下文允许的控件。页面标题、团队目标、生命周期和 cursor 放在工作区头部，不放进装饰卡片。

### 3.2 轨道层映射

轨道罗盘是信息位置编码，不是新的事实模型：

- 内环：成员/会话节点。每个节点显示稳定 `memberId` 的短标签、role、sessionMode、provider/model 和 active/requested/unavailable 状态。蚁后节点使用品牌强调 token，其他成员按状态 token 表示可用、空闲、暂停或异常。
- 中环：attempt 节点。每个 attempt 显示 `attemptId` 的短尾、所属 task、generation、running/paused/failed/completed/needs_attention 状态；失败 attempt 不从图上删除。
- 外环：task 节点。每个任务显示 `taskId`、title、ownerMemberId、ready/running/blocked/done/needs_attention 状态和质量门摘要；依赖未满足的节点仍可定位但不可派发。
- 连线：任务依赖用 SVG path 或等价 React 图形元素表示，方向从 `blockedByTaskId` 指向被阻塞任务；进行中的链路使用品牌强调 token，已完成链路使用成功状态 token，未完成普通链路使用边框/次级文本 token。连线只是 `TeamView` 的派生展示，不能由 Client 修改。
- 轨道标签：内环“成员”、中环“attempt”、外环“任务”；标签和节点必须有文本等价物，色彩不承担唯一语义。

画布采用数据驱动的极坐标布局：成员数、attempt 数和任务数由 `TeamView` 决定，节点位置由稳定排序（成员按 `memberId`、attempt 按 generation/eventSeq、任务按 DAG 拓扑序和 `taskId`）计算；同一视图游标下布局稳定。超过画布容量时分层滚动或折叠并给出计数，不覆盖节点，不以固定七节点假设裁剪数据。页面在窄屏将环形画布放在检查台之前，索引与检查台改为纵向区块；键盘焦点顺序仍按团队选择→索引→画布节点→检查台动作。

### 3.3 检查台

检查台按“事实→动作→回执”分层：

- 事实区：选中 team/task/member/attempt、owner、模型、依赖、质量门、当前 eventSeq 与生命周期；只读字段不渲染为可编辑输入。
- 动作区：根据可信访问结果和用户动作矩阵显示 `plan.confirm`、attempt 派发/暂停/恢复/接管/终止/重试、成员邀请/移除/换模型、归档/恢复/删除。agent 提案和质量报告可显示为待人工处理项，但页面不把它们自动升级为用户确认。
- 回执区：展示 requestId、outcome、eventSeq、eventIds、viewState；duplicate 与 committed 分开显示；失败显示稳定 error code、retryable、details 和“刷新事实”动作。

动作按钮不能靠本地 state 直接把任务改成 running/done。点击后先生成稳定 requestId，调用 `remote.team.dispatch`；收到回执后按 `lastEventSeq` 调 `team/get`，再用新 TeamView 重绘。`team/stale-cursor` 触发重新读取并保留用户刚才动作的可重试信息；`team/lease-conflict`、`team/lease-lost` 显示 Host 写入占用/租约失效；`team/rebuild-required` 显示已提交事实等待读面重建，允许刷新；`team/persistence-failed` 不显示成功；`team/not-found` 清空选中详情并刷新列表。

## 4. 状态、交互与恢复

页面状态机按数据请求分层，避免一个全局 loading 覆盖已有事实：

| 状态 | 页面表现 | 可操作恢复 |
|---|---|---|
| 初次 loading | 保留布局骨架，显示团队列表/画布/检查台占位 | 等待请求完成 |
| list empty | 显示绑定 workspace 下暂无团队 | 刷新；进入创建流程由后续 Host action 提供 |
| team selected loading | 保留上一游标摘要，详情区标注读取中 | 切换团队或刷新 |
| ready | 显示 TeamView、cursor 与可用动作 | 选择节点、执行动作、刷新 |
| stale cursor | 保留动作输入，提示事实已前进 | 重新读取后按新 cursor 重试 |
| lease conflict/lost | 保留只读事实，停止写按钮或标注租约失效 | 刷新；等待 Host 恢复后重试 |
| rebuild-required | 显示 committed receipt 与读面重建提示 | 刷新/重试读取，不重复提交同一动作 |
| persistence-failed | 显示失败 reason 与 retryable | 按回执指示重试或刷新，不假装成功 |
| not-found | 从详情清除已删除/不存在团队 | 刷新列表 |
| unavailable/network | 保留最后已知 TeamView 并显示连接错误 | 手动刷新，返回侧栏或重连 |

首版不注册 `team/changed` listener；使用显式刷新按钮、动作回执后的 get/list 和页面重新进入作为更新触发。后续若注册事件源，事件只携带 `teamId`、新 cursor 和失效原因，收到后按 teamId 调 get，事件本身不替代 TeamView。

## 5. 主题、locale 与无障碍

样式只引用现场 Theme token：`--dsw-alias-bg-base`、`--dsw-alias-bg-layer-1`、`--dsw-alias-bg-layer-2`、`--dsw-alias-border-l1`、`--dsw-alias-border-l2`、`--dsw-alias-brand-primary`、`--dsw-alias-label-primary`、`--dsw-alias-label-secondary`、`--dsw-alias-state-error-primary`、`--dsw-alias-state-idle-primary`、`--dsw-alias-state-success-primary`、`--dsw-alias-state-warn-primary`、`--dsw-specific-sidebar-fill`。所有容器和控件跟随 Host light/dark；轨道装饰可保留少量品牌色，但状态不能只靠色彩。

所有可见文字走 Client locale service；侧栏 `label` 使用字符串或 locale thunk。页面为单一 `main` landmark，团队选择使用 `label`/`select` 或等价 combobox，任务节点使用可聚焦按钮并提供 `aria-label`、状态和依赖摘要，SVG 连线 `aria-hidden`，同一依赖关系在任务列表文本中呈现。选中节点使用 `aria-current` 或 `aria-pressed`，动作按钮在请求中禁用并说明进行中，错误区用 `role="alert"`，成功/重复回执用 `role="status"`。键盘可完成团队选择、列表导航、节点选择、动作触发、刷新与返回侧栏；焦点不会因 get/list 重绘丢失到页面顶部。

## 6. 可拆分实现边界

实现按以下边界拆分，避免 Client 重新实现 Host 责任：

1. Client bundle/slot：模块加载、`main` 自有 key、`sidebar.panellist` 自有 id、disposer、locale 注册和 token 样式。
2. Remote adapter：只封装 `remote.team.get/list/dispatch`、请求超时/取消和稳定错误映射；不缓存成第二事实源。
3. View model：把共享 `TeamView` DTO 映射为轨道布局、DAG 连接、检查台只读模型；未知字段保持 unknown。
4. Interaction state：维护选中节点、请求中 requestId、最后成功 cursor、错误与回执；动作成功后以 Host 返回 cursor 重新读取。
5. Accessibility/responsive：节点键盘导航、文本等价、窄屏纵向布局、主题切换和 focus restoration。
6. Test surface：静态 manifest/exports/namespace、Remote schema、slot registration、light/dark tokens、loading/error/retry/stale/lease/rebuild/delete 状态、动作后 get/list 顺序。

#3 不冻结 #9 的 Host 实现细节。#9 必须实现并证明：TeamView 读模型字段、Remote 生成 schema、事件/游标语义、权限与动作回执；Client 只消费生成类型和稳定 error code。

## 7. 验收矩阵

| 验收面 | 必须观测 |
|---|---|
| Slot | `main` 自有 key `ant` 与 `sidebar.panellist` 自有 id 同时注册；不覆盖 `conversation`；卸载后注册与样式 disposer 清理 |
| Remote | Client 调用 Typert `remote.team.get/list/dispatch`；不出现动态 `host.call`；请求字段符合 #2 schema；错误保留稳定 code |
| Visual | 轨道罗盘包含成员/attempt/任务三层、依赖方向、状态文本和计数；节点不重叠；窄屏纵向堆叠；浅色/深色可读 |
| Interaction | 任务选择、检查台、用户动作按钮和模型路由展示；按钮调用 dispatch，不改本地事实；回执后按游标 get/list |
| Recovery | loading、empty、unavailable、stale-cursor、lease-conflict/lost、rebuild-required、persistence-failed、not-found 均有可见状态和恢复动作 |
| Accessibility | landmark、labels、focus、键盘路径、ARIA 状态/alert/status、色彩之外的状态文本均可检查 |
| Boundary | 页面不读团队目录、不折叠 WAL、不操作 DOM/iframe、不把 HTML 预览当插件完成证据；#9 的 TeamView schema 未冻结前页面不自行臆造字段 |

## 8. 依据与未决边界

实时 Client inspection 已确认：

- `main` 为 root keyed slot，`key` 必填；已占用 `conversation` 的替换风险为 `shadows-shipped-ui`，自有 key 可承载独立主面板；
- `sidebar.panellist` 为 root list slot，`id` 必填，`order` 可选，独立新 id 的替换风险为 `none`，owner props 为 `{ size, active }`；
- Builtin 的 `host.call` 属于动态 Host/Client package bridge，静态 bundle 使用 Typert generated Remote；
- Theme tokens 与 light/dark 要求来自实时 `Theme.listTokens`；
- Client `layout`、`locale`、`slots`、`theme`、`sessions`、`uiWorkspace`、`workspaces` 的 catalog 已读回，页面只使用实现阶段重新 inspection 后的实际签名；
- Client Event catalog 当前含 `connection/reset`、`locale/change`、`slots/changed`、`theme/change`，没有把未存在的玄驹事件写成当前能力。

本设计稿的真实依据还包括 [Host 契约](ant-host-contract.md)、[T1 基线](ant-baseline.md)、[GLOSSARY](../../GLOSSARY.md)、[Team WAL ADR](../adr/0001-team-wal-as-canonical-owner.md) 和已提交的 [HTML 视觉基线](../../ant-preview.html)。实现前重新检查这些 live API 与安装 profile；若 slot props、Typert exports 或 TeamView schema 与本稿不一致，以新鲜 inspection 和 #2/#9 已批准契约为准，并记录差异。

本稿是 #3 设计输入，不是 Client 实现、安装或运行时完成证明。
