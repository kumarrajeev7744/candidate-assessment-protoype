import { Link } from 'react-router-dom';
import { Icon } from '../components/ui/Icon';

export function LandingPage() {
  return (
    <section className="hero">
      <div className="hero-content">
        <span className="eyebrow eyebrow-on-dark">Structured hiring assessments</span>
        <h1>Candidate Assessment Platform</h1>
        <p>Structured written and video assessments for sales candidates.</p>
        <Link to="/admin/login" className="button-primary button-inverse">
          Recruiter login
          <Icon name="arrowRight" size={16} />
        </Link>
      </div>
      <ul className="hero-points" aria-label="Highlights">
        <li>
          <Icon name="text" /> 10 consistent questions for every candidate
        </li>
        <li>
          <Icon name="video" /> Written and video answers in one place
        </li>
        <li>
          <Icon name="share" /> Share individual responses with hiring managers
        </li>
      </ul>
    </section>
  );
}
