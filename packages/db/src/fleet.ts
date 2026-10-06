// Vehicle-type fleet settings (spec §3, M6): the checks Pydantic's `RunSettings` makes, run at submission so a bad fleet
// is a 400 before a worker sees it. Pure functions with no Node imports: the scenario workbench uses them too.

export type FleetType = {
  id: string;
  label: string;
  /** Vehicles available to the whole dispatch; null means unlimited (today's single trailer). */
  count: number | null;
  /** Capacity in the pipeline's unit: integer hundredths of a foot. */
  capacity: number;
  fixed_cost_cents: number | null;
  per_mile_cents: number | null;
};

export const MAX_FLEET_TYPES = 10;
export const MAX_CAPACITY = 1_000_000;

const isInt = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

/** Why a fleet cannot run, one message per problem (empty when it is fine). `objective` decides whether rates are required. */
export function fleetProblems(settings: { fleet?: FleetType[] | null; objective?: string }): string[] {
  const fleet = settings.fleet;
  if (fleet === undefined || fleet === null) return [];
  if (!Array.isArray(fleet) || !fleet.length) return ["A fleet needs at least one vehicle type; remove the fleet to use the single trailer."];
  const out: string[] = [];
  if (fleet.length > MAX_FLEET_TYPES) out.push(`A fleet has at most ${MAX_FLEET_TYPES} vehicle types.`);
  const seen = new Set<string>();
  fleet.forEach((type, i) => {
    const name = type.label?.trim() || type.id || `type ${i + 1}`;
    if (typeof type.id !== "string" || !type.id.trim() || type.id.length > 200) out.push(`${name}: needs an ID (1–200 characters).`);
    else if (seen.has(type.id)) out.push(`${name}: the ID ${type.id} is used twice.`);
    else seen.add(type.id);
    if (typeof type.label !== "string" || !type.label.trim() || type.label.length > 100) out.push(`${name}: needs a label (1–100 characters).`);
    if (type.count !== undefined && type.count !== null && !isInt(type.count, 1, 100_000)) out.push(`${name}: the count is a whole number from 1 to 100,000, or blank for unlimited.`);
    if (!isInt(type.capacity, 1, MAX_CAPACITY)) out.push(`${name}: the capacity is a whole number of hundredths of a foot, 1 to ${MAX_CAPACITY.toLocaleString("en-US")}.`);
    for (const [key, text] of [["fixed_cost_cents", "fixed cost"], ["per_mile_cents", "cost per mile"]] as const) {
      const value = type[key];
      if (value !== undefined && value !== null && !isInt(value, 0, Number.MAX_SAFE_INTEGER)) out.push(`${name}: the ${text} is a whole number of cents.`);
      else if (settings.objective === "cost" && (value === undefined || value === null)) out.push(`${name}: the lowest-cost objective needs a ${text} in cents on every type.`);
    }
  });
  return out;
}

/** Null or an empty list mean "no fleet": the key is dropped, so the stored settings keep their single-trailer shape. */
export function withoutEmptyFleet<T extends { fleet?: FleetType[] | null }>(settings: T): T {
  if (settings.fleet === null || (Array.isArray(settings.fleet) && !settings.fleet.length)) delete settings.fleet;
  return settings;
}
