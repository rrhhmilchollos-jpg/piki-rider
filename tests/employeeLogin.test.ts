import { describe, expect, it } from "vitest";
import { buildRiderEmployeeLoginPayload } from "../src/employeeLogin";

describe("rider employee login payload", () => {
  it("normalizes the email and explicitly requests the rider role", () => {
    expect(buildRiderEmployeeLoginPayload("  Adolfo@Example.com ", "password-123")).toEqual({
      email: "adolfo@example.com",
      password: "password-123",
      role: "rider",
    });
  });
});
