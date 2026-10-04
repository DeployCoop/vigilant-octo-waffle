/**
 * Bash <-> TypeScript parity contract tests (improvements plan WS3).
 *
 * The bash runners (src/argoRunner.bash et al.) and the TypeScript
 * engine are two implementations of the same templating behavior.
 * These tests run BOTH engines over identical fixture projects and
 * require their outputs to agree after canonicalization (parse the
 * YAML, sort keys recursively), and to match the fixture's golden
 * `expected.yaml`, so behavior changes on either side are deliberate.
 *
 * Bash side: the real argoRunner is sourced and invoked with a stub
 * `argocd` on PATH that captures the manifest it would have applied.
 * TS side: ArgoManager.prepareAppManifest on the same project tree.
 * Both read the repository's real src/default.env (the fixture root
 * symlinks src/), so the envsubst allowlist and the TS config map see
 * identical inputs.
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
import { ArgoManager } from '../index.js';
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

interface ParityCase {
  name: string;
  app: string;
  description: string;
}

function loadCases(): ParityCase[] {
  return fs
    .readdirSync(fixturesRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('argo-'))
    .map((e) => {
      const meta = JSON.parse(
        fs.readFileSync(path.join(fixturesRoot, e.name, 'case.json'), 'utf-8')
      ) as { app: string; description: string };
      return { name: e.name, app: meta.app, description: meta.description };
    })
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
while [ $# -gt 0 ]; do
  if [ "$1" = "-f" ]; then shift; cp "$1" "$VOW_PARITY_CAPTURE"; fi
  shift
done
exit 0
`;

/** Run the bash argoRunner and return the manifest argocd would get. */
function runBashEngine(root: string, app: string): string {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vow-parity-bin-'));
  const stub = path.join(binDir, 'argocd');
  fs.writeFileSync(stub, ARGOCD_STUB, { mode: 0o755 });
  const capture = path.join(binDir, 'captured.yaml');
  const script = [
    'set -a',
    'source src/default.env',
    'if [ -f ./.env ]; then source ./.env; fi',
    'set +a',
    'source src/argoRunner.bash',
    `argoRunner ${app}`,
  ].join('; ');
  execFileSync('bash', ['-c', script], {
    cwd: root,
    env: {
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      HOME: root,
      VOW_PARITY_CAPTURE: capture,
    },
    stdio: 'pipe',
    timeout: 120_000,
  });
  assert.ok(
    fs.existsSync(capture),
    'bash runner never handed a manifest to the argocd stub'
  );
  return fs.readFileSync(capture, 'utf-8');
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

describe('parity: ArgoCD manifest preparation (bash argoRunner vs ArgoManager)', () => {
  for (const parityCase of loadCases()) {
    it(
      `${parityCase.name}: ${parityCase.description}`,
      { timeout: 180_000 },
      (t) => {
        if (!bashToolsReady) {
          if (parityRequired) {
            assert.fail(
              'VOW_PARITY_REQUIRED=1 but yq/envsubst are not on PATH'
            );
          }
          t.skip('yq/envsubst not on PATH (CI installs them)');
          return;
        }
        const fixtureDir = path.join(fixturesRoot, parityCase.name);
        const root = materializeFixture(parityCase.name);
        try {
          const tsYaml = new ArgoManager(root).prepareAppManifest(
            parityCase.app
          ).templatedYaml;
          const bashYaml = runBashEngine(root, parityCase.app);

          assert.equal(
            canonicalize(tsYaml),
            canonicalize(bashYaml),
            'TypeScript and bash engines disagree on the rendered manifest'
          );

          const goldenPath = path.join(fixtureDir, 'expected.yaml');
          if (updateGoldens) {
            fs.writeFileSync(goldenPath, canonicalize(tsYaml));
          } else {
            assert.ok(
              fs.existsSync(goldenPath),
              'missing golden expected.yaml (run with VOW_PARITY_UPDATE=1)'
            );
            assert.equal(
              canonicalize(tsYaml),
              canonicalize(fs.readFileSync(goldenPath, 'utf-8')),
              'rendered manifest drifted from the golden file'
            );
          }
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }
    );
  }
});
