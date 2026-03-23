import { Mastra, Workflow, Step } from '@mastra/core';
import { z } from 'zod';

// Note: Mastra uses a different architecture (Workflows/Steps).
// This spike is minimal for comparison of state persistence.

const poStep = new Step({
  id: 'po',
  execute: async ({ context }) => {
    console.log('[Mastra PO] Generating spec');
    return {
      spec: {
        component: 'Button',
        primitive: '@ark-ui/react/button',
        props: {},
        slots: ['root'],
        tokens: ['primary.500'],
      },
    };
  },
});

const architectStep = new Step({
  id: 'architect',
  execute: async ({ context }) => {
    console.log('[Mastra Architect] Validating spec');
    // Minimal validation logic for comparison
    return {
      isValid: true,
    };
  },
});

const workflow = new Workflow({
  name: 'agent-loop-spike',
  trigger: z.object({ issue_id: z.string() }),
});

workflow.step(poStep).then(architectStep);

export const mastraApp = new Mastra({
  workflows: {
    loop: workflow,
  },
  // Mastra handles storage via LibSQL/Postgres by default,
  // but we can configure it for comparison if needed.
});
