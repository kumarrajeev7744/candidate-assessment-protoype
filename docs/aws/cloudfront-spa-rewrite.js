// CloudFront Function (runtime cloudfront-js-2.0), event type: viewer-request.
// Serves index.html for client-side routes (/admin/dashboard, /assessment/<token>, ...) while
// requests for real files (anything with a file extension, e.g. /assets/index-abc123.js) pass through.
function handler(event) {
  var request = event.request;
  var lastSegment = request.uri.split('/').pop();
  if (lastSegment.indexOf('.') === -1) {
    request.uri = '/index.html';
  }
  return request;
}
