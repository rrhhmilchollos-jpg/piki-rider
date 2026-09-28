const tokenKey = `piki-${location.hostname}-api-token`;
const emailKey = `piki-${location.hostname}-login-email`;

export function getStoredToken(): string {
  return localStorage.getItem(tokenKey) || sessionStorage.getItem(tokenKey) || "";
}

export function storeToken(token: string): void {
  localStorage.setItem(tokenKey, token);
  sessionStorage.setItem(tokenKey, token);
}

export function clearStoredToken(): void {
  localStorage.removeItem(tokenKey);
  sessionStorage.removeItem(tokenKey);
}

export function getStoredEmail(): string {
  return localStorage.getItem(emailKey) || "";
}

export function storeEmail(email: string): void {
  localStorage.setItem(emailKey, email.trim().toLowerCase());
}
