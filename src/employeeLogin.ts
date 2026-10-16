export type RiderEmployeeLoginPayload = {
  identifier: string;
  password: string;
  role: "rider";
};

/** Explicitly scopes employee sign-in to the rider app's authorized role. */
export function buildRiderEmployeeLoginPayload(
  identifier: string,
  password: string,
): RiderEmployeeLoginPayload {
  return {
    identifier: identifier.trim().toLowerCase(),
    password,
    role: "rider",
  };
}
