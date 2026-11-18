import { withRequestDeadline } from "./requestDeadline";
import { isValidReleasePolicy, type ReleasePolicy } from "./pwaUpdateRecovery";
import type { PikiReleaseIdentity } from "./pikiPwaUpdate";

export async function fetchRiderReleasePolicy(
  fetcher: typeof fetch,
  apiOrigin: string,
  current: PikiReleaseIdentity,
  timeoutMs = 8_000,
  retryDelays: readonly number[] = [0, 750, 2_000],
): Promise<ReleasePolicy> {
  let lastError: unknown = new Error("VERSION_CHECK_FAILED");
  for (const delay of retryDelays) {
    if (delay) await new Promise<void>((resolve) => setTimeout(resolve, delay));
    const controller = new AbortController();
    try {
      return await withRequestDeadline(async (signal) => {
        const query = new URLSearchParams({
          surface: current.surface,
          clientVersion: current.version,
          clientBuildId: current.buildId,
        });
        const response = await fetcher(`${apiOrigin}/api/v1/app-version?${query}`, {
          cache: "no-store", headers: { Accept: "application/json" }, signal,
        });
        if (!response.ok) throw new Error(`VERSION_CHECK_${response.status}`);
        const policy: unknown = await response.json();
        if (!policy || typeof policy !== "object" || !isValidReleasePolicy(policy as ReleasePolicy, current.surface)) {
          throw new Error("VERSION_POLICY_INVALID");
        }
        return policy as ReleasePolicy;
      }, controller, timeoutMs);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("VERSION_CHECK_FAILED");
}
