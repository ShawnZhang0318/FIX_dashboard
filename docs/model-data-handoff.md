# v1 数据交接

原始 CSV：73,100 行、5 个门店、20 个商品、2022-01-01 至 2024-01-01。
清洗表：S001，14,620 行，20 个商品。主键均为 (store_id, product_id, date)。
原始/清洗文件直接从 Drive 导入，本次不重建数据库。

| 目标用途 | 来源 | 字段与处理 |
| --- | --- | --- |
| 每日销量历史 | data/processed/v1/s001_sales_clean_v1.csv | store_id/product_id/date/units_sold；保持真实零值，缺失拒绝 |
| 订货信号 | 同上 | units_ordered 是订货量，不是收货量 |
| 模型场景配置 | ai/artifacts/s001-global-q-v1/product_catalog_v1.csv | category/lead_time_days 为合成固定配置，绑定模型版本 |
| 库存快照 | data/raw/retail_store_inventory_data.csv | Inventory Level；清洗表没有保留，需数据同学单独映射 |
| 溯源与校验 | data/metadata/v1/ | preprocess_manifest 为原始训练记录；import_manifest 为此次下载记录 |

清洗表其他保留字段：price、discount、weather_condition、holiday_promotion、
competitor_pricing、seasonality。它们不进入当前模型；单位/含义不应扩充解释。
原始 Category/Region 随日期变化；保留为原始观测，不能覆盖模型冻结 category。
原始 Demand Forecast 仅作离线参考，不作为输入、标签或真实模型输出，保留原值。

当前推理特征只用销量、商品 ID、固定周期和日期。当天观测加此前 28 天（共 29 日期）
才能完整计算 lag_28 与 rolling。数据库可以保存全量历史，但 worker 必须按 cutoff 查询，
冻结输入引用；不要把只含 train split 的表当完整业务历史。

## 库存口径

参考 starter architecture，推荐采用原始 Inventory Level 的每日观测快照；
由数据/后端负责人确认它与日末销量的时间口径。导入时设置观测库存，不再次扣销量或
增加 Units Ordered。清洗脚本不会生成库存。若另选库存回放，必须补初始库存、到货日、
未满足销量及缺货规则，当前模型包没有实现。

## 时间切分与限制

- 训练 origin 截至 2023-04-09，标签截至 2023-04-30。
- 校准/验证标签截至 2023-08-31。
- 测试 origin 2023-09-01 至 2023-12-11；示例使用 2023-11-15。
- 类别依商品 ID 循环分配；Groceries/Toys/Clothing/Electronics/Furniture 分别对应
  3/7/10/14/21 天。属于演示假设，不是供应商真实 SLA。
- 预测的是已售数量，不保证无库存限制下的需求。异常管理仍未实现。

数据同学负责导入脚本、字段迁移、唯一键与快照；模型负责人提供数据规范及特征函数；
后端负责读取截止日数据、任务和预测持久化。不要用审核结果直接更新库存。
