import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import Layout from "./components/Layout";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import ProvidersPage from "./pages/ProvidersPage";
import ModelsPage from "./pages/ModelsPage";
import DevicesPage from "./pages/DevicesPage";
import UsagePage from "./pages/UsagePage";
import SettingsPage from "./pages/SettingsPage";
import { Spinner } from "./components/ui";

function Protected() {
  const { loading, authenticated } = useAuth();
  if (loading) return <Spinner />;
  if (!authenticated) return <Navigate to="/login" replace />;
  return <Layout />;
}

export default function App() {
  return (
    <AuthProvider>
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
    </AuthProvider>
  );
}
