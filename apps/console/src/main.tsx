import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow-semi-condensed/500.css';
import '@fontsource/barlow-semi-condensed/600.css';
import './styles/app.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { queryRetryDelay, shouldRetryQuery } from './api/client';
import { App } from './App';
import appStyles from './App.module.css';
import { startSession } from './auth/session';
import { AuthGate } from './components/AuthGate';
import { RegionFallback } from './components/LoadStates';
import { ErrorBoundary } from './ui/ErrorBoundary';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: shouldRetryQuery, retryDelay: queryRetryDelay, refetchOnWindowFocus: false },
  },
});

// Outside React, so StrictMode's double effects cannot exchange the single-use code twice.
void startSession();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthGate>
        {/* Last resort for a crash outside every region (header, the console's own hooks). Inside
            the gate, so the session-expired banner still shows over it. */}
        <ErrorBoundary
          region="Console"
          fallback={() => (
            <RegionFallback
              label="Console"
              message="The console stopped working."
              retryLabel="Reload the console"
              retry={() => window.location.reload()}
              className={appStyles.consoleFallback}
            />
          )}
        >
          <App />
        </ErrorBoundary>
      </AuthGate>
    </QueryClientProvider>
  </StrictMode>,
);
