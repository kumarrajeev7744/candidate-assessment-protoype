import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { assessmentSettings } from '../src/context/AssessmentContext';
import { videoUploadSettings } from '../src/hooks/useVideoUpload';
import { renderApp } from './helpers/renderApp';
import { completeUpTo, installFakeAssessmentApi, QUESTIONS, TOKEN } from './helpers/fakeAssessmentApi';
import { installFakeMedia, uninstallFakeMedia } from './helpers/fakeMedia';

const BASE = `/assessment/${TOKEN}`;

beforeEach(() => {
  assessmentSettings.autosaveDelayMs = 30;
  videoUploadSettings.retryDelaysMs = [0, 0];
});
afterEach(() => uninstallFakeMedia());
afterAll(() => {
  assessmentSettings.autosaveDelayMs = 1000;
  videoUploadSettings.retryDelaysMs = [1500, 3000];
});

const questionHeading = (n: number) => screen.findByRole('heading', { name: `Question text number ${n}?` });
const videoStatus = () => screen.getByTestId('video-status');

async function open(n: number, options: Parameters<typeof installFakeAssessmentApi>[0] = {}) {
  const api = installFakeAssessmentApi({ status: 'In Progress', ...options });
  const media = installFakeMedia();
  renderApp(`${BASE}/questions/${n}`);
  await questionHeading(n);
  return { api, media };
}

async function recordAndAccept(startLabel = 'Record video') {
  await userEvent.click(screen.getByRole('button', { name: startLabel }));
  await userEvent.click(await screen.findByRole('button', { name: 'Start recording' }));
  await userEvent.click(screen.getByRole('button', { name: 'Stop recording' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Accept video' }));
}

describe('Video upload on the question screen', () => {
  it('uploads the accepted video directly to S3 with progress, then confirms it', async () => {
    const { api } = await open(1);
    let release!: () => void;
    api.state.holdPuts = new Promise((r) => (release = r));
    expect(videoStatus()).toHaveTextContent('No video yet');

    await recordAndAccept();
    expect(await screen.findByText(/Uploading video… 50%/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Upload progress' })).toHaveAttribute('value', '50');

    release();
    await waitFor(() => expect(videoStatus()).toHaveTextContent('Video uploaded'));
    expect(api.uploadUrlRequests).toEqual([
      { questionId: QUESTIONS[0]!.id, mimeType: 'video/webm', sizeBytes: expect.any(Number) },
    ]);
    expect(api.puts).toHaveLength(1);
    expect(api.puts[0]!.url).toMatch(/^https:\/\/s3\.test\//);
    expect(api.puts[0]!.headers).toEqual({ 'Content-Type': 'video/webm' });
    expect(api.puts[0]!.size).toBe(api.uploadUrlRequests[0]!.sizeBytes);
    expect(api.confirms).toEqual([{ questionId: QUESTIONS[0]!.id, objectKey: expect.stringMatching(/^videos\//) }]);
    expect(screen.getByRole('button', { name: 'Play video' })).toBeInTheDocument();
    // No video bytes go through the API (fetch); only JSON calls.
    for (const [, init] of api.fetchMock.mock.calls) expect(init?.body instanceof Blob).toBe(false);
  });

  it('retries a failed upload automatically and succeeds on a retry', async () => {
    const { api, media } = await open(1);
    api.state.failNextPuts = 2;
    await recordAndAccept();
    await waitFor(() => expect(videoStatus()).toHaveTextContent('Video uploaded'));
    expect(api.puts).toHaveLength(3); // initial + 2 retries
    expect(api.confirms).toHaveLength(1);
    expect(media.getUserMedia).toHaveBeenCalledTimes(1); // no re-recording needed
  });

  it('shows the retry count while retrying', async () => {
    const { api } = await open(1);
    videoUploadSettings.retryDelaysMs = [200, 200];
    api.state.failNextPuts = 1;
    await recordAndAccept();
    expect(await screen.findByText(/Upload attempt 1 of 3 failed\. Retrying \(1 of 2 retries\)/)).toBeInTheDocument();
    await waitFor(() => expect(videoStatus()).toHaveTextContent('Video uploaded'));
  });

  it('stops after 2 retries, keeps the recording and lets the candidate try again', async () => {
    const { api, media } = await open(1);
    api.state.failNextPuts = 3;
    await recordAndAccept();

    expect(await screen.findByRole('alert')).toHaveTextContent('Upload failed after 3 attempts');
    expect(api.puts).toHaveLength(3);
    expect(api.confirms).toHaveLength(0);
    expect(videoStatus()).toHaveTextContent('No video yet');
    expect(screen.getByText(/you do not need to record it again/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Try upload again' }));
    await waitFor(() => expect(videoStatus()).toHaveTextContent('Video uploaded'));
    expect(api.puts).toHaveLength(4);
    expect(new Set(api.puts.map((p) => p.size)).size).toBe(1); // same Blob every time
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('can discard a failed upload and re-record', async () => {
    const { api } = await open(1);
    api.state.failNextPuts = 3;
    await recordAndAccept();
    await screen.findByRole('button', { name: 'Try upload again' });
    await userEvent.click(screen.getByRole('button', { name: 'Discard and re-record' }));
    expect(screen.getByRole('button', { name: 'Record video' })).toBeInTheDocument();
  });

  it('does not allow moving on until the written answer and video are saved', async () => {
    const { api } = await open(1);
    const next = () => screen.getByRole('button', { name: 'Next' });

    await userEvent.click(next());
    expect(await screen.findByRole('alert')).toHaveTextContent('Please write your answer before continuing.');

    await userEvent.type(screen.getByLabelText('Your written answer'), 'My answer');
    await userEvent.click(next());
    expect(await screen.findByRole('alert')).toHaveTextContent('Please record and upload your video answer before continuing.');
    expect(screen.getByText('Question 1 of 10')).toBeInTheDocument();

    let release!: () => void;
    api.state.holdPuts = new Promise((r) => (release = r));
    await recordAndAccept();
    await screen.findByText(/Uploading video/);
    expect(next()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    release();
    await waitFor(() => expect(videoStatus()).toHaveTextContent('Video uploaded'));
    expect(screen.getByText('1 of 10 questions complete')).toBeInTheDocument();
    expect(screen.queryByText(/Please record and upload/)).not.toBeInTheDocument(); // stale message cleared
    await userEvent.click(next());
    expect(await questionHeading(2)).toBeInTheDocument();
  });

  it('re-recording replaces the previous video', async () => {
    const { api } = await open(1, completeUpTo(1));
    expect(videoStatus()).toHaveTextContent('Video uploaded');

    await userEvent.click(screen.getByRole('button', { name: 'Re-record video' }));
    await recordAndAccept('Record a new video');
    await waitFor(() => expect(api.confirms).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Re-record video' })).toBeInTheDocument());
    expect(api.state.videoKeys.get(QUESTIONS[0]!.id)).toBe(api.confirms[0]!.objectKey);
    expect(api.state.deletedKeys).toEqual(['videos/existing/1.webm']);
  });

  it('can keep the current video instead of re-recording', async () => {
    await open(1, completeUpTo(1));
    await userEvent.click(screen.getByRole('button', { name: 'Re-record video' }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep my current video' }));
    expect(screen.getByRole('button', { name: 'Play video' })).toBeInTheDocument();
  });

  it('plays an uploaded video through a presigned URL', async () => {
    await open(1, completeUpTo(1));
    await userEvent.click(screen.getByRole('button', { name: 'Play video' }));
    expect(await screen.findByLabelText('Uploaded video')).toHaveAttribute(
      'src',
      'https://s3.test/videos/existing/1.webm?download=1',
    );
  });

  it('restores the confirmed video status after a refresh', async () => {
    await open(3, { ...completeUpTo(2), videos: [1, 2, 3] });
    expect(videoStatus()).toHaveTextContent('Video uploaded');
    expect(screen.getByRole('button', { name: 'Play video' })).toBeInTheDocument();
  });

  it('does not open a later question before earlier ones are complete', async () => {
    installFakeAssessmentApi({ status: 'In Progress', ...completeUpTo(1) });
    installFakeMedia();
    renderApp(`${BASE}/questions/5`); // question 2 is the first incomplete one
    expect(await questionHeading(2)).toBeInTheDocument();
    expect(screen.getByText('Question 2 of 10')).toBeInTheDocument();
  });

  it('releases the camera when leaving a question mid-recording', async () => {
    const { media } = await open(2, completeUpTo(1));
    await userEvent.click(screen.getByRole('button', { name: 'Record video' }));
    await screen.findByRole('button', { name: 'Start recording' });
    expect(media.liveTracks()).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await questionHeading(1);
    expect(media.liveTracks()).toHaveLength(0);
  });
});

describe('Review screen video status', () => {
  it('shows each question’s video status and playback', async () => {
    installFakeAssessmentApi({ status: 'In Progress', ...completeUpTo(3) });
    renderApp(`${BASE}/review`);
    await screen.findByRole('heading', { name: 'Review your answers' });

    expect(screen.getByTestId('review-video-status-1')).toHaveTextContent('Video: Uploaded');
    expect(screen.getByTestId('review-video-status-4')).toHaveTextContent('Video: Not recorded');
    const items = screen.getAllByRole('listitem', { name: /^Question \d+$/ });
    expect(within(items[0]!).getByText('Complete')).toBeInTheDocument();
    expect(within(items[3]!).getByText('Incomplete')).toBeInTheDocument();
    expect(screen.getByText('3 of 10 questions complete')).toBeInTheDocument();

    await userEvent.click(within(items[1]!).getByRole('button', { name: 'Play video' }));
    expect(await within(items[1]!).findByLabelText('Uploaded video')).toHaveAttribute(
      'src',
      'https://s3.test/videos/existing/2.webm?download=1',
    );
  });
});
