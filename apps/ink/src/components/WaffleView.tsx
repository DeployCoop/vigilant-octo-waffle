import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  getBuiltinBlueprints,
  parseWaffleYaml,
  validateWafflePipeline,
  WaffleRunner,
  type WafflePipeline,
  type WaffleRunProgress,
} from '@vow/orchestrator';

interface WaffleViewProps {
  onBack: () => void;
}

export const WaffleView: React.FC<WaffleViewProps> = ({ onBack }) => {
  const [blueprints, setBlueprints] = useState<WafflePipeline[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [progress, setProgress] = useState<WaffleRunProgress | null>(null);
  const [executing, setExecuting] = useState(false);
  const [validationMsg, setValidationMsg] = useState<string | null>(null);

  useEffect(() => {
    const list = getBuiltinBlueprints();
    const customPath = path.join(process.cwd(), 'charts', 'waffle.yaml');
    if (fs.existsSync(customPath)) {
      try {
        const raw = fs.readFileSync(customPath, 'utf8');
        const customPipe = parseWaffleYaml(raw);
        setBlueprints([customPipe, ...list]);
        return;
      } catch {}
    }
    setBlueprints(list);
  }, []);

  const runPipeline = (dryRun: boolean) => {
    const pipe = blueprints[selectedIdx];
    if (!pipe) return;

    setExecuting(true);
    setProgress(null);
    const runner = new WaffleRunner(process.cwd());

    runner.on('progress', (p) => {
      setProgress(p);
      if (p.status === 'completed' || p.status === 'failed') {
        setExecuting(false);
      }
    });

    runner.executePipeline({
      sourceId: pipe.metadata.name,
      pipeline: pipe,
      baseDir: process.cwd(),
      dryRun,
    }).catch((err) => {
      setExecuting(false);
      setValidationMsg(`Execution failed: ${err.message}`);
    });
  };

  const validateCurrent = () => {
    const pipe = blueprints[selectedIdx];
    if (!pipe) return;
    const res = validateWafflePipeline(pipe, process.cwd());
    if (res.valid) {
      setValidationMsg(`✔ Pipeline '${pipe.metadata.name}' is 100% valid (${pipe.stages.length} stages)`);
    } else {
      setValidationMsg(`✖ Validation errors: ${res.errors.join('; ')}`);
    }
  };

  useInput((input, key) => {
    if (input === 'b' || key.escape) {
      onBack();
    } else if (key.upArrow && !executing) {
      setSelectedIdx((prev) => (prev > 0 ? prev - 1 : blueprints.length - 1));
      setValidationMsg(null);
    } else if (key.downArrow && !executing) {
      setSelectedIdx((prev) => (prev < blueprints.length - 1 ? prev + 1 : 0));
      setValidationMsg(null);
    } else if (input === 'v' && !executing) {
      validateCurrent();
    } else if (input === 'd' && !executing) {
      runPipeline(true);
    } else if (input === 'r' && !executing) {
      runPipeline(false);
    }
  });

  const current = blueprints[selectedIdx];

  return (
    <Box flexDirection="column" padding={1} borderStyle="single" borderColor="cyan">
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">
          📦 Waffle Meta-Package Pipeline Studio
        </Text>
        <Text color="gray">
          ↑/↓ select | 'v' validate | 'd' dry-run | 'r' run | 'b' back
        </Text>
      </Box>

      {validationMsg && (
        <Box marginBottom={1} paddingX={1} borderStyle="round" borderColor="yellow">
          <Text color="yellow" bold>{validationMsg}</Text>
        </Box>
      )}

      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="white">Available Blueprints & Pipelines ({blueprints.length}):</Text>
        {blueprints.map((b, idx) => {
          const isSelected = idx === selectedIdx;
          return (
            <Box key={b.metadata.name} paddingLeft={1}>
              <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                {isSelected ? '❯ ' : '  '}
                {b.metadata.name.padEnd(30)}
              </Text>
              <Text color={isSelected ? 'white' : 'gray'}>
                {(b.metadata.description || 'Custom Waffle Pipeline').substring(0, 70)}...
              </Text>
            </Box>
          );
        })}
      </Box>

      {current && (
        <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} marginY={1}>
          <Text bold color="yellow">Selected Pipeline: {current.metadata.name} (v{current.metadata.version || '1.0.0'})</Text>
          <Text color="gray">Namespace: {current.settings?.defaultNamespace || 'default'} | StorageClass: {current.settings?.defaultStorageClass || 'local-path'}</Text>
          <Text color="white">Stages ({current.stages.length}):</Text>
          {current.stages.map((st) => (
            <Box key={st.id} paddingLeft={2} gap={2}>
              <Text color="cyan">• [{st.id}] {st.name} ({st.mode})</Text>
              <Text color="gray">Steps: {st.steps.map((s) => s.chart).join(', ')}</Text>
            </Box>
          ))}
        </Box>
      )}

      {progress && (
        <Box flexDirection="column" borderStyle="round" borderColor={progress.status === 'completed' ? 'green' : 'yellow'} padding={1}>
          <Text bold color={progress.status === 'completed' ? 'green' : 'yellow'}>
            Status: {progress.status.toUpperCase()} ({progress.completedSteps}/{progress.totalSteps} steps completed)
          </Text>
          {progress.activeStepId && (
            <Text color="white">Current Step: {progress.activeStepId}</Text>
          )}
        </Box>
      )}
    </Box>
  );
};
