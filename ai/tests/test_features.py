import numpy as np
import pandas as pd
import pytest

from ai.features import build_request


def history():
    return pd.DataFrame({"store_id": "S001", "product_id": "P0001",
                         "date": pd.date_range("2023-10-18", periods=29),
                         "units_sold": range(29)})


def request(frame):
    return build_request(frame, store_id="S001", product_id="P0001",
                         as_of_date="2023-11-15", lead_time_days=3, input_reference="test")


def test_window_and_future_isolation():
    frame = history()
    result = request(frame)
    f = result.features
    assert (f.units_sold_today, f.lag_1, f.lag_7, f.lag_28) == (28, 27, 21, 0)
    assert f.rolling_mean_7 == 24
    assert f.rolling_mean_28 == 13.5
    assert f.rolling_std_28 == pytest.approx(np.std(range(28), ddof=1))
    future = frame.tail(1).assign(date=pd.Timestamp("2023-11-16"), units_sold=100000)
    assert request(pd.concat([frame, future])) == result


@pytest.mark.parametrize("kind", ["missing", "duplicate", "mixed", "negative", "nan"])
def test_bad_history(kind):
    frame = history()
    if kind == "missing":
        frame = frame.drop(4)
    elif kind == "duplicate":
        frame = pd.concat([frame, frame.head(1)])
    elif kind == "mixed":
        frame.loc[0, "store_id"] = "S002"
    elif kind == "negative":
        frame.loc[0, "units_sold"] = -1
    else:
        frame.loc[0, "units_sold"] = np.nan
    with pytest.raises(ValueError):
        request(frame)
