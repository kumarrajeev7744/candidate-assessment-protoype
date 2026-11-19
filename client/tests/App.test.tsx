import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../src/App';
import { AppRoutes } from '../src/routes/AppRoutes';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe('App', () => {
  it('renders the application shell', () => {
    render(<App />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('displays the landing page at /', () => {
    renderAt('/');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Candidate Assessment Platform' }),
    ).toBeInTheDocument();
  });

  it('displays the not-found page for unknown routes', () => {
    renderAt('/some/unknown/route');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('navigates from the not-found page back to the landing page', async () => {
    renderAt('/missing');
    await userEvent.click(screen.getByRole('link', { name: 'Go to home page' }));
    expect(
      screen.getByRole('heading', { level: 1, name: 'Candidate Assessment Platform' }),
    ).toBeInTheDocument();
  });
});
