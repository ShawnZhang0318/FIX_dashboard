# 本周 Demo：团队接入与交接

**2026-10-20 更新：** 下面保留早期独立 HTML Demo 的交接记录。当前 React 主项目以 [W04 数据流核对与接口传输](data-flow-audit-zh.md) 和 [前端接口合同](frontend-api-contract.md) 为准，已补齐快照端点、门店过滤、Run/Job 和组合异常。React 配置在 `public/runtime-config.js`，页面在 `src/pages/`；不要按早期记录恢复普通 script 标签或只确认旧的七个端点。

2026-10-21 main 版已接入真实模型、独立 worker、公共 API 和本地 SQLite；正式 PostgreSQL 与服务器部署仍待团队接入。具体运行和替换边界见[本地联调说明](local-integration-zh.md)。下文保留团队分工和接口建议，不代表其他同学已接受新增分工。原有 `/cases`、`/jobs` 属于通用 starter，不能直接当成库存分析接口。

## 谁改哪些文件

| 成员 / 角色 | 本周交付 | 主要文件 / 边界 |
| --- | --- | --- |
| Zhou Guanxu | 分析触发、状态轮询、预测结果、公共 API、联调协调 | `frontend/app.js`、`api.js`、`live-api.js`、`http-client.js`、接口文档与测试 |
| Zhang Yitong | 库存、异常列表、详情、审核、整体布局 | `frontend/pages/review-pages.js`、`styles.css`、`index.html`；保留 runtime-config 和 app 两个 script 标签及页面挂载节点 |
| Shah Pooja Zenit | 按既有数据分工提供导入、快照、字段映射和迁移交付 | 向后端提供 store/product/date 键、库存快照及历史销量；不在前端直接读取 CSV |
| Cao Jun | 按既有模型分工提供预测函数 / 服务及样例 | 向 worker 提供有版本号的模型输出；模型密钥和推理调用不进入浏览器 |
| 后端 / worker 负责人（团队待指定） | 创建任务、持久化结果与异常、状态更新、审核事务及 CORS | 实现 `frontend-api-contract.md` 中的零售接口；Zhou 负责协调，不默认独自承担这部分 |

Zhang 的页面通过 `createReviewPages(context)` 接收同一个 api、导航和显示工具，导出 `inventoryPage(token)`、`exceptionsPage(params, token)`。异步请求返回后先检查 `isActive(token)`，避免切页后覆盖新页面。页面不要直接 fetch、读 localStorage，或另建一份异常数据。详情链接保留 `run`、`case`，列表保留 `status`；它们让两人的页面能互相跳转、刷新恢复。新增全局节点或路由先同步给 Zhou。

## 接入顺序与验收

1. **今天先确认合同和负责人。** 后端负责人确认七个接口、状态枚举、错误码；Cao 确认 quantile 或 point_buffer；Pooja 确认门店、日期、库存快照含义。字段变化集中适配在 `live-api.js`，不要分散修改页面。
2. **两位前端先并行开发。** Zhou 改分析模块，Zhang 改独立 review 模块与布局。运行 mock 成功 / 失败 / 空结果各一次；审核刷新后仍存在，审批不改变库存。样式和 index 属于共享入口，Zhou 若要改应先协调。
3. **接库存读取。** 后端先提供真实 `GET /inventory?store_id=S001`。Pooja 提供至少一份有明确日期的 S001 快照；对照数据库验证行数、商品 ID 和库存数量，缺失值不能默认为 0。
4. **接创建、查询和结果。** POST 返回 202 和持久化 run/job ID；worker 将 queued → processing → completed/failed 写入数据库。刷新页面使用同一 run ID，不能重新提交任务。结果包括正常商品，不只异常。
5. **接异常与审核。** 由后端根据同一批持久化结果生成异常，并提供 run 过滤。POST 审核与状态更新必须在服务端事务中完成：两人审核同一条只允许一次成功，另一次 409；失败 / 不完整任务禁止审核。数量验证与推荐数量取值由服务端执行。
6. **最后统一验收。** 使用同一 store/date/run 走“库存 → 分析 → 结果 → 异常 → 审核 → 刷新”；重启后端后仍可查记录。再验失败部分结果、成功空结果、404、422、409、断网及超时。网络失败不等于 worker 失败，写入超时先查询，禁止盲目重试。

## 数据和模型交接细节

数据表的业务键使用 `(store_id, product_id, date)`；库存是快照，不能用审核或建议补货直接改库存。CSV 中类别 / 地区随日期变化，不能未经确认固化为商品 / 门店主属性。只使用截止日及以前的历史，不能把 CSV 的 Demand Forecast 列当成已经训练好的模型输出。

建议 worker 对单个商品向模型传入：store_id、product_id、as_of_date、horizon_days，以及不晚于截止日的日期 / 销量历史。接口的最终代码形式由模型和后端同学共同确定。模型返回同一预测窗口的需求总量，不能把每天预测值与 lead-time 总量混用。

| 输出模式 | 需要交付的字段 | 后端补货规则（本周建议，需确认） |
| --- | --- | --- |
| quantile | predicted_demand_p50、predicted_demand_p90、model_version | safety_stock = P90 − P50；order = max(0, ceil(P90 − snapshot_stock)) |
| point_buffer | predicted_demand_point、uncertainty_buffer、model_version | safety_stock = buffer；order = max(0, ceil(point + buffer − snapshot_stock)) |

所有数值必须有限、非负，P90 ≥ P50；horizon_days 为正整数。后端验证并补充 policy_version、input_reference、analysis_run_id、case_id。前端只展示持久化结果，不自行训练模型或重算业务规则。buffer / lead time 来源需明确标注假设，不要包装成 CSV 原始字段。

## 切换真实接口

修改 `frontend/runtime-config.js`：

```js
globalThis.FIX_CONFIG = {
  mode: 'live',
  apiBaseUrl: 'http://localhost:8000',
  pollMs: 1500,
  timeoutMs: 10000
};
```

同源代理可使用 `/api` 前缀。这里是公开配置，不放密码或模型密钥。live 下隐藏模拟场景和重置按钮，不会在接口失败时悄悄回退到模拟数据。mock 与 live 应整体切换；本版没有按页面混用数据源，避免模拟 run ID 进入真实审核接口。后端尚未完整实现时，继续 mock 开发页面，分别验收真实端点。

CORS 允许实际页面 origin，例如 `http://127.0.0.1:5173`（与 localhost 不同），允许 GET / POST / OPTIONS、Content-Type；若团队增加登录，需要另行确定会话、授权和 CSRF 方案。本 Demo 不声称具备登录鉴权。

## 提交与证据

各自在分支提交自己负责文件，避免整体覆盖 frontend 目录。合并前从仓库根目录运行 `node --test frontend/tests/*.test.js`，再各走一遍浏览器流程。测试覆盖 mock 业务行为和 HTTP 适配边界；通过不代表真实数据库 / worker / 模型已经验收。

每次交接记录：接口版本或提交号、环境地址、store/date/run ID、model_version、成功 / 失败截图、尚未通过项。真实接入完成前，演示明确写“模拟接口”。

## FIX_dashboard 仓库说明

React 合并分支已让 src/pages 页面共用 frontend/ 的 API 适配器，部署时发布整合后的 React 页面。frontend/ 独立 HTML 留作参考；React 配置位于 public/runtime-config.js。新的文件归属与验收见 react-integration.md。本文提到的 Python starter 位于原 injuredkitten/MAIE6000C1 仓库，不随本次上传复制。
