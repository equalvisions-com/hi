import { getAuthUserId } from "@convex-dev/auth/server";
import { query, mutation, action } from "./_generated/server";
import { v } from "convex/values";
import { r2 } from "./r2";
import { api } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }
    
    const userData = await ctx.db
      .query("users")
      .filter(q => q.eq(q.field("_id"), userId))
      .first();
      
    if (!userData) {
      throw new Error("User was deleted");
    }
    
    // Return only essential fields needed for authentication
    return {
      _id: userData._id,
      _creationTime: userData._creationTime,
      username: userData.username,
      name: userData.name,
      email: userData.email,
      isAnonymous: userData.isAnonymous,
      isBoarded: userData.isBoarded ?? false,
      image: userData.image,
      profileImage: userData.profileImage
    };
  },
});

// New optimized version that only selects needed fields
export const viewerOptimized = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }
    
    // Use query with field filtering instead of get()
    const user = await ctx.db
      .query("users")
      .filter(q => q.eq(q.field("_id"), userId))
      .first()
      .then(user => user ? {
        _id: user._id,
        username: user.username,
        name: user.name,
        email: user.email,
        isAnonymous: user.isAnonymous,
        isBoarded: user.isBoarded
      } : null);
    
    if (!user) {
      throw new Error("User was deleted");
    }
    
    // Return only the fields we need
    return user;
  },
});

export const getProfile = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const user = await ctx.db
      .query("users")
      .filter(q => q.eq(q.field("_id"), userId))
      .first()
      .then(user => user ? {
        userId: user._id,
        username: user.username || "Guest",
        name: user.name,
        bio: user.bio,
        profileImage: user.profileImage || user.image,
        rssKeys: user.rssKeys || [],
        isBoarded: user.isBoarded ?? false
      } : null);

    return user;
  },
});

export const getUserProfile = query({
  args: { id: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .filter(q => q.eq(q.field("_id"), args.id))
      .first()
      .then(user => user ? {
        userId: user._id,
        username: user.username || "Guest",
        name: user.name,
        bio: user.bio,
        profileImage: user.profileImage || user.image,
        rssKeys: user.rssKeys || []
      } : null);

    return user;
  },
});

export const getProfileByUsername = query({
  args: { username: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_username", q => q.eq("username", args.username.toLowerCase()))
      .first();
    
    if (!user) return null;

    // Return only the specific fields needed for profile display
    return {
      userId: user._id,
      username: user.username,
      name: user.name,
      bio: user.bio,
      profileImage: user.profileImage || user.image,
      rssKeys: user.rssKeys || []
    };
  },
});

// Optimized version that implements field selection pattern
export const getUserByUsernameOptimized = query({
  args: { 
    username: v.string(),
    // Allow callers to specify exactly which fields they need
    fields: v.optional(v.array(v.string()))
  },
  handler: async (ctx, args) => {
    const { username, fields = ["_id", "username", "name", "bio", "profileImage", "image"] } = args;
    
    // First get the base user document - but only retrieve it once
    const user = await ctx.db
      .query("users")
      .withIndex("by_username", q => q.eq("username", username.toLowerCase()))
      .first();
    
    if (!user) return null;
    
    // Create a result object with only the requested fields
    const result: Record<string, any> = {
      userId: user._id, // Always include the ID for reference
    };
    
    // Only include fields that were requested
    fields.forEach(field => {
      if (field === "profileImage" && !user.profileImage) {
        // Handle the special case for profileImage fallback
        result.profileImage = user.image;
      } else if (field in user) {
        // Handle standard fields
        result[field] = user[field as keyof typeof user];
      } else if (field === "rssKeys" && !user.rssKeys) {
        // Handle optional arrays with defaults
        result.rssKeys = [];
      }
    });
    
    return result;
  },
});

// Generate a signed URL for uploading a profile image
export const getProfileImageUploadUrl = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Unauthenticated");
    }
    
    // Generate a unique key for the profile image based on the user ID
    const key = `profile-images/${userId}_${Date.now()}`;
    
    try {
      // Generate a signed URL
      const urlResponse = await r2.generateUploadUrl(key);
      
      // Depending on the structure of the response, extract the URL correctly
      let url;
      if (typeof urlResponse === 'string') {
        url = urlResponse;
      } else if (urlResponse && typeof urlResponse === 'object') {
        // Looks like R2 is returning an object, try to get the url from it
        if ('url' in urlResponse) {
          url = (urlResponse as any).url;
        } else {
          // Try stringifying as a last resort
          url = String(urlResponse);
        }
      } else {
        throw new Error("Invalid URL format returned from R2");
      }
      
      return { url, key };
    } catch (error) {
      console.error("Failed to generate upload URL:", error);
      throw new Error("Failed to generate upload URL");
    }
  },
});

export const updateProfile = mutation({
  args: {
    name: v.union(v.string(), v.null()),
    bio: v.union(v.string(), v.null()),
    profileImage: v.union(v.string(), v.null()),
    // New parameter for R2 object key
    profileImageKey: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const { name, bio, profileImage, profileImageKey } = args;
    
    // Get the authenticated user ID
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Unauthenticated");
    }
    
    // Find the user with field filtering
    const user = await ctx.db
      .query("users")
      .filter(q => q.eq(q.field("_id"), userId))
      .first()
      .then(user => user ? {
        _id: user._id,
        profileImageKey: user.profileImageKey
      } : null);
      
    if (!user) {
      throw new Error("User not found");
    }
    
    // Prepare updates - convert null to undefined for the DB
    const updates: {
      name?: string;
      bio?: string;
      profileImage?: string;
      profileImageKey?: string;
    } = {};
    
    if (name !== null) updates.name = name;
    if (bio !== null) updates.bio = bio;
    
    // Store old key for tracking if we need to clean up
    const oldProfileImageKey = user.profileImageKey;
    const isChangingImage = profileImageKey && oldProfileImageKey && profileImageKey !== oldProfileImageKey;
    
    // Handle both regular profileImage URLs and R2 keys
    if (profileImageKey) {
      // If an R2 key is provided, generate a public URL for it
      try {
        const publicUrl = await r2.getUrl(profileImageKey);
        updates.profileImage = publicUrl;
        updates.profileImageKey = profileImageKey;
      } catch (error) {
        console.error("Failed to get image URL:", error);
        // Still save the key even if we can't get the URL right now
        updates.profileImageKey = profileImageKey;
      }
      
      // If we're changing the R2 image, delete the old one
      if (isChangingImage) {
        // We can't call an action directly from a mutation, so schedule with 0 delay for immediate execution
        ctx.scheduler.runAfter(0, api.r2Cleanup.deleteR2Object, { key: oldProfileImageKey });
        console.log(`🗑️ Scheduled immediate deletion of old profile image: ${oldProfileImageKey}`);
      }
    } else if (profileImage !== null) {
      // If just a regular URL is provided (legacy or external)
      updates.profileImage = profileImage;
      
      // If we're changing from R2 to external URL, remove the key and delete the old image
      if (oldProfileImageKey) {
        updates.profileImageKey = undefined;
        // We can't call an action directly from a mutation, so schedule with 0 delay for immediate execution
        ctx.scheduler.runAfter(0, api.r2Cleanup.deleteR2Object, { key: oldProfileImageKey });
        console.log(`🗑️ Scheduled immediate deletion of old profile image: ${oldProfileImageKey}`);
      }
    }
    
    // Update the user
    await ctx.db.patch(userId, updates);
    
    return userId;
  },
});

// Helper action to get a direct URL for an R2 stored profile image
export const getProfileImageUrl = action({
  args: {
    key: v.string(),
  },
  handler: async (ctx, args) => {
    return r2.getUrl(args.key);
  },
});

// Helper functions for the batch queries
async function getFriendsWithProfiles(
  ctx: any, 
  userId: Id<"users">, 
  limit: number
) {
  // Get friends relationships with minimal fields needed
  const friendships = await ctx.db
    .query("friends")
    .withIndex("by_users")
    .filter((q: any) => 
      q.or(
        q.and(
          q.eq(q.field("requesterId"), userId),
          q.eq(q.field("status"), "accepted")
        ),
        q.and(
          q.eq(q.field("requesteeId"), userId),
          q.eq(q.field("status"), "accepted")
        )
      )
    )
    .order("desc")
    .take(limit + 1); // Take one extra to check if there are more

  // Determine if there are more results
  const hasMore = friendships.length > limit;
  const cursor = hasMore ? friendships[limit - 1]._id : null;
  const items = hasMore ? friendships.slice(0, limit) : friendships;

  // Collect all friend IDs first to make a single batch query
  const friendIds: Id<"users">[] = [];
  // Track which friendships correspond to which IDs for later mapping
  const friendshipMap: Record<string, any> = {};

  items.forEach((friendship: any) => {
    try {
      const isSender = friendship.requesterId && friendship.requesterId.toString() === userId.toString();
      const friendId = isSender ? friendship.requesteeId : friendship.requesterId;
      
      if (friendId) {
        friendIds.push(friendId);
        // Store minimal friendship data
        friendshipMap[friendId.toString()] = {
          _id: friendship._id,
          status: friendship.status,
          direction: isSender ? "sent" : "received",
          friendId,
        };
      }
    } catch (error) {
      console.error("Error processing friendship for batch query:", error);
    }
  });

  // Batch query for all friend users at once - only get necessary fields
  const friends = await Promise.all(
    friendIds.map(id => 
      ctx.db
        .query("users")
        .filter((q: any) => q.eq(q.field("_id"), id))
        .first()
        .then((user: any) => 
          user ? {
            _id: user._id,
            username: user.username,
            name: user.name,
            profileImage: user.profileImage || user.image
          } : null
        )
    )
  );

  // Map the friends to their friendship data
  const friendItems = friends
    .filter(Boolean)
    .map((friend: any) => {
      const friendshipData = friendshipMap[friend._id.toString()];
      if (!friendshipData) return null;
      
      // Format as profile data with the expected structure
      // IMPORTANT: Use _id instead of userId to match ProfileData type
      return {
        friendship: friendshipData,
        profile: {
          _id: friend._id,  // This field must be _id, not userId
          userId: friend._id, // Keep userId for backward compatibility
          username: friend.username || "Guest",
          name: friend.name,
          profileImage: friend.profileImage
        }
      };
    })
    .filter(Boolean);

  // Return results in expected format
  return {
    items: friendItems,
    hasMore,
    cursor
  };
}

export const getProfilePageData = query({
  args: { 
    username: v.string(),
    limit: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const { username, limit = 10 } = args;

    // Get current authenticated user (optional)
    let currentUserId = null;
    try {
      currentUserId = await getAuthUserId(ctx);
    } catch (e) {
      // Not authenticated, continue as guest
    }

    // Get the user's profile by username
    const user = await ctx.db
      .query("users")
      .withIndex("by_username", q => q.eq("username", username))
      .first();

    if (!user) {
      return null;
    }

    // Format as profile - only extract the specific fields we need
    const profile = {
      userId: user._id,
      username: user.username,
      name: user.name,
      bio: user.bio,
      profileImage: user.profileImage || user.image
    };

    // Get friendship status if authenticated
    let friendshipStatus = null;
    if (currentUserId) {
      // Skip checking if viewing own profile
      if (currentUserId.toString() !== user._id.toString()) {
        const friendship = await ctx.db
          .query("friends")
          .withIndex("by_users")
          .filter(q =>
            q.or(
              q.and(
                q.eq(q.field("requesterId"), currentUserId),
                q.eq(q.field("requesteeId"), user._id)
              ),
              q.and(
                q.eq(q.field("requesterId"), user._id),
                q.eq(q.field("requesteeId"), currentUserId)
              )
            )
          )
          .first();

        if (friendship) {
          const isSender = friendship.requesterId.toString() === currentUserId.toString();
          // Only extract needed fields for friendship status
          friendshipStatus = {
            status: friendship.status,
            direction: isSender ? "sent" : "received",
            id: friendship._id
          };
        }
      } else {
        // Viewing own profile
        friendshipStatus = { status: "self" };
      }
    }

    // Get friends with profiles - making sure to optimize the helper function
    const friendsWithProfiles = await getFriendsWithProfiles(ctx, user._id, limit);

    // Get following count using optimized count-only query
    const followingCount = await ctx.db
      .query("following")
      .withIndex("by_user", q => q.eq("userId", user._id))
      .collect()
      .then(records => records.length);
    
    // Get following data (limited)
    const following = await ctx.db
      .query("following")
      .withIndex("by_user", q => q.eq("userId", user._id))
      .order("desc")
      .take(limit);

    // Get post data for followed feeds - only fetch specific fields needed
    const postIds = following.map(f => f.postId);
    const postsPromises = postIds.length > 0 
      ? postIds.map(id => 
          ctx.db
            .query("posts")
            .filter(q => q.eq(q.field("_id"), id))
            .first()
            .then(post => post ? {
              _id: post._id,
              title: post.title,
              featuredImg: post.featuredImg,
              categorySlug: post.categorySlug,
              postSlug: post.postSlug,
              mediaType: post.mediaType,
              verified: post.verified ?? false
            } : null)
        )
      : [];
    
    const posts = await Promise.all(postsPromises);

    // Filter out any null posts and format following data
    const followingData = following
      .map((follow, i) => {
        const post = posts[i];
        return post ? {
          _id: follow._id,
          feedUrl: follow.feedUrl,
          postId: follow.postId,
          post: post // Already formatted with only the fields we need
        } : null;
      })
      .filter(Boolean);

    // Return complete profile page data
    return {
      profile,
      friendshipStatus,
      social: {
        friendCount: friendsWithProfiles.items.length,
        followingCount,
        friends: friendsWithProfiles.items,
        following: followingData
      }
    };
  }
});

export const getProfileActivityData = query({
  args: { 
    userId: v.id("users"),
    limit: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const { userId, limit = 30 } = args;
    
    // Get user to verify existence - just check existence without fetching full document
    const userExists = await ctx.db
      .query("users")
      .filter(q => q.eq(q.field("_id"), userId))
      .first()
      .then(Boolean);
    
    if (!userExists) throw new Error("User not found");
    
    // Get the last 30 activities (comments, retweets only)
    // We've removed likes completely from the activity feed
    // Only select the specific fields we need for comments
    const [comments, retweets] = await Promise.all([
      ctx.db
        .query("comments")
        .withIndex("by_user", q => q.eq("userId", userId))
        .filter(q => q.eq(q.field("parentId"), undefined)) // Only fetch top-level comments
        .order("desc")
        .take(limit)
        .then(results => results.map(comment => ({
          _id: comment._id,
          createdAt: comment.createdAt,
          entryGuid: comment.entryGuid,
          feedUrl: comment.feedUrl,
          content: comment.content
        }))),
      ctx.db
        .query("retweets")
        .withIndex("by_user", q => q.eq("userId", userId))
        .order("desc")
        .take(limit)
        .then(results => results.map(retweet => ({
          _id: retweet._id,
          retweetedAt: retweet.retweetedAt,
          entryGuid: retweet.entryGuid,
          feedUrl: retweet.feedUrl,
          title: retweet.title,
          link: retweet.link,
          pubDate: retweet.pubDate
        })))
    ]);
    
    // Convert to unified activity items - already optimized from previous step
    const commentActivities = comments.map(comment => ({
      type: "comment" as const,
      timestamp: comment.createdAt,
      entryGuid: comment.entryGuid,
      feedUrl: comment.feedUrl,
      content: comment.content,
      _id: comment._id.toString()
    }));
    
    const retweetActivities = retweets.map(retweet => ({
      type: "retweet" as const,
      timestamp: retweet.retweetedAt,
      entryGuid: retweet.entryGuid,
      feedUrl: retweet.feedUrl,
      title: retweet.title,
      link: retweet.link,
      pubDate: retweet.pubDate,
      _id: retweet._id.toString()
    }));
    
    // Combine and sort by timestamp (newest first)
    const allActivities = [
      ...commentActivities,
      ...retweetActivities
    ].sort((a, b) => b.timestamp - a.timestamp);
    
    // Take only limit items
    const activities = allActivities.slice(0, limit);
    
    // Get all unique entryGuids from the activities
    const entryGuids = [...new Set(activities.map(activity => activity.entryGuid))];
    
    // Get only the unique feedUrls we need
    const feedUrls = [...new Set(activities.map(activity => activity.feedUrl))];
    
    // Get entry metrics for all guids more efficiently - perform count operations in parallel
    // Removed like count query since it's not needed in the activity feed
    const entryMetricsPromises = entryGuids.map(async guid => {
      const [commentCount, retweetCount] = await Promise.all([
        ctx.db.query("comments")
          .withIndex("by_entry", q => q.eq("entryGuid", guid))
          .collect()
          .then(comments => comments.length),
        ctx.db.query("retweets")
          .withIndex("by_entry", q => q.eq("entryGuid", guid))
          .collect()
          .then(retweets => retweets.length)
      ]);
      
      return {
        guid,
        // Still include likeCount in the metrics object to maintain the API contract,
        // but don't waste time querying it
        likeCount: 0,
        commentCount,
        retweetCount
      };
    });
    
    // Get post data with only the fields we need
    const postsPromises = feedUrls.map(feedUrl => 
      ctx.db.query("posts")
        .withIndex("by_feedUrl", q => q.eq("feedUrl", feedUrl))
        .first()
        .then(post => post ? {
          feedUrl: post.feedUrl,
          title: post.title,
          featuredImg: post.featuredImg,
          mediaType: post.mediaType, 
          categorySlug: post.categorySlug,
          postSlug: post.postSlug,
          verified: post.verified ?? false
        } : null)
    );
    
    // Collect all data in parallel
    const [entryMetricsArray, postsArray] = await Promise.all([
      Promise.all(entryMetricsPromises),
      Promise.all(postsPromises)
    ]);
    
    // Construct the metrics lookup and filter out nulls
    const entryMetrics = Object.fromEntries(
      entryMetricsArray.map(metrics => [metrics.guid, metrics])
    );
    
    // Filter null posts and create a map for fast lookup
    const postsMap = new Map();
    postsArray.filter(Boolean).forEach(post => {
      if (post && post.feedUrl) {
        postsMap.set(post.feedUrl, post);
      }
    });
    
    // Create a mapping of entry guids to post details
    const entryDetails: Record<string, {
      post_title: string;
      post_featured_img: string;
      post_media_type: string;
      category_slug: string;
      post_slug: string;
      verified?: boolean;
    }> = {};
    
    // Use the map for faster lookups instead of find() operation
    for (const activity of activities) {
      const post = postsMap.get(activity.feedUrl);
      if (post) {
        entryDetails[activity.entryGuid] = {
          post_title: post.title,
          post_featured_img: post.featuredImg,
          post_media_type: post.mediaType,
          category_slug: post.categorySlug,
          post_slug: post.postSlug,
          verified: post.verified
        };
      }
    }
    
    return {
      activities: {
        activities,
        totalCount: allActivities.length,
        hasMore: allActivities.length > limit
      },
      entryMetrics,
      entryDetails
    };
  }
});

export const getProfileLikesData = query({
  args: { 
    userId: v.id("users"),
    limit: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const { userId, limit = 30 } = args;
    
    // Get user to verify existence - just check existence without fetching full document
    const userExists = await ctx.db
      .query("users")
      .filter(q => q.eq(q.field("_id"), userId))
      .first()
      .then(Boolean);
    
    if (!userExists) throw new Error("User not found");
    
    // Get the user's likes - only select fields we need
    const likes = await ctx.db
      .query("likes")
      .withIndex("by_user", q => q.eq("userId", userId))
      .order("desc")
      .take(limit)
      .then(results => results.map(like => ({
        _id: like._id,
        _creationTime: like._creationTime,
        entryGuid: like.entryGuid,
        feedUrl: like.feedUrl,
        title: like.title,
        link: like.link,
        pubDate: like.pubDate
      })));
    
    // Convert to activity items - already optimized from previous step
    const activities = likes.map(like => ({
      type: "like" as const,
      timestamp: like._creationTime,
      entryGuid: like.entryGuid,
      feedUrl: like.feedUrl,
      title: like.title,
      link: like.link,
      pubDate: like.pubDate,
      _id: like._id.toString()
    }));
    
    // Get all unique entryGuids and feedUrls
    const entryGuids = [...new Set(activities.map(activity => activity.entryGuid))];
    const feedUrls = [...new Set(activities.map(activity => activity.feedUrl))];
    
    // Get entry metrics for all guids efficiently - perform count operations in parallel
    const entryMetricsPromises = entryGuids.map(async guid => {
      const [likeCount, commentCount, retweetCount] = await Promise.all([
        ctx.db.query("likes")
          .withIndex("by_entry", q => q.eq("entryGuid", guid))
          .collect()
          .then(likes => likes.length),
        ctx.db.query("comments")
          .withIndex("by_entry", q => q.eq("entryGuid", guid))
          .collect()
          .then(comments => comments.length),
        ctx.db.query("retweets")
          .withIndex("by_entry", q => q.eq("entryGuid", guid))
          .collect()
          .then(retweets => retweets.length)
      ]);
      
      return {
        guid,
        likeCount,
        commentCount,
        retweetCount
      };
    });
    
    // Get post data with only the fields we need
    const postsPromises = feedUrls.map(feedUrl => 
      ctx.db.query("posts")
        .withIndex("by_feedUrl", q => q.eq("feedUrl", feedUrl))
        .first()
        .then(post => post ? {
          feedUrl: post.feedUrl,
          title: post.title,
          featuredImg: post.featuredImg,
          mediaType: post.mediaType, 
          categorySlug: post.categorySlug,
          postSlug: post.postSlug,
          verified: post.verified ?? false
        } : null)
    );
    
    // Collect all data in parallel
    const [entryMetricsArray, postsArray] = await Promise.all([
      Promise.all(entryMetricsPromises),
      Promise.all(postsPromises)
    ]);
    
    // Construct the metrics lookup
    const entryMetrics = Object.fromEntries(
      entryMetricsArray.map(metrics => [metrics.guid, metrics])
    );
    
    // Filter null posts and create a map for fast lookup
    const postsMap = new Map();
    postsArray.filter(Boolean).forEach(post => {
      if (post && post.feedUrl) {
        postsMap.set(post.feedUrl, post);
      }
    });
    
    // Create a mapping of entry guids to post details
    const entryDetails: Record<string, {
      post_title: string;
      post_featured_img: string;
      post_media_type: string;
      category_slug: string;
      post_slug: string;
      verified?: boolean;
    }> = {};
    
    // Use the map for faster lookups instead of find() operation
    for (const activity of activities) {
      const post = postsMap.get(activity.feedUrl);
      if (post) {
        entryDetails[activity.entryGuid] = {
          post_title: post.title,
          post_featured_img: post.featuredImg,
          post_media_type: post.mediaType,
          category_slug: post.categorySlug,
          post_slug: post.postSlug,
          verified: post.verified
        };
      }
    }
    
    return {
      activities: {
        activities,
        totalCount: likes.length,
        hasMore: likes.length >= limit
      },
      entryMetrics,
      entryDetails
    };
  }
});

export const completeOnboarding = mutation({
  args: {
    username: v.string(),
    name: v.optional(v.union(v.string(), v.null())),
    bio: v.optional(v.union(v.string(), v.null())),
    profileImageKey: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const { username, name, bio, profileImageKey } = args;
    
    // Get the authenticated user ID
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Unauthenticated");
    }
    
    // Find the user with field filtering
    const user = await ctx.db
      .query("users")
      .filter(q => q.eq(q.field("_id"), userId))
      .first()
      .then(user => user ? {
        _id: user._id,
        username: user.username
      } : null);
      
    if (!user) {
      throw new Error("User not found");
    }
    
    // Check if the username is already taken (case-insensitive)
    if (user.username?.toLowerCase() !== username.toLowerCase()) {
      const existingUser = await ctx.db
        .query("users")
        .withIndex("by_username", q => q.eq("username", username.toLowerCase()))
        .first();
      
      if (existingUser) {
        throw new Error("Username already taken");
      }
    }
    
    // Default SVG profile image
    const defaultProfileImage = "data:image/svg+xml;utf8,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%20100%20100%27%3E%3Ccircle%20cx=%2750%27%20cy=%2750%27%20r=%2750%27%20fill=%27%23E1E8ED%27/%3E%3Ccircle%20cx=%2750%27%20cy=%2740%27%20r=%2712%27%20fill=%27%23FFF%27/%3E%3Cpath%20fill=%27%23FFF%27%20d=%27M35,70c0-8.3%208.4-15%2015-15s15,6.7%2015,15v5H35V70z%27/%3E%3C/svg%3E";
    
    // Prepare updates
    const updates: {
      username: string;
      name?: string;
      bio?: string;
      profileImageKey?: string;
      profileImage: string;
      isBoarded: boolean;
    } = {
      username: username.toLowerCase(), // Store lowercase in database
      profileImage: defaultProfileImage, // Set default profile image
      isBoarded: true
    };
    
    if (name) {
      updates.name = name;
    }
    
    if (bio) {
      updates.bio = bio;
    }

    if (profileImageKey) {
      updates.profileImageKey = profileImageKey;
      // Get the public URL for the image
      try {
        const publicUrl = await r2.getUrl(profileImageKey);
        updates.profileImage = publicUrl;
      } catch (error) {
        console.error("Failed to get image URL:", error);
        // Still save the key even if we can't get the URL right now
      }
    }
    
    // Update the user
    await ctx.db.patch(userId, updates);
    
    return { success: true };
  },
});

// Optimized version of searchUsers that uses field filtering
export const searchUsersOptimized = query({
  args: { 
    query: v.string(),
    cursor: v.optional(v.id("users")),
    limit: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const { query, cursor, limit = 10 } = args;
    
    // Get current authenticated user (optional)
    let currentUserId = null;
    try {
      currentUserId = await getAuthUserId(ctx);
    } catch (e) {
      // Not authenticated, continue as guest
    }
    
    // Create a case-insensitive regex pattern
    const searchPattern = new RegExp(query.trim() || '.', 'i');
    
    // Get only the fields we need for filtering and displaying users
    // This prevents exposing sensitive fields like email, verification status, etc.
    const users = await ctx.db
      .query("users")
      .collect()
      .then(users => users.map(user => ({
        _id: user._id,
        username: user.username,
        name: user.name,
        bio: user.bio,
        profileImage: user.profileImage,
        image: user.image,
        isAnonymous: user.isAnonymous,
        isBoarded: user.isBoarded
      })));

    // Skip if we don't have users
    if (users.length === 0) {
      return { users: [], hasMore: false, nextCursor: null };
    }
    
    // Filter users by username, name, and bio using regex
    // Sort by priority: username match, then name match, then bio match
    const matchingUsers = users
      .filter(user => {
        // Skip users without usernames
        if (!user.username) return false;
        
        // Skip anonymous users
        if (user.isAnonymous) return false;
        
        // Match against username, name, or bio
        return (
          searchPattern.test(user.username) || 
          (user.name && searchPattern.test(user.name)) || 
          (user.bio && searchPattern.test(user.bio))
        );
      })
      .sort((a, b) => {
        // Sort by match priority (username > name > bio)
        const aUsernameMatch = a.username && searchPattern.test(a.username) ? 3 : 0;
        const aNameMatch = a.name && searchPattern.test(a.name) ? 2 : 0;
        const aBioMatch = a.bio && searchPattern.test(a.bio) ? 1 : 0;
        const aScore = aUsernameMatch + aNameMatch + aBioMatch;
        
        const bUsernameMatch = b.username && searchPattern.test(b.username) ? 3 : 0;
        const bNameMatch = b.name && searchPattern.test(b.name) ? 2 : 0;
        const bBioMatch = b.bio && searchPattern.test(b.bio) ? 1 : 0;
        const bScore = bUsernameMatch + bNameMatch + bBioMatch;
        
        return bScore - aScore;
      });
    
    // Handle pagination
    let startIndex = 0;
    if (cursor) {
      const cursorIndex = matchingUsers.findIndex(user => user._id === cursor);
      if (cursorIndex !== -1) {
        startIndex = cursorIndex + 1;
      }
    }
    
    // Get the paginated users
    const paginatedUsers = matchingUsers.slice(startIndex, startIndex + limit + 1);
    
    // Check if there are more users
    const hasMore = paginatedUsers.length > limit;
    const resultUsers = paginatedUsers.slice(0, limit);
    const nextCursor = hasMore && resultUsers.length > 0 ? resultUsers[resultUsers.length - 1]._id : null;
    
    // Process users to get friendship status and format result
    const formattedUsers = await Promise.all(
      resultUsers.map(async (user) => {
        // Get friendship status if authenticated
        let friendshipStatus = null;
        if (currentUserId && currentUserId.toString() !== user._id.toString()) {
          // Only query the specific friendship instead of getting all friendships
          const friendship = await ctx.db
            .query("friends")
            .withIndex("by_users")
            .filter(q =>
              q.or(
                q.and(
                  q.eq(q.field("requesterId"), currentUserId),
                  q.eq(q.field("requesteeId"), user._id)
                ),
                q.and(
                  q.eq(q.field("requesterId"), user._id),
                  q.eq(q.field("requesteeId"), currentUserId)
                )
              )
            )
            .first()
            .then(friendship => friendship ? {
              _id: friendship._id,
              status: friendship.status,
              requesterId: friendship.requesterId,
              requesteeId: friendship.requesteeId
            } : null);

          if (friendship) {
            const isSender = friendship.requesterId.toString() === currentUserId.toString();
            friendshipStatus = {
              exists: true,
              status: friendship.status,
              direction: isSender ? "sent" : "received",
              friendshipId: friendship._id
            };
          } else {
            friendshipStatus = {
              exists: false,
              status: null,
              direction: null,
              friendshipId: null
            };
          }
        } else if (currentUserId && currentUserId.toString() === user._id.toString()) {
          friendshipStatus = {
            exists: true, 
            status: "self",
            direction: null,
            friendshipId: null
          };
        }
        
        // Return only essential fields needed for the UI
        return {
          userId: user._id,
          username: user.username || "Guest",
          name: user.name,
          bio: user.bio || "",
          profileImage: user.profileImage || user.image,
          isAuthenticated: !!currentUserId,
          friendshipStatus
        };
      })
    );
    
    return {
      users: formattedUsers,
      hasMore,
      nextCursor
    };
  },
});

export const getRandomUsers = query({
  args: { 
    limit: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const { limit = 10 } = args;
    
    // Get current authenticated user (optional)
    let currentUserId = null;
    try {
      currentUserId = await getAuthUserId(ctx);
    } catch (e) {
      // Not authenticated, continue as guest
    }
    
    // Get only necessary fields from users - avoid exposing sensitive information
    const users = await ctx.db
      .query("users")
      .collect()
      .then(allUsers => allUsers.map(user => ({
        _id: user._id,
        username: user.username,
        name: user.name,
        bio: user.bio,
        profileImage: user.profileImage,
        image: user.image,
        isAnonymous: user.isAnonymous,
        isBoarded: user.isBoarded
      })));

    // Skip if we don't have users
    if (users.length === 0) {
      return { users: [], hasMore: false, nextCursor: null };
    }
    
    // Filter out users without usernames and anonymous users
    const validUsers = users.filter(user => {
      return user.username && !user.isAnonymous && user.isBoarded === true;
    });
    
    // Shuffle the users array (Fisher-Yates algorithm)
    for (let i = validUsers.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [validUsers[i], validUsers[j]] = [validUsers[j], validUsers[i]];
    }
    
    // Get the limited number of users
    const randomUsers = validUsers.slice(0, limit);
    
    // If not authenticated, return without friendship status
    if (!currentUserId) {
      const formattedUsers = randomUsers.map(user => ({
        userId: user._id,
        username: user.username || "Guest",
        name: user.name,
        bio: user.bio || "",
        profileImage: user.profileImage || user.image,
        isAuthenticated: false,
        friendshipStatus: null
      }));
      
      return {
        users: formattedUsers,
        hasMore: false,
        nextCursor: null
      };
    }
    
    // Get all friendship data in one batch query for efficiency
    const userIds = randomUsers.map(user => user._id);
    
    // Query all relevant friendships where current user is involved with any of the random users
    const friendships = await ctx.db
      .query("friends")
      .filter(q => 
        q.or(
          q.and(
            q.eq(q.field("requesterId"), currentUserId),
            q.or(...userIds.map(id => q.eq(q.field("requesteeId"), id)))
          ),
          q.and(
            q.or(...userIds.map(id => q.eq(q.field("requesterId"), id))),
            q.eq(q.field("requesteeId"), currentUserId)
          )
        )
      )
      .collect()
      .then(friendships => friendships.map(friendship => ({
        _id: friendship._id,
        requesterId: friendship.requesterId,
        requesteeId: friendship.requesteeId,
        status: friendship.status
      })));
    
    // Create a map of userId to friendship status for fast lookup
    const friendshipMap = new Map();
    
    friendships.forEach(friendship => {
      const isSender = friendship.requesterId.toString() === currentUserId.toString();
      const targetId = isSender ? friendship.requesteeId.toString() : friendship.requesterId.toString();
      
      friendshipMap.set(targetId, {
        exists: true,
        status: friendship.status,
        direction: isSender ? "sent" : "received",
        friendshipId: friendship._id
      });
    });
    
    // Process users to get friendship status and format result
    const formattedUsers = randomUsers.map(user => {
      // Skip self
      if (user._id.toString() === currentUserId.toString()) {
        return {
          userId: user._id,
          username: user.username || "Guest",
          name: user.name,
          bio: user.bio || "",
          profileImage: user.profileImage || user.image,
          isAuthenticated: true,
          friendshipStatus: {
            exists: true, 
            status: "self",
            direction: null,
            friendshipId: null
          }
        };
      }
      
      // Get from map or create default
      const friendshipStatus = friendshipMap.get(user._id.toString()) || {
        exists: false,
        status: null,
        direction: null,
        friendshipId: null
      };
      
      return {
        userId: user._id,
        username: user.username || "Guest",
        name: user.name,
        bio: user.bio || "",
        profileImage: user.profileImage || user.image,
        isAuthenticated: true,
        friendshipStatus
      };
    });
    
    return {
      users: formattedUsers,
      hasMore: false,
      nextCursor: null
    };
  },
});

export const deleteAccount = mutation({
  args: {},
  handler: async (ctx) => {
    // Get the authenticated user ID
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Unauthenticated");
    }
    
    // Get only the profile image key if it exists
    const user = await ctx.db
      .query("users")
      .filter(q => q.eq(q.field("_id"), userId))
      .first()
      .then(user => user ? {
        _id: user._id,
        profileImageKey: user.profileImageKey
      } : null);
      
    if (!user) {
      throw new Error("User not found");
    }
    
    // Get the profile image key if it exists
    const profileImageKey = user.profileImageKey;
    
    // 1. Delete user's likes
    const likes = await ctx.db
      .query("likes")
      .withIndex("by_user", q => q.eq("userId", userId))
      .collect();
    
    for (const like of likes) {
      await ctx.db.delete(like._id);
    }
    
    // 2. Delete user's bookmarks
    const bookmarks = await ctx.db
      .query("bookmarks")
      .withIndex("by_user", q => q.eq("userId", userId))
      .collect();
    
    for (const bookmark of bookmarks) {
      await ctx.db.delete(bookmark._id);
    }
    
    // 3. Delete user's retweets
    const retweets = await ctx.db
      .query("retweets")
      .withIndex("by_user", q => q.eq("userId", userId))
      .collect();
    
    for (const retweet of retweets) {
      await ctx.db.delete(retweet._id);
    }
    
    // 4. Delete user's comments and comment likes
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_user", q => q.eq("userId", userId))
      .collect();
    
    for (const comment of comments) {
      // Delete likes for this comment
      const commentLikes = await ctx.db
        .query("commentLikes")
        .withIndex("by_comment", q => q.eq("commentId", comment._id))
        .collect();
      
      for (const like of commentLikes) {
        await ctx.db.delete(like._id);
      }
      
      // Delete the comment itself
      await ctx.db.delete(comment._id);
    }
    
    // 5. Delete likes the user made on other comments
    const userCommentLikes = await ctx.db
      .query("commentLikes")
      .withIndex("by_user", q => q.eq("userId", userId))
      .collect();
    
    for (const like of userCommentLikes) {
      await ctx.db.delete(like._id);
    }
    
    // 6. Delete user's following data
    const following = await ctx.db
      .query("following")
      .withIndex("by_user", q => q.eq("userId", userId))
      .collect();
    
    for (const follow of following) {
      await ctx.db.delete(follow._id);
    }
    
    // 7. Delete user's friendship data (both as requester and requestee)
    // Get friendships where user is the requester
    const friendshipsAsRequester = await ctx.db
      .query("friends")
      .withIndex("by_requester", q => q.eq("requesterId", userId))
      .collect();
    
    for (const friendship of friendshipsAsRequester) {
      await ctx.db.delete(friendship._id);
    }
    
    // Get friendships where user is the requestee
    const friendshipsAsRequestee = await ctx.db
      .query("friends")
      .withIndex("by_requestee", q => q.eq("requesteeId", userId))
      .collect();
    
    for (const friendship of friendshipsAsRequestee) {
      await ctx.db.delete(friendship._id);
    }
    
    // 8. Delete auth-related data
    
    // 8.1 Delete auth accounts
    const authAccounts = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", q => q.eq("userId", userId))
      .collect();
    
    for (const account of authAccounts) {
      // Delete any verification codes associated with this account first
      const verificationCodes = await ctx.db
        .query("authVerificationCodes")
        .withIndex("accountId", q => q.eq("accountId", account._id))
        .collect();
      
      for (const code of verificationCodes) {
        await ctx.db.delete(code._id);
      }
      
      // Delete the account
      await ctx.db.delete(account._id);
    }
    
    // 8.2 Delete auth sessions and related refresh tokens
    const authSessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", q => q.eq("userId", userId))
      .collect();
    
    for (const session of authSessions) {
      // Delete refresh tokens for this session
      const refreshTokens = await ctx.db
        .query("authRefreshTokens")
        .withIndex("sessionId", q => q.eq("sessionId", session._id))
        .collect();
      
      for (const token of refreshTokens) {
        await ctx.db.delete(token._id);
      }
      
      // Delete session verifiers
      const verifiers = await ctx.db
        .query("authVerifiers")
        .filter(q => q.eq(q.field("sessionId"), session._id))
        .collect();
      
      for (const verifier of verifiers) {
        await ctx.db.delete(verifier._id);
      }
      
      // Delete the session
      await ctx.db.delete(session._id);
    }
    
    // 9. Delete the profile image from R2 if it exists
    if (profileImageKey) {
      // Schedule the deletion of the profile image
      ctx.scheduler.runAfter(0, api.r2Cleanup.deleteR2Object, { key: profileImageKey });
    }
    
    // 10. Finally, delete the user record itself
    await ctx.db.delete(userId);
    
    return { success: true };
  },
});

