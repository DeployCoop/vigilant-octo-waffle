import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { createBringUpEngine, type BringUpProgress } from '@vow/orchestrator';
import { ProgressBar } from './ProgressBar.js';
import { SpinnerWheel } from './SpinnerWheel.js';

interface ClusterUpViewProps {
  onBack: () => void;
  dryRun?: boolean;
}

export const ClusterUpView: React.FC<ClusterUpViewProps> = ({ onBack, dryRun = false }) => {
  const [progress, setProgress] = useState<BringUpProgress | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isDryRun, setIsDryRun] = useState(dryRun);

  const startBringUp = (modeDryRun: boolean) => {
    setIsRunning(true);
    const engine = createBringUpEngine();

    engine.on('progress', (p: BringUpProgress) => {
      setProgress(p);
      if (p.status === 'completed' || p.status === 'failed') {
        setIsRunning(false);
      }
    });

    engine.execute({ dryRun: modeDryRun }).catch((err) => {
      setIsRunning(false);
      setProgress((prev) => (prev ? { ...prev, status: 'failed', error: err.message } : null));
    });
  };

  useEffect(() => {
    startBringUp(isDryRun);
  }, []);

  useInput((input, key) => {
    if (input === 'b' || key.escape) {
      onBack();
    } else if (input === 'r' && !isRunning) {
      startBringUp(false);
    } else if (input === 'd' && !isRunning) {
      setIsDryRun(true);
      startBringUp(true);
    }
  });

  const completedCount = progress
    ? progress.steps.filter((s) => s.status === 'completed').length
    : 0;
  const percent = progress
    ? Math.round((completedCount / Math.max(1, progress.totalSteps)) * 100)
    : 0;

  return (
    <Box flexDirection="column" padding={1} borderStyle="single" borderColor="green">
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="green">
          🚀 Cluster Bring-Up Orchestration {isDryRun ? '(DRY-RUN)' : '(LIVE)'}
        </Text>
        <Text color="gray">
          Press 'b' to return | 'r' to re-run live | 'd' for dry-run
        </Text>
      </Box>

      {/* Progress Bar with Fractional Blocks & Stopwatch */}
      {progress && (
        <Box marginBottom={1} paddingX={1} flexDirection="column" gap={1}>
          <ProgressBar
            percent={percent}
            width={32}
            color={progress.status === 'failed' ? 'red' : 'green'}
            label="Overall Progress"
          />
        </Box>
      )}

      {progress && (
        <Box flexDirection="column" gap={0}>
          {progress.steps.map((step, idx) => {
            let statusIcon: React.ReactNode = <Text color="gray">⏳</Text>;
            let color: 'gray' | 'green' | 'yellow' | 'red' = 'gray';

            if (step.status === 'completed') {
              statusIcon = <Text color="green">✔</Text>;
              color = 'green';
            } else if (step.status === 'running') {
              statusIcon = <SpinnerWheel type="braille" color="yellow" />;
              color = 'yellow';
            } else if (step.status === 'failed') {
              statusIcon = <Text color="red">✖</Text>;
              color = 'red';
            }

            return (
              <Box key={step.id} justifyContent="space-between">
                <Box flexDirection="row" alignItems="center">
                  <Box marginRight={1}>{statusIcon}</Box>
                  <Text color={color} bold={step.status === 'running'}>
                    [{idx + 1}/{progress.totalSteps}] {step.name.padEnd(44)}
                  </Text>
                  {step.message && (
                    <Text color="gray"> - {step.message}</Text>
                  )}
                </Box>
                {step.durationMs !== undefined && (
                  <Text color="gray">{step.durationMs}ms</Text>
                )}
              </Box>
            );
          })}

          <Box marginTop={1} borderStyle="round" borderColor={progress.status === 'completed' ? 'green' : progress.status === 'failed' ? 'red' : 'yellow'} paddingX={1}>
            <Text bold color={progress.status === 'completed' ? 'green' : progress.status === 'failed' ? 'red' : 'yellow'}>
              Overall Status: {progress.status.toUpperCase()}
              {progress.error ? ` - Error: ${progress.error}` : ''}
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};

