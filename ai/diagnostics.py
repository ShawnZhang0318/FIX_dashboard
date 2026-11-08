"""Daily and monthly SKU diagnostics over frozen daily observations."""
from datetime import timedelta
from statistics import mean


ROSTER = tuple(f"P{i:04d}" for i in range(1, 21))
POLICY_VERSION = "s001-diagnostics-v1"
DAILY_ZERO_DAYS = 3
MONTHLY_ZERO_DAYS = 7
MONTHLY_STOCKOUT_PERIODS = 3
WEEKLY_DEVIATION = 0.25
MIN_COMPARABLE_DAYS = 4
PERSISTENCE_WEEKS = 3


def finding(status, reason, **evidence):
    return {"status": status, "reason": reason, **evidence}


def daily_checks(rows, cutoff):
    today = rows.get(cutoff)
    prior = [rows.get(cutoff - timedelta(days=i)) for i in range(1, 29)]
    if today is None or None in prior:
        high = finding("insufficient_data", "requires_cutoff_and_28_prior_sales_days")
    else:
        baseline = mean(row.units_sold for row in prior)
        threshold = max(5, 2 * baseline)
        high = finding("anomaly" if today.units_sold > threshold else "normal",
                       "sales_above_prior_baseline" if today.units_sold > threshold else "within_threshold",
                       observed=today.units_sold, baseline=baseline, threshold=threshold)

    streak = 0
    row = today
    while row is not None and row.inventory_level == 0:
        streak += 1
        row = rows.get(cutoff - timedelta(days=streak))
    if streak >= DAILY_ZERO_DAYS:
        stock = finding("anomaly", "at_least_three_consecutive_zero_stock_days",
                        observed=streak, lower_bound=row is None, threshold=DAILY_ZERO_DAYS)
    elif row is None:
        stock = finding("insufficient_data", "gap_in_current_stockout_window", observed=streak)
    else:
        stock = finding("normal", "below_stockout_threshold",
                        observed=streak, threshold=DAILY_ZERO_DAYS)
    return {"high_sales": high, "persistent_zero_stock": stock}


def stockout_metrics(window):
    count = periods = longest = streak = 0
    for row in window:
        if row.inventory_level == 0:
            periods += streak == 0
            count += 1
            streak += 1
            longest = max(longest, streak)
        else:
            streak = 0
    return {"zero_days": count, "zero_share": count / len(window),
            "periods": periods, "longest_streak": longest}


def monthly_checks(rows, cutoff):
    panel = [rows.get(cutoff - timedelta(days=i)) for i in range(55, -1, -1)]
    names = ("persistent_high_sales", "persistent_low_sales", "long_stockout")
    if None in panel:
        return {name: finding("insufficient_data", "requires_56_consecutive_observations",
                              observed_days=sum(row is not None for row in panel))
                for name in names}
    reference, recent = panel[:28], panel[28:]
    prior_stock, current_stock = stockout_metrics(reference), stockout_metrics(recent)
    stock_anomaly = (current_stock["zero_days"] >= MONTHLY_ZERO_DAYS
                     or current_stock["periods"] >= MONTHLY_STOCKOUT_PERIODS)
    stock = finding("anomaly" if stock_anomaly else "normal",
                    "frequent_or_prolonged_stockouts" if stock_anomaly else "within_threshold",
                    recent=current_stock, reference=prior_stock,
                    zero_days_threshold=MONTHLY_ZERO_DAYS,
                    periods_threshold=MONTHLY_STOCKOUT_PERIODS)

    # Compare matched weekdays with positive observed stock in both windows.
    comparisons = []
    for start in range(0, 28, 7):
        comparable = [(old.units_sold, new.units_sold)
                      for old, new in zip(reference[start:start + 7], recent[start:start + 7])
                      if old.inventory_level > 0 and new.inventory_level > 0]
        if len(comparable) >= MIN_COMPARABLE_DAYS:
            comparisons.append(comparable)
    if len(comparisons) < PERSISTENCE_WEEKS:
        limited = finding("inventory_limited", "too_few_weeks_with_comparable_stock",
                          comparable_weeks=len(comparisons), recent=current_stock,
                          reference=prior_stock)
        return {names[0]: limited, names[1]: limited, names[2]: stock}

    # A one-unit absolute floor keeps zero and tiny baselines usable.
    def sales_check(direction):
        def deviates(pairs):
            before = mean(old for old, _ in pairs)
            after = mean(new for _, new in pairs)
            return direction * (after - before) >= max(1, WEEKLY_DEVIATION * before)

        matching = sum(deviates(week) for week in comparisons)
        combined = [pair for week in comparisons for pair in week]
        triggered = matching >= PERSISTENCE_WEEKS and deviates(combined)
        return finding("anomaly" if triggered else "normal",
                       "persistent_sales_deviation" if triggered else "within_persistence_threshold",
                       recent_mean=mean(new for _, new in combined),
                       reference_mean=mean(old for old, _ in combined),
                       matching_weeks=matching, comparable_weeks=len(comparisons),
                       relative_threshold=WEEKLY_DEVIATION, required_weeks=PERSISTENCE_WEEKS)

    return {names[0]: sales_check(1), names[1]: sales_check(-1), names[2]: stock}


def diagnose(request, mode):
    cutoff = request.as_of_date
    monthly = mode == "monthly"
    check = monthly_checks if monthly else daily_checks
    results = {}
    for product in ROSTER:
        observations = request.products.get(product, [])
        rows = {row.date: row for row in observations}
        if len(rows) != len(observations):
            raise ValueError(f"{product}: duplicate observation date")
        if any(day > cutoff for day in rows):
            raise ValueError(f"{product}: observation is after cutoff")
        results[product] = check(rows, cutoff)
    response = {"store_id": request.store_id, "as_of_date": cutoff,
                "input_reference": request.input_reference, "policy_version": POLICY_VERSION,
                "mode": mode, "products": results}
    if monthly:
        response.update(recent_start=cutoff - timedelta(days=27),
                        reference_start=cutoff - timedelta(days=55),
                        reference_end=cutoff - timedelta(days=28))
    return response
