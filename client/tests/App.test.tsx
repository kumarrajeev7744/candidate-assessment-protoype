import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../src/App';
import { renderApp } from './helpers/renderApp';

describe('App', () => {
  it('renders the application shell', () => {
    render(<App />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('displays the landing page at /', () => {
    renderApp('/');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Candidate Assessment Platform' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Recruiter login' })).toHaveAttribute('href', '/admin/login');
  });

  it('displays the not-found page for unknown routes', () => {
    renderApp('/some/unknown/route');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('navigates from the not-found page back to the landing page', async () => {
    renderApp('/missing');
    await userEvent.click(screen.getByRole('link', { name: 'Go to home page' }));
    expect(
      screen.getByRole('heading', { level: 1, name: 'Candidate Assessment Platform' }),
    ).toBeInTheDocument();
  });
});
