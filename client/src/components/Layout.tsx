import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function Layout() {
  const { status, admin, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/admin/login', { replace: true });
  }

  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="app-brand">
          Candidate Assessment Platform
        </Link>
        {status === 'authenticated' && (
          <div className="app-user">
            <span>{admin?.email}</span>
            <button type="button" className="button-link" onClick={handleLogout}>
              Log out
            </button>
          </div>
        )}
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
