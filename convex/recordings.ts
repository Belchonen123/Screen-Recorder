import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

const recordingDoc = v.object({
  _id: v.id("recordings"),
  _creationTime: v.number(),
  storageId: v.id("_storage"),
  thumbnailStorageId: v.optional(v.id("_storage")),
  title: v.string(),
  byteSize: v.optional(v.number()),
});

export const generateUploadUrl = mutationGeneric({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const finalizeRecording = mutationGeneric({
  args: {
    storageId: v.id("_storage"),
    thumbnailStorageId: v.optional(v.id("_storage")),
    title: v.optional(v.string()),
    byteSize: v.optional(v.number()),
  },
  returns: v.id("recordings"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("recordings", {
      storageId: args.storageId,
      thumbnailStorageId: args.thumbnailStorageId,
      title: args.title?.trim() || "Recording",
      byteSize: args.byteSize,
    });
  },
});

export const list = queryGeneric({
  args: {},
  returns: v.array(recordingDoc),
  handler: async (ctx) => {
    const rows = await ctx.db.query("recordings").collect();
    return rows
      .sort((a, b) => b._creationTime - a._creationTime)
      .slice(0, 50);
  },
});

export const getUrlByRecordingId = queryGeneric({
  args: { id: v.id("recordings") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.id);
    if (!doc) return null;
    return await ctx.storage.getUrl(doc.storageId);
  },
});

export const remove = mutationGeneric({
  args: { id: v.id("recordings") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.id);
    if (doc) {
      await ctx.storage.delete(doc.storageId);
      if (doc.thumbnailStorageId) {
        await ctx.storage.delete(doc.thumbnailStorageId);
      }
      await ctx.db.delete(args.id);
    }
    return null;
  },
});

export const getThumbnailUrlByRecordingId = queryGeneric({
  args: { id: v.id("recordings") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.id);
    if (!doc?.thumbnailStorageId) return null;
    return await ctx.storage.getUrl(doc.thumbnailStorageId);
  },
});
