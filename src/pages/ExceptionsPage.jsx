import { Link, useParams } from 'react-router';
import IntegrationNote from '../components/IntegrationNote.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { useLanguage } from '../i18n.jsx';

const columns = ['Case ID', 'Product ID', 'Exception type', 'Status', 'Suggested quantity', 'Run'];

export default function ExceptionsPage() {
  const { caseId } = useParams();
  const { t } = useLanguage();

  if (caseId) {
    return <ExceptionDetail caseId={caseId} />;
  }

  return (
    <>
      <PageHeader
        eyebrow={t('Planner review')}
        title={t('Exceptions')}
        description={t("Review products that need a planner's attention.")}
        actions={<span className="queue-chip"><span className="queue-chip__dot" />{t('Review queue')}</span>}
      />

      <section className="panel exceptions-panel" aria-labelledby="exceptions-table-title">
        <div className="panel-heading">
          <div>
            <div className="panel-kicker">{t('Human-in-the-loop')}</div>
            <h2 id="exceptions-table-title">{t('Exception queue')}</h2>
            <p>{t('Open a case to understand its forecast and record a review decision.')}</p>
          </div>
          <span className="endpoint-label">GET /exceptions</span>
        </div>

        <div className="table-toolbar table-toolbar--filters">
          <div className="filter-tabs" aria-label={t('Exception status filter')}>
            <button className="filter-tab is-selected" type="button" disabled>{t('Pending review')}</button>
            <button className="filter-tab" type="button" disabled>{t('Reviewed')}</button>
            <button className="filter-tab" type="button" disabled>{t('All cases')}</button>
          </div>
          <span className="filter-note">{t('Filters available after API integration')}</span>
        </div>

        <div className="table-scroll">
          <table className="data-table exceptions-table">
            <thead>
              <tr>{columns.map((column) => <th key={column}>{t(column)}</th>)}</tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={columns.length} className="table-empty-cell">
                  <div className="empty-state empty-state--wide">
                    <div className="empty-state__icon empty-state__icon--exceptions"><AlertIcon /></div>
                    <h3>{t('No exception records loaded')}</h3>
                    <p>{t('Cases will appear here when a completed analysis needs human review.')}</p>
                    <Link className="text-link" to="/analysis">{t('Go to Analysis')} <ArrowRightIcon /></Link>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div className="review-guidance">
        <div className="review-guidance__icon"><ReviewIcon /></div>
        <div>
          <strong>{t('Review is advisory')}</strong>
          <p>{t("Approve or modify a recommendation records a planner's decision. It does not place an order or change inventory.")}</p>
        </div>
      </div>

      <IntegrationNote>
        {t('Exception cases will be opened by their case ID or linked run ID. The interface will not guess a case from a product name or list position.')}
      </IntegrationNote>
    </>
  );
}

function ExceptionDetail({ caseId }) {
  const { t } = useLanguage();
  return (
    <>
      <PageHeader
        eyebrow={t('Planner review')}
        title={t('Exception details')}
        description={t('Review the supporting forecast before recording a decision.')}
        actions={<Link className="secondary-button" to="/exceptions">{t('Back to queue')}</Link>}
      />

      <div className="detail-layout">
        <section className="panel case-detail-panel" aria-labelledby="case-summary-title">
          <div className="panel-heading">
            <div>
              <div className="panel-kicker">{t('Exception case')}</div>
              <h2 id="case-summary-title">{t('Case')} {caseId}</h2>
              <p>{t('Case information will be loaded from the exception API.')}</p>
            </div>
            <span className="status-badge status-badge--muted">{t('Awaiting API')}</span>
          </div>

          <div className="detail-metrics">
            <DetailMetric label={t('Product ID')} value="—" />
            <DetailMetric label={t('Exception type')} value="—" />
            <DetailMetric label={t('Forecast horizon')} value="—" />
            <DetailMetric label={t('Suggested quantity')} value="—" />
          </div>

          <div className="explanation-placeholder">
            <span className="explanation-placeholder__label">{t('Why this case was raised')}</span>
            <p>{t('The model explanation and inventory snapshot will appear here when case details are connected.')}</p>
          </div>
        </section>

        <section className="panel review-panel" aria-labelledby="review-form-title">
          <div className="panel-heading panel-heading--compact">
            <div>
              <div className="panel-kicker">{t('Decision')}</div>
              <h2 id="review-form-title">{t('Record review')}</h2>
            </div>
          </div>
          <div className="review-options">
            <button type="button" className="review-option" disabled>
              <span className="review-option__mark review-option__mark--approve">✓</span>
              <span><strong>{t('Approve')}</strong><small>{t('Accept the suggested quantity')}</small></span>
            </button>
            <button type="button" className="review-option" disabled>
              <span className="review-option__mark review-option__mark--modify">↗</span>
              <span><strong>{t('Modify')}</strong><small>{t('Enter a different quantity and reason')}</small></span>
            </button>
          </div>
          <label className="field-group field-group--disabled">
            <span>{t('Reviewed quantity')}</span>
            <input className="field-value" type="number" min="0" placeholder={t('Available after API integration')} disabled />
          </label>
          <label className="field-group field-group--disabled">
            <span>{t('Reason')}</span>
            <textarea className="field-value field-value--textarea" rows="3" placeholder={t('A reason will be required when modifying a recommendation')} disabled />
          </label>
          <button type="button" className="primary-button review-submit" disabled>{t('Save review')}</button>
          <p className="button-help">{t('The form will refresh from the saved case after submission.')}</p>
        </section>
      </div>

      <IntegrationNote>
        {t("The page distinguishes the system's suggestion from the quantity entered by a planner. Review actions will be enabled after the review API is connected.")}
      </IntegrationNote>
    </>
  );
}

function DetailMetric({ label, value }) {
  return (
    <div className="detail-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M16 4.5 28 26H4z" />
      <path d="M16 11v6m0 4.5h.01" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3.5 10h12m-5-5 5 5-5 5" />
    </svg>
  );
}

function ReviewIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 4.5h14v15H5z" />
      <path d="m8.5 12 2.2 2.2 5-5M8.5 8.5h2" />
    </svg>
  );
}
