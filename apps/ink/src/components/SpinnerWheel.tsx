import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

export type SpinnerType = 'braille' | 'clock' | 'orbit' | 'bounce' | 'arrows';

interface SpinnerWheelProps {
  type?: SpinnerType;
  label?: string;
  color?: 'cyan' | 'green' | 'yellow' | 'red' | 'magenta' | 'blue';
  intervalMs?: number;
}

const SPINNERS: Record<SpinnerType, string[]> = {
  braille: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  clock: ['🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛'],
  orbit: ['◒', '◐', '◓', '◑'],
  bounce: ['⠁', '⠂', '⠄', '⠂'],
  arrows: ['←', '↖', '↑', '↗', '→', '↘', '↓', '↙'],
};

export const SpinnerWheel: React.FC<SpinnerWheelProps> = ({
  type = 'braille',
  label,
  color = 'cyan',
  intervalMs = 80,
}) => {
  const [frame, setFrame] = useState<number>(0);
  const frames = SPINNERS[type] || SPINNERS.braille;

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % frames.length);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [frames.length, intervalMs]);

  return (
    <Box flexDirection="row" alignItems="center">
      <Text bold color={color}>
        {frames[frame]}
      </Text>
      {label && (
        <Box marginLeft={1}>
          <Text color={color}>{label}</Text>
        </Box>
      )}
    </Box>
  );
};
