import { Link, useParams } from 'react-router';
import IntegrationNote from '../components/IntegrationNote.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { useLanguage } from '../i18n.jsx';

const steps = [
  { number: '01', title: 'Create analysis run', detail: 'POST /analysis-runs', state: 'API step' },
  { number: '02', title: 'Build forecast', detail: 'Worker + private AI service', state: 'Background step' },
  { number: '03', title: 'Review exceptions', detail: 'Open a linked case for human review', state: 'Planner step' },
];

export default function AnalysisPage() {
  const { runId } = useParams();
  const { t } = useLanguage();

  return (
    <>
      <PageHeader
        eyebrow={t('Daily demand planning')}
        title={t(runId ? 'Analysis run' : 'Analysis')}
        description={t(runId ? 'Follow the status and results for this analysis request.' : 'Start a daily analysis for the selected store and date.')}
        actions={<span className="mode-chip"><span className="mode-chip__dot" />{t('Daily analysis')}</span>}
      />

      <div className="analysis-grid">
        <section className="panel request-panel" aria-labelledby="request-title">
          <div className="panel-heading">
            <div>
              <div className="panel-kicker">{t('New request')}</div>
              <h2 id="request-title">{t('Run daily analysis')}</h2>
              <p>{t('Choose the store and analysis date to prepare a run.')}</p>
            </div>
            <span className="endpoint-label">POST /analysis-runs</span>
          </div>

          <div className="request-fields">
            <label className="field-group">
              <span>{t('Store')}</span>
              <div className="field-value field-value--fixed">
                <span className="field-value__leading"><StoreIcon /></span>
                S001
                <span className="field-value__tag">{t('Demo store')}</span>
              </div>
            </label>
            <label className="field-group" htmlFor="analysis-date">
              <span>{t('Analysis date')}</span>
              <input id="analysis-date" className="field-value" type="date" disabled />
              <small>{t('Enabled when the demo data range is confirmed.')}</small>
            </label>
          </div>

          <div className="request-footer">
            <div className="request-footer__copy">
              <span className="status-dot status-dot--muted" />
              <span>{t('API not connected')}</span>
            </div>
            <button className="primary-button" type="button" disabled>
              <PlayIcon />
              {t('Run Daily Analysis')}
            </button>
          </div>
          <p className="button-help">{t('The request button will be enabled when run creation is integrated.')}</p>
        </section>

        <section className="panel run-status-panel" aria-labelledby="run-status-title">
          <div className="panel-heading panel-heading--compact">
            <div>
              <div className="panel-kicker">{t('Current request')}</div>
              <h2 id="run-status-title">{t('Run status')}</h2>
            </div>
            <span className="status-badge status-badge--muted">{t('Awaiting API')}</span>
          </div>
          {runId ? (
            <div className="run-reference">
              <span>{t('Run ID')}</span>
              <strong>{runId}</strong>
              <p>{t('Status and forecast results will be retrieved from the API.')}</p>
              <Link className="text-link" to="/analysis">{t('Back to new analysis')}</Link>
            </div>
          ) : (
            <div className="status-empty">
              <div className="status-empty__symbol"><ClockIcon /></div>
              <h3>{t('No run selected')}</h3>
              <p>{t('After a request is created, its queued, processing, completed, or failed status will appear here.')}</p>
            </div>
          )}
        </section>
      </div>

      <section className="panel workflow-panel" aria-labelledby="workflow-title">
        <div className="panel-heading panel-heading--compact">
          <div>
            <div className="panel-kicker">{t('What happens next')}</div>
            <h2 id="workflow-title">{t('Daily analysis workflow')}</h2>
          </div>
          <span className="workflow-caption">{t('One request · persisted results · human review')}</span>
        </div>
        <ol className="workflow-steps">
          {steps.map((step) => (
            <li className="workflow-step" key={step.number}>
              <span className="workflow-step__number">{step.number}</span>
              <div>
                <h3>{t(step.title)}</h3>
                <p>{t(step.detail)}</p>
              </div>
              <span className="workflow-step__state">{t(step.state)}</span>
            </li>
          ))}
        </ol>
      </section>

      <IntegrationNote>
        {t('This page will display the persisted output for the current run. Dataset benchmark values will not be shown as model predictions.')}
      </IntegrationNote>
    </>
  );
}

function StoreIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3 8.5h14v8H3zM2.5 6l1.2-3h12.6l1.2 3v2.5H2.5z" />
      <path d="M7 16.5v-4h3v4M6 8.5v-2m4 2v-2m4 2v-2" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="m7 4.5 8 5.5-8 5.5z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="11" />
      <path d="M16 9v7l4.5 2.5" />
    </svg>
  );
}
