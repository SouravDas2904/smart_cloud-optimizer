"""Additive Holt-Winters with a damped trend (level + trend + weekly season), in numpy.

Small and dependency-free so every line can be explained to a judge.
"""
from __future__ import annotations

import numpy as np


def holt_winters(y, season=7, alpha=0.5, beta=0.05, gamma=0.2, phi=0.8, horizon=90):
    y = np.asarray(y, dtype=float)
    n = len(y)
    level = y[:season].mean()
    trend = (y[season:2 * season].mean() - y[:season].mean()) / season
    seas = list(y[:season] - level)
    fitted = []
    for t in range(n):
        s = seas[t % season]
        fitted.append(level + phi * trend + s)
        prev_level = level
        level = alpha * (y[t] - s) + (1 - alpha) * (level + phi * trend)
        trend = beta * (level - prev_level) + (1 - beta) * phi * trend
        seas[t % season] = gamma * (y[t] - level) + (1 - gamma) * s
    resid = y - np.array(fitted)
    sigma = float(np.std(resid[season:]))
    # damped trend: the slope fades out instead of compounding forever (phi < 1)
    damp = np.cumsum(phi ** np.arange(1, horizon + 1))
    fc = np.array([level + damp[h] * trend + seas[(n + h) % season] for h in range(horizon)])
    band = sigma * (1 + 0.15 * np.sqrt(np.arange(1, horizon + 1)))
    return fc, band, sigma


def backtest(y, holdout=7, **kw):
    """Fit on all but the last `holdout` days, forecast them, report MAPE."""
    y = np.asarray(y, dtype=float)
    fc, _, _ = holt_winters(y[:-holdout], horizon=holdout, **kw)
    return float(np.mean(np.abs(fc - y[-holdout:]) / y[-holdout:]) * 100)
