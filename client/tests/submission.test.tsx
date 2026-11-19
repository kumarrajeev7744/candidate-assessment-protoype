import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { assessmentSettings } from '../src/context/AssessmentContext';
import { renderApp } from './helpers/renderApp';
import { completeUpTo, installFakeAssessmentApi, QUESTIONS, TOKEN } from './helpers/fakeAssessmentApi';

const BASE = `/assessment/${TOKEN}`;

beforeEach(() => {
  assessmentSettings.autosaveDelayMs = 30;
});
afterAll(() => {
  assessmentSettings.autosaveDelayMs = 1000;
});

async function openReview(options: Parameters<typeof installFakeAssessmentApi>[0] = completeUpTo(10)) {
  const api = installFakeAssessmentApi({ status: 'In Progress', ...options });
  renderApp(`${BASE}/review`);
  await screen.findByRole('heading', { name: 'Review your answers' });
  return api;
}

const submitButton = () => screen.getByRole('button', { name: 'Submit Assessment' });

async function submitAndConfirm() {
  await userEvent.click(submitButton());
  const dialog = await screen.findByRole('dialog', { name: 'Submit your assessment?' });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Submit assessment' }));
}

describe('Review and submission', () => {
  it('shows all 10 questions with written answers, video status and counts', async () => {
    await openReview();
    expect(screen.getAllByRole('listitem', { name: /^Question \d+$/ })).toHaveLength(10);
    QUESTIONS.forEach((q) => expect(screen.getByText(q.questionText)).toBeInTheDocument());
    expect(screen.getByText('Answer 7')).toBeInTheDocument();
    expect(screen.getByTestId('review-video-status-10')).toHaveTextContent('Video: Uploaded');
    expect(screen.getByText(/completed ·/).parentElement).toHaveTextContent('10 completed · 0 incomplete');
    expect(screen.getByText(/You can submit your assessment/)).toBeInTheDocument();
    expect(submitButton()).toBeEnabled();
  });

  it('identifies incomplete questions and disables submission', async () => {
    const api = await openReview({
      answers: { ...completeUpTo(10).answers, 3: '' },
      videos: completeUpTo(10).videos.filter((n) => n !== 5 && n !== 3),
    });
    expect(screen.getByText(/completed ·/).parentElement).toHaveTextContent('8 completed · 2 incomplete');
    const attention = screen.getByText(/Questions needing attention/).closest('div')!;
    expect(within(attention).getByText('Question 3').closest('li')).toHaveTextContent(
      'Question 3 – Written answer missing, Video missing',
    );
    expect(within(attention).getByText('Question 5').closest('li')).toHaveTextContent('Question 5 – Video missing');
    expect(screen.getAllByText('Incomplete')).toHaveLength(2);
    expect(submitButton()).toBeDisabled();

    await userEvent.click(within(attention).getByRole('link', { name: 'Question 3' }));
    expect(await screen.findByText('Question 3 of 10')).toBeInTheDocument();
    expect(api.submits).toHaveLength(0);
  });

  it('opens a confirmation dialog explaining that submission is final, and can be cancelled', async () => {
    const api = await openReview();
    await userEvent.click(submitButton());
    const dialog = await screen.findByRole('dialog', { name: 'Submit your assessment?' });
    expect(dialog).toHaveTextContent(/Submission is final/);
    expect(dialog).toHaveTextContent(/not be able to edit your written answers or re-record your videos/);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.submits).toHaveLength(0);

    await userEvent.click(submitButton());
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('submits, shows a loading state and navigates to the confirmation screen', async () => {
    const api = await openReview();
    api.state.submitDelayMs = 80;
    await submitAndConfirm();
    expect(await screen.findByRole('button', { name: 'Submitting…' })).toBeDisabled();

    expect(await screen.findByRole('heading', { name: 'Assessment submitted successfully.' })).toBeInTheDocument();
    expect(screen.getByText('Priya Sharma')).toBeInTheDocument();
    const submittedAt = screen.getByText('Submitted').nextElementSibling!;
    expect(submittedAt).toHaveTextContent(/2026/);
    expect(screen.getByRole('status')).toHaveTextContent('A confirmation email has been sent to priya@example.com.');
    expect(screen.queryByRole('link', { name: /Edit|question/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(api.submits).toHaveLength(1);
    const [, init] = api.fetchMock.mock.calls.find(([url]) => String(url).endsWith('/assessment/submit'))!;
    expect((init?.headers as Record<string, string>)['X-Assessment-Token']).toBe(TOKEN);
  });

  it('explains when the confirmation email could not be sent', async () => {
    const api = await openReview();
    api.state.confirmationEmailSent = false;
    await submitAndConfirm();
    expect(await screen.findByRole('heading', { name: 'Assessment submitted successfully.' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Your assessment was submitted successfully, but we could not send the confirmation email.',
    );
    expect(screen.queryByText(/has been sent/)).not.toBeInTheDocument();
  });

  it('saves pending text before submitting', async () => {
    assessmentSettings.autosaveDelayMs = 60_000;
    const api = installFakeAssessmentApi({ status: 'In Progress', ...completeUpTo(10) });
    renderApp(`${BASE}/questions/10`);
    await screen.findByText('Question 10 of 10');
    await userEvent.type(screen.getByLabelText('Your written answer'), ' (edited)');
    await userEvent.click(screen.getByRole('button', { name: 'Review answers' }));
    await screen.findByRole('heading', { name: 'Review your answers' });
    await submitAndConfirm();
    await screen.findByRole('heading', { name: 'Assessment submitted successfully.' });
    expect(api.state.answers.get(QUESTIONS[9]!.id)).toBe('Answer 10 (edited)');
  });

  it('shows the server’s incomplete-assessment error with the missing parts', async () => {
    const api = await openReview();
    api.state.submitFailure = {
      status: 400,
      code: 'ASSESSMENT_INCOMPLETE',
      message: 'Not complete',
      details: { missing: [{ questionNumber: 4, writtenMissing: false, videoMissing: true }] },
    };
    await submitAndConfirm();
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(
      'Your assessment is not complete yet: Question 4 (video missing).',
    );
    expect(screen.queryByRole('heading', { name: 'Assessment submitted successfully.' })).not.toBeInTheDocument();
  });

  it.each([
    [{ status: 0, code: 'NETWORK', message: '' }, /Unable to reach the server/],
    [{ status: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' }, /Your answers are saved; please try again/],
  ])('shows API errors and allows retrying (%j)', async (failure, message) => {
    const api = await openReview();
    api.state.submitFailure = failure;
    await submitAndConfirm();
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(message);
    expect(within(dialog).getByRole('button', { name: 'Submit assessment' })).toBeEnabled();

    api.state.submitFailure = null;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit assessment' }));
    expect(await screen.findByRole('heading', { name: 'Assessment submitted successfully.' })).toBeInTheDocument();
  });

  it('shows the expired screen if the link expired before submitting', async () => {
    const api = await openReview();
    api.state.submitFailure = { status: 410, code: 'INVITATION_EXPIRED', message: 'Expired' };
    await submitAndConfirm();
    expect(await screen.findByRole('heading', { name: 'Invitation expired' })).toBeInTheDocument();
  });
});

describe('After submission', () => {
  it('editing screens are no longer reachable in the same session', async () => {
    await openReview();
    await submitAndConfirm();
    await screen.findByRole('heading', { name: 'Assessment submitted successfully.' });
    // A late autosave or navigation attempt must not reopen editing.
    await act(async () => {
      window.dispatchEvent(new Event('popstate'));
    });
    expect(screen.queryByLabelText('Your written answer')).not.toBeInTheDocument();
  });

  it.each(['', '/questions/1', '/review'])('reopening the link at "%s" shows the submitted message, not the editor', async (path) => {
    installFakeAssessmentApi({ status: 'Completed', ...completeUpTo(10) });
    renderApp(`${BASE}${path}`);
    expect(await screen.findByRole('heading', { name: 'Assessment already submitted' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Your written answer')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start Assessment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit Assessment' })).not.toBeInTheDocument();
  });

  it('a stale question URL after submission redirects to the confirmation screen', async () => {
    const api = await openReview();
    await submitAndConfirm();
    await screen.findByRole('heading', { name: 'Assessment submitted successfully.' });
    expect(api.state.status).toBe('Completed');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
