import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { assessmentSettings } from '../src/context/AssessmentContext';
import { storePosition } from '../src/utils/assessmentPosition';
import { renderApp } from './helpers/renderApp';
import { completeUpTo, installFakeAssessmentApi, QUESTIONS, TOKEN } from './helpers/fakeAssessmentApi';

const BASE = `/assessment/${TOKEN}`;

beforeEach(() => {
  assessmentSettings.autosaveDelayMs = 30;
  localStorage.clear();
});

afterAll(() => {
  assessmentSettings.autosaveDelayMs = 1000;
});

const textarea = () => screen.getByLabelText('Your written answer') as HTMLTextAreaElement;
const questionHeading = (n: number) => screen.findByRole('heading', { name: `Question text number ${n}?` });

async function openQuestion(n: number, options: Parameters<typeof installFakeAssessmentApi>[0] = {}) {
  const api = installFakeAssessmentApi({ status: 'In Progress', ...options });
  renderApp(`${BASE}/questions/${n}`);
  await questionHeading(n);
  return api;
}

describe('Assessment start screen', () => {
  it('renders the welcome, candidate details, instructions and limits', async () => {
    installFakeAssessmentApi();
    renderApp(BASE);

    expect(screen.getByRole('status')).toHaveTextContent('Loading your assessment');
    expect(await screen.findByRole('heading', { name: 'Welcome, Priya Sharma' })).toBeInTheDocument();
    expect(screen.getByText('priya@example.com')).toBeInTheDocument();
    expect(screen.getByText('10 questions')).toBeInTheDocument();
    expect(screen.getByText(/up to 1,000 characters/)).toBeInTheDocument();
    expect(screen.getByText(/up to 2 minutes/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start Assessment' })).toBeEnabled();
  });

  it('starts the assessment only when the candidate clicks Start', async () => {
    const api = installFakeAssessmentApi();
    renderApp(BASE);
    await screen.findByRole('heading', { name: 'Welcome, Priya Sharma' });
    expect(api.starts).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Start Assessment' }));
    expect(await questionHeading(1)).toBeInTheDocument();
    expect(screen.getByText('Question 1 of 10')).toBeInTheDocument();
    expect(api.starts).toHaveLength(1);
    expect(api.state.status).toBe('In Progress');
    // The candidate token is sent in the dedicated header.
    const [, init] = api.fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!;
    expect((init?.headers as Record<string, string>)['X-Assessment-Token']).toBe(TOKEN);
  });
});

describe('Question navigation', () => {
  it('displays questions in order with Previous and Next', async () => {
    await openQuestion(1, completeUpTo(10));
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    for (let n = 2; n <= 10; n++) {
      await userEvent.click(screen.getByRole('button', { name: 'Next' }));
      expect(await questionHeading(n)).toBeInTheDocument();
      expect(screen.getByText(`Question ${n} of 10`)).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Review answers' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(await questionHeading(9)).toBeInTheDocument();
  });

  it('keeps and reloads answers when revisiting a question', async () => {
    const api = await openQuestion(1, { videos: [1] });
    await userEvent.type(textarea(), 'Answer one');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await questionHeading(2);
    expect(textarea()).toHaveValue('');

    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await questionHeading(1);
    expect(textarea()).toHaveValue('Answer one');
    expect(api.saves.at(-1)).toMatchObject({ questionId: QUESTIONS[0]!.id, writtenAnswer: 'Answer one' });
  });

  it('loads previously saved answers from the server and allows editing them', async () => {
    const api = await openQuestion(2, { answers: { 1: 'One', 2: 'Saved earlier' }, videos: [1] });
    expect(textarea()).toHaveValue('Saved earlier');
    await userEvent.type(textarea(), ' and edited');
    await waitFor(() => expect(api.state.answers.get(QUESTIONS[1]!.id)).toBe('Saved earlier and edited'));
  });

  it('saves explicitly before moving to another question', async () => {
    assessmentSettings.autosaveDelayMs = 60_000; // autosave would not fire in time
    const api = await openQuestion(1, { videos: [1] });
    await userEvent.type(textarea(), 'Typed quickly');
    expect(api.saves).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await questionHeading(2);
    expect(api.saves).toEqual([{ questionId: QUESTIONS[0]!.id, writtenAnswer: 'Typed quickly', token: TOKEN }]);
  });
});

describe('Written answer field', () => {
  it('shows a live character counter', async () => {
    await openQuestion(1);
    expect(screen.getByText('0/1000')).toBeInTheDocument();
    await userEvent.type(textarea(), 'Hello');
    expect(screen.getByText('5/1000')).toBeInTheDocument();
  });

  it('enforces the 1,000-character limit', async () => {
    const api = await openQuestion(1);
    fireEvent.change(textarea(), { target: { value: 'x'.repeat(1005) } });
    expect(textarea().value).toHaveLength(1000);
    expect(screen.getByText('1000/1000')).toBeInTheDocument();
    expect(screen.getByText(/reached the 1,000-character limit/)).toBeInTheDocument();
    await waitFor(() => expect(api.saves.at(-1)?.writtenAnswer).toHaveLength(1000));
  });
});

describe('Autosave', () => {
  it('saves automatically after typing stops and shows Saving then Saved', async () => {
    const api = await openQuestion(1);
    api.state.saveDelayMs = 50;
    await userEvent.type(textarea(), 'Autosaved text');
    expect(screen.getByTestId('save-status')).toHaveTextContent(/Unsaved changes|Saving/);
    expect(await screen.findByText('Saving…')).toBeInTheDocument();
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(api.saves.at(-1)).toEqual({ questionId: QUESTIONS[0]!.id, writtenAnswer: 'Autosaved text', token: TOKEN });
    // Debounced: one save for the whole burst of typing.
    expect(api.saves).toHaveLength(1);
  });

  it('never sends overlapping saves for the same question and ends with the latest text', async () => {
    const api = await openQuestion(1, { videos: [1] });
    api.state.saveDelayMs = 80;
    await userEvent.type(textarea(), 'first');
    await screen.findByText('Saving…');
    await userEvent.type(textarea(), ' second');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await questionHeading(2);
    await waitFor(() => expect(api.state.answers.get(QUESTIONS[0]!.id)).toBe('first second'));
    expect(api.state.maxInFlight).toBe(1);
  });

  it('shows a save failure, keeps the text, blocks navigation and recovers on retry', async () => {
    const api = await openQuestion(1);
    api.state.failSaves = true;
    await userEvent.type(textarea(), 'Important answer');

    expect(await screen.findByText('Save failed')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/Save failed.*Your text is kept on this page/);
    expect(textarea()).toHaveValue('Important answer');

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Question 1 of 10')).toBeInTheDocument();
    expect(textarea()).toHaveValue('Important answer');

    api.state.failSaves = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry save' }));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(api.state.answers.get(QUESTIONS[0]!.id)).toBe('Important answer');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an offline message when the network is down', async () => {
    const api = await openQuestion(1);
    api.fetchMock.mockImplementation(async () => {
      throw new TypeError('Failed to fetch');
    });
    await userEvent.type(textarea(), 'Offline text');
    expect(await screen.findByRole('alert')).toHaveTextContent(/offline/);
    expect(textarea()).toHaveValue('Offline text');
  });
});

describe('Review screen', () => {
  it('lists all 10 questions with saved answers and flags missing ones', async () => {
    installFakeAssessmentApi({ status: 'In Progress', answers: { 1: 'Alpha answer', 4: 'Delta answer' }, videos: [1] });
    renderApp(`${BASE}/review`);

    expect(await screen.findByRole('heading', { name: 'Review your answers' })).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(10);
    QUESTIONS.forEach((q, i) => expect(within(items[i]!).getByText(q.questionText)).toBeInTheDocument());
    expect(within(items[0]!).getByText('Alpha answer')).toBeInTheDocument();
    expect(within(items[3]!).getByText('Delta answer')).toBeInTheDocument();
    expect(within(items[1]!).getByText('No written answer yet')).toBeInTheDocument();
    expect(screen.getAllByText('No written answer yet')).toHaveLength(8);
    expect(screen.getByText('9 questions still need a written answer and a video.')).toBeInTheDocument();
    expect(screen.getByText('1 of 10 questions complete')).toBeInTheDocument();
  });

  it('is reached by Next on the last question', async () => {
    await openQuestion(10, completeUpTo(10));
    await userEvent.click(screen.getByRole('button', { name: 'Review answers' }));
    expect(await screen.findByRole('heading', { name: 'Review your answers' })).toBeInTheDocument();
  });

  it('Edit returns to the selected question', async () => {
    installFakeAssessmentApi({ status: 'In Progress', ...completeUpTo(5), answers: { ...completeUpTo(5).answers, 6: 'Sixth' } });
    renderApp(`${BASE}/review`);
    await screen.findByRole('heading', { name: 'Review your answers' });

    await userEvent.click(screen.getByRole('link', { name: 'Edit question 6' }));
    expect(await questionHeading(6)).toBeInTheDocument();
    expect(textarea()).toHaveValue('Sixth');
  });
});

describe('Resume', () => {
  it('restores the question and saved answers on refresh', async () => {
    installFakeAssessmentApi({ status: 'In Progress', answers: { 1: 'One', 2: 'Two', 3: 'Three draft' }, videos: [1, 2] });
    renderApp(`${BASE}/questions/3`);

    expect(await questionHeading(3)).toBeInTheDocument();
    expect(textarea()).toHaveValue('Three draft');
    expect(screen.getByText('2 of 10 questions complete')).toBeInTheDocument();
  });

  it('reopening the email link continues at the last question viewed', async () => {
    storePosition(TOKEN, 7);
    const api = installFakeAssessmentApi({ status: 'In Progress', ...completeUpTo(8) });
    renderApp(BASE);
    expect(await questionHeading(7)).toBeInTheDocument();
    expect(api.starts).toHaveLength(0);
  });

  it('without a stored position, continues at the first incomplete question', async () => {
    installFakeAssessmentApi({ status: 'In Progress', ...completeUpTo(2) });
    renderApp(BASE);
    expect(await questionHeading(3)).toBeInTheDocument();
  });

  it('remembers the current question as the candidate moves', async () => {
    const api = await openQuestion(4, completeUpTo(5));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await questionHeading(5);
    expect(api.saves).toHaveLength(0); // nothing typed, nothing saved
    await act(async () => undefined);
    const { getStoredPosition } = await import('../src/utils/assessmentPosition');
    expect(getStoredPosition(TOKEN)).toBe(5);
  });

  it('redirects an unknown question number to question 1', async () => {
    installFakeAssessmentApi({ status: 'In Progress' });
    renderApp(`${BASE}/questions/99`);
    expect(await questionHeading(1)).toBeInTheDocument();
  });

  it('sends a not-yet-started candidate from a question URL to the start screen', async () => {
    installFakeAssessmentApi({ status: 'Invited' });
    renderApp(`${BASE}/questions/2`);
    expect(await screen.findByRole('heading', { name: 'Welcome, Priya Sharma' })).toBeInTheDocument();
  });
});

describe('Invalid links', () => {
  it.each([
    [401, 'INVALID_ASSESSMENT_TOKEN', 'Invitation not found', /link is invalid/],
    [410, 'INVITATION_EXPIRED', 'Invitation expired', /request a new link/],
    [409, 'ASSESSMENT_COMPLETED', 'Assessment already submitted', /already completed/],
  ])('HTTP %i shows "%s"', async (status, code, heading, body) => {
    installFakeAssessmentApi({ loadError: { status, code } });
    renderApp(`${BASE}/questions/1`);
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.getByText(body)).toBeInTheDocument();
    expect(screen.queryByLabelText('Your written answer')).not.toBeInTheDocument();
  });

  it('shows the expired message if the link expires while answering', async () => {
    const api = await openQuestion(1);
    api.fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify({ error: { code: 'INVITATION_EXPIRED', message: 'Expired' } }), {
        status: 410,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await userEvent.type(textarea(), 'x');
    expect(await screen.findByRole('heading', { name: 'Invitation expired' })).toBeInTheDocument();
  });

  it('offers a retry when the assessment cannot be loaded because of a network error', async () => {
    const api = installFakeAssessmentApi({ status: 'In Progress' });
    const working = api.fetchMock.getMockImplementation()!;
    api.fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('Failed to fetch');
    });
    renderApp(`${BASE}/questions/1`);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Unable to reach the server/);
    api.fetchMock.mockImplementation(working);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await questionHeading(1)).toBeInTheDocument();
  });
});

describe('Leaving the page', () => {
  it('flushes a pending autosave when the tab is hidden', async () => {
    assessmentSettings.autosaveDelayMs = 60_000;
    const api = await openQuestion(1);
    await userEvent.type(textarea(), 'Closing soon');
    expect(api.saves).toHaveLength(0);

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    try {
      document.dispatchEvent(new Event('visibilitychange'));
      await waitFor(() => expect(api.saves.at(-1)?.writtenAnswer).toBe('Closing soon'));
      const putCall = api.fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!;
      expect(putCall[1]?.keepalive).toBe(true);
    } finally {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    }
  });

  it('warns before unloading while changes are unsaved', async () => {
    assessmentSettings.autosaveDelayMs = 60_000;
    await openQuestion(1);
    await userEvent.type(textarea(), 'Pending');
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
