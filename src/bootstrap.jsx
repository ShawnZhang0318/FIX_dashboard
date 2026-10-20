import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router';
import App from './App.jsx';
import { LanguageProvider } from './i18n.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <LanguageProvider><HashRouter><App /></HashRouter></LanguageProvider>
  </React.StrictMode>,
);
