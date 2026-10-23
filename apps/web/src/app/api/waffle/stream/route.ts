import { getProjectRoot } from '@/lib/project';
import {
  getWaffleRunner,
  type StageStatus,
  type StepStatus,
  type WaffleRunProgress,
} from '@vow/orchestrator';
import { authorizeRequest } from '@/lib/authz';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  // Authorize before opening the stream.
  const denied = await authorizeRequest(req, 'tasks:read');
  if (denied) return denied;

  const root = getProjectRoot();
  const runner = getWaffleRunner(root);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const sendEvent = (event: string, data: unknown) => {
        try {
          const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch {
          // stream might be closed
        }
      };

      // Send initial snapshot
      const initial = runner.getActiveRun();
      sendEvent('init', {
        activeRun: initial,
        timestamp: new Date().toISOString(),
      });

      // Keepalive heartbeat every 15s
      const heartbeat = setInterval(() => {
        sendEvent('ping', { time: Date.now() });
      }, 15000);

      // Event handlers — payload shapes are the runner's emit contracts
      // (packages/orchestrator/src/waffle/runner.ts).
      const onProgress = (data: WaffleRunProgress) => sendEvent('progress', data);
      const onStepLog = (data: { stepId: string; line: string }) => sendEvent('step_log', data);
      // pipeline_log is emitted only by WaffleRunner.logToRun(message: string).
      const onPipelineLog = (line: string) => sendEvent('pipeline_log', { line });
      const onStageStart = (data: { stageId: string; name: string }) => sendEvent('stage_start', data);
      const onStepStart = (data: { stepId: string; name: string; stageId: string }) =>
        sendEvent('step_start', data);
      const onStepComplete = (data: { stepId: string; status: StepStatus; error?: string }) =>
        sendEvent('step_complete', data);
      const onStageComplete = (data: { stageId: string; status: StageStatus }) =>
        sendEvent('stage_complete', data);
      const onFinish = (data: WaffleRunProgress) => sendEvent('finish', data);

      runner.on('progress', onProgress);
      runner.on('step_log', onStepLog);
      runner.on('pipeline_log', onPipelineLog);
      runner.on('stage_start', onStageStart);
      runner.on('step_start', onStepStart);
      runner.on('step_complete', onStepComplete);
      runner.on('stage_complete', onStageComplete);
      runner.on('finish', onFinish);

      // Cleanup on disconnect
      req.signal.addEventListener('abort', () => {
        clearInterval(heartbeat);
        runner.off('progress', onProgress);
        runner.off('step_log', onStepLog);
        runner.off('pipeline_log', onPipelineLog);
        runner.off('stage_start', onStageStart);
        runner.off('step_start', onStepStart);
        runner.off('step_complete', onStepComplete);
        runner.off('stage_complete', onStageComplete);
        runner.off('finish', onFinish);
        try {
          controller.close();
        } catch {
          // ignore
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
