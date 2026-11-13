import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const hoisted = vi.hoisted(() => ({
  load: { status: 'disabled' } as import('@vow/orchestrator').AuthzStoreLoad,
  root: '',
  calculateBurnRates: vi.fn(),
  toggleSloCircuitBreaker: vi.fn(),
}));

vi.mock('@vow/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vow/orchestrator')>();
  return {
    ...actual,
    loadAuthzStore: () => hoisted.load,
    calculateBurnRates: hoisted.calculateBurnRates,
    toggleSloCircuitBreaker: hoisted.toggleSloCircuitBreaker,
  };
});

vi.mock('@/lib/project', () => ({ getProjectRoot: () => hoisted.root }));

import { GET, POST } from './route';

/** Validation + not-found tests for /api/slo (Batch C, C7/C8). */

function postReq(body: unknown) {
  return new Request('http://localhost:3000/api/slo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  hoisted.load = { status: 'disabled' };
  hoisted.root = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-slo-'));
  hoisted.calculateBurnRates.mockReset();
  hoisted.toggleSloCircuitBreaker.mockReset();
  hoisted.calculateBurnRates.mockReturnValue({
    serviceId: 'slo-keycloak',
    burnRate1h: 0.5,
  });
  hoisted.toggleSloCircuitBreaker.mockReturnValue({
    success: true,
    tripped: true,
    message: 'ok',
  });
});

afterEach(() => {
  fs.rmSync(hoisted.root, { recursive: true, force: true });
});

describe('GET /api/slo (C8)', () => {
  it('returns 404 for an unknown serviceId instead of another service rates', async () => {
    hoisted.calculateBurnRates.mockReturnValue(null);
    const res = await GET(
      new Request('http://localhost:3000/api/slo?serviceId=no-such-service')
    );
    expect(res.status).toBe(404);
  });

  it('returns burn rates for a known service', async () => {
    const res = await GET(
      new Request('http://localhost:3000/api/slo?serviceId=slo-keycloak')
    );
    expect(res.status).toBe(200);
    expect(hoisted.calculateBurnRates).toHaveBeenCalledWith('slo-keycloak');
  });
});

describe('POST /api/slo validation (C7) + unknown service (C8)', () => {
  it('rejects a string tripped with 400 (no Boolean() coercion)', async () => {
    const res = await POST(
      postReq({ serviceId: 'slo-keycloak', action: 'toggle_circuit_breaker', tripped: 'true' })
    );
    expect(res.status).toBe(400);
    expect(hoisted.toggleSloCircuitBreaker).not.toHaveBeenCalled();
  });

  it('returns 404 when toggling an unknown service', async () => {
    hoisted.toggleSloCircuitBreaker.mockReturnValue({
      success: false,
      tripped: false,
      message: 'SLO for service no-such-service not found.',
    });
    const res = await POST(
      postReq({ serviceId: 'no-such-service', action: 'toggle_circuit_breaker', tripped: true })
    );
    expect(res.status).toBe(404);
  });

  it('toggles with a real boolean', async () => {
    const res = await POST(
      postReq({ serviceId: 'slo-keycloak', action: 'toggle_circuit_breaker', tripped: true })
    );
    expect(res.status).toBe(200);
    expect(hoisted.toggleSloCircuitBreaker).toHaveBeenCalledWith('slo-keycloak', true);
  });
});
