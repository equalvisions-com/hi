import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Id } from "./_generated/dataModel";

export const addComment = mutation({
  args: {
    entryGuid: v.string(),
    feedUrl: v.string(),
    content: v.string(),
    parentId: v.optional(v.id("comments")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Get the user's profile to get their username
    const profile = await ctx.db
      .query("profiles")
      .filter(q => q.eq(q.field("userId"), userId))
      .first();
    
    if (!profile) throw new Error("User profile not found");

    // Validate content
    const content = args.content.trim();
    if (!content) throw new Error("Comment cannot be empty");
    if (content.length > 1000) throw new Error("Comment too long");

    // If this is a reply, verify parent exists
    if (args.parentId) {
      const parent = await ctx.db.get(args.parentId);
      if (!parent) throw new Error("Parent comment not found");
      if (parent.entryGuid !== args.entryGuid) {
        throw new Error("Parent comment belongs to different entry");
      }
    }

    return await ctx.db.insert("comments", {
      userId,
      username: profile.username,
      entryGuid: args.entryGuid,
      feedUrl: args.feedUrl,
      content,
      createdAt: Date.now(),
      parentId: args.parentId,
    });
  },
});

export const deleteComment = mutation({
  args: {
    commentId: v.id("comments"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const comment = await ctx.db.get(args.commentId);
    if (!comment) throw new Error("Comment not found");
    if (comment.userId !== userId) throw new Error("Not authorized");

    // Delete the comment and all its replies
    const deleteReplies = async (commentId: Id<"comments">) => {
      const replies = await ctx.db
        .query("comments")
        .withIndex("by_parent", (q) => q.eq("parentId", commentId))
        .collect();

      for (const reply of replies) {
        await deleteReplies(reply._id);
        await ctx.db.delete(reply._id);
      }
    };

    await deleteReplies(args.commentId);
    await ctx.db.delete(args.commentId);
  },
});

export const getComments = query({
  args: {
    entryGuid: v.string(),
  },
  handler: async (ctx, args) => {
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_entry_time", (q) => 
        q.eq("entryGuid", args.entryGuid)
      )
      .order("desc")
      .collect();

    // Get user info for each comment
    const userIds = new Set(comments.map(c => c.userId));
    const users = await Promise.all(
      Array.from(userIds).map(id => ctx.db.get(id))
    );
    const userMap = new Map(users.map(u => [u!._id, u]));

    return comments.map(comment => ({
      ...comment,
      user: userMap.get(comment.userId),
    }));
  },
});

// Define the type for a comment with user data
type CommentWithUser = {
  _id: Id<"comments">;
  _creationTime: number;
  parentId?: Id<"comments">;
  feedUrl: string;
  userId: Id<"users">;
  username: string;
  entryGuid: string;
  content: string;
  createdAt: number;
  user?: {
    userId: Id<"users">;
    username: string;
    [key: string]: any;
  };
};

export const batchGetComments = query({
  args: {
    entryGuids: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    // Get all comments for the requested entries in a single query
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_entry_time")
      .filter((q) => 
        q.or(
          ...args.entryGuids.map(guid => 
            q.eq(q.field("entryGuid"), guid)
          )
        )
      )
      .order("desc")
      .collect();

    if (comments.length === 0) {
      return args.entryGuids.map(() => []);
    }

    // Get all unique user IDs
    const userIds = new Set(comments.map(c => c.userId));
    
    // Fetch all user data in one query
    const users = await ctx.db
      .query("profiles")
      .filter((q) => 
        q.or(
          ...Array.from(userIds).map(id => 
            q.eq(q.field("userId"), id)
          )
        )
      )
      .collect();

    // Create a map for quick user lookup
    const userMap = new Map(users.map(u => [u.userId, u]));

    // Group comments by entryGuid
    const commentsByEntry = new Map<string, CommentWithUser[]>();
    for (const comment of comments) {
      const entryComments = commentsByEntry.get(comment.entryGuid) || [];
      const commentWithUser: CommentWithUser = {
        ...comment,
        user: userMap.get(comment.userId),
      };
      entryComments.push(commentWithUser);
      commentsByEntry.set(comment.entryGuid, entryComments);
    }

    // Return comments in the same order as input guids
    return args.entryGuids.map(guid => commentsByEntry.get(guid) || []);
  },
}); 