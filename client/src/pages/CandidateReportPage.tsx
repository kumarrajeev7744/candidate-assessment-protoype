import { Link, useParams } from 'react-router-dom';

/** Placeholder: the candidate report is implemented in the next step. */
export function CandidateReportPage() {
  const { candidateId } = useParams();
  return (
    <section className="page">
      <p>
        <Link to="/admin/dashboard">← Back to candidates</Link>
      </p>
      <h1>Candidate report</h1>
      <p>The detailed report for this candidate will be available in the next release.</p>
      <p className="field-hint">Candidate reference: {candidateId}</p>
    </section>
  );
}
