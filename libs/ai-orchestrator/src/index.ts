/**
 * @isolate-ui/ai-orchestrator
 *
 * Multi-agent orchestrator for the Isolate UI development lifecycle.
 * Uses LangGraph.js to coordinate 6 specialized agent personas.
 */

// Core schema
export * from './schema';

// Agent definitions
export * from './agents';

// Persistence layer
export * from './persistence';

export const AI_ORCHESTRATOR_VERSION = '0.1.0';
