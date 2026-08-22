import type { ModelWithProvider } from "../types";
import { parseRewriteRules } from "./rewrite";

export type RoutingStrategy = "priority" | "lowest_latency" | "weighted";

/**
 * Selects the optimal candidate order for proxy execution based on configured routing strategy
 */
export function selectCandidateRoute(
  candidates: ModelWithProvider[],
  requestedModel: string,
  recentAvgLatencies: Record<string, number> | Map<string, number> = {}
): ModelWithProvider[] {
  if (candidates.length <= 1) return candidates;

  const getLatency = (providerId: string): number => {
    if (recentAvgLatencies instanceof Map) {
      return recentAvgLatencies.get(providerId) ?? 600;
    }
    return (recentAvgLatencies as Record<string, number>)[providerId] ?? 600;
  };

  // Determine effective strategy from the top candidate or any candidate rule
  let strategy: RoutingStrategy = "priority";
  for (const c of candidates) {
    const rules = parseRewriteRules(c.config_json);
    if (rules.routing_strategy) {
      strategy = rules.routing_strategy;
      break;
    }
  }

  // 1. Lowest Latency Strategy
  if (strategy === "lowest_latency") {
    return [...candidates].sort((a, b) => {
      const latA = getLatency(a.provider_id);
      const latB = getLatency(b.provider_id);
      if (latA !== latB) return latA - latB;
      // Secondary sort: direct model_name match over alias
      const exactA = a.model_name.toLowerCase() === requestedModel.toLowerCase() ? 0 : 1;
      const exactB = b.model_name.toLowerCase() === requestedModel.toLowerCase() ? 0 : 1;
      return exactA - exactB;
    });
  }

  // 2. Weighted Load Balancing Strategy
  if (strategy === "weighted") {
    const weights = candidates.map((c) => {
      const rules = parseRewriteRules(c.config_json);
      return Math.max(1, rules.weight || 10);
    });
    const totalWeight = weights.reduce((acc, w) => acc + w, 0);
    let rand = Math.random() * totalWeight;

    let selectedIndex = 0;
    for (let i = 0; i < weights.length; i++) {
      rand -= weights[i];
      if (rand <= 0) {
        selectedIndex = i;
        break;
      }
    }

    const selected = candidates[selectedIndex];
    const remaining = candidates.filter((_, idx) => idx !== selectedIndex);
    return [selected, ...remaining];
  }

  // 3. Default Priority Strategy (Alias match > Model name match > ID)
  return [...candidates].sort((a, b) => {
    const aliasA = a.alias && a.alias.toLowerCase() === requestedModel.toLowerCase() ? 0 : 1;
    const aliasB = b.alias && b.alias.toLowerCase() === requestedModel.toLowerCase() ? 0 : 1;
    if (aliasA !== aliasB) return aliasA - aliasB;

    const exactA = a.model_name.toLowerCase() === requestedModel.toLowerCase() ? 0 : 1;
    const exactB = b.model_name.toLowerCase() === requestedModel.toLowerCase() ? 0 : 1;
    if (exactA !== exactB) return exactA - exactB;
    return a.id.localeCompare(b.id);
  });
}
