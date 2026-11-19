import { useAuth } from '../context/AuthContext';

/** Placeholder until the recruiter dashboard is built. */
export function DashboardPage() {
  const { admin } = useAuth();
  return (
    <section className="page">
      <h1>Recruiter Dashboard</h1>
      <p>Signed in as {admin?.email}.</p>
      <p>Candidate management will be added in a later step.</p>
    </section>
  );
}
