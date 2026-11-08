# 派工要叫醒成员：attempt.dispatch 的宿主侧闭环（2026-11-08）

## 结论

WAL 里 `attempt.dispatch` 提交之后，原来没有任何东西去通知被派工的成员会话——调度器把活派了，没人被叫醒。同一次实测还暴露两件事：放行工具对任何在职成员开放；`gateStatus` 里有一个未定义的 `single`。三处都已修，并在隔离工作区把「建队 → 认计划 → 调度 → 完成 → 审查 → 放行」整条链跑通。

## 缺口证据（修前）

用同一套模块（`AntService` + `createAntTools` 的同一批 tool 对象）在临时工作区跑完整链路，两轮 `attempt.dispatch` 都提交成功、attempt 状态为 `running`，但注入的 `sessionController.prompt` 调用次数为 **0**。

根因在 `src/host/service.mjs` 的 `dispatchThroughService`：只有 `mail.send` 会交给 `MailDeliveryService.schedule` 去唤醒会话，`attempt.dispatch` 只写 WAL 就返回。

## 修法

1. **派工唤醒**（`src/host/service.mjs`）：新增 `deliverWork({ teamId, assignments })`，按 `(taskId, memberId)` 取该 attempt 与任务，经 `SessionAdapter.prompt` 把任务简报投给成员会话，请求形态与邮件一致：`{ requestId: 'work-<teamId>-<attemptId>', sessionId, mode: 'queue', content: [{ type: 'text', text }] }`。简报含目标、范围、验收、验证命令、质量门、attemptId、回报方式，并附成员的 `executionPrompt`（若声明）。
2. **投递失败不装死**：`prompt` 被拒（`accepted !== true`）时以 system 身份写 `attempt.pause`，把 attempt 落到 `paused`，下一轮 tick 的 `wake` 再恢复重投，不留下「running 但没人干」的僵尸 attempt。
3. **唤醒闭环**（`src/core/scheduler.mjs` 的 `runSchedule`）：`evaluateSchedule` 一直算 `wake` 但没人消费。现在 tick 末尾对 `paused` 的驻留成员发 `attempt.resume`，把恢复项与本次派发项合并成 `assignments` 交给 `deliverWork`，并在返回体里多带 `resumed` / `prompted` 两个键（无内容时不出现）。
4. **放行只归领队**：`team.created` 现在把 `payload.leadMemberId` 记进视图（`src/core/fold.mjs`，仅在该字段存在时写入，避免 `undefined` 进 `canonical.encode`）；`releaseAsAgent` 要求调用者正是该领队，否则 `team/forbidden` `Release is reserved to the colony lead`。owner 通过 `/ant` 的放行路径不受影响。
5. **门判定修复**（`src/core/gate.mjs`）：`gateStatus` 里 `single` 未定义，只有「审查没写 gateId」这条分支才会踩到——写 gateId 的用例全躲过了。现在 `single = 该任务声明的 review 门恰好一个`，未署名的 pass 只在此时算满足。

## 实测链路（临时工作区，stub sessionController）

| 步骤 | 谁 | 结果 |
| --- | --- | --- |
| `team.create`（payload 带 `leadMemberId: 'queen'`） | agent（蚁后会话） | committed，seq 1，lifecycle `staged`，领队 sessionId 自动绑定 |
| `plan.confirm` | owner | committed，seq 2 |
| `ant_team_schedule` | 蚁后会话 | 派 spec 给 worker-1（seq 3），`prompted[0].delivered = true` |
| `task.complete`（证据覆盖 verify） | worker-1 会话 | committed，seq 4 |
| `quality.review`（`gateId: 'spec-review'`） | 蚁后（未持过该 attempt） | committed，seq 5，`releaseQueue = ['spec']` |
| `ant_team_release(['spec'])` | 蚁后 | committed，seq 6；tick 随即派 core（seq 7，同样唤醒 worker-1） |
| `task.complete`（`locator: 'node --test'`） | worker-1 会话 | committed，seq 8 |
| `quality.review`（`gateId: 'core-review'`） | 蚁后 | committed，seq 9 |
| `ant_team_release(['core'])` | 蚁后 | committed，seq 10；`integrationQueue` 只剩 `ship-integration` |
| `ant_team_release` | worker-1 | `team/forbidden` `Release is reserved to the colony lead` |
| `ant_team_release` | 名册外会话 | `team/forbidden` `Calling agent is not an active Team member` |

最终视图：两个任务 `released`，两个批次 `batch-6` / `batch-10`，两条 pass 审查带 gateId，两条派工简报投递成功。

## 边界与未做

- 唤醒只做 `mode: 'queue'` 的入队投递，不抢占成员正在跑的轮次；重新投递靠 tick 的 `wake`，没有指数退避。
- `taken-over` 的 attempt 不自动恢复——接管是显式动作，恢复也要显式。
- 真实 Host 上（活插件）尚未验证：本会话里的插件是重启前加载的旧代码，`ant_team_dispatch` 对 `team.create` 仍返回 `Agent dispatch requires a teamId`。要看到上面这条链在活插件里跑，需要重启 Host。
- 简报文本是中文硬编码，未进 `locale/`；等界面文案统一时再抽。
