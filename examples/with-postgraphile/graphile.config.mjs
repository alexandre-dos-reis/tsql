import { makePgService } from "postgraphile/adaptors/pg";
import { defaultMaskError } from "postgraphile/grafserv";
import { PostGraphileAmberPreset } from "postgraphile/presets/amber";

/** @type {GraphileConfig.Preset} */
export default {
  extends: [PostGraphileAmberPreset],
  pgServices: [
    makePgService({
      connectionString: process.env.DATABASE_URL ?? "postgres://postgraphile:secret@localhost:5432/postgres",
      schemas: ["api"],
    }),
  ],
  grafserv: {
    // PostGraphile hides database errors from clients. The trigger's refusal is
    // meant for them, so a check violation (SQLSTATE 23514) keeps its message.
    maskError(error) {
      const original = error.originalError;
      if (original?.code === "23514")
        return new error.constructor(original.message, { nodes: error.nodes, path: error.path });
      return defaultMaskError(error);
    },
  },
};
