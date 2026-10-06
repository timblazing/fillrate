#!/usr/bin/env node

// Review `/request-access` and `/admin` pages for horizontal overflow and UI issues
// at desktop (1440×900) and mobile (393×852) viewports using agent-browser.
// Run after `bun run build`: node scripts/review-access-pages.mjs

import { exec } from "node:child_process";
import { spawn } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const Database = createRequire(join(root, "packages/db/package.json"))("better-sqlite3");
const appDir = join(root, "apps/web");
const standalone = join(appDir, ".next/standalone/apps/web");

const freePort = () => new Promise((ok, fail) => {
  const server = createServer().once("error", fail);
  server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => ok(port)); });
});

async function startServer(env) {
  const dataDir = mkdtempSync(join(tmpdir(), "fillrate-review-access-"));
  const [port, internal] = await Promise.all([freePort(), freePort()]);
  const output = [];
  const child = spawn(process.execPath, [join(standalone, "server.js")], {
    cwd: standalone, stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", DATA_DIR: dataDir, PORT: String(port), HOSTNAME: "127.0.0.1", INTERNAL_PORT: String(internal), WORKER_TOKEN: randomBytes(32).toString("hex"), ...env },
  });
  child.stdout.on("data", d => output.push(String(d)));
  child.stderr.on("data", d => output.push(String(d)));
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) })).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  const stop = async () => {
    if (child.exitCode === null) { child.kill("SIGTERM"); await new Promise(r => child.once("exit", r)); }
    rmSync(dataDir, { recursive: true, force: true });
  };
  return { child, base, dataDir, output, stop };
}

async function runAgentBrowserCommand(cmd, env = {}) {
  try {
    const { stdout, stderr } = await execAsync(cmd, { env: { ...process.env, ...env }, maxBuffer: 10 * 1024 * 1024 });
    return { stdout, stderr };
  } catch (error) {
    console.error(`Command failed: ${cmd}`);
    console.error(error.stdout || error.message);
    throw error;
  }
}

async function testAccessPages() {
  const secret = randomBytes(32).toString("base64");
  const origin = "https://fillrate.example.com";
  const server = await startServer({
    FILLRATE_MODE: "hosted",
    BETTER_AUTH_SECRET: secret,
    BETTER_AUTH_URL: origin,
    GITHUB_CLIENT_ID: "check-client",
    GITHUB_CLIENT_SECRET: "check-secret",
    ADMIN_GITHUB_ID: "119372400",
    SIGNUP_MODE: "request"
  });

  const b = server.base;
  const db = new Database(join(server.dataDir, "fillrate.sqlite"));
  const now = Date.now();

  const createSession = (name, githubId) => {
    const userId = randomUUID(), token = randomBytes(24).toString("hex");
    db.prepare("INSERT INTO user (id,name,email,email_verified,image,created_at,updated_at) VALUES (?,?,?,1,NULL,?,?)").run(userId, name, `${name.toLowerCase()}@example.com`, now, now);
    db.prepare("INSERT INTO account (id,account_id,provider_id,user_id,created_at,updated_at) VALUES (?,?,'github',?,?,?)").run(randomUUID(), githubId, userId, now, now);
    db.prepare("INSERT INTO session (id,expires_at,token,created_at,updated_at,user_id) VALUES (?,?,?,?,?,?)").run(randomUUID(), now + 86_400_000, token, now, now, userId);
    const signature = createHmac("sha256", secret).update(token).digest("base64");
    const cookieValue = `__Secure-better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
    return { userId, token, cookieValue };
  };

  // Create test users with various access levels and long names for testing
  const admin = createSession("Admin User", "119372400");
  const pending = createSession("Pending Request User With Long Name", "123456");

  // Add long notes to test text wrapping
  db.prepare("UPDATE access_requests SET note=? WHERE user_id=?").run(
    "Testing the fillrate optimization system with sample delivery orders from our internal database to ensure it can handle large-scale logistics scenarios.",
    pending.userId
  );

  // Create additional test users to fill the admin table
  const u1 = createSession("Alice Wonderland", "11111");
  const u2 = createSession("Bob Smith Very Very Long Name", "22222");
  db.prepare("UPDATE access_requests SET note=? WHERE user_id=?").run("Testing with sample deliveries", u1.userId);

  db.close();

  // Create screenshots directory
  const screenshotDir = mkdtempSync(join(tmpdir(), "fillrate-review-"));
  console.log(`Screenshots directory: ${screenshotDir}\n`);

  const sessionId = `review-${Date.now()}`;
  const env = { AGENT_BROWSER_SESSION: sessionId };
  let hasOverflowIssues = false;

  try {
    console.log("=== Desktop 1440×900 ===\n");

    // Desktop /request-access
    console.log("Testing /request-access (pending user)...");
    await runAgentBrowserCommand(`agent-browser open "${b}/request-access" --cookie "${pending.cookieValue}"`, env);
    await runAgentBrowserCommand(`agent-browser set viewport 1440 900`, env);
    const scrollCheck1 = await runAgentBrowserCommand(
      `agent-browser eval "document.documentElement.scrollWidth <= window.innerWidth ? 'OK' : 'OVERFLOW: ' + document.documentElement.scrollWidth + ' > ' + window.innerWidth"`,
      env
    );
    console.log(`  Overflow check: ${scrollCheck1.stdout.trim()}`);
    if (!scrollCheck1.stdout.includes("OK")) hasOverflowIssues = true;
    await runAgentBrowserCommand(`agent-browser screenshot "${join(screenshotDir, '01-request-access-desktop.png')}"`, env);
    await runAgentBrowserCommand(`agent-browser close`, env);

    // Desktop /admin  
    console.log("Testing /admin (admin user)...");
    await runAgentBrowserCommand(`agent-browser open "${b}/admin" --cookie "${admin.cookieValue}"`, env);
    await runAgentBrowserCommand(`agent-browser set viewport 1440 900`, env);
    const scrollCheck2 = await runAgentBrowserCommand(
      `agent-browser eval "document.documentElement.scrollWidth <= window.innerWidth ? 'OK' : 'OVERFLOW: ' + document.documentElement.scrollWidth + ' > ' + window.innerWidth"`,
      env
    );
    console.log(`  Overflow check: ${scrollCheck2.stdout.trim()}`);
    if (!scrollCheck2.stdout.includes("OK")) hasOverflowIssues = true;
    await runAgentBrowserCommand(`agent-browser screenshot "${join(screenshotDir, '02-admin-desktop.png')}"`, env);
    await runAgentBrowserCommand(`agent-browser close`, env);

    console.log("\n=== Mobile 393×852 (iPhone 16) ===\n");

    // Mobile /request-access
    console.log("Testing /request-access (pending user)...");
    await runAgentBrowserCommand(`agent-browser open "${b}/request-access" --cookie "${pending.cookieValue}"`, env);
    await runAgentBrowserCommand(`agent-browser set viewport 393 852`, env);
    const scrollCheck3 = await runAgentBrowserCommand(
      `agent-browser eval "document.documentElement.scrollWidth <= window.innerWidth ? 'OK' : 'OVERFLOW: ' + document.documentElement.scrollWidth + ' > ' + window.innerWidth"`,
      env
    );
    console.log(`  Overflow check: ${scrollCheck3.stdout.trim()}`);
    if (!scrollCheck3.stdout.includes("OK")) hasOverflowIssues = true;
    await runAgentBrowserCommand(`agent-browser screenshot "${join(screenshotDir, '03-request-access-mobile.png')}"`, env);
    await runAgentBrowserCommand(`agent-browser close`, env);

    // Mobile /admin
    console.log("Testing /admin (admin user)...");
    await runAgentBrowserCommand(`agent-browser open "${b}/admin" --cookie "${admin.cookieValue}"`, env);
    await runAgentBrowserCommand(`agent-browser set viewport 393 852`, env);
    const scrollCheck4 = await runAgentBrowserCommand(
      `agent-browser eval "document.documentElement.scrollWidth <= window.innerWidth ? 'OK' : 'OVERFLOW: ' + document.documentElement.scrollWidth + ' > ' + window.innerWidth"`,
      env
    );
    console.log(`  Overflow check: ${scrollCheck4.stdout.trim()}`);
    if (!scrollCheck4.stdout.includes("OK")) hasOverflowIssues = true;
    await runAgentBrowserCommand(`agent-browser screenshot "${join(screenshotDir, '04-admin-mobile.png')}"`, env);

    // Cleanup
    await runAgentBrowserCommand(`agent-browser close --all`, env);

    console.log(`\n✓ Screenshots saved to: ${screenshotDir}`);
    if (hasOverflowIssues) {
      console.log("⚠ WARNING: Overflow issues detected on one or more pages");
    } else {
      console.log("✓ All viewport checks passed");
    }

  } catch (error) {
    console.error("Test error:", error.message);
  } finally {
    await server.stop();
  }
}

testAccessPages().catch(console.error).finally(() => process.exit(0));
