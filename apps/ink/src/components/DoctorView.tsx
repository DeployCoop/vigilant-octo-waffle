import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { checkConfig, reconcileConfig, type ConfigDoctorReport, type ConfigIssue } from '@vow/orchestrator';

interface DoctorViewProps {
  onBack: () => void;
}

export const DoctorView: React.FC<DoctorViewProps> = ({ onBack }) => {
  const [report, setReport] = useState<ConfigDoctorReport | null>(null);
  const [fixMessage, setFixMessage] = useState<string | null>(null);

  const runAudit = () => {
    const res = checkConfig(process.cwd());
    setReport(res);
  };

  const runFix = () => {
    const res = reconcileConfig(process.cwd());
    const fixedKeys = Object.keys(res.fixesApplied || {});
    setFixMessage(`Fixed ${fixedKeys.length} keys: ${fixedKeys.join(', ') || 'already up to date'}`);
    runAudit();
  };

  useEffect(() => {
    runAudit();
  }, []);

  useInput((input, key) => {
    if (input === 'b' || key.escape) {
      onBack();
    } else if (input === 'f') {
      runFix();
    } else if (input === 'r') {
      runAudit();
      setFixMessage(null);
    }
  });

  return (
    <Box flexDirection="column" padding={1} borderStyle="single" borderColor="blue">
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="blue">
          🩺 Config Doctor & Reconciler
        </Text>
        <Text color="gray">
          Press 'f' to auto-fix | 'r' to refresh | 'b' to return
        </Text>
      </Box>

      {fixMessage && (
        <Box marginBottom={1} paddingX={1} borderStyle="round" borderColor="green">
          <Text color="green" bold>✔ {fixMessage}</Text>
        </Box>
      )}

      {report && (
        <Box flexDirection="column">
          <Box justifyContent="space-between" marginBottom={1}>
            <Text color={report.valid ? 'green' : 'yellow'} bold>
              {report.valid ? '✔ All variables valid and synchronized' : `⚠ ${report.issues.length} Configuration Issues Detected`}
            </Text>
            <Text color="gray">
              Total Issues: {report.summary.totalIssues} (Fixable: {report.summary.fixable})
            </Text>
          </Box>

          {report.issues.length > 0 ? (
            <Box flexDirection="column" marginBottom={1}>
              <Text bold color="yellow">Issues to reconcile:</Text>
              {report.issues.slice(0, 8).map((issue: ConfigIssue, idx: number) => (
                <Box key={idx} paddingLeft={1}>
                  <Text color="yellow">• [{issue.category.toUpperCase()}] {issue.key}: </Text>
                  <Text color="gray">{issue.message}</Text>
                </Box>
              ))}
              {report.issues.length > 8 && (
                <Text color="gray" italic>  ...and {report.issues.length - 8} more issues</Text>
              )}
            </Box>
          ) : (
            <Box marginY={1}>
              <Text color="green">Everything is clean! THIS_NAME, THIS_NAMESPACE, THIS_DOMAIN are perfectly cascaded.</Text>
            </Box>
          )}

          <Box marginTop={1} gap={2}>
            <Text color="gray">Key Dependencies:</Text>
            <Text color="white">THIS_NAME: {report.config.raw['THIS_NAME']}</Text>
            <Text color="white">THIS_NAMESPACE: {report.config.raw['THIS_NAMESPACE']}</Text>
            <Text color="white">THIS_DOMAIN: {report.config.raw['THIS_DOMAIN']}</Text>
            <Text color="white">THIS_SECRETS: {report.config.raw['THIS_SECRETS']}</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};
