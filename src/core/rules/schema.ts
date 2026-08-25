import { z } from 'zod';

export const ruleFrontmatterSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'rule ids are lowercase kebab-case'),
  /** Agent names, or `*` for every agent. */
  appliesTo: z.array(z.string()).default(['*']),
  /**
   * `advisory` rules are injected into agent context only. `blocking` rules
   * additionally run their `check` at handoff time and can fail it.
   */
  enforcement: z.enum(['advisory', 'blocking']).default('advisory'),
  /** Executable check, relative to `.harness/rules/`. */
  check: z.string().optional(),
  description: z.string().default(''),
});

export type RuleFrontmatter = z.infer<typeof ruleFrontmatterSchema>;

export interface Rule extends RuleFrontmatter {
  /** The markdown body -- the text injected into an agent's context. */
  body: string;
  /** Absolute path to the check script, when one is declared. */
  checkPath: string | undefined;
  file: string;
}
