import "server-only";
import { EXAMPLES_OWNER, type Store } from "@fillrate/db";
import { callEvaluator, EvaluationError, evaluationRequest, parsePlan, planContext } from "@fillrate/db/evaluate";

import { evaluationAdmission, type Principal } from "./access";
import { workerToken } from "./database";
import { ApiError } from "./errors";

// Manual plan evaluation (spec §10, §12). The optimizer's FastAPI listens on loopback only (spec §2); its
// address comes from deployment configuration, never from a request.
const optimizerUrl = () => process.env.OPTIMIZER_URL ?? `http://127.0.0.1:${process.env.OPTIMIZER_PORT ?? 8000}`;

function asApiError(error: unknown): never {
  if (error instanceof EvaluationError) throw new ApiError(error.status, error.code, error.message, error.code === "invalid_plan" ? ["routes"] : []);
  throw error;
}

/** Editor context for one cluster of a run the caller can read: problem visits and the optimized routes. */
export function manualPlanContext(store: Store, runId: string, clusterId: unknown) {
  if (typeof clusterId !== "string" || !clusterId) throw new ApiError(400, "invalid_cluster", "Send ?cluster=<cluster id>.", ["cluster"]);
  try {
    return { schema_version: 1, ...planContext(store, runId, clusterId) };
  } catch (error) {
    asApiError(error);
  }
}

/**
 * Evaluates a manual plan for one cluster against the run's recorded problem, alongside the run's own routes.
 * Admission is charged before the optimizer call; nothing is stored. A valid result is a manual baseline:
 * it passed the same validator, it is not a solver result.
 */
export async function evaluateRunPlan(store: Store, who: Principal, runId: string, versionId: string, body: unknown) {
  let assembled;
  try {
    assembled = evaluationRequest(store, runId, parsePlan(body));
  } catch (error) {
    asApiError(error);
  }
  const admission = evaluationAdmission(who, store.versionOwner(versionId) === EXAMPLES_OWNER);
  if (admission) store.admitWork(admission, 1, () => undefined);
  try {
    const result = await callEvaluator(optimizerUrl(), workerToken(), assembled.request);
    return { ...result, run_id: runId, label: "manual" as const, recorded: assembled.recorded };
  } catch (error) {
    asApiError(error);
  }
}
