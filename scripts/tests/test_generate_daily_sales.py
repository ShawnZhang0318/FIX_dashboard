import csv
from datetime import date, timedelta

from scripts.generate_daily_sales import daily_summary


def test_weekday_patterns_and_store_totals_use_only_past_observations(tmp_path):
    source = tmp_path / "sales.csv"
    first = date(2023, 1, 1)
    target = date(2023, 3, 6)  # Monday
    with source.open("w", newline="", encoding="utf-8") as file:
        writer = csv.writer(file)
        writer.writerow(["store_id", "product_id", "date", "units_sold"])
        for offset in range((target - first).days):
            day = first + timedelta(days=offset)
            writer.writerow(["S001", "A", day, 120 if day.weekday() == 0 else 4])
            writer.writerow(["S001", "B", day, 0])
            writer.writerow(["S002", "C", day, 10000])
    monday = daily_summary(source, "S001", target)
    tuesday = daily_summary(source, "S001", target + timedelta(days=1))
    assert monday["total_units_sold"] > tuesday["total_units_sold"]
    assert monday["source"] == "historical_simulation"
    assert monday["history_through"] == "2023-03-05"
    assert monday["items"] == [
        {"product_id": "A", "units_sold": monday["total_units_sold"]},
        {"product_id": "B", "units_sold": 0},
    ]
    with source.open("a", newline="", encoding="utf-8") as file:
        writer = csv.writer(file)
        writer.writerow(["S001", "A", target, 99999])
        writer.writerow(["S001", "A", target + timedelta(days=1), 99999])
    assert daily_summary(source, "S001", target) == monday


def test_sparse_history_uses_the_available_observation(tmp_path):
    source = tmp_path / "sales.csv"
    source.write_text("store_id,product_id,date,units_sold\nS001,P0001,2024-01-01,17\n", encoding="utf-8")
    assert daily_summary(source, "S001", date(2024, 7, 10))["total_units_sold"] == 17
