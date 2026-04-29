import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  recordings: defineTable({
    storageId: v.id("_storage"),
    /** JPEG poster (~first frame), optional — client-generated */
    thumbnailStorageId: v.optional(v.id("_storage")),
    title: v.string(),
    byteSize: v.optional(v.number()),
  }),
});
