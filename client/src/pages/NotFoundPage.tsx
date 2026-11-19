import { Link } from 'react-router-dom';
import { Icon } from '../components/ui/Icon';

export function NotFoundPage() {
  return (
    <section className="page state-page">
      <span className="status-icon status-icon-brand">
        <Icon name="alert" size={26} />
      </span>
      <h1>Page not found</h1>
      <p>The page you are looking for does not exist.</p>
      <Link to="/">Go to home page</Link>
    </section>
  );
}
