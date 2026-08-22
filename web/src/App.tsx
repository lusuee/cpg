import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { ThemeProvider } from "./hooks/useTheme";
import Layout from "./components/Layout";
import LoginPage from "./pages/LoginPage";
import { Spinner } from "./components/ui";

const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const ProvidersPage = lazy(() => import("./pages/ProvidersPage"));
const ModelsPage = lazy(() => import("./pages/ModelsPage"));
const DevicesPage = lazy(() => import("./pages/DevicesPage"));
const UsagePage = lazy(() => import("./pages/UsagePage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));

function PageLoader() {
  return (
    <div className="flex items-center justify-center p-12 min-h-[400px]">
      <Spinner text="正在加载页面…" />
    </div>
  );
}

function Protected() {
  const { loading, authenticated } = useAuth();
  if (loading) return <PageLoader />;
  if (!authenticated) return <Navigate to="/login" replace />;
  return <Layout />;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<Protected />}>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/providers" element={<ProvidersPage />} />
              <Route path="/models" element={<ModelsPage />} />
              <Route path="/devices" element={<DevicesPage />} />
              <Route path="/usage" element={<UsagePage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </ThemeProvider>
  );
}
