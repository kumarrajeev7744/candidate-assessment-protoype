/**
 * Explains why a presigned video could not be played: S3 refused it (e.g. AccessDenied /
 * NoSuchKey), or the browser cannot play the format (e.g. WebM in Safari).
 */
export async function diagnoseVideoFailure(url: string, mimeType: string | null): Promise<string> {
  const canPlay = mimeType ? document.createElement('video').canPlayType(mimeType) : 'maybe';
  try {
    // Needs the bucket CORS rule for GET (docs/aws/s3-cors.json). Reads only the first byte.
    const res = await fetch(url, { headers: { Range: 'bytes=0-0' } });
    if (res.status === 403) {
      const code = /<Code>([^<]+)<\/Code>/.exec(await res.text())?.[1];
      return `The video file could not be accessed (S3 refused the request${code ? `: ${code}` : ''}).`;
    }
    if (res.status === 404) return 'The video file was not found in storage.';
    if (!res.ok) return `The video file could not be loaded (HTTP ${res.status}).`;
  } catch {
    // CORS/network: cannot inspect the response; fall through to the format check.
  }
  if (mimeType && canPlay === '') {
    return `This browser cannot play ${mimeType} videos. Please open the report in Chrome, Edge or Firefox.`;
  }
  return 'The video could not be played in this browser.';
}
