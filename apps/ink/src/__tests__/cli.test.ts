/**
 * WS7 — vow CLI dispatch + commander surface tests.
 *
 * The command surface is a contract: renaming a command or dropping a
 * flag breaks scripts (and the raw `vow authz` passthrough breaks
 * authz administration), so it is pinned here.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createProgram, resolveDispatch } from '../program.js';

describe('resolveDispatch', () => {
  it('routes authz to the raw delegation, whatever follows', () => {
    assert.equal(resolveDispatch(['authz']), 'authz');
    assert.equal(resolveDispatch(['authz', 'list']), 'authz');
    assert.equal(
      resolveDispatch(['authz', 'add', '--name', 'X', '--role', 'viewer']),
      'authz'
    );
  });

  it('launches the TUI with no args or an interactive flag anywhere', () => {
    assert.equal(resolveDispatch([]), 'tui');
    assert.equal(resolveDispatch(['-i']), 'tui');
    assert.equal(resolveDispatch(['--interactive']), 'tui');
    // Documented quirk: the flag wins even after a command, shadowing
    // the up command's own --interactive option.
    assert.equal(resolveDispatch(['up', '--interactive']), 'tui');
  });

  it('sends everything else to commander', () => {
    assert.equal(resolveDispatch(['up']), 'commander');
    assert.equal(resolveDispatch(['doctor', '--fix']), 'commander');
    assert.equal(resolveDispatch(['--help']), 'commander');
    assert.equal(resolveDispatch(['--version']), 'commander');
    assert.equal(resolveDispatch(['bogus']), 'commander');
  });
});

interface CommandInfo {
  name: string;
  argsHelp: string;
  options: { long?: string; defaultValue?: unknown }[];
}

function commandInfo(name: string): CommandInfo {
  const program = createProgram();
  const cmd = program.commands.find((c) => c.name() === name);
  assert.ok(cmd, `command '${name}' should be registered`);
  return {
    name: cmd.name(),
    argsHelp: cmd.helpInformation(),
    options: cmd.options.map((o) => ({
      long: o.long,
      defaultValue: o.defaultValue,
    })),
  };
}

describe('command surface', () => {
  it('registers exactly the expected commands', () => {
    const names = createProgram()
      .commands.map((c) => c.name())
      .sort();
    assert.deepEqual(names, [
      'app',
      'doctor',
      'ingress',
      'k3s',
      'namespaces',
      'secrets',
      'storage',
      'up',
      'waffle',
    ]);
  });

  it('program help names the binary and lists every command', () => {
    const help = createProgram().helpInformation();
    assert.match(help, /Usage: vow /);
    for (const name of ['up', 'doctor', 'secrets', 'namespaces', 'waffle', 'ingress', 'storage', 'app', 'k3s']) {
      assert.match(help, new RegExp(`\\b${name}\\b`), `help should list ${name}`);
    }
  });

  it('pins argument shapes', () => {
    assert.match(commandInfo('waffle').argsHelp, /<subaction> \[pipelineFile\]/);
    assert.match(commandInfo('app').argsHelp, /<action> \[appId\]/);
    assert.match(commandInfo('k3s').argsHelp, /<action> \[nodeName\]/);
    assert.match(commandInfo('secrets').argsHelp, /\[action\]/);
    assert.match(commandInfo('storage').argsHelp, /\[action\] \[arg\]/);
  });

  it('pins key options and defaults', () => {
    const up = commandInfo('up');
    assert.ok(up.options.some((o) => o.long === '--dry-run'));
    const app = commandInfo('app');
    const engine = app.options.find((o) => o.long === '--engine');
    assert.ok(engine, 'app should have --engine');
    assert.equal(engine.defaultValue, 'argocd');
    const doctor = commandInfo('doctor');
    assert.ok(doctor.options.some((o) => o.long === '--fix'));
  });

  it('unknown commands are rejected by the parser', () => {
    const program = createProgram();
    program.exitOverride();
    program.configureOutput({ writeErr: () => {} });
    assert.throws(
      () => program.parse(['node', 'vow', 'bogus-command']),
      (err: unknown) =>
        (err as { code?: string }).code === 'commander.unknownCommand'
    );
  });

  it('--help is a clean exit through the parser', () => {
    const program = createProgram();
    program.exitOverride();
    let out = '';
    program.configureOutput({ writeOut: (s: string) => (out += s) });
    assert.throws(
      () => program.parse(['node', 'vow', '--help']),
      (err: unknown) =>
        (err as { code?: string }).code === 'commander.helpDisplayed'
    );
    assert.match(out, /Usage: vow /);
  });
});
