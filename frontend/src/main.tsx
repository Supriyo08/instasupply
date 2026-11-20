import './index.css';

import { ApiProvider } from '@instasupply/api-client/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';

import { router } from './app/router';
import { ToastProvider } from './components/ui/Toast';
import { api } from './lib/api';

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element.');

createRoot(root).render(
  <StrictMode>
    {/* Starts the client once: restores the session, loads /config, opens the live socket. */}
    <ApiProvider client={api}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </ApiProvider>
  </StrictMode>,
);
