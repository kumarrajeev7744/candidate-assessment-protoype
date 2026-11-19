import { Link, Outlet } from 'react-router-dom';

export function Layout() {
  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="app-brand">
          Candidate Assessment Platform
        </Link>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
