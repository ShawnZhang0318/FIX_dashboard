# AI model / worker 合同 v1

参考 maie6000c-starter-CadenJ 的 FastAPI、Pydantic 与 worker HTTP 模式。
原 starter `/triage` 接口是文本分类，不能直接替代本接口；其数据库、任务代码未复制。

## 请求

私有 `POST /analyze`，见 `ai/examples/example_analyze_request.json`。

| 字段 | 约束 |
| --- | --- |
| store_id | 仅 S001 |
| product_id | P0001–P0020 且属于模型 manifest |
| as_of_date | ISO 日历日期；当天销量已经完整入库 |
| lead_time_days | 正整数，必须等于该商品冻结周期 |
| feature_schema_version | features-v1 |
| input_reference | 非空；worker 应提供可追溯的数据快照版本/引用 |
| features | 当天销量、lag_1/7/14/28、rolling_mean_7/28、rolling_std_28；有限非负数 |

额外字段拒绝，尤其不能传入未来标签、Demand Forecast 或库存作为预测特征。
月份、星期由服务根据 as_of_date 计算；星期一为 0。商品编码使用 manifest 的完整
categorical 顺序。rolling 不包括当天，标准差 ddof=1。

worker 推荐先调用 `ai.features.build_request`，输入单门店单商品的原始历史。
该函数拒绝混合身份、窗口内重复/缺失日期、无效销量；截止日后记录不参与特征。
预计算特征接口无法证明调用方是否泄漏未来信息，数据截止日责任仍在 worker。

## 响应

返回 store_id、product_id、as_of_date、horizon_days、forecast_mode=quantile、
predicted_demand_p50、predicted_demand_p90、model_version、feature_schema_version、input_reference。
`horizon_days = lead_time_days`，输出为 t+1 至 t+L 的总量，不能再次乘周期。

校准与 Notebook 一致：

```text
p50 = max(0, raw_p50)
p90 = max(p50, max(0, raw_p90) + correction_by_lead_time_days[L])
```

`example_analyze_response.json` 的预测数值来自已有 Notebook 输出，其他字段按本合同整理；
没有在本次重新计算。它不代表完整前端 ForecastResult。

## 错误与运行

- 422：请求校验失败、周期与商品不一致；当前实现也将无效模型数值作为 422 返回。
- 503：服务未加载模型。
- 500：其他推理内部失败；不返回虚构结果或自动退回 mock。
- 启动加载失败：进程启动失败，由部署健康检查发现。

worker 应设置请求超时，检查响应身份、窗口、model_version 和有限数值，再持久化。
失败应记录任务失败；HTTP 重试、任务幂等和部分结果策略由后端确定。
日期早于 2023-09-01 的结果不能作为该已训练/校准模型的诚实样本外回测；
服务不禁止历史诊断调用，worker/报告必须区分诊断与正式回测。

## 与前端的边界

worker 另补 analysis_run_id、result id、inventory_at_prediction、policy_version、
safety_stock、recommended_order_quantity、explanation、anomaly_type 和 case_id。
按现有团队建议，safety_stock=P90-P50，补货=max(0, ceil(P90-snapshot_stock))；
规则仍由后端负责人确认并版本化。预测服务不产生异常标签或修改库存。
现有 `frontend/live-api.js` 应继续调用公共零售 API，不直接调用私有模型端点。
