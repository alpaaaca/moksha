"""Data versions passed inside a list, a dict or a dataclass travel as the
step's inputs, like those passed on their own: lineage, the run's DAG, and
content hashes (not IDs) in the fingerprint."""

from __future__ import annotations

import dataclasses
import json

import moksha as mk
from conftest import wait
from moksha._replay import Ctx


def test_nested_data_versions_are_inputs(client):
    run_id = client.start_run("nested_inputs", {})
    h = wait(client, run_id)
    assert h["status"] == "completed", h
    res = json.loads(h["resultJson"])
    assert res["result"] == {"parts": ["a", "b"], "by_name": {"x/y": "c"}, "bundle": ["z", "d"]}
    combine = next(l for l in h["steps"] if l["name"] == "nested_combine")
    assert combine.get("after") == [1, 2, 3, 4], "edges from every part it reads"

    got = client.call("CatalogService", "GetDataVersion", {"id": res["id"]})
    edges = got["upstream"]["edges"]
    assert sorted(e["name"] for e in edges) == ["bundle/extra", "by_name/x~1y", "parts/0", "parts/1"]
    parts = {l["seq"]: l["dataVersion"] for l in h["steps"] if l["name"] == "nested_part"}
    assert {e["inputId"] for e in edges} == set(parts.values())


def test_arguments_hold_placeholders_not_ids():
    @mk.step(name="nested_args_step")
    def take(top, many: list, named: dict, nothing: int = 0):
        pass

    @dataclasses.dataclass
    class Pair:
        left: mk.DataVersion
        n: int

    dv = lambda i: mk.DataVersion(id=f"dv{i}", dataset="d")  # noqa: E731
    ctx = Ctx("run", [])
    seq, _ = ctx._step_command(take, (dv(0), [dv(1), 5], {"a~b": dv(2), "p": Pair(dv(3), 7)}), {})
    step = ctx.commands[seq - 1]["step"]
    assert step["inputs"] == [
        {"name": "top", "data_version": "dv0"},
        {"name": "many/0", "data_version": "dv1"},
        {"name": "named/a~0b", "data_version": "dv2"},
        {"name": "named/p/left", "data_version": "dv3"},
    ]
    assert "dv" not in step["argsJson"], "IDs stay out of the arguments and so the fingerprint"
    args = mk._model.decode(json.loads(step["argsJson"]),
                            {i["name"]: mk.DataVersion(id=i["data_version"]) for i in step["inputs"]})
    assert args == {"top": mk.DataVersion(id="dv0"), "many": [mk.DataVersion(id="dv1"), 5],
                    "named": {"a~b": mk.DataVersion(id="dv2"), "p": {"left": mk.DataVersion(id="dv3"), "n": 7}}}
