from datetime import datetime

import pytest

from app.core.growth_logic import coverage_gain, level_for, stage_for, week_key


@pytest.mark.parametrize("level", range(1, 51))
def test_level_boundaries(level):
    xp = sum(40 + 20 * (n - 1) for n in range(1, level))
    assert level_for(xp)["level"] == level
    assert level_for(xp)["xp_into_level"] == 0
    if xp:
        assert level_for(xp - 1)["level"] == level - 1
    assert level_for(xp)["xp_for_next"] == (0 if level == 50 else 40 + 20 * (level - 1))


@pytest.mark.parametrize("level,stage", [(1,"egg"),(2,"egg"),(3,"cria"),(6,"cria"),(7,"joven"),
                                         (14,"joven"),(15,"adulto"),(29,"adulto"),(30,"legendario"),(50,"legendario")])
def test_stages(level, stage):
    assert stage_for(level) == stage


def test_cap_week_and_coverage():
    assert level_for(999999)["level"] == 50
    assert week_key(datetime(2021, 1, 1)) == "2020-W53"
    assert week_key(datetime(2026, 10, 7)) == "2026-W41"
    assert coverage_gain({"total":100,"answered":50}, {"total":100,"answered":53})
    assert not coverage_gain({"total":100,"answered":50}, {"total":100,"answered":52})
    assert not coverage_gain({"total":9,"answered":0}, {"total":10,"answered":10})
    assert not coverage_gain({"total":10,"answered":0}, {"total":9,"answered":9})
    assert not coverage_gain({"total":0,"answered":0}, {"total":0,"answered":0})
