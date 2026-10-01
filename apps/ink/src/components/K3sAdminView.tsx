import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import {
  getK3sHealthScore,
  runK3sCisAudit,
  getK3sNodes,
  type K3sLiveHealthReport,
  type K3sCisHardeningReport,
  type K3sNodeDetail,
} from '@vow/orchestrator';

interface K3sAdminViewProps {
  onBack: () => void;
}

export const K3sAdminView: React.FC<K3sAdminViewProps> = ({ onBack }) => {
  const [health, setHealth] = useState<K3sLiveHealthReport | null>(null);
  const [cis, setCis] = useState<K3sCisHardeningReport | null>(null);
  const [nodes, setNodes] = useState<K3sNodeDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'health' | 'cis' | 'nodes'>('health');

  const fetchData = async () => {
    setLoading(true);
    try {
      const [h, n] = await Promise.all([
        getK3sHealthScore(process.cwd()),
        getK3sNodes(process.cwd()),
      ]);
      setHealth(h);
      setNodes(n);
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  };

  const handleCisAudit = async () => {
    setLoading(true);
    try {
      const c = await runK3sCisAudit(process.cwd());
      setCis(c);
      setViewMode('cis');
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useInput((input, key) => {
    if (input === 'b' || key.escape) {
      onBack();
    } else if (input === 'r') {
      fetchData();
    } else if (input === 'c') {
      handleCisAudit();
    } else if (input === 'h') {
      setViewMode('health');
    } else if (input === 'n') {
      setViewMode('nodes');
    }
  });

  return (
    <Box flexDirection="column" padding={1} borderStyle="single" borderColor="green">
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="green">
          🛡️ K3s Cluster Health Watchdog & CIS Benchmark
        </Text>
        <Text color="gray">
          'h': Health | 'c': CIS Audit | 'n': Nodes | 'r': Refresh | 'b': Return
        </Text>
      </Box>

      {loading && (
        <Box marginY={1}>
          <Text color="green"><Spinner type="dots" /> Evaluating cluster metrics and telemetry...</Text>
        </Box>
      )}

      {!loading && viewMode === 'health' && health && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text bold>Cluster Health Score: </Text>
            <Text color={health.score >= 80 ? 'green' : health.score >= 50 ? 'yellow' : 'red'} bold>
              {health.score}/100 [{health.grade}]
            </Text>
            <Text> | API Latency: </Text>
            <Text color={health.apiLatencyMs < 200 ? 'green' : 'yellow'}>{health.apiLatencyMs}ms</Text>
            <Text> | etcd Quorum: </Text>
            <Text color={health.etcdQuorum ? 'green' : 'red'}>{health.etcdQuorum ? 'HEALTHY' : 'DEGRADED'}</Text>
          </Box>

          <Box flexDirection="row" justifyContent="space-between" marginBottom={1}>
            <Box flexDirection="column" width="50%" borderStyle="single" borderColor="gray" paddingX={1}>
              <Text bold color="cyan">Nodes Condition</Text>
              <Text>Total: {health.nodes.total} | Ready: <Text color="green">{health.nodes.ready}</Text> | NotReady: <Text color="red">{health.nodes.notReady}</Text></Text>
              {health.nodes.pressureAlerts.length > 0 ? (
                health.nodes.pressureAlerts.map((p, i) => (
                  <Text key={i} color="red">⚠ {p}</Text>
                ))
              ) : (
                <Text color="green">✔ No memory/disk pressure detected</Text>
              )}
            </Box>

            <Box flexDirection="column" width="50%" borderStyle="single" borderColor="gray" paddingX={1}>
              <Text bold color="cyan">Pod Stability</Text>
              <Text>Total: {health.pods.total} | Running: <Text color="green">{health.pods.running}</Text></Text>
              <Text>Pending: <Text color={health.pods.pending > 0 ? 'yellow' : 'green'}>{health.pods.pending}</Text> | Failing: <Text color={health.pods.failing > 0 ? 'red' : 'green'}>{health.pods.failing}</Text></Text>
              <Text>Total Restarts: <Text color={health.pods.totalRestarts > 5 ? 'yellow' : 'gray'}>{health.pods.totalRestarts}</Text></Text>
            </Box>
          </Box>

          {health.recommendations.length > 0 && (
            <Box flexDirection="column" borderStyle="single" borderColor="yellow" paddingX={1}>
              <Text bold color="yellow">Recommendations & Alerts ({health.recommendations.length}):</Text>
              {health.recommendations.map((rec, i) => (
                <Text key={i} color="yellow">• {rec}</Text>
              ))}
            </Box>
          )}
        </Box>
      )}

      {!loading && viewMode === 'cis' && cis && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text bold>CIS Benchmark Compliance: </Text>
            <Text color={cis.scorePercentage >= 80 ? 'green' : 'yellow'} bold>{cis.scorePercentage}%</Text>
            <Text> ({cis.passedChecks} PASS / {cis.failedChecks} FAIL / {cis.warnChecks} WARN)</Text>
          </Box>

          <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
            {cis.findings.map((f) => (
              <Box key={f.id} flexDirection="column" marginY={0}>
                <Box>
                  <Text color={f.status === 'PASS' ? 'green' : f.status === 'FAIL' ? 'red' : 'yellow'} bold>
                    [{f.status}] {f.id.padEnd(10)}
                  </Text>
                  <Text bold>{f.description.padEnd(35)}</Text>
                  <Text color="gray">{f.details}</Text>
                </Box>
                {f.remediation && (
                  <Text color="cyan" italic>   ↪ Fix: {f.remediation}</Text>
                )}
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {!loading && viewMode === 'nodes' && (
        <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
          <Text bold color="cyan">Cluster Nodes ({nodes.length}):</Text>
          {nodes.map((n) => (
            <Box key={n.name} justifyContent="space-between">
              <Text bold color={n.status === 'Ready' ? 'green' : 'red'}>● {n.name.padEnd(20)}</Text>
              <Text color="cyan">{n.status.padEnd(12)}</Text>
              <Text color="gray">{n.internalIp.padEnd(16)}</Text>
              <Text color="gray">{n.kubeletVersion.padEnd(16)}</Text>
              <Text color="yellow">roles={n.roles.join(',')}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};
