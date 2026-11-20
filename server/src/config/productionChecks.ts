import type { AppConfig } from './env.js';

export interface ConfigCheckResult {
  /** Problems that would make the deployment insecure or broken: startup is refused. */
  errors: string[];
  /** Likely misconfigurations that do not prevent startup. */
  warnings: string[];
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.localhost');
}

/**
 * Validates settings that only matter in production (NODE_ENV=production).
 * Messages name the variable but never include its value.
 */
export function checkProductionConfig(config: AppConfig, env: NodeJS.ProcessEnv = process.env): ConfigCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (config.nodeEnv !== 'production') return { errors, warnings };

  if (!env.CLIENT_URL?.trim()) {
    errors.push('CLIENT_URL must be set to the public frontend URL (e.g. the CloudFront https:// URL).');
  } else {
    for (const url of config.clientUrls) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        errors.push('CLIENT_URL contains an invalid URL.');
        continue;
      }
      if (parsed.protocol !== 'https:') errors.push('CLIENT_URL entries must use https:// in production.');
      else if (isLocalHost(parsed.hostname)) errors.push('CLIENT_URL must not point to localhost in production.');
      if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
        errors.push('CLIENT_URL entries must be origins only (scheme and host, no path).');
      }
    }
  }
  if (!config.mongodbUri) errors.push('MONGODB_URI must be set.');

  if (config.trustProxy === 0) {
    warnings.push('TRUST_PROXY is 0: behind App Runner every request appears to come from the load balancer, so rate limits would be shared by all users. Set TRUST_PROXY=1.');
  }
  if (!config.smtp.user || !config.smtp.pass) warnings.push('SMTP_USER/SMTP_PASS are not set: invitation and share emails will fail.');
  else if (!config.smtp.from) warnings.push('SMTP_FROM is not set: emails will be sent from SMTP_USER with a default display name.');
  if (!config.video.region || !config.video.bucket) warnings.push('AWS_REGION/S3_VIDEO_BUCKET are not set: video upload and playback will fail.');
  if (config.video.endpoint) warnings.push('S3_ENDPOINT is set: it is meant for local S3 emulators only and should be removed in production.');
  if (env.AWS_ACCESS_KEY_ID || env.AWS_SECRET_ACCESS_KEY) {
    warnings.push('AWS access keys are set in the environment: on App Runner use the instance role instead of long-lived keys.');
  }
  if (env.ADMIN_PASSWORD) warnings.push('ADMIN_PASSWORD is set: it is only needed while running seed:admin and should be removed from the service.');
  return { errors, warnings };
}
