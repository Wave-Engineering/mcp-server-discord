/**
 * logger.ts -- Re-exports @wave-engineering/mcp-logger for the disc server.
 *
 * All other files import { log } from "./logger.ts" — this indirection
 * lets us swap the implementation without touching every import site.
 */

import { createLogger } from "@wave-engineering/mcp-logger";

export const log = createLogger("disc");
