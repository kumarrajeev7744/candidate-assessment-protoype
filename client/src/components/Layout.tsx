import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ActionsMenu } from './ui/ActionsMenu';
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
          {signedIn && admin && (
            <div className="app-user">
              <ActionsMenu
                label="Account menu"
                triggerClassName="account-trigger"
                triggerContent={
                  <>
                    <span className="avatar" aria-hidden="true">
                      <Icon name="user" size={18} />
                    </span>
                    <Icon name="chevronDown" size={16} />
                  </>
                }
                header={
                  <>
                    <span className="actions-menu-caption">Signed in as</span>
                    <span className="actions-menu-email">{admin.email}</span>
                  </>
                }
                actions={[{ label: 'Sign out', icon: 'logout', onSelect: handleLogout }]}
              />
            </div>
          )}
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
