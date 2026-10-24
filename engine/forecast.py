"""Additive Holt-Winters (level + trend + weekly season), written out in numpy.

Small and dependency-free so every line can be explained to a judge.
"""
from __future__ import annotations

import numpy as np


def holt_winters(y, season=7, alpha=0.4, beta=0.05, gamma=0.3, horizon=90):
    y = np.asarray(y, dtype=float)
    n = len(y)
    level = y[:season].mean()
    trend = (y[season:2 * season].mean() - y[:season].mean()) / season
    seas = list(y[:season] - level)
    fitted = []
    for t in range(n):
        s = seas[t % season]
        fitted.append(level + trend + s)
        prev_level = level
        level = alpha * (y[t] - s) + (1 - alpha) * (level + trend)
        trend = beta * (level - prev_level) + (1 - beta) * trend
        seas[t % season] = gamma * (y[t] - level) + (1 - gamma) * s
    resid = y - np.array(fitted)
    sigma = float(np.std(resid[season:]))
    fc = np.array([level + (h + 1) * trend + seas[(n + h) % season] for h in range(horizon)])
    band = sigma * np.sqrt(np.arange(1, horizon + 1)) * 0.5 + sigma
    return fc, band, sigma


def backtest(y, holdout=7, **kw):
    """Fit on all but the last `holdout` days, forecast them, report MAPE."""
    y = np.asarray(y, dtype=float)
    fc, _, _ = holt_winters(y[:-holdout], horizon=holdout, **kw)
    return float(np.mean(np.abs(fc - y[-holdout:]) / y[-holdout:]) * 100)
