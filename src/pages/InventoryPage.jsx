import IntegrationNote from '../components/IntegrationNote.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { useLanguage } from '../i18n.jsx';

const columns = ['Product ID', 'Category', 'On hand', 'Snapshot date', 'Lead time'];

export default function InventoryPage() {
  const { t } = useLanguage();
  return (
    <>
      <PageHeader
        eyebrow={t('Store operations')}
        title={t('Inventory')}
        description={t('Review the latest stock position for the selected store.')}
        actions={<span className="store-chip"><span className="store-chip__dot" />{t('Store S001')}</span>}
      />

      <div className="summary-grid" aria-label={t('Inventory summary placeholders')}>
        <article className="summary-card">
          <span className="summary-card__label">{t('Tracked products')}</span>
          <strong className="summary-card__value">—</strong>
          <span className="summary-card__hint">{t('Available after inventory loads')}</span>
        </article>
        <article className="summary-card">
          <span className="summary-card__label">{t('On-hand units')}</span>
          <strong className="summary-card__value">—</strong>
          <span className="summary-card__hint">{t('Based on the selected snapshot')}</span>
        </article>
        <article className="summary-card summary-card--accent">
          <span className="summary-card__label">{t('Inventory source')}</span>
          <strong className="summary-card__value summary-card__value--text">{t('Daily snapshots')}</strong>
          <span className="summary-card__hint">{t("Historical snapshots may not reflect today's live stock.")}</span>
        </article>
      </div>

      <section className="panel inventory-panel" aria-labelledby="inventory-table-title">
        <div className="panel-heading">
          <div>
            <div className="panel-kicker">{t('Stock overview')}</div>
            <h2 id="inventory-table-title">{t('Inventory records')}</h2>
            <p>{t('Stock quantities will be shown with the date of their source snapshot.')}</p>
          </div>
          <span className="endpoint-label">GET /inventory</span>
        </div>

        <div className="table-toolbar">
          <span className="store-chip store-chip--muted">{t('Selected store')} <strong>S001</strong></span>
          <button className="quiet-button" type="button" disabled title={t('Available after API integration')}>
            <SearchIcon />
            {t('Search products')}
          </button>
        </div>

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>{columns.map((column) => <th key={column}>{t(column)}</th>)}</tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={columns.length} className="table-empty-cell">
                  <div className="empty-state">
                    <div className="empty-state__icon empty-state__icon--inventory"><InventoryIcon /></div>
                    <h3>{t('No inventory loaded yet')}</h3>
                    <p>{t('Inventory records will appear here after the inventory API is connected.')}</p>
                    <span className="empty-state__meta">{t('An empty table does not mean stock is zero.')}</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <IntegrationNote>
        {t('The inventory view is a page scaffold. It will use the snapshot date returned by the API and will not change stock when a review is approved.')}
      </IntegrationNote>
    </>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="8.8" cy="8.8" r="5.7" />
      <path d="m13 13 4 4" />
    </svg>
  );
}

function InventoryIcon() {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="m5 11 11-6 11 6v11l-11 6-11-6z" />
      <path d="m5.8 11.5 10.2 5.8 10.2-5.8M16 17.5V28M10.5 8l11 6.2" />
    </svg>
  );
}
