import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = join(root, "apps/web");
const optimizerDir = join(root, "services/optimizer");
const dataDir = mkdtempSync(join(tmpdir(), "fillrate-browser-smoke-"));
const children = new Set();
let stopping;

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not allocate a local port."));
      server.close((error) => error ? reject(error) : resolvePort(address.port));
    });
  });
}

function launch(command, args, options) {
  const child = spawn(command, args, { stdio: "inherit", ...options });
  children.add(child);
  child.once("exit", () => children.delete(child));
  child.once("error", (error) => console.error(`Could not start ${command}:`, error));
  return child;
}

async function waitForWeb(url, child) {
  const deadline = Date.now() + 90_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`next start exited with code ${child.exitCode}.`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`Production web server did not become ready: ${lastError}`);
}

async function stop() {
  if (stopping) return stopping;
  stopping = (async () => {
    for (const child of children) child.kill("SIGTERM");
    await Promise.race([
      Promise.all([...children].map((child) => new Promise((resolveExit) => child.once("exit", resolveExit)))),
      new Promise((resolveDelay) => setTimeout(resolveDelay, 5_000)),
    ]);
    for (const child of children) child.kill("SIGKILL");
    rmSync(dataDir, { recursive: true, force: true });
  })();
  return stopping;
}

process.once("SIGINT", () => void stop().finally(() => process.exit(130)));
process.once("SIGTERM", () => void stop().finally(() => process.exit(143)));

try {
  const [webPort, internalPort] = await Promise.all([freePort(), freePort()]);
  const workerToken = randomBytes(32).toString("hex");
  const runKey = randomUUID();
  const standaloneAppDir = join(appDir, ".next/standalone/apps/web");
  cpSync(join(appDir, ".next/static"), join(standaloneAppDir, ".next/static"), { recursive: true });
  cpSync(join(appDir, "public"), join(standaloneAppDir, "public"), { recursive: true });
  const commonEnv = {
    ...process.env,
    NODE_ENV: "production",
    DATA_DIR: dataDir,
    WORKER_TOKEN: workerToken,
    INTERNAL_PORT: String(internalPort),
    NEXT_TELEMETRY_DISABLED: "1",
  };
  const web = launch(process.execPath, [join(standaloneAppDir, "server.js")], {
    cwd: standaloneAppDir,
    env: { ...commonEnv, PORT: String(webPort), HOSTNAME: "127.0.0.1", RUN_KEY: runKey },
  });

  const baseURL = `http://127.0.0.1:${webPort}`;
  await waitForWeb(`${baseURL}/learn/fulfillment-pipeline?key=${encodeURIComponent(runKey)}`, web);

  const worker = launch("uv", ["run", "--locked", "fillrate-worker"], {
    cwd: optimizerDir,
    env: {
      ...commonEnv,
      UV_PYTHON: process.env.UV_PYTHON ?? "3.13",
      FILLRATE_INTERNAL_URL: `http://127.0.0.1:${internalPort}`,
      WORKER_ID: `browser-smoke-${process.pid}`,
      WORKER_POLL_SECONDS: "0.2",
    },
  });

  const runner = launch(process.execPath, [
    join(root, "node_modules/@playwright/test/cli.js"),
    "test",
    "--config",
    join(root, "playwright.config.ts"),
  ], { cwd: root, env: { ...process.env, FILLRATE_TEST_BASE_URL: baseURL, FILLRATE_TEST_RUN_KEY: runKey } });

  const exitCode = await new Promise((resolveExit, reject) => {
    runner.once("error", reject);
    runner.once("exit", (code, signal) => resolveExit(code ?? (signal ? 1 : 0)));
  });
  await stop();
  process.exitCode = exitCode;
} catch (error) {
  console.error(error);
  await stop();
  process.exitCode = 1;
}
