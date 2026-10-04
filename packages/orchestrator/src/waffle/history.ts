/**
 * Waffle run history persistence (WS6 split of waffle.ts).
 * Behavior-preserving file motion only — see the WS6 decomposition PR.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { type WaffleRunProgress } from './runner.js';

// ============================================================================
// 5. WAFFLE RUN HISTORY & TELEMETRY
// ============================================================================

export class WaffleRunHistory {
  private historyFile: string;
  private projectRoot: string;
  private inMemoryHistory: WaffleRunProgress[] = [];

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.historyFile = path.join(projectRoot, '.vow_waffle_history.json');
  }

  private async loadFromFile(): Promise<void> {
    try {
      if (fs.existsSync(this.historyFile)) {
        const raw = await fs.promises.readFile(this.historyFile, 'utf-8');
        this.inMemoryHistory = JSON.parse(raw);
      }
    } catch {
      this.inMemoryHistory = [];
    }
  }

  public async getHistory(): Promise<WaffleRunProgress[]> {
    await this.loadFromFile();
    return [...this.inMemoryHistory].sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
  }

  public async getRun(runId: string): Promise<WaffleRunProgress | undefined> {
    const list = await this.getHistory();
    return list.find((r) => r.runId === runId);
  }

  public async recordRun(run: WaffleRunProgress): Promise<void> {
    await this.loadFromFile();
    // Trim log bodies in persistent history to keep file performant
    const sanitizedRun = {
      ...run,
      stages: Object.fromEntries(
        Object.entries(run.stages).map(([stageId, stage]) => [
          stageId,
          {
            ...stage,
            steps: Object.fromEntries(
              Object.entries(stage.steps).map(([stepId, step]) => [
                stepId,
                {
                  ...step,
                  logs: step.logs.slice(-50), // keep last 50 lines
                },
              ])
            ),
          },
        ])
      ),
    };

    const existingIdx = this.inMemoryHistory.findIndex((r) => r.runId === run.runId);
    if (existingIdx >= 0) {
      this.inMemoryHistory[existingIdx] = sanitizedRun;
    } else {
      this.inMemoryHistory.unshift(sanitizedRun);
    }

    if (this.inMemoryHistory.length > 50) {
      this.inMemoryHistory = this.inMemoryHistory.slice(0, 50);
    }

    try {
      await fs.promises.writeFile(this.historyFile, JSON.stringify(this.inMemoryHistory, null, 2), 'utf-8');
    } catch {
      // ignore history write errors
    }
  }

  public async clearHistory(): Promise<void> {
    this.inMemoryHistory = [];
    if (fs.existsSync(this.historyFile)) {
      await fs.promises.unlink(this.historyFile);
    }
  }
}
