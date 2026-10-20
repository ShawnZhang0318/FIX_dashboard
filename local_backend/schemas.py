from datetime import date
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from local_backend.storage import MANIFEST

Nonnegative = Annotated[float, Field(ge=0, allow_inf_nan=False, strict=True)]
Text = Annotated[str, Field(min_length=1)]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Snapshot(Strict):
    store_id: Literal["S001"]
    product_id: Text
    snapshot_date: date
    category_raw: Text
    region_raw: Text
    inventory_level: Nonnegative
    units_sold: Nonnegative
    units_ordered: Nonnegative
    price: Nonnegative
    discount_raw: Nonnegative
    weather_condition: Text
    holiday_promotion: Annotated[int, Field(strict=True, ge=0, le=1)]
    competitor_pricing: Nonnegative
    seasonality_raw: Text
    demand_forecast_benchmark: Annotated[float, Field(allow_inf_nan=False, strict=True)]
    source_reference: Text

    @model_validator(mode="after")
    def product_supported(self):
        if self.product_id not in MANIFEST["product_id_categories"]:
            raise ValueError("Product is not in the frozen v1 roster")
        return self


class SnapshotBatch(Strict):
    source_file_sha256: str = Field(pattern=r"^[a-fA-F0-9]{64}$")
    snapshots: list[Snapshot] = Field(min_length=1, max_length=100)


class RunRequest(Strict):
    store_id: Literal["S001"]
    run_type: Literal["daily"]
    as_of_date: date


class Review(Strict):
    decision: Literal["approve", "modify", "reject", "resolve"]
    reviewer_label: str = Field(min_length=1, max_length=100)
    override_reason: str = Field(default="", max_length=1000)
    reviewer_order_quantity: Annotated[int, Field(strict=True, ge=0)] | None = None
