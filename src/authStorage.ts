const tokenKey = `piki-${location.hostname}-api-token`;
const validationKey = `piki-${location.hostname}-employee-session-validated`;
const emailKey = `piki-${location.hostname}-login-email`;
const rememberKey = `piki-${location.hostname}-remember-employee-session`;

export function getStoredToken(): string {
  sessionStorage.removeItem(validationKey);
  return localStorage.getItem(tokenKey) || sessionStorage.getItem(tokenKey) || "";
}

export function storeToken(token: string, rememberDevice = false): void {
  sessionStorage.removeItem(validationKey);
  if (rememberDevice) localStorage.setItem(tokenKey, token);
  else localStorage.removeItem(tokenKey);
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
}

export function getStoredEmail(): string {
  return localStorage.getItem(emailKey) || "";
}

export function getRememberDevice(): boolean {
  return localStorage.getItem(rememberKey) === "true";
}

export function storeEmail(email: string, rememberDevice = false): void {
  if (rememberDevice) {
    localStorage.setItem(emailKey, email.trim().toLowerCase());
    localStorage.setItem(rememberKey, "true");
  } else {
    localStorage.removeItem(emailKey);
    localStorage.removeItem(rememberKey);
  }
}
