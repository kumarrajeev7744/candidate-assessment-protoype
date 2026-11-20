import userEvent from '@testing-library/user-event';
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
    expect(within(banner).queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument();
  });

  it('signed-in recruiters get an account menu with their email and Sign out (no nav links)', async () => {
    storeSession({ token: 'jwt', expiresAt: futureIso() });
    mockApi({
      'GET /auth/me': () => ({ status: 200, body: { admin: ADMIN } }),
      'POST /auth/logout': () => ({ status: 200, body: { message: 'Logged out' } }),
    });
    renderApp('/admin/dashboard');
    await screen.findByRole('heading', { name: 'Candidates' });
    const banner = screen.getByRole('banner');
    expect(within(banner).queryByRole('navigation')).not.toBeInTheDocument();
    expect(within(banner).queryByText(ADMIN.email)).not.toBeInTheDocument(); // only inside the menu
    expect(within(banner).getByRole('link', { name: 'Candidate Assessment Platform' })).toHaveAttribute('href', '/admin/dashboard');

    const trigger = within(banner).getByRole('button', { name: 'Account menu' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    await userEvent.click(trigger);
    const menu = screen.getByRole('menu', { name: 'Account menu' });
    expect(menu).toHaveTextContent('Signed in as');
    expect(menu).toHaveTextContent(ADMIN.email);
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Sign out']);

    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Recruiter login' })).toBeInTheDocument();
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

describe('Candidate and shared pages', () => {
  it.each([`/assessment/${'T'.repeat(43)}`, `/shared-response/${'S'.repeat(43)}`])(
    'show the brand without any link or recruiter controls on %s, even with a recruiter session in the tab',
    async (path) => {
      storeSession({ token: 'jwt', expiresAt: futureIso() });
      mockApi({
        'GET /auth/me': () => ({ status: 200, body: { admin: ADMIN } }),
        [`GET /assessment`]: () => ({ status: 409, body: { error: { code: 'ASSESSMENT_COMPLETED', message: 'x' } } }),
        [`GET /shared-responses/${'S'.repeat(43)}`]: () => ({ status: 404, body: { error: { code: 'X', message: 'x' } } }),
      });
      renderApp(path);
      await screen.findByRole('heading', { level: 1 });
      const banner = screen.getByRole('banner');
      expect(within(banner).getByText('Candidate Assessment Platform')).toBeInTheDocument();
      expect(within(banner).queryByRole('link')).not.toBeInTheDocument();
      expect(within(banner).queryByRole('navigation')).not.toBeInTheDocument();
      expect(within(banner).queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument();
      expect(within(banner).queryByText(ADMIN.email)).not.toBeInTheDocument();
    },
  );
});
