import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { BrandMark, Icon } from './ui/Icon';

export function Layout() {
  const { status, admin, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // Candidate and hiring-manager pages are standalone: no links into the recruiter area,
  // even if this browser tab also holds a recruiter session.
  const isPublicFlow = pathname.startsWith('/assessment/') || pathname.startsWith('/shared-response/');
  const signedIn = status === 'authenticated' && !isPublicFlow;
  // Candidate reports belong to the Candidates section too.
  const candidatesActive = pathname.startsWith('/admin/dashboard') || pathname.startsWith('/admin/candidates');

  function handleLogout() {
    logout();
    navigate('/admin/login', { replace: true });
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-inner">
          {isPublicFlow ? (
            <span className="app-brand">
              <BrandMark />
              <span className="brand-name">Candidate Assessment Platform</span>
            </span>
          ) : (
            <Link to={signedIn ? '/admin/dashboard' : '/'} className="app-brand">
              <BrandMark />
              <span className="brand-name">Candidate Assessment Platform</span>
            </Link>
          )}
          {signedIn && (
            <>
              <nav className="app-nav" aria-label="Recruiter">
                <Link
                  to="/admin/dashboard"
                  className={candidatesActive ? 'app-nav-link active' : 'app-nav-link'}
                  aria-current={candidatesActive ? 'page' : undefined}
                >
                  Candidates
                </Link>
              </nav>
              <div className="app-user">
                <span className="avatar" aria-hidden="true">
                  {admin?.email.charAt(0).toUpperCase()}
                </span>
                <span className="app-user-email">{admin?.email}</span>
                <button type="button" className="button-secondary button-small" onClick={handleLogout}>
                  <Icon name="logout" size={16} />
                  Log out
                </button>
              </div>
            </>
          )}
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
