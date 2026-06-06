// $ per 1M tokens, verified June 2026. Used to compute REAL API cost from usage.
export const TEXT_RATES = {
  'llama-3.1-8b-instant': { in: 0.05, out: 0.08 },
  'llama-3.3-70b-versatile': { in: 0.59, out: 0.79 },
  'gpt-4o-mini': { in: 0.15, out: 0.60 },
  'gpt-4.1-mini': { in: 0.40, out: 1.60 },
  'gpt-4.1-nano': { in: 0.10, out: 0.40 },
  'gpt-5-mini': { in: 0.25, out: 2.00 },
  'gpt-5-nano': { in: 0.05, out: 0.40 },
  'gpt-5.4-mini': { in: 0.75, out: 4.50 },
  'gpt-5': { in: 1.25, out: 10.00 },
  'gpt-5.4': { in: 2.50, out: 15.00 },
  'gpt-5.5': { in: 5.00, out: 30.00 },
};

// $ per image (approx, medium quality 1024x1024)
export const IMAGE_COST = {
  'gpt-image-1-mini': 0.02,
  'gpt-image-1.5': 0.04,
  'gpt-image-2': 0.04,
};

// returns cost in micro-USD (integer). micro = USD * 1e6 = tokens * ($/1M).
export function textCostMicro(model, usage) {
  const r = TEXT_RATES[model] || { in: 0.5, out: 2.0 }; // conservative default
  const i = usage?.prompt_tokens || 0, o = usage?.completion_tokens || 0;
  return Math.round(i * r.in + o * r.out);
}

export function imageCostMicro(model, n = 1) {
  return Math.round((IMAGE_COST[model] || 0.02) * (n || 1) * 1e6);
}
