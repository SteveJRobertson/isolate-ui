import { z } from 'zod';

/**
 * Environment variable validation schema for ai-orchestrator.
 * API keys (OPENAI_API_KEY, ANTHROPIC_API_KEY) are validated lazily by each
 * client factory when first accessed, not at schema parse time.
 */
const OrchestratorEnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  GITHUB_TOKEN: z
    .string()
    .min(1, 'GITHUB_TOKEN must be non-empty if provided')
    .optional(),
  LANGCHAIN_TRACING_V2: z.enum(['true', 'false']).optional(),
  LANGCHAIN_API_KEY: z.string().optional(),
  WEBHOOK_SECRET: z.string().optional(),
  TAILSCALE_HOSTNAME: z.string().optional(),
});

export type OrchestratorEnv = z.infer<typeof OrchestratorEnvSchema>;

/**
 * Validate environment variables.
 * Note: Individual clients (OpenAI, Anthropic) must validate their required keys separately.
 *
 * @throws {Error} If validation fails
 */
export function validateOrchestratorEnv(): OrchestratorEnv {
  try {
    return OrchestratorEnvSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorDetails = error.errors
        .map((e) => {
          const field = e.path.join('.');
          const message = e.message || e.code;
          return `${field}: ${message}`;
        })
        .join('; ');
      throw new Error(
        `Orchestrator environment validation failed. ${errorDetails}`,
      );
    }
    throw error;
  }
}
