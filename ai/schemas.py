"""Private worker-to-model contract; no database or frontend dependencies."""
from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Nonnegative = Annotated[float, Field(ge=0, allow_inf_nan=False, strict=True)]


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
    product_id: str = Field(pattern=r"^P00(?:0[1-9]|1[0-9]|20)$")
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
