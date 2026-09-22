import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link, Route, Routes } from 'react-router-dom';

import { AppLayout } from './components/layout/AppLayout';
import { Button, EmptyState } from './components/ui/primitives';
import { BenchmarkPage } from './pages/BenchmarkPage';
import { DashboardPage } from './pages/DashboardPage';
import { DatasetsPage } from './pages/DatasetsPage';
import { ExportPage } from './pages/ExportPage';
import { HelpPage } from './pages/HelpPage';
import { JobsPage } from './pages/JobsPage';
import { ModelsPage } from './pages/ModelsPage';
import { PredictPage } from './pages/PredictPage';
import { RunsPage } from './pages/RunsPage';
import { SolutionsPage } from './pages/SolutionsPage';
import { StudioPage } from './pages/StudioPage';
import { SystemPage } from './pages/SystemPage';
import { TrainPage } from './pages/TrainPage';
import { ValidatePage } from './pages/ValidatePage';

/** Top-level route table. Every page renders inside the shared shell. */
export function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="models" element={<ModelsPage />} />
          <Route path="datasets" element={<DatasetsPage />} />
          <Route path="predict" element={<PredictPage />} />
          <Route path="studio" element={<StudioPage />} />
          <Route path="solutions" element={<SolutionsPage />} />
          <Route path="train" element={<TrainPage />} />
          <Route path="validate" element={<ValidatePage />} />
          <Route path="export" element={<ExportPage />} />
          <Route path="benchmark" element={<BenchmarkPage />} />
          <Route path="runs" element={<RunsPage />} />
          <Route path="jobs" element={<JobsPage />} />
          <Route path="system" element={<SystemPage />} />
          <Route path="help" element={<HelpPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}

function NotFoundPage() {
  return (
    <EmptyState
      icon={<AlertTriangle className="size-5" />}
      title="Page not found"
      description="That route does not exist. Use the command palette (Ctrl/Cmd-K) or head back to the dashboard."
      action={
        <Link to="/">
          <Button variant="primary" size="sm">
            Back to dashboard
          </Button>
        </Link>
      }
    />
  );
}

interface ErrorBoundaryState {
  error: Error | null;
}

/** Prevents a single broken page from blanking the whole app. */
class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surfaced in the browser console for debugging; a real deployment would ship this to telemetry.
    console.error('Unhandled UI error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="p-6">
        <EmptyState
          icon={<AlertTriangle className="size-5" />}
          title="Something went wrong"
          description={this.state.error.message}
          action={
            <Button
              variant="primary"
              size="sm"
              icon={<RefreshCw className="size-3.5" />}
              onClick={() => window.location.reload()}
            >
              Reload
            </Button>
          }
        />
      </div>
    );
  }
}
