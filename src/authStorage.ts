const tokenKey = `piki-${location.hostname}-api-token`;
const validationKey = `piki-${location.hostname}-employee-session-validated`;
const emailKey = `piki-${location.hostname}-login-email`;

export function getStoredToken(): string {
  sessionStorage.removeItem(validationKey);
  return localStorage.getItem(tokenKey) || sessionStorage.getItem(tokenKey) || "";
}

export function storeToken(token: string): void {
  sessionStorage.removeItem(validationKey);
  localStorage.setItem(tokenKey, token);
  sessionStorage.setItem(tokenKey, token);
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
}

export function getStoredEmail(): string {
  return localStorage.getItem(emailKey) || "";
}

export function storeEmail(email: string): void {
  localStorage.setItem(emailKey, email.trim().toLowerCase());
}
