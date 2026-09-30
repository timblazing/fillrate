"""Offline export: no live service or network required."""

import json
from pathlib import Path

from .app import app
from .contracts import ContractBundle


def main():
    root = Path(__file__).resolve().parents[4] / "packages/contracts"
    schema = ContractBundle.model_json_schema()
    (root / "schema.json").write_text(json.dumps(schema, indent=2, sort_keys=True) + "\n")
    shared = ContractBundle.model_json_schema(ref_template="#/components/schemas/{model}")
    document = app.openapi()
    document.setdefault("components", {}).setdefault("schemas", {}).update(shared.pop("$defs"))
    document["components"]["schemas"]["ContractBundle"] = shared
    (root / "openapi.json").write_text(json.dumps(document, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
