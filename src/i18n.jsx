import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {workflowTranslations} from './workflow-translations.js';

const LanguageContext = createContext(null);

const translations = {
  'zh-CN': {
    'Primary navigation': '主导航',
    'Inventory': '库存',
    'Analysis': '分析',
    'Exceptions': '异常处理',
    'Workspace': '工作区',
    'Inventory workspace': '库存工作台',
    'Inventory summary placeholders': '库存摘要',
    'API connection': 'API 连接',
    'Not connected': '尚未连接',
    'Forecasting & Inventory Exceptions': '需求预测与库存异常',
    'Frontend scaffold': '前端原型',
    'Store operations': '门店运营',
    'Review the latest stock position for the selected store.': '查看所选门店最近一次库存快照。',
    'Store S001': '门店 S001',
    'Tracked products': '商品种类',
    'Available after inventory loads': '接入库存数据后显示',
    'On-hand units': '现有库存总量',
    'Based on the selected snapshot': '基于所选库存快照',
    'Inventory source': '库存数据来源',
    'Daily snapshots': '每日库存快照',
    "Historical snapshots may not reflect today's live stock.": '历史快照不一定反映实时库存。',
    'Stock overview': '库存总览',
    'Inventory records': '库存记录',
    'Stock quantities will be shown with the date of their source snapshot.': '库存数量将同时显示对应快照日期。',
    'Selected store': '所选门店',
    'Search products': '搜索商品',
    'Available after API integration': '接入 API 后开放',
    'Product ID': '商品编号',
    'Category': '商品类别',
    'On hand': '现有库存',
    'Snapshot date': '快照日期',
    'Lead time': '供货周期',
    'No inventory loaded yet': '暂未加载库存数据',
    'Inventory records will appear here after the inventory API is connected.': '连接库存 API 后，库存记录会显示在这里。',
    'An empty table does not mean stock is zero.': '表格为空不代表库存为零。',
    'The inventory view is a page scaffold. It will use the snapshot date returned by the API and will not change stock when a review is approved.': '这是库存页面原型。页面将使用 API 返回的快照日期；审核建议不会直接修改库存。',
    'Daily demand planning': '每日需求规划',
    'Analysis run': '分析任务',
    'Follow the status and results for this analysis request.': '查看本次分析请求的状态和结果。',
    'Start a daily analysis for the selected store and date.': '为所选门店和日期发起每日分析。',
    'Daily analysis': '每日分析',
    'New request': '新建请求',
    'Run daily analysis': '运行每日分析',
    'Choose the store and analysis date to prepare a run.': '选择门店和分析日期以准备任务。',
    'Store': '门店',
    'Demo store': '演示门店',
    'Analysis date': '分析日期',
    'Enabled when the demo data range is confirmed.': '确认演示数据的日期范围后开放。',
    'API not connected': 'API 尚未连接',
    'Run Daily Analysis': '运行每日分析',
    'The request button will be enabled when run creation is integrated.': '接入分析任务创建接口后，此按钮将开放。',
    'Current request': '当前请求',
    'Run status': '任务状态',
    'Awaiting API': '等待 API 接入',
    'Run ID': '任务编号',
    'Status and forecast results will be retrieved from the API.': '任务状态和预测结果将从 API 获取。',
    'Back to new analysis': '返回新建分析',
    'No run selected': '尚未选择分析任务',
    'After a request is created, its queued, processing, completed, or failed status will appear here.': '创建请求后，这里会显示排队中、处理中、已完成或失败等状态。',
    'What happens next': '后续流程',
    'Daily analysis workflow': '每日分析流程',
    'One request · persisted results · human review': '一次请求 · 结果留存 · 人工审核',
    'Create analysis run': '创建分析任务',
    'API step': 'API 步骤',
    'Build forecast': '生成需求预测',
    'Worker + private AI service': '后台任务 + 内部 AI 服务',
    'Background step': '后台步骤',
    'Review exceptions': '审核异常项',
    'Open a linked case for human review': '打开关联案例进行人工审核',
    'Planner step': '规划员步骤',
    'This page will display the persisted output for the current run. Dataset benchmark values will not be shown as model predictions.': '此页面将展示当前任务保存的结果。数据集基准值不会被当作模型预测展示。',
    'Planner review': '规划员审核',
    "Review products that need a planner's attention.": '查看需要规划员关注的商品。',
    'Review queue': '待审核队列',
    'Human-in-the-loop': '人工参与审核',
    'Exception queue': '异常队列',
    'Open a case to understand its forecast and record a review decision.': '打开案例查看预测依据，并记录审核决定。',
    'Exception status filter': '异常状态筛选',
    'Pending review': '待审核',
    'Reviewed': '已审核',
    'All cases': '全部案例',
    'Filters available after API integration': '接入 API 后开放筛选',
    'Case ID': '案例编号',
    'Case': '案例',
    'Exception type': '异常类型',
    'Status': '状态',
    'Suggested quantity': '建议数量',
    'Run': '任务编号',
    'No exception records loaded': '暂未加载异常记录',
    'Cases will appear here when a completed analysis needs human review.': '分析完成且需要人工审核时，相关案例会显示在这里。',
    'Go to Analysis': '前往分析页面',
    'Review is advisory': '审核仅供决策参考',
    "Approve or modify a recommendation records a planner's decision. It does not place an order or change inventory.": '批准或修改建议只会记录规划员的决定，不会自动下单或修改库存。',
    'Exception cases will be opened by their case ID or linked run ID. The interface will not guess a case from a product name or list position.': '请通过案例编号或关联的任务编号打开异常案例。系统不会根据商品名或列表位置猜测案例。',
    'Exception details': '异常详情',
    'Review the supporting forecast before recording a decision.': '查看相关预测依据后，再记录审核决定。',
    'Back to queue': '返回异常队列',
    'Exception case': '异常案例',
    'Case information will be loaded from the exception API.': '案例信息将从异常 API 加载。',
    'Forecast horizon': '预测周期',
    'Why this case was raised': '异常原因',
    'The model explanation and inventory snapshot will appear here when case details are connected.': '接入案例详情后，这里会显示模型说明和库存快照。',
    'Decision': '审核决定',
    'Record review': '记录审核结果',
    'Approve': '批准',
    'Accept the suggested quantity': '接受建议数量',
    'Modify': '修改',
    'Enter a different quantity and reason': '填写其他数量及原因',
    'Reviewed quantity': '审核后数量',
    'Reason': '原因',
    'Available after API integration': '接入 API 后开放',
    'A reason will be required when modifying a recommendation': '修改建议时需要填写原因',
    'Save review': '保存审核结果',
    'The form will refresh from the saved case after submission.': '提交后，表单将显示已保存的案例信息。',
    "The page distinguishes the system's suggestion from the quantity entered by a planner. Review actions will be enabled after the review API is connected.": '页面会区分系统建议数量和规划员填写的数量。接入审核 API 后即可提交审核操作。',
    'Page not found': '未找到页面',
    'That workspace page does not exist.': '该工作区页面不存在。',
    'Use the navigation to return to Inventory, Analysis, or Exceptions.': '请使用导航返回库存、分析或异常处理页面。',
    'Project F.I.X. · Demo workspace': 'Project F.I.X. · 演示工作区',
    'Inventory decisions remain human-reviewed': '库存决策由人工审核',
    'Switch language to Simplified Chinese': '切换为简体中文',
    'Switch language to English': '切换为 English',
  },
};

export function LanguageProvider({ children }) {
  const [language, setLanguage] = useState(() => {
    try {
      return window.localStorage.getItem('fix-language') === 'zh-CN' ? 'zh-CN' : 'en';
    } catch {
      return 'en';
    }
  });

  useEffect(() => {
    document.documentElement.lang = language === 'zh-CN' ? 'zh-CN' : 'en';
    document.title = language === 'zh-CN'
      ? 'Project F.I.X. | 库存工作台'
      : 'Project F.I.X. | Inventory workspace';
    try {
      window.localStorage.setItem('fix-language', language);
    } catch {
      // Keep the selected language for the current page even if storage is unavailable.
    }
  }, [language]);

  const value = useMemo(() => ({
    language,
    setLanguage,
    toggleLanguage: () => setLanguage((current) => current === 'en' ? 'zh-CN' : 'en'),
    t: (text) => language === 'zh-CN' ? workflowTranslations[text] ?? translations['zh-CN'][text] ?? text : text,
  }), [language]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used inside LanguageProvider');
  return context;
}
