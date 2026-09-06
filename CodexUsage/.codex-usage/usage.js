"use strict";

// Both the documented App Server protocol and the legacy HTTP response are
// normalized here. primary/secondary describe slots, NOT fixed durations.
function number(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function percent(value) {
  const parsed = number(value);
  return parsed === null ? null : Math.max(0, Math.min(100, parsed));
}

function positive(value) {
  const parsed = number(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function windowLabel(minutes) {
  if (!minutes) return "Window";
  if (minutes % 10080 === 0) return `${minutes / 10080}w`;
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function normalizeWindow(raw, slot, fetchedAtMs) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const minutes = positive(raw.windowDurationMins ?? raw.window_duration_mins ?? raw.window_minutes)
    ?? (positive(raw.limit_window_seconds) === null ? null : Number(raw.limit_window_seconds) / 60);
  const remaining = percent(raw.remainingPercent ?? raw.remaining_percent);
  const used = percent(raw.usedPercent ?? raw.used_percent ?? raw.percent_used);
  const resetAfter = number(raw.reset_after_seconds);
  const resetsAt = positive(raw.resetsAt ?? raw.resets_at ?? raw.reset_at)
    ?? (resetAfter !== null && resetAfter >= 0 ? Math.floor(fetchedAtMs / 1000) + resetAfter : null);
  return {
    slot, minutes, label: minutes ? windowLabel(minutes) : `${slot === "primary" ? "Primary" : "Secondary"} window`,
    remainingPct: remaining ?? (used === null ? null : 100 - used), resetsAt,
  };
}

function normalizeCredits(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    balance: number(raw.balance), unlimited: raw.unlimited === true,
    hasCredits: typeof (raw.hasCredits ?? raw.has_credits) === "boolean" ? (raw.hasCredits ?? raw.has_credits) : null,
  };
}

function normalizeBucket(raw, id, root, fetchedAtMs) {
  const primary = raw.primary ?? raw.primary_window ?? raw.primaryWindow ?? raw.session ?? raw.five_hour ?? raw.fiveHour;
  const secondary = raw.secondary ?? raw.secondary_window ?? raw.secondaryWindow ?? raw.weekly ?? raw.week ?? raw.seven_day ?? raw.sevenDay;
  const windows = [normalizeWindow(primary, "primary", fetchedAtMs), normalizeWindow(secondary, "secondary", fetchedAtMs)]
    .filter(Boolean).sort((a, b) => (a.minutes ?? Infinity) - (b.minutes ?? Infinity));
  const individual = raw.individualLimit ?? raw.individual_limit;
  return {
    id, name: text(raw.limitName ?? raw.limit_name) || (id === "codex" ? "Codex" : id), windows,
    plan: text(raw.planType ?? raw.plan_type ?? root.planType ?? root.plan_type ?? root.plan),
    credits: normalizeCredits(raw.credits ?? (id === "codex" ? root.credits : null)),
    reached: text(raw.rateLimitReachedType ?? raw.rate_limit_reached_type ?? root.rate_limit_reached_type),
    blocked: raw.limit_reached === true || raw.allowed === false || raw.spendControlReached === true,
    individualLimit: individual && typeof individual === "object" ? {
      remainingPct: percent(individual.remainingPercent ?? individual.remaining_percent),
      resetsAt: positive(individual.resetsAt ?? individual.reset_at),
    } : null,
  };
}

function normalizeUsage(raw, fetchedAtMs = Date.now()) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Usage response is empty or invalid");
  const buckets = new Map();
  const add = (value, id) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      buckets.set(id, normalizeBucket(value, id, raw, fetchedAtMs));
    }
  };
  const legacy = raw.rateLimits ?? raw.rate_limits ?? raw.rate_limit ?? raw.limits;
  if (legacy) add(legacy, text(legacy.limitId ?? legacy.limit_id) || "codex");
  else if (raw.primary || raw.secondary || raw.primary_window || raw.secondary_window) add(raw, "codex");
  // The multi-bucket response is authoritative, including explicit null slots.
  const multi = raw.rateLimitsByLimitId ?? raw.rate_limits_by_limit_id;
  if (multi && typeof multi === "object" && !Array.isArray(multi)) {
    for (const [id, value] of Object.entries(multi)) add(value, id);
  }
  if (Array.isArray(raw.additional_rate_limits)) {
    for (const entry of raw.additional_rate_limits) {
      const id = text(entry.limit_id ?? entry.limitId ?? entry.metered_feature);
      if (id && !buckets.has(id)) add({ ...entry.rate_limit, limit_name: entry.limit_name ?? entry.limitName }, id);
    }
  }
  if (raw.code_review_rate_limit) add({ ...raw.code_review_rate_limit, limit_name: "Code review" }, "code_review");
  if (!buckets.size) throw new Error("Unrecognized usage response; update Codex or check the usage page");
  const resetCredits = raw.rateLimitResetCredits ?? raw.rate_limit_reset_credits;
  const available = number(resetCredits?.availableCount ?? resetCredits?.available_count);
  return {
    fetchedAt: new Date(fetchedAtMs).toISOString(),
    buckets: [...buckets.values()],
    availableResets: available !== null && available >= 0 ? Math.floor(available) : null,
  };
}

function normalizeActivity(raw) {
  const summary = raw?.summary;
  if (!summary || typeof summary !== "object") return null;
  return Object.fromEntries(["lifetimeTokens", "peakDailyTokens", "currentStreakDays", "longestStreakDays"]
    .map(key => [key, number(summary[key])]));
}

function selectBucket(usage, id = "codex") {
  return usage.buckets.find(bucket => bucket.id === id) || null;
}

module.exports = { number, percent, positive, windowLabel, normalizeUsage, normalizeActivity, selectBucket };
