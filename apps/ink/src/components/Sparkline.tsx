import React from 'react';
import { Box, Text } from 'ink';

interface SparklineProps {
  data: number[];
  color?: 'cyan' | 'green' | 'yellow' | 'red' | 'magenta' | 'blue';
  label?: string;
  showMinMax?: boolean;
}

const SPARK_CHARS = [' ', ' ', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

export const Sparkline: React.FC<SparklineProps> = ({
  data,
  color = 'cyan',
  label,
  showMinMax = true,
}) => {
  if (!data || data.length === 0) {
    return <Text color="gray">[no data]</Text>;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const sparklineStr = data
    .map((val) => {
      const normalized = (val - min) / range;
      const idx = Math.min(
        SPARK_CHARS.length - 1,
        Math.max(0, Math.round(normalized * (SPARK_CHARS.length - 1)))
      );
      return SPARK_CHARS[idx];
    })
    .join('');

  return (
    <Box flexDirection="row" alignItems="center">
      {label && (
        <Box marginRight={1}>
          <Text color="gray">{label}:</Text>
        </Box>
      )}
      <Text color={color}>{sparklineStr}</Text>
      {showMinMax && (
        <Box marginLeft={1}>
          <Text color="gray">
            (min: {min.toFixed(0)}, max: {max.toFixed(0)})
          </Text>
        </Box>
      )}
    </Box>
  );
};
