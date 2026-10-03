import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface MenuItem {
  id: string;
  label: string;
  description: string;
  icon: string;
}

interface NavigationProps {
  items: MenuItem[];
  onSelect: (item: MenuItem) => void;
  onExit?: () => void;
}

export const Navigation: React.FC<NavigationProps> = ({ items, onSelect, onExit }) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1));
    } else if (key.downArrow) {
      setSelectedIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0));
    } else if (key.return) {
      if (items[selectedIndex]) {
        onSelect(items[selectedIndex]);
      }
    } else if (input === 'q' || key.escape) {
      if (onExit) onExit();
    }
  });

  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold color="yellow">
        Choose an action (Use ↑/↓ arrows, Enter to select, 'q' to exit):
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {items.map((item, idx) => {
          const isSelected = idx === selectedIndex;
          return (
            <Box key={item.id} paddingX={1} marginY={0}>
              <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                {isSelected ? '❯ ' : '  '}
                {item.icon} {item.label.padEnd(30)}
              </Text>
              <Text color={isSelected ? 'white' : 'gray'}>
                {item.description}
              </Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};
