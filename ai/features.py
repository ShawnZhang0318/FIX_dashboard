"""Cutoff-safe features matching model_v1.ipynb, including std(ddof=1)."""
import numpy as np
import pandas as pd

from ai.schemas import AnalyzeRequest


def build_request(history, *, store_id, product_id, as_of_date,
                  lead_time_days, input_reference):
    """Consume one series, with date/units_sold; require t-28 through t inclusive.

    Mixed identities, duplicate/missing dates and invalid sales are errors.
    Rows after the cutoff are ignored. Missing sales are never zero-filled.
    """
    frame = pd.DataFrame(history).copy()
    required = {"store_id", "product_id", "date", "units_sold"}
    if not required.issubset(frame.columns):
        raise ValueError(f"History requires {sorted(required)}")
    if not frame.store_id.eq(store_id).all() or not frame.product_id.eq(product_id).all():
        raise ValueError("History must contain exactly the requested store/product")
    cutoff = pd.Timestamp(as_of_date)
    if cutoff.tzinfo is not None or cutoff != cutoff.normalize():
        raise ValueError("Cutoff must be a timezone-free calendar date")
    frame["date"] = pd.to_datetime(frame["date"], errors="raise")
    if frame.date.isna().any() or frame.date.dt.tz is not None:
        raise ValueError("History dates must be nonmissing timezone-free dates")
    if not frame.date.eq(frame.date.dt.normalize()).all():
        raise ValueError("History dates must be calendar dates")
    frame = frame.loc[frame.date.between(cutoff - pd.Timedelta(days=28), cutoff)]
    if frame.date.duplicated().any():
        raise ValueError("Duplicate historical date")
    frame = frame.sort_values("date").set_index("date")
    expected = pd.date_range(cutoff - pd.Timedelta(days=28), cutoff)
    if not frame.index.equals(expected):
        raise ValueError("Need current day and 28 consecutive preceding days")
    if frame.units_sold.map(lambda x: isinstance(x, (bool, np.bool_))).any():
        raise ValueError("Sales cannot be booleans")
    sales = pd.to_numeric(frame.units_sold, errors="raise").astype(float)
    if not np.isfinite(sales).all() or (sales < 0).any():
        raise ValueError("Sales must be finite and nonnegative")
    previous = sales.iloc[:-1]
    features = {"units_sold_today": float(sales.iloc[-1])}
    features.update({f"lag_{k}": float(sales.iloc[-1-k]) for k in (1, 7, 14, 28)})
    features.update(rolling_mean_7=float(previous.iloc[-7:].mean()),
                    rolling_mean_28=float(previous.mean()),
                    rolling_std_28=float(previous.std(ddof=1)))
    return AnalyzeRequest(store_id=store_id, product_id=product_id,
                          as_of_date=cutoff.date(), lead_time_days=lead_time_days,
                          feature_schema_version="features-v1",
                          input_reference=input_reference, features=features)


def prepare_X(request: AnalyzeRequest, manifest):
    if request.product_id not in manifest["product_id_categories"]:
        raise ValueError("Unknown product")
    if request.lead_time_days != manifest["product_lead_times"][request.product_id]:
        raise ValueError("Lead time must match the model's fixed product catalog")
    row = request.features.model_dump()
    row.update(product_id=request.product_id, lead_time_days=request.lead_time_days,
               day_of_week=request.as_of_date.weekday(), month=request.as_of_date.month)
    frame = pd.DataFrame([row], columns=manifest["feature_columns_in_order"])
    frame["product_id"] = pd.Categorical(frame.product_id,
                                        categories=manifest["product_id_categories"])
    numeric = [col for col in frame if col != "product_id"]
    frame[numeric] = frame[numeric].astype("float64")
    if frame.isna().any().any() or not np.isfinite(frame[numeric].to_numpy()).all():
        raise ValueError("Missing or non-finite features")
    return frame
