// Keep legacy API for backward compatibility
export {
  OrchestratorGraph as OrchestratorGraphLegacy,
  type AgentNodeFn,
  type OrchestratorRunResult,
} from './graph';

// New LangGraph-based implementation
export {
  OrchestratorGraph,
  type AgentNodeFn as AgentNodeFnLangGraph,
  type OrchestratorRunResult as OrchestratorRunResultLangGraph,
} from './langgraph';
