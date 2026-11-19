import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { LandingPage } from '../pages/LandingPage';
import { LoginPage, DASHBOARD_PATH } from '../pages/LoginPage';
import { DashboardPage } from '../pages/DashboardPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { AssessmentLayout } from '../pages/assessment/AssessmentLayout';
import { AssessmentStartPage } from '../pages/assessment/AssessmentStartPage';
import { QuestionPage } from '../pages/assessment/QuestionPage';
import { ReviewPage } from '../pages/assessment/ReviewPage';
import { SubmittedPage } from '../pages/assessment/SubmittedPage';
import { ProtectedRoute } from './ProtectedRoute';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<LandingPage />} />
        <Route path="admin/login" element={<LoginPage />} />
        <Route path="assessment/:token" element={<AssessmentLayout />}>
          <Route index element={<AssessmentStartPage />} />
          <Route path="questions/:number" element={<QuestionPage />} />
          <Route path="review" element={<ReviewPage />} />
          <Route path="submitted" element={<SubmittedPage />} />
          <Route path="*" element={<Navigate to="." replace />} />
        </Route>
        <Route path="admin" element={<ProtectedRoute />}>
          <Route index element={<Navigate to={DASHBOARD_PATH} replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
