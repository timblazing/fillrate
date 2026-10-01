"""Offline export: no live service or network required."""

import json
from pathlib import Path

from pydantic.json_schema import models_json_schema

from .app import app
from .contracts import ContractBundle
from .model import ExplorerSettings, ExplorerSummary, RunSettings, RunSummary, ScenarioDocument

PIPELINE_MODELS = (ScenarioDocument, RunSettings, RunSummary, ExplorerSettings, ExplorerSummary)


def main():
    root = Path(__file__).resolve().parents[4] / "packages/contracts"
    schema = ContractBundle.model_json_schema()
    _, pipeline = models_json_schema([(m, "validation") for m in PIPELINE_MODELS])
    schema["$defs"].update(pipeline["$defs"])
    (root / "schema.json").write_text(json.dumps(schema, indent=2, sort_keys=True) + "\n")
    shared = ContractBundle.model_json_schema(ref_template="#/components/schemas/{model}")
    _, pipeline_refs = models_json_schema(
        [(m, "validation") for m in PIPELINE_MODELS], ref_template="#/components/schemas/{model}"
    )
    document = app.openapi()
    schemas = document.setdefault("components", {}).setdefault("schemas", {})
    schemas.update(shared.pop("$defs"))
    schemas.update(pipeline_refs["$defs"])
    schemas["ContractBundle"] = shared
    (root / "openapi.json").write_text(json.dumps(document, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
