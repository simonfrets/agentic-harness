/**
 * Installs the TypeScript source hooks in a spawned Node process.
 *
 * The hooks run on their own thread, so they have to live in a module of their
 * own; this is the file `node --import` points at.
 */
import { register } from "node:module";

register("./typescript-source-hooks.mjs", import.meta.url);
