import { z } from "zod";

/**
 * The six fixed pipeline agents, stored in code-unit order so that any
 * iteration over them is canonical without an extra sort.
 *
 * The archived handoff spells the fifth agent `hardender`; that is a typo and
 * `hardener` is the canonical identifier. See `docs/handoff/rule-enforcement.md`.
 */
export const BUILT_IN_AGENT_IDS = [
  "architect",
  "cleaner",
  "coder",
  "hardener",
  "qa",
  "specifier",
] as const;

export type BuiltInAgentId = (typeof BUILT_IN_AGENT_IDS)[number];

/**
 * A rule may target one of the six built-in agents or a project-defined agent,
 * so the identifier is a validated string rather than a closed union.
 */
export type AgentId = string;

const AGENT_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export const agentIdSchema = z
  .string()
  .regex(
    AGENT_ID_PATTERN,
    "agent ids must be lower-case kebab-case, for example `coder`"
  );

export const isBuiltInAgentId = (value: string): value is BuiltInAgentId =>
  (BUILT_IN_AGENT_IDS as readonly string[]).includes(value);

/**
 * Builds a record that is total over the built-in agents.
 *
 * A mapped type over a closed union is not an index signature, so reading
 * `record.coder` yields `T` rather than `T | undefined` under
 * `noUncheckedIndexedAccess`.
 */
export const mapBuiltInAgents = <T>(
  create: (agent: BuiltInAgentId) => T
): Readonly<Record<BuiltInAgentId, T>> =>
  Object.fromEntries(
    BUILT_IN_AGENT_IDS.map((agent) => [agent, create(agent)])
  ) as Record<BuiltInAgentId, T>;
