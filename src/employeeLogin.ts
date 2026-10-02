export type RiderEmployeeLoginPayload = {
  email: string;
  password: string;
  role: "rider";
};

/** Explicitly scopes employee sign-in to the rider app's authorized role. */
export function buildRiderEmployeeLoginPayload(
  email: string,
  password: string,
): RiderEmployeeLoginPayload {
  return {
    email: email.trim().toLowerCase(),
    password,
    role: "rider",
  };
}
