import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export const LOGIN_PATH = '/admin/login';

/** Renders child routes only for an authenticated admin; otherwise redirects to login. */
export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'checking') {
    return (
      <p role="status" className="page">
        Checking your session…
      </p>
    );
  }
  if (status !== 'authenticated') {
    return <Navigate to={LOGIN_PATH} replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
