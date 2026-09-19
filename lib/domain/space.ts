import { z } from "zod";
import { ConnectionId, RevisionId } from "./model";
import { DocumentSummarySchema } from "./protocol";

/** A revision reached by an actual connection in the revision graph. */
const NeighborhoodNodeBaseSchema = z
  .object({
    document: DocumentSummarySchema,
    revisionId: RevisionId,
    sequence: z.number().int().positive(),
    connectionId: ConnectionId,
  })
  .strict();

const DirectNeighborhoodNodeSchema = NeighborhoodNodeBaseSchema.extend({
  distance: z.literal(1),
  viaRevisionId: z.null(),
}).strict();

const SecondNeighborhoodNodeSchema = NeighborhoodNodeBaseSchema.extend({
  distance: z.literal(2),
  viaRevisionId: RevisionId,
}).strict();

/**
 * The discriminant keeps the distance-one/null-via and distance-two/required-
 * via invariant visible to both TypeScript and the wire validator.
 */
export const NeighborhoodNodeSchema = z.discriminatedUnion("distance", [
  DirectNeighborhoodNodeSchema,
  SecondNeighborhoodNodeSchema,
]);

export type NeighborhoodNode = z.infer<typeof NeighborhoodNodeSchema>;

export const NeighborhoodResultSchema = z
  .object({
    centerRevisionId: RevisionId,
    nodes: z.array(NeighborhoodNodeSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();

export type NeighborhoodResult = z.infer<typeof NeighborhoodResultSchema>;
