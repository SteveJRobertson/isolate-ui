import { describe, it, expect } from 'vitest';
import {
  AGENT_PERSONAS,
  getPersona,
  getPersonaIds,
  validatePersonas,
} from '../agents';

const REQUIRED_IDS = ['po', 'architect', 'dev', 'a11y', 'qa', 'docs'];

describe('Agent Personas', () => {
  it('defines all 6 required personas', () => {
    const ids = getPersonaIds();
    REQUIRED_IDS.forEach((id) => {
      expect(ids).toContain(id);
    });
  });

  it('each persona has required fields', () => {
    REQUIRED_IDS.forEach((id) => {
      const persona = AGENT_PERSONAS[id];
      expect(persona.id).toBe(id);
      expect(persona.name).toMatch(/^@isolate-/);
      expect(persona.title).toBeTruthy();
      expect(persona.description).toBeTruthy();
      expect(persona.systemPrompt.length).toBeGreaterThan(50);
      expect(['gpt-4o', 'claude-3-5-sonnet']).toContain(persona.model);
      expect(persona.inputFields.length).toBeGreaterThan(0);
      expect(persona.outputFields.length).toBeGreaterThan(0);
    });
  });

  it('getPersona returns the correct persona', () => {
    const po = getPersona('po');
    expect(po?.name).toBe('@isolate-po');

    const a11y = getPersona('a11y');
    expect(a11y?.name).toBe('@isolate-a11y');
    expect(a11y?.model).toBe('claude-3-5-sonnet');
  });

  it('getPersona returns undefined for unknown IDs', () => {
    expect(getPersona('unknown')).toBeUndefined();
    expect(getPersona('')).toBeUndefined();
  });

  it('validatePersonas passes when all required personas exist', () => {
    expect(() => validatePersonas(REQUIRED_IDS)).not.toThrow();
  });

  it('validatePersonas throws when a persona is missing', () => {
    expect(() => validatePersonas(['po', 'nonexistent'])).toThrow(
      'Missing required personas: nonexistent',
    );
  });

  it('each persona system prompt mentions its core responsibility', () => {
    expect(AGENT_PERSONAS['po'].systemPrompt).toContain('Product Owner');
    expect(AGENT_PERSONAS['architect'].systemPrompt).toContain('Architect');
    expect(AGENT_PERSONAS['a11y'].systemPrompt).toContain('WCAG');
    expect(AGENT_PERSONAS['qa'].systemPrompt).toContain('QA Engineer');
  });
});
