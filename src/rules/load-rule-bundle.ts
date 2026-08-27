import { LineCounter, parseDocument } from "yaml";

import { RuleValidationError } from "./rule-error.js";
import type { RuleIssue, RuleSourceLocation } from "./rule-error.js";
import { ruleBundleSchema } from "./rule-schema.js";
import type { RuleBundle } from "./rule-schema.js";

export interface LoadRuleBundleOptions {
  /** Filename reported in diagnostics. Never an absolute machine path. */
  readonly source: string;
}

/**
 * `Document.toJS()` is declared `any` by the `yaml` typings. Reading it through
 * a structural type that returns `unknown` keeps `any` out of this package
 * without an eslint-disable comment, which `reportUnusedDisableDirectives`
 * would itself flag if it ever became unnecessary.
 */
interface PlainDocument {
  toJS(options: { maxAliasCount: number }): unknown;
}

interface RangedNode {
  readonly range: readonly [number, number, number];
}

const MAX_ALIAS_COUNT = 64;

const hasRange = (node: unknown): node is RangedNode =>
  typeof node === "object" &&
  node !== null &&
  "range" in node &&
  Array.isArray(node.range);

const stripByteOrderMark = (text: string): string =>
  text.startsWith("﻿") ? text.slice(1) : text;

const normalizeNewlines = (text: string): string =>
  text.replace(/\r\n?/g, "\n");

const formatPath = (path: readonly PropertyKey[]): string =>
  path.map((segment) => String(segment)).join(".");

export const loadRuleBundle = (
  text: string,
  options: LoadRuleBundleOptions
): RuleBundle => {
  const lineCounter = new LineCounter();
  const document = parseDocument(normalizeNewlines(stripByteOrderMark(text)), {
    lineCounter,
    prettyErrors: true,
  });

  /**
   * Walks the path prefix outwards so a missing required field still reports
   * the location of its enclosing node instead of no location at all.
   */
  const locate = (path: readonly PropertyKey[]): RuleSourceLocation | null => {
    for (let end = path.length; end >= 0; end -= 1) {
      const node: unknown = document.getIn(path.slice(0, end), true);

      if (hasRange(node)) {
        const { line, col } = lineCounter.linePos(node.range[0]);

        return { line, column: col };
      }
    }

    return null;
  };

  if (document.errors.length > 0) {
    // `pos` is always populated, so syntax errors resolve through the same
    // line counter as schema errors rather than a second, branchier path.
    const issues: RuleIssue[] = document.errors.map((error) => {
      const { line, col } = lineCounter.linePos(error.pos[0]);

      return {
        path: "",
        message: error.message,
        location: { line, column: col },
      };
    });

    throw new RuleValidationError(options.source, issues);
  }

  const plain = (document as unknown as PlainDocument).toJS({
    maxAliasCount: MAX_ALIAS_COUNT,
  });
  const parsed = ruleBundleSchema.safeParse(plain);

  if (!parsed.success) {
    const issues: RuleIssue[] = parsed.error.issues.map((issue) => ({
      path: formatPath(issue.path),
      message: issue.message,
      location: locate(issue.path),
    }));

    throw new RuleValidationError(options.source, issues);
  }

  return parsed.data;
};
