# React 团队整合与验收

此分支将 Zhou 的分析流程和 API 接入 Zhang 的 React 布局及中英文框架。界面使用 HashRouter，不再跳转到独立 HTML。尚未连接真实后台或模型。

## 文件归属

- Zhou：src/pages/AnalysisPage.jsx、src/workflow.js、frontend/api.js、live-api.js、http-client.js、mock-api.js。
- Zhang：src/pages/InventoryPage.jsx、ExceptionsPage.jsx、components/AppLayout.jsx、styles.css。
- 共用：src/useResource.js、components/WorkflowUI.jsx、workflow-translations.js、public/runtime-config.js。共享文件修改先协调。
- 原有 frontend/pages/review-pages.js 是独立 Demo 参考，React 页面使用 src/pages。

## 实际流程

1. 启动 React（npm ci，npm run dev），打开终端给出的 /FIX_dashboard/ 地址。
2. 库存显示 S001 的六个人工示例商品，可搜索。
3. 分析选择日期 2022-06-30，成功场景；提交一次后自动跳转 /#/analysis/任务ID。
4. 等待约 6 秒；应显示 6 条结果、265 建议单位、3 个异常；正常商品也保留。
5. 点击异常进入 /#/exceptions/案例ID；Modify 输入 120、审核人和原因，保存后刷新，仍显示 modified 和 120。
6. 返回异常队列，应限制在同一 run；可筛选待审核或已审核状态，点击全部案例解除 run 筛选。
7. 库存数量不因审核变化。P0006 只有 resolve 操作；已审核的条目无提交表单。
8. 失败场景显示失败及一条部分结果，对应审核禁用。空结果场景成功完成，显示零条结果。
9. 访问不存在的任务或案例，应显示错误和重试，不能伪造空成功。
10. 中英文切换保留当前路由；手机尺寸下表格横向滚动。

模拟状态和审核沿用 localStorage 的 fix-demo-v1。不同端口 / 域名有不同存储；GitHub Pages 不会显示本机记录。API 返回的解释和技术错误保持原文，界面标签支持中英文。

## 验证边界

node --test frontend/tests/*.test.js 检查 mock 业务与 HTTP 适配边界；npm run build 检查 React 构建。实际浏览器验收另行记录。数据库事务、并发审核、真实 worker 和模型不在这份前端验收的覆盖范围内。

## 发布

先推送整合分支，由团队审阅后合并 main；既有 Pages 工作流会构建整合后的 React 页面。不要将旧分支里的独立 HTML 当作已部署 React 页面。真实接入修改 public/runtime-config.js 后，还需要后端实现 API 合同与 CORS。

## 本次验证记录（2026-10-14）

- React 生产构建通过；公开配置文件按 /FIX_dashboard/runtime-config.js 加载。构建器提示此普通脚本不参与打包，这是保留部署时配置的预期行为。
- 9 项 mock / HTTP 测试通过。
- 浏览器验证：成功分析、任务页刷新、结果到对应案例、修改为 120 后保存及刷新、所属任务列表与 modified 筛选、中英文切换、失败任务禁止审核、成功空结果；控制台无错误。
- 检查了窄屏和桌面布局。真实服务联调仍待后端交付。
