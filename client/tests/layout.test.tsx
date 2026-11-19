import { render, screen, within } from '@testing-library/react';
import { Icon, BrandMark } from '../src/components/ui/Icon';
import { storeSession } from '../src/utils/tokenStorage';
import { ADMIN, futureIso, mockApi, renderApp } from './helpers/renderApp';

describe('App header', () => {
  it('shows the brand linking home for visitors, without recruiter navigation', () => {
    renderApp('/');
    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('link', { name: 'Candidate Assessment Platform' })).toHaveAttribute('href', '/');
    expect(within(banner).queryByRole('navigation')).not.toBeInTheDocument();
    expect(within(banner).queryByRole('button', { name: /Log out/ })).not.toBeInTheDocument();
  });

  it('marks the Candidates section active on the dashboard and on candidate reports', async () => {
    storeSession({ token: 'jwt', expiresAt: futureIso() });
    mockApi({
      'GET /auth/me': () => ({ status: 200, body: { admin: ADMIN } }),
      ['GET /candidates/' + 'c'.repeat(24) + '/report']: () => ({ status: 404, body: { error: { code: 'X', message: 'x' } } }),
    });
    renderApp(`/admin/candidates/${'c'.repeat(24)}`);
    const nav = await screen.findByRole('navigation', { name: 'Recruiter' });
    expect(within(nav).getByRole('link', { name: 'Candidates' })).toHaveAttribute('aria-current', 'page');
    expect(within(screen.getByRole('banner')).getByRole('link', { name: 'Candidate Assessment Platform' })).toHaveAttribute(
      'href',
      '/admin/dashboard',
    );
  });
});

describe('Icons', () => {
  it('are decorative and hidden from assistive technology', () => {
    const { container } = render(
      <button type="button">
        <Icon name="share" /> Share
        <BrandMark />
      </button>,
    );
    for (const svg of container.querySelectorAll('svg')) expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
  });
});
