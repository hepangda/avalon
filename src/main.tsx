import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import './globals.css';
import './styles/table-layout.css';
import './styles/role-notes.css';
import './styles/table-elements.css';
import './styles/role-cards.css';
import './styles/identity.css';
import './styles/assassination.css';
import './styles/timing.css';
import './styles/reconnect.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
