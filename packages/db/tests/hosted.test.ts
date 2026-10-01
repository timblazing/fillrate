import { expect, test } from "vitest";
import { clientIp, deploymentMode, ModeConfigError, quotaConfig } from "../src/hosted";

const hosted = { FILLRATE_MODE: "hosted", BETTER_AUTH_SECRET: "x".repeat(32), BETTER_AUTH_URL: "https://fillrate.example.com", GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "secret", NODE_ENV: "production" };
const problems = (env: Record<string, string | undefined>) => { try { deploymentMode(env); return []; } catch (error) { if (error instanceof ModeConfigError) return error.problems; throw error; } };

test("hosted mode needs complete auth configuration and never falls back", () => {
  expect(deploymentMode(hosted)).toMatchObject({ mode: "hosted", auth: { baseURL: "https://fillrate.example.com", origin: "https://fillrate.example.com" } });
  for (const name of ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"] as const) {
    expect(problems({ ...hosted, [name]: undefined }).length, name).toBeGreaterThan(0);
  }
  expect(problems({ ...hosted, BETTER_AUTH_SECRET: "short" })[0]).toMatch(/at least 32/);
  expect(problems({ ...hosted, BETTER_AUTH_URL: "http://fillrate.example.com" })[0]).toMatch(/https/);
  expect(problems({ ...hosted, BETTER_AUTH_URL: "http://localhost:3000" })[0]).toMatch(/https/); // production
  expect(problems({ ...hosted, BETTER_AUTH_URL: "http://localhost:3000", NODE_ENV: "development" })).toEqual([]);
  expect(problems({ ...hosted, BETTER_AUTH_URL: "https://fillrate.example.com/app" })[0]).toMatch(/without a path/);
  // Every problem is reported at once.
  expect(problems({ FILLRATE_MODE: "hosted" })).toHaveLength(4);
});

test("local mode needs no credentials; an unknown mode or auth settings without a mode are refused", () => {
  expect(deploymentMode({ FILLRATE_MODE: "local", NODE_ENV: "production" })).toEqual({ mode: "local", trustedIpHeader: null });
  expect(deploymentMode({})).toEqual({ mode: "operator", trustedIpHeader: null });
  expect(problems({ FILLRATE_MODE: "Hosted" })[0]).toMatch(/hosted or local/);
  expect(problems({ BETTER_AUTH_SECRET: "x".repeat(40) })[0]).toMatch(/FILLRATE_MODE=hosted/);
  expect(problems({ ...hosted, TRUSTED_CLIENT_IP_HEADER: "bad header" })[0]).toMatch(/header name/);
});

test("client addresses come only from the configured proxy header", () => {
  const headers = new Headers({ "x-forwarded-for": "203.0.113.9, 198.51.100.7", "x-real-ip": "not an ip" });
  expect(clientIp(headers, null)).toBeNull();
  expect(clientIp(headers, "x-forwarded-for")).toBe("198.51.100.7");
  expect(clientIp(headers, "x-real-ip")).toBeNull();
  expect(deploymentMode({ ...hosted, TRUSTED_CLIENT_IP_HEADER: "X-Forwarded-For" }).trustedIpHeader).toBe("x-forwarded-for");
});

test("starting limits follow spec §14 and are configurable", () => {
  expect(quotaConfig({}, "hosted")).toMatchObject({ activeJobs: 1, maxQueued: 10, solvesPerDay: 20, uploadBytes: 10 * 1024 * 1024, maxSweepRuns: 10 });
  expect(quotaConfig({}, "local")).toMatchObject({ maxQueued: 50, maxSweepRuns: 25 });
  expect(quotaConfig({ QUOTA_SOLVES_PER_DAY: "5", MAX_QUEUED_RUNS: "bad" }, "hosted")).toMatchObject({ solvesPerDay: 5, maxQueued: 10 });
});
