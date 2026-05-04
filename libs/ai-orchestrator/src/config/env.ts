import { z } from 'zod';

/**
 * Environment variable validation schema for ai-orchestrator.
 * Ensures required API keys are present at startup.
 */
const OrchestratorEnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
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
 * Validate environment variables and fail fast if required keys are missing.
 * This is called at orchestrator initialization to prevent runtime surprises.
 *
 * @throws {Error} If validation fails, with a detailed message about what's missing
 */
export function validateOrchestratorEnv(): OrchestratorEnv {
  try {
    return OrchestratorEnvSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      // Collect all validation errors with details
      const errorDetails = error.errors
        .map((e) => {
          const field = e.path.join('.');
          const message = e.message || e.code;
          return `${field}: ${message}`;
        })
        .join('; ');

      throw new Error(
        `Orchestrator environment validation failed. ${errorDetails}. ` +
          `Please check .env.example and ensure OPENAI_API_KEY and ANTHROPIC_API_KEY are set.`,
      );
    }
    throw error;
  }
}
