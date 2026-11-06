"""Private worker-to-model contract; no database or frontend dependencies."""
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Nonnegative = Annotated[float, Field(ge=0, allow_inf_nan=False, strict=True)]
ProductID = Annotated[str, Field(pattern=r"^P00(?:0[1-9]|1[0-9]|20)$")]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Features(StrictModel):
    units_sold_today: Nonnegative
    lag_1: Nonnegative
    lag_7: Nonnegative
    lag_14: Nonnegative
    lag_28: Nonnegative
    rolling_mean_7: Nonnegative
    rolling_mean_28: Nonnegative
    rolling_std_28: Nonnegative


class AnalyzeRequest(StrictModel):
    store_id: Literal["S001"]
    product_id: ProductID
    as_of_date: date
    lead_time_days: int = Field(strict=True, gt=0)
    feature_schema_version: Literal["features-v1"]
    input_reference: str = Field(min_length=1, max_length=500)
    features: Features


class AnalyzeResponse(StrictModel):
    store_id: Literal["S001"]
    product_id: str
    as_of_date: date
    horizon_days: int = Field(gt=0)
    forecast_mode: Literal["quantile"] = "quantile"
    predicted_demand_p50: Nonnegative
    predicted_demand_p90: Nonnegative
    model_version: str
    feature_schema_version: str
    input_reference: str

    @model_validator(mode="after")
    def ordered_quantiles(self):
        if self.predicted_demand_p90 < self.predicted_demand_p50:
            raise ValueError("P90 must be >= P50")
        return self


class Observation(StrictModel):
    date: date
    units_sold: Nonnegative
    inventory_level: Nonnegative


class ClosedDayRequest(StrictModel):
    store_id: Literal["S001"]
    product_id: ProductID
    as_of_date: date
    expected_closed_date: date
    input_reference: str = Field(min_length=1, max_length=500)
    lead_time_days: int = Field(strict=True, gt=0)
    history: list[Observation] = Field(max_length=29)

    @model_validator(mode="after")
    def fresh_cutoff(self):
        if self.as_of_date != self.expected_closed_date:
            raise ValueError("Snapshot cutoff must match the expected closed business day")
        if any(row.date > self.as_of_date for row in self.history):
            raise ValueError("Closed-day input cannot contain future observations")
        return self


class ClosedDayResponse(AnalyzeResponse):
    forecast_start: date
    forecast_end: date
    generated_at: datetime


class DiagnosticsRequest(StrictModel):
    store_id: Literal["S001"]
    as_of_date: date
    input_reference: str = Field(min_length=1, max_length=500)
    products: dict[ProductID, Annotated[list[Observation], Field(max_length=56)]] = Field(max_length=20)
