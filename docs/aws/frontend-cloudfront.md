# Frontend on S3 + CloudFront

The frontend is a static Vite build (`client/dist`: `index.html`, `favicon.svg` and fingerprinted files under `assets/`). It is served by CloudFront from a **private** S3 bucket.

## 1. Frontend bucket

- A new bucket, separate from the video bucket. Block **all** public access: on. Default encryption: SSE-S3. Static website hosting: **off**, because CloudFront uses the bucket's REST endpoint through Origin Access Control.
- Bucket policy: [`frontend-bucket-policy.json`](frontend-bucket-policy.json). Replace `<FRONTEND_BUCKET_NAME>` and `<CLOUDFRONT_DISTRIBUTION_ARN>`. CloudFront offers to copy this policy when you create the OAC.

## 2. CloudFront distribution

| Setting | Value |
|---|---|
| Origin | the frontend bucket (S3 REST endpoint), **Origin Access Control** (sign requests) |
| Viewer protocol policy | Redirect HTTP to HTTPS |
| Allowed methods | GET, HEAD |
| Cache policy | `CachingOptimized` (managed) |
| Default root object | `index.html` |
| Function association | Viewer request → CloudFront Function from [`cloudfront-spa-rewrite.js`](cloudfront-spa-rewrite.js) (runtime `cloudfront-js-2.0`) |
| Response headers policy | Custom policy, see section 4 |
| Price class | as needed (e.g. "Use North America, Europe, Asia, Middle East, and Africa") |
| Standard logging | **Off**, or make sure only trusted people can read the logs (see the security note below) |
| Alternate domain + ACM certificate | optional; the default `*.cloudfront.net` domain already has HTTPS |

### SPA routing (deep links)

React Router owns paths such as `/admin/dashboard`, `/admin/candidates/<id>`, `/assessment/<token>/questions/3` and `/shared-response/<token>`. These are not files in S3. The viewer-request function rewrites every path whose last segment has no file extension to `/index.html`, so refreshing or opening a deep link works. Real files (`/assets/index-<hash>.js`, `/favicon.svg`) pass through untouched, and a missing asset still returns a real 403/404 instead of an HTML page.

(Alternative: custom error responses mapping 403 and 404 to `/index.html` with status 200. That is simpler to click together, but it also hides broken asset URLs. The function is preferred.)

### Security note: tokens in URLs

Invitation and share tokens are part of the page URL. The app already sends `Referrer-Policy: no-referrer`, and the API never logs raw tokens. If CloudFront standard or real-time logs are enabled, they record full URLs including tokens, so restrict access to that log bucket or leave logging off.

## 3. Build and upload

`VITE_API_BASE_URL` is baked into the bundle at build time. A production build **fails** if it is missing, and it rejects plain `http://` for non-localhost hosts.

```bash
VITE_API_BASE_URL=https://<APP_RUNNER_SERVICE_DOMAIN>/api npm run build:client
```

Check that the bundle points at the production API:

```bash
grep -o "https://<APP_RUNNER_SERVICE_DOMAIN>/api" client/dist/assets/*.js | head -1
```

(`client/dist` also contains the string `http://localhost` from React Router's internal URL parsing; that is expected and is not an API URL.)

Upload fingerprinted assets with a long cache lifetime (their names change on every build):

```bash
aws s3 sync client/dist/assets s3://<FRONTEND_BUCKET_NAME>/assets --cache-control "public,max-age=31536000,immutable"
```

Upload everything else (`index.html`, `favicon.svg`) so browsers revalidate it every time:

```bash
aws s3 sync client/dist s3://<FRONTEND_BUCKET_NAME> --exclude "assets/*" --cache-control "no-cache"
```

Make CloudFront fetch the new `index.html` right away:

```bash
aws cloudfront create-invalidation --distribution-id <DISTRIBUTION_ID> --paths "/index.html" "/"
```

Old files under `assets/` are kept on purpose. A browser that still has the previous `index.html` open can load its files. Delete old assets occasionally if you like.

### Caching summary

| Path | Cache-Control | Effect |
|---|---|---|
| `/assets/*` (hashed names) | `public,max-age=31536000,immutable` | Cached for a year by CloudFront and browsers |
| `/index.html`, `/favicon.svg` | `no-cache` | Revalidated on every load; new deployments appear immediately (after the invalidation) |
| SPA routes (rewritten to `/index.html`) | same as `index.html` | |

## 4. Response headers policy (recommended)

Create a custom response headers policy and attach it to the default behaviour:

| Header | Value |
|---|---|
| Strict-Transport-Security | `max-age=31536000; includeSubDomains` |
| X-Content-Type-Options | `nosniff` |
| X-Frame-Options | `DENY` |
| Referrer-Policy | `no-referrer` (the app relies on this; the managed `SecurityHeadersPolicy` uses a weaker value) |
| Permissions-Policy (custom header) | `camera=(self), microphone=(self), geolocation=()` |

A Content-Security-Policy can be added later. It must allow `connect-src` to the API and the video bucket, `media-src` to the video bucket, and `style-src`/`font-src` for Google Fonts. Test it in report-only mode first, because a wrong CSP breaks video upload and playback.

## 5. Browser features that need HTTPS

Camera/microphone access (`getUserMedia`) only works on HTTPS pages. CloudFront provides HTTPS, so recording works from the production URL. The video bucket's CORS rules must list `https://<CLOUDFRONT_DOMAIN>` for the browser's presigned `PUT` uploads (see [s3-configuration.md](s3-configuration.md)). Playback uses `<video src>` with presigned GET URLs and does not need CORS.
