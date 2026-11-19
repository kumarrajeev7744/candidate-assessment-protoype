import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { LandingPage } from '../pages/LandingPage';
import { LoginPage, DASHBOARD_PATH } from '../pages/LoginPage';
import { DashboardPage } from '../pages/DashboardPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { InvitationPage } from '../pages/InvitationPage';
import { ProtectedRoute } from './ProtectedRoute';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<LandingPage />} />
        <Route path="admin/login" element={<LoginPage />} />
        <Route path="assessment/:token" element={<InvitationPage />} />
        <Route path="admin" element={<ProtectedRoute />}>
          <Route index element={<Navigate to={DASHBOARD_PATH} replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
