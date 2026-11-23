"""Loops: the pipelines a build says can continue as new."""

from __future__ import annotations

import moksha as mk
from moksha import worker


def _again(ctx, n):
    ctx.continue_as_new(n=n + 1)


def test_a_build_says_which_pipelines_loop():
    @mk.pipeline(name="loops_directly")
    def directly(ctx, n: int = 0):
        ctx.continue_as_new(n=n + 1)

    @mk.pipeline(name="loops_through_a_helper")
    def helper(ctx, n: int = 0):
        _again(ctx, n)

    @mk.pipeline(name="loops_not")
    def ends(ctx):
        """Never calls continue_as_new, though it says the word."""
        return ctx.wait_signal("approve")

    @mk.pipeline(name="loops_not_for_its_child")
    def parent(ctx):
        ctx.start_run(directly)

    info = {i["pipeline"]: i for i in worker.registration("b-loops")["pipelineInfo"]}
    assert info["loops_directly"]["loops"] is True
    assert info["loops_through_a_helper"]["loops"] is True
    assert "loops" not in info.get("loops_not", {})
    assert "loops" not in info.get("loops_not_for_its_child", {})
