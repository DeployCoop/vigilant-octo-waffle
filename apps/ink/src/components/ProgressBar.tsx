import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';

interface ProgressBarProps {
  percent: number; // 0 to 100
  width?: number; // total bar character width
  color?: 'cyan' | 'green' | 'yellow' | 'red' | 'magenta' | 'blue';
  showElapsed?: boolean;
  startTime?: number; // timestamp in ms
  label?: string;
}

const SUB_BLOCKS = [' ', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];

export const ProgressBar: React.FC<ProgressBarProps> = ({
  percent,
  width = 24,
  color = 'cyan',
  showElapsed = true,
  startTime,
  label,
}) => {
  const [elapsedSec, setElapsedSec] = useState<number>(0);

  useEffect(() => {
    if (!showElapsed) return;
    const start = startTime || Date.now();
    const timer = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - start) / 1000));
    }, 500);
    return () => clearInterval(timer);
  }, [showElapsed, startTime]);

  const clamped = Math.max(0, Math.min(100, percent));
  const fullWidthValue = (clamped / 100) * width;
  const fullChars = Math.floor(fullWidthValue);
  const remainder = fullWidthValue - fullChars;
  const subIndex = Math.floor(remainder * 8);

  let filledBar = '█'.repeat(fullChars);
  if (fullChars < width && subIndex > 0) {
    filledBar += SUB_BLOCKS[subIndex];
  }
  const emptyBar = '░'.repeat(Math.max(0, width - filledBar.length));

  const formatTime = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const s = sec % 60;
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <Box flexDirection="row" alignItems="center">
      {label && (
        <Box marginRight={1}>
          <Text color="gray">{label}</Text>
        </Box>
      )}
      <Text color={color}>{filledBar}</Text>
      <Text color="gray">{emptyBar}</Text>
      <Box marginLeft={1}>
        <Text bold color={color}>
          {clamped.toFixed(1)}%
        </Text>
      </Box>
      {showElapsed && (
        <Box marginLeft={1}>
          <Text color="gray">[{formatTime(elapsedSec)}]</Text>
        </Box>
      )}
    </Box>
  );
};
