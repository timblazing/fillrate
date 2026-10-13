"""Regenerate the bundled playground plan: cd services/optimizer && uv run python ../../examples/generate-playground.py."""

import hashlib
import json
from pathlib import Path

from fillrate_optimizer.solve import solve

root = Path(__file__).resolve().parents[1]
example_path = root / "examples/lesson-fulfillment.json"
example = json.loads(example_path.read_text())
settings = {**example["settings"], "solver_time_limit_s": 5}
result = solve("pipeline", example["scenario"], settings)
summary = result["summary"]
assert summary["validity"] == "valid", "The sample must pass independent validation"
assert summary["coverage"] == "complete", "The sample must cover all allocated stock"
optimizer = root / "services/optimizer"
sources = [optimizer / "uv.lock", *sorted((optimizer / "src/fillrate_optimizer").glob("*.py"))]
artifact = {
    "scenario_sha256": hashlib.sha256(example_path.read_bytes()).hexdigest(),
    "optimizer_sha256": hashlib.sha256(b"".join(path.read_bytes() for path in sources)).hexdigest(),
    "summary": summary,
}
output = root / "examples/playground-result.json"
output.write_text(json.dumps(artifact, separators=(",", ":")) + "\n")
print(f"Saved {len(summary['trucks'])} validated shipments to {output.name}")
