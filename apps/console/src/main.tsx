import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow-semi-condensed/500.css';
import '@fontsource/barlow-semi-condensed/600.css';
import './styles/app.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { shouldRetryQuery } from './api/client';
import { App } from './App';
import { startSession } from './auth/session';
import { AuthGate } from './components/AuthGate';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: shouldRetryQuery, refetchOnWindowFocus: false } },
});

// Outside React, so StrictMode's double effects cannot exchange the single-use code twice.
void startSession();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthGate>
        <App />
      </AuthGate>
    </QueryClientProvider>
  </StrictMode>,
);
