"""Pipeline groups: @pipeline(group=) is for people; the Pipelines page lists
a group's pipelines under it."""

from __future__ import annotations

import pytest

import moksha as mk


def test_a_pipeline_says_its_group_when_its_build_registers():
    from moksha import worker

    @mk.pipeline(name="grouped_pipeline", group=" shop ")
    def grouped_pipeline(ctx):
        pass

    @mk.pipeline(name="ungrouped_pipeline")
    def ungrouped_pipeline(ctx):
        pass

    info = {i["pipeline"]: i for i in worker.registration("b-groups")["pipelineInfo"]}
    assert info["grouped_pipeline"]["group"] == "shop"
    assert "group" not in info.get("ungrouped_pipeline", {})

    before = worker.build_id()
    mk._model.PIPELINES["grouped_pipeline"].group = "finance"
    assert worker.build_id() != before, "a new group is a new build, so the server learns it"
    with pytest.raises(ValueError, match="pipeline x: group must be a name"):
        mk.pipeline(name="x", group="a\nb")


def test_a_group_is_a_name_on_one_line():
    for bad in ["", "  ", "a\nb", "x" * 101, 3]:
        with pytest.raises(ValueError, match="group must be a name"):
            mk.pipeline(name="bad_group", group=bad)

    def group_trimmed(ctx):
        pass

    assert mk.pipeline(group=" load ")(group_trimmed).__moksha_pipeline__.group == "load"
