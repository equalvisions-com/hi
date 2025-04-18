import { query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

// Get all unique categories for a specific media type
export const getCategories = query({
  args: { mediaType: v.string() },
  handler: async (ctx, args) => {
    const { mediaType } = args;
    
    // Get only the category and mediaType fields from posts
    const posts = await ctx.db
      .query("posts")
      .filter(q => q.eq(q.field("mediaType"), mediaType))
      .collect()
      .then(posts => posts.map(post => ({
        category: post.category,
        categorySlug: post.categorySlug,
        mediaType: post.mediaType
      })));
    
    // Extract unique categories
    const categoriesMap = new Map();
    posts.forEach(post => {
      if (!categoriesMap.has(post.categorySlug)) {
        categoriesMap.set(post.categorySlug, {
          _id: post.categorySlug, // Use categorySlug as ID
          name: post.category,
          slug: post.categorySlug,
          mediaType: post.mediaType
        });
      }
    });
    
    // Convert map to array and sort alphabetically by name
    const categories = Array.from(categoriesMap.values()).sort((a, b) => 
      a.name.localeCompare(b.name)
    );
    
    return categories;
  },
});

// Get featured posts for a specific media type
export const getFeaturedPosts = query({
  args: { 
    mediaType: v.string(),
    limit: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const { mediaType, limit = 10 } = args;
    
    // Query featured posts for the specified media type
    const posts = await ctx.db
      .query("posts")
      .filter(q => 
        q.and(
          q.eq(q.field("mediaType"), mediaType),
          q.eq(q.field("isFeatured"), true)
        )
      )
      .take(limit);
    
    // Return only the necessary fields, not the entire post documents
    return posts.map(post => ({
      _id: post._id,
      _creationTime: post._creationTime,
      title: post.title,
      postSlug: post.postSlug,
      category: post.category,
      categorySlug: post.categorySlug,
      mediaType: post.mediaType,
      featuredImg: post.featuredImg,
      body: post.body?.substring(0, 150), // Truncate body to first 150 chars for preview
      feedUrl: post.feedUrl,
      verified: post.verified ?? false
    }));
  },
});

// Get posts by category with pagination
export const getPostsByCategory = query({
  args: { 
    categoryId: v.string(), // This will be the categorySlug
    mediaType: v.string(),
    cursor: v.optional(v.string()),
    limit: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const { categoryId, mediaType, cursor, limit = 10 } = args;
    
    // Get user authentication state
    const userId = await getAuthUserId(ctx);
    const isAuthenticated = !!userId;

    // Special case for featured posts
    if (categoryId === 'featured') {
      const posts = await ctx.db
        .query("posts")
        .filter(q => 
          q.and(
            q.eq(q.field("mediaType"), mediaType),
            q.eq(q.field("isFeatured"), true)
          )
        )
        .take(limit + 1);

      // Optimize posts to only include needed fields
      const optimizedPosts = posts.map(post => ({
        _id: post._id,
        _creationTime: post._creationTime,
        title: post.title,
        postSlug: post.postSlug,
        category: post.category,
        categorySlug: post.categorySlug,
        mediaType: post.mediaType,
        featuredImg: post.featuredImg,
        body: post.body?.substring(0, 150), // Truncate body to first 150 chars for preview
        feedUrl: post.feedUrl,
        verified: post.verified
      }));

      // Get follow states if authenticated
      let followStates: { [key: string]: boolean } = {};
      if (isAuthenticated) {
        const followings = await ctx.db
          .query("following")
          .withIndex("by_user_post")
          .filter(q => q.eq(q.field("userId"), userId))
          .collect();

        followStates = followings.reduce((acc: { [key: string]: boolean }, following) => {
          acc[following.postId] = true;
          return acc;
        }, {} as { [key: string]: boolean });
      }

      const hasMore = optimizedPosts.length > limit;
      const postsWithFollowState = optimizedPosts.slice(0, limit).map(post => ({
        ...post,
        isAuthenticated,
        isFollowing: followStates[post._id] || false
      }));
      
      return {
        posts: postsWithFollowState,
        hasMore,
        nextCursor: hasMore && optimizedPosts.length > 0 ? optimizedPosts[limit - 1]._id : null
      };
    }
    
    // For regular categories, query by categorySlug
    try {
      let postsQuery = ctx.db
        .query("posts")
        .filter(q => 
          q.and(
            q.eq(q.field("categorySlug"), categoryId),
            q.eq(q.field("mediaType"), mediaType)
          )
        );
      
      // Get posts with limit + 1 to determine if there are more posts
      const posts = await postsQuery.take(limit + 1);

      // Optimize posts to only include needed fields
      const optimizedPosts = posts.map(post => ({
        _id: post._id,
        _creationTime: post._creationTime,
        title: post.title,
        postSlug: post.postSlug,
        category: post.category,
        categorySlug: post.categorySlug,
        mediaType: post.mediaType,
        featuredImg: post.featuredImg,
        body: post.body?.substring(0, 150), // Truncate body to first 150 chars for preview
        feedUrl: post.feedUrl,
        verified: post.verified
      }));

      // Get follow states if authenticated
      let followStates: { [key: string]: boolean } = {};
      if (isAuthenticated) {
        const followings = await ctx.db
          .query("following")
          .withIndex("by_user_post")
          .filter(q => q.eq(q.field("userId"), userId))
          .collect();

        followStates = followings.reduce((acc: { [key: string]: boolean }, following) => {
          acc[following.postId] = true;
          return acc;
        }, {} as { [key: string]: boolean });
      }
      
      // Check if there are more posts
      const hasMore = optimizedPosts.length > limit;
      
      // Add follow states to posts
      const postsWithFollowState = optimizedPosts.slice(0, limit).map(post => ({
        ...post,
        isAuthenticated,
        isFollowing: followStates[post._id] || false
      }));
      
      // Return only the requested number of posts
      return {
        posts: postsWithFollowState,
        hasMore,
        nextCursor: hasMore && optimizedPosts.length > 0 ? optimizedPosts[limit - 1]._id : null
      };
    } catch (error) {
      console.error("Error fetching posts by category:", error);
      return { posts: [], hasMore: false, nextCursor: null };
    }
  },
});

// Get initial data for category slider (categories + initial posts)
export const getCategorySliderData = query({
  args: { 
    mediaType: v.string(),
    postsPerCategory: v.optional(v.number())
  },
  handler: async (ctx, args) => {
    const { mediaType, postsPerCategory = 10 } = args;
    
    // Get user authentication state
    const userId = await getAuthUserId(ctx);
    const isAuthenticated = !!userId;

    // Get all posts for the media type
    const allPosts = await ctx.db
      .query("posts")
      .filter(q => q.eq(q.field("mediaType"), mediaType))
      .collect();

    // Extract only the fields we need to reduce memory usage
    const optimizedPosts = allPosts.map(post => ({
      _id: post._id,
      _creationTime: post._creationTime,
      title: post.title,
      postSlug: post.postSlug,
      category: post.category,
      categorySlug: post.categorySlug,
      mediaType: post.mediaType,
      featuredImg: post.featuredImg,
      isFeatured: post.isFeatured,
      body: post.body?.substring(0, 150), // Truncate body to first 150 chars for preview
      feedUrl: post.feedUrl,
      verified: post.verified
    }));

    // If authenticated, get all follow states for these posts
    let followStates: { [key: string]: boolean } = {};
    if (isAuthenticated) {
      const followings = await ctx.db
        .query("following")
        .withIndex("by_user_post")
        .filter(q => q.eq(q.field("userId"), userId))
        .collect();

      followStates = followings.reduce((acc: { [key: string]: boolean }, following) => {
        acc[following.postId] = true;
        return acc;
      }, {} as { [key: string]: boolean });
    }

    // Add follow state to each post with optimized fields
    const postsWithFollowState = optimizedPosts.map(post => ({
      ...post,
      isAuthenticated,
      isFollowing: followStates[post._id] || false
    }));
    
    // Extract unique categories
    const categoriesMap = new Map();
    postsWithFollowState.forEach(post => {
      if (!categoriesMap.has(post.categorySlug)) {
        categoriesMap.set(post.categorySlug, {
          _id: post.categorySlug,
          name: post.category,
          slug: post.categorySlug,
          mediaType: post.mediaType
        });
      }
    });
    
    // Convert map to array and sort alphabetically by name
    const categories = Array.from(categoriesMap.values()).sort((a, b) => 
      a.name.localeCompare(b.name)
    );
    
    // Get featured posts
    const featuredPosts = postsWithFollowState
      .filter(post => post.isFeatured === true)
      .slice(0, postsPerCategory);
    
    // Get initial posts for each category
    const initialPostsByCategory: Record<string, any> = {};
    
    for (const category of categories) {
      const categorySlug = category.slug;
      const categoryPosts = postsWithFollowState
        .filter(post => post.categorySlug === categorySlug)
        .slice(0, postsPerCategory + 1);
      
      initialPostsByCategory[categorySlug] = {
        posts: categoryPosts.slice(0, postsPerCategory),
        hasMore: categoryPosts.length > postsPerCategory,
        nextCursor: categoryPosts.length > postsPerCategory ? categoryPosts[postsPerCategory - 1]._id : null
      };
    }
    
    return {
      categories,
      featured: {
        posts: featuredPosts,
        hasMore: featuredPosts.length === postsPerCategory,
        nextCursor: featuredPosts.length > 0 ? featuredPosts[featuredPosts.length - 1]._id : null
      },
      initialPostsByCategory
    };
  },
}); 