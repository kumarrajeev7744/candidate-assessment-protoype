import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../services/apiClient';
import { isValidEmail } from '../utils/validation';
import { BrandMark, Icon } from '../components/ui/Icon';

export const DASHBOARD_PATH = '/admin/dashboard';

interface FieldErrors {
  email?: string;
  password?: string;
}

function validate(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!email.trim()) errors.email = 'Email is required.';
  else if (!isValidEmail(email)) errors.email = 'Enter a valid email address.';
  if (!password) errors.password = 'Password is required.';
  return errors;
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Invalid email or password.';
    if (err.status === 429) return 'Too many login attempts. Please wait a few minutes and try again.';
    if (err.status === 0) return err.message;
    if (err.status >= 500) return 'The server encountered an error. Please try again later.';
    return err.message;
  }
  return 'Something went wrong. Please try again.';
}

export function LoginPage() {
  const { status, login, notice } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? DASHBOARD_PATH;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated' && !submitting) {
    return <Navigate to={DASHBOARD_PATH} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const errors = validate(email, password);
    setFieldErrors(errors);
    if (errors.email || errors.password) return;

    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setFormError(describeError(err));
      setPassword('');
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-layout">
      <aside className="auth-aside" aria-hidden="true">
        <BrandMark size={44} />
        <span className="eyebrow eyebrow-on-dark">Recruiter workspace</span>
        <p className="auth-aside-title">Assess sales talent with structured written and video responses.</p>
        <ul className="auth-aside-points">
          <li>
            <Icon name="check" size={16} /> Invite candidates and track progress
          </li>
          <li>
            <Icon name="check" size={16} /> Review answers and videos side by side
          </li>
          <li>
            <Icon name="check" size={16} /> Share single responses securely
          </li>
        </ul>
      </aside>
    <section className="page auth-page">
      <h1>Recruiter login</h1>
      <p className="page-subtitle auth-subtitle">Sign in with your administrator account.</p>
      {notice && !formError && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {formError && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}
      <form onSubmit={handleSubmit} noValidate className="form">
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            placeholder="you@company.com"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? 'email-error' : undefined}
            disabled={submitting}
          />
          {fieldErrors.email && (
            <span id="email-error" className="field-error">
              {fieldErrors.email}
            </span>
          )}
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={Boolean(fieldErrors.password)}
            aria-describedby={fieldErrors.password ? 'password-error' : undefined}
            disabled={submitting}
          />
          {fieldErrors.password && (
            <span id="password-error" className="field-error">
              {fieldErrors.password}
            </span>
          )}
        </div>
        <button type="submit" className="button-primary button-block" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Log in'}
        </button>
      </form>
    </section>
    </div>
  );
}
