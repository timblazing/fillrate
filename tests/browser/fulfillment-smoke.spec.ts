import { expect, test } from "@playwright/test";

test("public fulfillment lesson produces and exports a valid result without narrow-screen overflow", async ({ page }) => {
  test.setTimeout(180_000);

  const runKey = process.env.FILLRATE_TEST_RUN_KEY;
  if (!runKey) throw new Error("FILLRATE_TEST_RUN_KEY is required by the isolated browser smoke launcher.");

  await page.goto(`/learn/fulfillment-pipeline?key=${encodeURIComponent(runKey)}`);
  await expect(page.getByRole("heading", { name: "Fulfillment pipeline" })).toBeVisible();
  await page.getByRole("button", { name: "Run the pipeline" }).click();

  const openRun = page.getByRole("link", { name: "Open run" });
  await expect(openRun).toBeVisible({ timeout: 15_000 });
  const runPath = await openRun.getAttribute("href");
  expect(runPath).toMatch(/^\/runs\/[0-9a-f-]+\?key=/i);
  await page.goto(runPath!);

  const runId = runPath!.match(/^\/runs\/([0-9a-f-]+)/i)?.[1];
  if (!runId) throw new Error(`Could not read run ID from ${runPath}`);
  let detail: { status: string; summary?: { validity: string; coverage: string; totals: { planned_cents: number; trucks: number } } } | undefined;
  await expect.poll(async () => {
    const response = await page.request.get(`/api/v1/runs/${runId}`);
    if (!response.ok()) return `http-${response.status()}`;
    detail = await response.json();
    return detail.status;
  }, { timeout: 150_000, intervals: [500, 1_000, 2_000, 3_000] }).toBe("succeeded");

  expect(detail?.summary?.validity).toBe("valid");
  expect(detail?.summary?.coverage).toBe("complete");
  expect(detail?.summary?.totals.planned_cents).toBeGreaterThan(0);
  expect(detail?.summary?.totals.trucks).toBeGreaterThan(0);
  await expect(page.getByText("Validated, complete")).toBeVisible();
  await expect(page.getByText("Planned revenue", { exact: true })).toBeVisible();
  await expect(page.getByText("Shipments", { exact: true }).first()).toBeVisible();

  const hasNoHorizontalOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  expect(await hasNoHorizontalOverflow(), "result page should fit at 1440 px").toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(hasNoHorizontalOverflow, { timeout: 10_000 }).toBe(true);

  await page.getByRole("button", { name: "Export" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: "Run JSON (inputs, stages, results)" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^fillrate-run-[0-9a-f]{8}\.json$/i);
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Run JSON download had no readable content.");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const exported = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  expect(exported.run.status).toBe("succeeded");
  expect(exported.summary.validity).toBe("valid");
  expect(exported.summary.coverage).toBe("complete");
  expect(exported.summary.totals.planned_cents).toBeGreaterThan(0);
  expect(exported.summary.totals.trucks).toBeGreaterThan(0);
});
