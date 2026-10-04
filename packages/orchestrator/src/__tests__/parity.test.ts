/**
 * Bash <-> TypeScript parity contract tests (improvements plan WS3).
 *
 * The bash runners (src/argoRunner.bash, src/fluxRunner.bash) and the
 * TypeScript engine are two implementations of the same templating
 * and deployment behavior. These tests run BOTH engines over
 * identical fixture projects and require agreement:
 *
 *   pair 1 (argo):  ArgoManager.prepareAppManifest vs argoRunner
 *   pair 2 (deploy): ArgoManager.deployApp's argocd argv vs the
 *                    runner's argocd argv (stub captures both)
 *   pair 3 (flux):  FluxManager.prepareAppManifest vs fluxRunner
 *                   (native manifests and argo->flux synthesis)
 *
 * Manifest outputs are compared after canonicalization (parse the
 * YAML, sort keys recursively) and against the fixture's golden
 * `expected.yaml`, so behavior changes on either side are deliberate.
 *
 * The bash side runs the real runner scripts with stub `argocd` /
 * `kubectl` binaries on PATH that capture what would have been
 * applied. Both engines read the repository's real src/default.env
 * (the fixture root symlinks src/), so the envsubst allowlist and
 * the TS config map see identical inputs.
 *
 * Requires `yq` and `envsubst` on PATH (CI installs both and sets
 * VOW_PARITY_REQUIRED=1; locally the bash cases skip when the tools
 * are missing). Regenerate goldens with VOW_PARITY_UPDATE=1.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { ArgoManager, FluxManager } from '../index.js';
import { substituteVariables } from '../template.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..');
const fixturesRoot = path.join(
  repoRoot,
  'packages/orchestrator/src/__tests__/fixtures/parity'
);
const updateGoldens = process.env.VOW_PARITY_UPDATE === '1';
const parityRequired = process.env.VOW_PARITY_REQUIRED === '1';

function toolAvailable(cmd: string): boolean {
  try {
    execFileSync(cmd, ['--version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
const bashToolsReady = toolAvailable('yq') && toolAvailable('envsubst');

/** Recursively sort object keys for order-insensitive comparison. */
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Canonical form of a (possibly multi-document) YAML text. */
function canonicalize(yamlText: string): string {
  return YAML.parseAllDocuments(yamlText)
    .map((doc) => YAML.stringify(sortDeep(doc.toJS())))
    .join('---\n');
}

type PairKind = 'argo' | 'flux';
interface ParityCase {
  name: string;
  app: string;
  description: string;
  pair: PairKind;
}

function loadCases(pair: PairKind): ParityCase[] {
  return fs
    .readdirSync(fixturesRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const meta = JSON.parse(
        fs.readFileSync(path.join(fixturesRoot, e.name, 'case.json'), 'utf-8')
      ) as { app: string; description: string; pair?: PairKind };
      return {
        name: e.name,
        app: meta.app,
        description: meta.description,
        pair: meta.pair ?? 'argo',
      };
    })
    .filter((c) => c.pair === pair)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Materialize a fixture project in a temp dir with the real src/. */
function materializeFixture(name: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `vow-parity-${name}-`));
  fs.cpSync(path.join(fixturesRoot, name, 'project'), root, {
    recursive: true,
  });
  fs.symlinkSync(path.join(repoRoot, 'src'), path.join(root, 'src'), 'dir');
  return root;
}

const ARGOCD_STUB = `#!/bin/sh
printf '%s\\n' "$@" > "$VOW_PARITY_ARGV"
while [ $# -gt 0 ]; do
  if [ "$1" = "-f" ]; then shift; cp "$1" "$VOW_PARITY_CAPTURE"; fi
  shift
done
exit 0
`;

const KUBECTL_STUB = `#!/bin/sh
if [ "$1" = "apply" ]; then
  while [ $# -gt 0 ]; do
    if [ "$1" = "-f" ]; then shift; cp "$1" "$VOW_PARITY_CAPTURE"; fi
    shift
  done
fi
exit 0
`;

interface BashRunResult {
  manifest: string;
  argv: string[] | null;
  binDir: string;
  capturePath: string;
  argvPath: string;
}

/** Write the stub binaries and return their dir + capture paths. */
function makeStubs(): Omit<BashRunResult, 'manifest' | 'argv'> {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-parity-bin-'));
  fs.writeFileSync(path.join(binDir, 'argocd'), ARGOCD_STUB, { mode: 0o755 });
  fs.writeFileSync(path.join(binDir, 'kubectl'), KUBECTL_STUB, {
    mode: 0o755,
  });
  return {
    binDir,
    capturePath: path.join(binDir, 'captured.yaml'),
    argvPath: path.join(binDir, 'argv.txt'),
  };
}

/** Run a bash runner (argoRunner/fluxRunner) with stubbed CLIs. */
function runBashRunner(
  root: string,
  runnerFile: string,
  runnerFn: string,
  app: string,
  stubs: Omit<BashRunResult, 'manifest' | 'argv'>
): BashRunResult {
  const script = [
    'set -a',
    'source src/default.env',
    'if [ -f ./.env ]; then source ./.env; fi',
    'set +a',
    `source src/${runnerFile}`,
    `${runnerFn} ${app}`,
  ].join('; ');
  execFileSync('bash', ['-c', script], {
    cwd: root,
    env: {
      PATH: `${stubs.binDir}:${process.env.PATH ?? ''}`,
      HOME: root,
      VOW_PARITY_CAPTURE: stubs.capturePath,
      VOW_PARITY_ARGV: stubs.argvPath,
    },
    stdio: 'pipe',
    timeout: 120_000,
  });
  assert.ok(
    fs.existsSync(stubs.capturePath),
    `${runnerFn} never handed a manifest to the CLI stub`
  );
  return {
    ...stubs,
    manifest: fs.readFileSync(stubs.capturePath, 'utf-8'),
    argv: fs.existsSync(stubs.argvPath)
      ? fs.readFileSync(stubs.argvPath, 'utf-8').split('\n').filter(Boolean)
      : null,
  };
}

function skipOrFail(t: { skip: (msg: string) => void }): boolean {
  if (bashToolsReady) return false;
  if (parityRequired) {
    assert.fail('VOW_PARITY_REQUIRED=1 but yq/envsubst are not on PATH');
  }
  t.skip('yq/envsubst not on PATH (CI installs them)');
  return true;
}

function assertGolden(fixtureName: string, canonicalActual: string): void {
  const goldenPath = path.join(fixturesRoot, fixtureName, 'expected.yaml');
  if (updateGoldens) {
    fs.writeFileSync(goldenPath, canonicalActual);
    return;
  }
  assert.ok(
    fs.existsSync(goldenPath),
    'missing golden expected.yaml (run with VOW_PARITY_UPDATE=1)'
  );
  assert.equal(
    canonicalActual,
    canonicalize(fs.readFileSync(goldenPath, 'utf-8')),
    'rendered manifest drifted from the golden file'
  );
}

describe('parity: substituteVariables preserveUnknown (envsubst allowlist semantics)', () => {
  const env = { KNOWN: 'value', EMPTY: '' };

  it('default mode keeps historical behavior (blank unknowns, expand defaults)', () => {
    assert.equal(substituteVariables('a $MISSING b', env), 'a  b');
    assert.equal(substituteVariables('${MISSING:-dflt}', env), 'dflt');
  });

  it('preserveUnknown substitutes plain references to known variables', () => {
    assert.equal(
      substituteVariables('$KNOWN/${KNOWN}', env, { preserveUnknown: true }),
      'value/value'
    );
    assert.equal(
      substituteVariables('[${EMPTY}]', env, { preserveUnknown: true }),
      '[]'
    );
  });

  it('preserveUnknown leaves unknown references literal (literal $ content survives)', () => {
    const input = "php: $settings['x']; pw: \"abc$ON=xyz\"; home: ${HOME}";
    assert.equal(
      substituteVariables(input, env, { preserveUnknown: true }),
      input
    );
  });

  it('preserveUnknown leaves parameter-expansion forms literal, like envsubst', () => {
    assert.equal(
      substituteVariables('${KNOWN:-dflt}', env, { preserveUnknown: true }),
      '${KNOWN:-dflt}'
    );
    assert.equal(
      substituteVariables('${MISSING:=dflt}', env, { preserveUnknown: true }),
      '${MISSING:=dflt}'
    );
  });
});

describe('parity pair 1: ArgoCD manifest preparation (argoRunner vs ArgoManager)', () => {
  for (const parityCase of loadCases('argo')) {
    it(
      `${parityCase.name}: ${parityCase.description}`,
      { timeout: 180_000 },
      (t) => {
        if (skipOrFail(t)) return;
        const root = materializeFixture(parityCase.name);
        try {
          const tsYaml = new ArgoManager(root).prepareAppManifest(
            parityCase.app
          ).templatedYaml;
          const bash = runBashRunner(
            root,
            'argoRunner.bash',
            'argoRunner',
            parityCase.app,
            makeStubs()
          );
          assert.equal(
            canonicalize(tsYaml),
            canonicalize(bash.manifest),
            'TypeScript and bash engines disagree on the rendered manifest'
          );
          assertGolden(parityCase.name, canonicalize(tsYaml));
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }
    );
  }
});

describe('parity pair 2: ArgoCD deploy invocation (argocd argv)', () => {
  it(
    'deployApp passes the same argocd arguments as argoRunner',
    { timeout: 180_000 },
    async (t) => {
      if (skipOrFail(t)) return;
      const fixture = loadCases('argo').find((c) => c.name === 'argo-drupal');
      assert.ok(fixture, 'argo-drupal fixture is required for pair 2');
      const root = materializeFixture(fixture.name);
      const stubs = makeStubs();
      const savedEnv = {
        PATH: process.env.PATH,
        VOW_PARITY_CAPTURE: process.env.VOW_PARITY_CAPTURE,
        VOW_PARITY_ARGV: process.env.VOW_PARITY_ARGV,
      };
      try {
        const bash = runBashRunner(
          root,
          'argoRunner.bash',
          'argoRunner',
          fixture.app,
          stubs
        );

        // TS side: the same stubs, reached through the test process env
        // (processManager merges process.env into the child env).
        process.env.PATH = `${stubs.binDir}:${savedEnv.PATH ?? ''}`;
        process.env.VOW_PARITY_CAPTURE = path.join(
          stubs.binDir,
          'captured-ts.yaml'
        );
        process.env.VOW_PARITY_ARGV = path.join(stubs.binDir, 'argv-ts.txt');
        const task = new ArgoManager(root).deployApp(fixture.app);
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('deployApp task did not finish')),
            60_000
          );
          task.emitter.once('close', () => {
            clearTimeout(timer);
            resolve();
          });
        });
        assert.equal(task.status, 'completed');

        const tsArgv = fs
          .readFileSync(process.env.VOW_PARITY_ARGV, 'utf-8')
          .split('\n')
          .filter(Boolean);
        // The -f path legitimately differs (bash tmpdir vs .vow-cache).
        const normalize = (argv: string[]): string[] => {
          const out = [...argv];
          const i = out.indexOf('-f');
          if (i >= 0 && i + 1 < out.length) out[i + 1] = '<FILE>';
          return out;
        };
        assert.ok(bash.argv, 'bash stub captured no argv');
        assert.deepEqual(normalize(tsArgv), normalize(bash.argv));

        // And the file each engine handed to argocd must agree too.
        const tsManifest = fs.readFileSync(
          process.env.VOW_PARITY_CAPTURE,
          'utf-8'
        );
        assert.equal(canonicalize(tsManifest), canonicalize(bash.manifest));
      } finally {
        process.env.PATH = savedEnv.PATH;
        if (savedEnv.VOW_PARITY_CAPTURE === undefined)
          delete process.env.VOW_PARITY_CAPTURE;
        else process.env.VOW_PARITY_CAPTURE = savedEnv.VOW_PARITY_CAPTURE;
        if (savedEnv.VOW_PARITY_ARGV === undefined)
          delete process.env.VOW_PARITY_ARGV;
        else process.env.VOW_PARITY_ARGV = savedEnv.VOW_PARITY_ARGV;
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  );
});

describe('parity pair 3: Flux manifest preparation (fluxRunner vs FluxManager)', () => {
  for (const parityCase of loadCases('flux')) {
    it(
      `${parityCase.name}: ${parityCase.description}`,
      { timeout: 180_000 },
      (t) => {
        if (skipOrFail(t)) return;
        const root = materializeFixture(parityCase.name);
        try {
          const tsYaml = new FluxManager(root).prepareAppManifest(
            parityCase.app
          ).templatedYaml;
          const bash = runBashRunner(
            root,
            'fluxRunner.bash',
            'fluxRunner',
            parityCase.app,
            makeStubs()
          );
          assert.equal(
            canonicalize(tsYaml),
            canonicalize(bash.manifest),
            'TypeScript and bash engines disagree on the rendered manifest'
          );
          assertGolden(parityCase.name, canonicalize(tsYaml));
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }
    );
  }
});
