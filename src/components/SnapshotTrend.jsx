import {useCallback} from 'react';
import {useResource} from '../useResource.js';
import {api} from '../workflow.js';
import {dailySeries} from '../../frontend/reporting.js';
import {useLanguage} from '../i18n.jsx';
import {Feedback} from './WorkflowUI.jsx';
import {LineChart} from './Charts.jsx';

export default function SnapshotTrend({product, from, to}) {
  const {t} = useLanguage();
  const state = useResource(useCallback(options => api.getSnapshots({store_id: 'S001', product_id: product, from, to}, options), [product, from, to]));
  const points = state.data ? dailySeries(state.data, {from, to, products: [product]}).map(p => ({...p,
    stockout: state.data.some(row => row.snapshot_date === p.date && row.inventory_level === 0)})) : [];
  return <div className="product-trend"><h4>{t('Daily sales in the recent 28 days')}</h4><p className="chart-footnote">{t('Amber dots mark zero closing stock. Records may include simulated quantities.')} {t('Charts use current saved records; later corrections may differ from this analysis.')}</p><Feedback {...state} />{state.data && <LineChart points={points} label={`${product} · ${t('Daily units sold')}`} unit={t('units')} />}</div>;
}
