import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import schema from "../schema.json";
import type { components } from "./generated";
export type { paths, components } from "./generated";
export type StageManifest = components["schemas"]["StageManifest"];
export type Lease = components["schemas"]["Lease"];
export type WorkerEvent = components["schemas"]["WorkerEvent"];
export type Snapshot = components["schemas"]["Snapshot"];
export type ScenarioDocument = components["schemas"]["ScenarioDocument"];
export type RunSettings = components["schemas"]["RunSettings"];
export type RunSummary = components["schemas"]["RunSummary"];
export type ExplorerSettings = components["schemas"]["ExplorerSettings"];
export type ExplorerSummary = components["schemas"]["ExplorerSummary"];
// Manual plan evaluation (FastAPI /evaluate, spec §10); Next.js assembles the request from a run's artifacts.
export type ClusterPlan = components["schemas"]["ClusterPlan"];
export type EvaluateRequest = components["schemas"]["EvaluateRequest"];
export type EvaluateResponse = components["schemas"]["EvaluateResponse"];
export type PlanEvaluation = components["schemas"]["PlanEvaluation"];
export type PlanViolation = components["schemas"]["PlanViolation"];
export type ContractName = "StageManifest" | "WorkerEvent" | "Snapshot" | "Lease" | "ScenarioDocument" | "RunSettings" | "RunSummary" | "ExplorerSettings" | "ExplorerSummary";

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(schema, "contracts");
export function parseContract<T extends ContractName>(
  name: T, value: unknown,
): components["schemas"][T] {
  const validate = ajv.getSchema(`contracts#/$defs/${name}`)!;
  if (!validate(value)) throw new Error(`invalid_${name}: ${ajv.errorsText(validate.errors)}`);
  return value as components["schemas"][T];
}
