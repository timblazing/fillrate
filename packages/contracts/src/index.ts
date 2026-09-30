import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import schema from "../schema.json";
import type { components } from "./generated";
export type { paths, components } from "./generated";
export type StageManifest = components["schemas"]["StageManifest"];
export type Lease = components["schemas"]["Lease"];
export type WorkerEvent = components["schemas"]["WorkerEvent"];
export type Snapshot = components["schemas"]["Snapshot"];

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(schema, "contracts");
export function parseContract<T extends "StageManifest" | "WorkerEvent" | "Snapshot" | "Lease">(
  name: T, value: unknown,
): components["schemas"][T] {
  const validate = ajv.getSchema(`contracts#/$defs/${name}`)!;
  if (!validate(value)) throw new Error(`invalid_${name}: ${ajv.errorsText(validate.errors)}`);
  return value as components["schemas"][T];
}
