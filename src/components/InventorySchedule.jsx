import {useCallback, useEffect, useState} from 'react';
import {useLanguage} from '../i18n.jsx';
import {api, config} from '../workflow.js';
import {Feedback} from './WorkflowUI.jsx';

// Poll the store clock and saved settlement date. A background refresh should
// neither blank the report nor change a date the user explicitly selected.
export function useInventorySchedule() {
  const [state, setState] = useState({loading: true, data: null, error: null});
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (config.mode !== 'live') return;
    const controller = new AbortController();
    let busy = false;
    async function refresh() {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const data = await api.getInventoryAutomation({store_id: 'S001'}, {signal: controller.signal});
        if (!controller.signal.aborted) setState({loading: false, data, error: null});
      } catch (error) {
        if (!controller.signal.aborted) setState(last => ({...last, loading: false, error}));
      } finally {
        busy = false;
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, 30000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [revision]);
  return {...state, reload};
}

const statusLabels = {
  scheduled: 'Awaiting settlement', settled: 'Settled today',
  blocked: 'Settlement blocked', disabled: 'Automation off',
};

export function InventorySchedule({state}) {
  const {t, language} = useLanguage();
  const day = state.data;
  if (config.mode !== 'live') return <p className="workflow-message">
    {t('Automatic settlement runs on the backend. This preview shows sample inventory.')}
  </p>;
  return <section className="panel inventory-schedule">
    <div className="panel-heading">
      <h2>{t('Daily inventory settlement')}</h2>
      {day && !state.error && <strong className="inventory-schedule-status">{t(statusLabels[day.status])}</strong>}
    </div>
    <Feedback loading={state.loading} error={state.error} reload={state.reload} />
    {day && !state.error && <>
      <p>{t('At close, the system deducts forecast sales up to the opening stock, then adds the forecast replenishment. Quantities are simulated.')}</p>
      <dl className="inventory-schedule-dates">
        <div><dt>{t('Store business date')}</dt><dd>{day.business_date}</dd></div>
        <div><dt>{t('Daily close')} ({day.timezone === 'Asia/Shanghai' ? t('Beijing time') : day.timezone})</dt><dd>{day.close_time || '—'}</dd></div>
        <div><dt>{t('Next scheduled settlement')}</dt><dd>{day.next_settlement_at
          ? new Intl.DateTimeFormat(language, {timeZone: day.timezone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).format(new Date(day.next_settlement_at)) : '—'}</dd></div>
      </dl>
      {day.detail && <p className="workflow-message" role="status">{t(day.detail)}</p>}
    </>}
  </section>;
}
