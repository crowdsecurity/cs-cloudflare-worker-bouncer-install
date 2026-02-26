import Cloudflare from 'cloudflare';
import type { CloudflareClient } from './types.js';

/**
 * Create a Cloudflare API client with the given token
 */
export function createCloudflareClient(apiToken: string): CloudflareClient {
  return new Cloudflare({
    apiToken,
  });
}

/**
 * Check if an error is a Cloudflare "not found" error
 */
export function isNotFoundError(error: unknown): boolean {
  if (error instanceof Cloudflare.NotFoundError) {
    return true;
  }
  // Also check for common API error patterns
  if (error instanceof Cloudflare.APIError) {
    return error.status === 404;
  }
  return false;
}

/**
 * Extract a concise, user-facing error message.
 * For Cloudflare API errors, uses the errors array instead of the raw response body.
 */
export function extractErrorMessage(error: unknown): string {
  if (error instanceof Cloudflare.APIError) {
    if (error.errors && error.errors.length > 0) {
      return error.errors.map((e: { message: string }) => e.message).join(', ');
    }
    // Fallback: strip the status prefix from the message (e.g. "400 {...}" → just the message)
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Format a Cloudflare API error for display
 */
export function formatApiError(error: unknown, operation: string): string {
  if (error instanceof Cloudflare.APIError) {
    return `Cloudflare API error during ${operation}: ${error.message} (status: ${error.status})`;
  }
  if (error instanceof Error) {
    return `Error during ${operation}: ${error.message}`;
  }
  return `Unknown error during ${operation}: ${String(error)}`;
}
