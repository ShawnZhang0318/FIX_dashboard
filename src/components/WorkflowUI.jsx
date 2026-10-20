import { useLanguage } from "../i18n.jsx";
import { Link } from 'react-router';
export function Feedback({ loading, error, reload }) {
  const { t } = useLanguage();
  if (loading)
    return (
      <p className="workflow-message" role="status">
        {t("Loading…")}
      </p>
    );
  if (error)
    return (
      <div className="workflow-message workflow-error" role="alert">
        <p>{t("Request failed. Check the connection or record ID.")}</p>
        <p>{error.message}</p>
        {error.writeUncertain && <p>{t('Write outcome unknown. Check server state before retrying.')}</p>}
        {error.requestId && <p className="workflow-id"><Link to={`/logs?${new URLSearchParams({source:'browser',request_id: error.requestId})}`}>{t('View request log')}</Link> · {error.requestId}</p>}
        {reload && (
          <button className="secondary-button" onClick={reload}>
            {t("Retry")}
          </button>
        )}
      </div>
    );
  return null;
}
export function Badge({ status }) {
  const { t } = useLanguage();
  return (
    <span className={`status-badge workflow-status-${status}`}>
      {t(status)}
    </span>
  );
}
export function Metric({ label, value }) {
  return (
    <article className="summary-card">
      <span className="summary-card__label">{label}</span>
      <strong className="summary-card__value">{value}</strong>
    </article>
  );
}
