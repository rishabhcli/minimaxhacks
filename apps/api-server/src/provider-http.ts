const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

export interface ProviderFetchOptions {
  fetchImpl?: typeof fetch;
  timeoutMs: number;
  maxAttempts?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Apply a bounded timeout and optional retry policy to an external provider call.
 * Callers must keep maxAttempts at one for non-idempotent mutations.
 */
export async function fetchWithProviderPolicy(
  url: string,
  init: RequestInit,
  options: ProviderFetchOptions,
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 1);
  const sleep = options.sleep ?? wait;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const response = await fetchImpl(url, {
        ...init,
        signal: controller.signal,
      });

      if (response.ok || attempt === maxAttempts - 1 || !RETRYABLE_STATUS_CODES.has(response.status)) {
        return response;
      }

      await response.body?.cancel().catch(() => undefined);
    } catch (error) {
      if (attempt === maxAttempts - 1) throw error;
    } finally {
      clearTimeout(timeout);
    }

    const backoff = Math.min(250 * 2 ** attempt, 1_000) + Math.floor(Math.random() * 100);
    await sleep(backoff);
  }

  throw new Error("Provider request exhausted its retry policy");
}
