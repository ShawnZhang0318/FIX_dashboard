import { Navigate, Route, Routes } from 'react-router';
import AppLayout from './components/AppLayout.jsx';
import { useLanguage } from './i18n.jsx';
import AnalysisPage from './pages/AnalysisPage.jsx';
import ExceptionsPage from './pages/ExceptionsPage.jsx';
import InventoryPage from './pages/InventoryPage.jsx';
import LogsPage from './pages/LogsPage.jsx';

function NotFoundPage() {
  const { t } = useLanguage();
  return (
    <section className="not-found panel">
      <span className="eyebrow">{t('Page not found')}</span>
      <h1>{t('That workspace page does not exist.')}</h1>
      <p>{t('Use the navigation to return to Inventory, Analysis, or Exceptions.')}</p>
    </section>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/inventory" replace />} />
        <Route path="inventory" element={<InventoryPage />} />
        <Route path="analysis" element={<AnalysisPage />} />
        <Route path="analysis/:runId" element={<AnalysisPage />} />
        <Route path="exceptions" element={<ExceptionsPage />} />
        <Route path="exceptions/:caseId" element={<ExceptionsPage />} />
        <Route path="logs" element={<LogsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
