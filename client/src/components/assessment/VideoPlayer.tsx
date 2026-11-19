import { useState } from 'react';
import { getVideoPlaybackUrl } from '../../services/videoService';
import { ApiError } from '../../services/apiClient';

/** Loads a short-lived presigned URL on demand and plays the candidate's uploaded video. */
export function VideoPlayer({ token, questionId, label = 'Play video' }: { token: string; questionId: string; label?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const playback = await getVideoPlaybackUrl(token, questionId);
      setUrl(playback.url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The video could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  if (url) {
    return (
      <video
        className="video-frame"
        src={url}
        controls
        autoPlay
        playsInline
        aria-label="Uploaded video"
        onError={() => {
          setUrl(null);
          setError('The video could not be played. Please try again.');
        }}
      />
    );
  }
  return (
    <div className="video-controls">
      <button type="button" className="button-secondary button-small" onClick={() => void load()} disabled={loading}>
        {loading ? 'Loading video…' : label}
      </button>
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
