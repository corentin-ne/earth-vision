import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { startAutosave } from './world/persist';
import { loadIso2 } from './world/flags';
import './styles.css';

startAutosave();
// The ISO code table is needed to show the bundled flags; it is tiny and cached offline.
loadIso2().finally(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
