import type { LanguageModelV2 } from '@ai-sdk/provider';
import { wrapLanguageModel } from 'ai';
import { normalizeUsage, type TaskUsage } from '../usage';

/** Capture provider finish before the SDK waits for outstanding tool executions.
 * Each transport invocation owns its deduplication guard, independent of step summaries.
 */
export function withUsageAccounting(
  model: LanguageModelV2,
  record: (usage: TaskUsage) => Promise<void>,
  onStart?: () => void
): LanguageModelV2 {
  return wrapLanguageModel({
    model,
    middleware: {
      middlewareVersion: 'v2',
      wrapStream: async ({ doStream }) => {
        onStart?.();
        const result = await doStream();
        let recorded = false;
        return {
          ...result,
          stream: result.stream.pipeThrough(
            new TransformStream({
              async transform(part, controller) {
                if (part.type === 'finish' && !recorded) {
                  recorded = true;
                  const usage = normalizeUsage(part.usage);
                  const directCost = part.providerMetadata?.openrouter?.cost;
                  if (
                    typeof directCost === 'number' &&
                    Number.isFinite(directCost) &&
                    directCost >= 0
                  )
                    usage.costUsd = directCost;
                  await record(usage);
                }
                controller.enqueue(part);
              },
            })
          ),
        };
      },
    },
  });
}
