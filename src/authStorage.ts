const tokenKey = `piki-${location.hostname}-api-token`;
const validationKey = `piki-${location.hostname}-employee-session-validated`;
const emailKey = `piki-${location.hostname}-login-email`;
const tokenChangedEvent = "piki-token-changed";

export function getStoredToken(): string {
  sessionStorage.removeItem(validationKey);
  return localStorage.getItem(tokenKey) || sessionStorage.getItem(tokenKey) || "";
}

export function storeToken(token: string): void {
  sessionStorage.removeItem(validationKey);
  localStorage.setItem(tokenKey, token);
  sessionStorage.setItem(tokenKey, token);
  window.dispatchEvent(new Event(tokenChangedEvent));
}

export function markStoredTokenValidated(): void {
  sessionStorage.setItem(validationKey, "1");
  window.dispatchEvent(new Event("piki-authenticated"));
}

export function clearStoredToken(): void {
  localStorage.removeItem(tokenKey);
  sessionStorage.removeItem(tokenKey);
  sessionStorage.removeItem(validationKey);
  localStorage.removeItem(emailKey);
  window.dispatchEvent(new Event(tokenChangedEvent));
}

/** Invalidate identity immediately for same-tab changes and cross-tab logout/login. */
export function subscribeStoredToken(onChange: () => void): () => void {
  const storageChanged = (event: StorageEvent) => {
    if (event.key !== tokenKey && event.key !== null) return;
    // localStorage is shared; do not resurrect this tab's stale sessionStorage copy.
    sessionStorage.removeItem(tokenKey);
    sessionStorage.removeItem(validationKey);
    onChange();
  };
  window.addEventListener(tokenChangedEvent, onChange);
  window.addEventListener("storage", storageChanged);
  return () => {
    window.removeEventListener(tokenChangedEvent, onChange);
    window.removeEventListener("storage", storageChanged);
  };
}

export function getStoredEmail(): string {
  return localStorage.getItem(emailKey) || "";
}

export function storeEmail(email: string): void {
  localStorage.setItem(emailKey, email.trim().toLowerCase());
}
export function forgetEmail(): void {
  try { localStorage.removeItem(emailKey); } catch { /* noop */ }
}
