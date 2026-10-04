import React from 'react';
import { render } from 'ink';
import { App } from './components/App.js';
import { createProgram, resolveDispatch } from './program.js';

// Default action: Launch interactive Ink app
const rawArgs = process.argv.slice(2);
const dispatch = resolveDispatch(rawArgs);
if (dispatch === 'authz') {
  // Authorization management is delegated to the orchestrator's authz CLI
  // (commander pass-through would mangle its flags).
  const { runAuthzCommand } = await import('@vow/orchestrator');
  process.exitCode = await runAuthzCommand(rawArgs.slice(1));
} else if (dispatch === 'tui') {
  render(<App />);
} else {
  createProgram().parse(process.argv);
}
