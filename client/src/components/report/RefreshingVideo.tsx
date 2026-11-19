import { useState } from 'react';
import type { VideoPlayback } from '../../types/report';

interface Props {
  video: VideoPlayback;
  label: string;
  /** Fetches a fresh presigned URL (e.g. by reloading the report). Returns the new playback info. */
  onRefresh: () => Promise<VideoPlayback | null>;
}

/**
 * Plays a video from a short-lived presigned URL. If loading fails (typically because the URL
 * expired), it fetches a fresh URL once and retries; after that it offers a manual retry.
 */
export function RefreshingVideo({ video, label, onRefresh }: Props) {
  const [current, setCurrent] = useState(video);
  const [refreshed, setRefreshed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);

  async function refresh(manual: boolean) {
    setRefreshing(true);
    try {
      const next = await onRefresh();
      if (next?.url) {
        setCurrent(next);
        setFailed(false);
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setRefreshing(false);
      if (!manual) setRefreshed(true);
    }
  }

  if (!current.available) return null;
  if (!current.url || failed) {
    return (
      <div className="video-unavailable" role="status">
        <span>The video could not be loaded.</span>
        <button type="button" className="button-secondary button-small" onClick={() => void refresh(true)} disabled={refreshing}>
          {refreshing ? 'Loading…' : 'Retry video'}
        </button>
      </div>
    );
  }
  return (
    <video
      key={current.url}
      className="video-frame"
      src={current.url}
      controls
      playsInline
      preload="metadata"
      aria-label={label}
      onError={() => {
        if (refreshing) return;
        if (!refreshed) void refresh(false); // probably an expired URL: get a fresh one once
        else setFailed(true);
      }}
    />
  );
}
