import { describe, expect, it } from "vitest";
import { friendlyAuthError, withTimeout } from "./errors";

describe("friendlyAuthError", () => {
  it("maps known Supabase errors to clear messages", () => {
    expect(friendlyAuthError({ code: "invalid_credentials", message: "Invalid login credentials" })).toBe("Email or password is incorrect.");
    expect(friendlyAuthError({ message: "Email not confirmed" })).toContain("Confirm your email");
    expect(friendlyAuthError({ status: 429, message: "x" })).toContain("Too many attempts");
    expect(friendlyAuthError({ message: "Unsupported provider: provider is not enabled" })).toContain("Google sign-in is not enabled");
  });

  it("never returns raw error text", () => {
    expect(friendlyAuthError({ message: "PGRST301 relation does not exist" })).toBe("Something went wrong on our side. Try again in a moment.");
    expect(friendlyAuthError(null)).toBe("Something went wrong on our side. Try again in a moment.");
  });
});

describe("withTimeout", () => {
  it("rejects with a timeout error when the promise hangs", async () => {
    await expect(withTimeout(new Promise(() => {}), 10)).rejects.toMatchObject({ code: "timeout" });
  });

  it("passes the value through", async () => {
    await expect(withTimeout(Promise.resolve(3), 50)).resolves.toBe(3);
  });
});
