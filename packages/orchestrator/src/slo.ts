export interface ServiceSloRecord {
  id: string;
  serviceName: string;
  namespace: string;
  availabilityTarget: number; // e.g. 99.9 (%)
  currentAvailability: number; // e.g. 99.94 (%)
  latencyTargetP99Ms: number; // e.g. 200 (ms)
  currentLatencyP99Ms: number; // e.g. 142 (ms)
  errorBudgetRemainingPct: number; // e.g. 84.2 (%)
  errorBudgetTotalMinutes: number; // e.g. 43.2 min (for 30-day window)
  consumedMinutes: number;
  burnRate1h: number; // 1.0 = burning at sustainable rate
  burnRate6h: number;
  burnRate24h: number;
  status: 'HEALTHY' | 'WARNING' | 'CRITICAL_BURN' | 'EXHAUSTED';
  circuitBreakerTripped: boolean;
}

export interface BurnRateTelemetry {
  serviceId: string;
  burnRate1h: number;
  burnRate6h: number;
  burnRate24h: number;
  timeToExhaustionHours: number;
  circuitBreakerActive: boolean;
  recommendation: string;
}

const sloStore: ServiceSloRecord[] = [
  {
    id: 'slo-keycloak',
    serviceName: 'Keycloak SSO & Auth',
    namespace: 'keycloak',
    availabilityTarget: 99.9,
    currentAvailability: 99.96,
    latencyTargetP99Ms: 250,
    currentLatencyP99Ms: 148,
    errorBudgetRemainingPct: 88.5,
    errorBudgetTotalMinutes: 43.2,
    consumedMinutes: 4.97,
    burnRate1h: 0.8,
    burnRate6h: 1.1,
    burnRate24h: 0.9,
    status: 'HEALTHY',
    circuitBreakerTripped: false,
  },
  {
    id: 'slo-nextcloud',
    serviceName: 'Nextcloud Files',
    namespace: 'nextcloud',
    availabilityTarget: 99.5,
    currentAvailability: 99.12,
    latencyTargetP99Ms: 500,
    currentLatencyP99Ms: 620,
    errorBudgetRemainingPct: 24.0,
    errorBudgetTotalMinutes: 216.0,
    consumedMinutes: 164.16,
    burnRate1h: 7.4,
    burnRate6h: 5.2,
    burnRate24h: 3.8,
    status: 'CRITICAL_BURN',
    circuitBreakerTripped: true,
  },
  {
    id: 'slo-postgres',
    serviceName: 'PostgreSQL Relational DB',
    namespace: 'postgres',
    availabilityTarget: 99.99,
    currentAvailability: 100.0,
    latencyTargetP99Ms: 50,
    currentLatencyP99Ms: 8.5,
    errorBudgetRemainingPct: 100.0,
    errorBudgetTotalMinutes: 4.32,
    consumedMinutes: 0.0,
    burnRate1h: 0.0,
    burnRate6h: 0.0,
    burnRate24h: 0.0,
    status: 'HEALTHY',
    circuitBreakerTripped: false,
  },
  {
    id: 'slo-traefik',
    serviceName: 'Traefik API Gateway',
    namespace: 'traefik',
    availabilityTarget: 99.95,
    currentAvailability: 99.98,
    latencyTargetP99Ms: 100,
    currentLatencyP99Ms: 34,
    errorBudgetRemainingPct: 92.0,
    errorBudgetTotalMinutes: 21.6,
    consumedMinutes: 1.72,
    burnRate1h: 1.2,
    burnRate6h: 0.9,
    burnRate24h: 0.8,
    status: 'HEALTHY',
    circuitBreakerTripped: false,
  },
];

export async function getServiceSlos(): Promise<ServiceSloRecord[]> {
  return [...sloStore];
}

export async function calculateBurnRates(serviceId: string): Promise<BurnRateTelemetry> {
  const slo = sloStore.find((s) => s.id === serviceId) || sloStore[0];
  const timeToExhaustion =
    slo.burnRate1h > 0
      ? Math.round(((slo.errorBudgetRemainingPct / 100) * 720) / slo.burnRate1h)
      : 9999;

  let recommendation = 'Error budget burn rate is healthy. Continuous deployments allowed.';
  if (slo.burnRate1h >= 5.0) {
    recommendation =
      'CRITICAL: Fast burn rate detected (>5.0x). Automated circuit breaker halted canary promotion on Argo Rollouts.';
  } else if (slo.burnRate1h >= 2.0) {
    recommendation = 'WARNING: Elevated error rate detected. Review latest deployment diff.';
  }

  return {
    serviceId: slo.id,
    burnRate1h: slo.burnRate1h,
    burnRate6h: slo.burnRate6h,
    burnRate24h: slo.burnRate24h,
    timeToExhaustionHours: timeToExhaustion,
    circuitBreakerActive: slo.circuitBreakerTripped,
    recommendation,
  };
}

export async function toggleSloCircuitBreaker(
  serviceId: string,
  tripped: boolean
): Promise<{ success: boolean; tripped: boolean; message: string }> {
  const slo = sloStore.find((s) => s.id === serviceId);
  if (!slo) {
    return { success: false, tripped: false, message: `SLO target ${serviceId} not found.` };
  }

  slo.circuitBreakerTripped = tripped;
  slo.status = tripped ? 'CRITICAL_BURN' : slo.errorBudgetRemainingPct > 50 ? 'HEALTHY' : 'WARNING';

  return {
    success: true,
    tripped: slo.circuitBreakerTripped,
    message: tripped
      ? `Tripped deployment circuit breaker for ${slo.serviceName}. Argo Rollouts canary promotions paused.`
      : `Reset deployment circuit breaker for ${slo.serviceName}. Canary promotions resumed.`,
  };
}
