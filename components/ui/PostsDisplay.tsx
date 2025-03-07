'use client';

import React, { useEffect, useState } from 'react';
import { useInView } from 'react-intersection-observer';
import { useQuery, useConvexAuth } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from './skeleton';
import { AspectRatio } from '@/components/ui/aspect-ratio';
import Link from 'next/link';
import Image from 'next/image';
import { FollowButton } from '@/components/follow-button/FollowButton';
import { Id } from '@/convex/_generated/dataModel';

// Define the shape of a post from the database
export interface Post {
  _id: Id<"posts">;
  _creationTime: number;
  title: string;
  postSlug: string;
  category: string;
  categorySlug: string;
  body: string;
  featuredImg: string;
  mediaType: string;
  isFeatured?: boolean;
  // Optional fields that might not be present in all posts
  publishedAt?: number;
  feedUrl?: string;
  author?: string;
  authorUrl?: string;
  twitterUrl?: string;
  websiteUrl?: string;
  platform?: string;
  // Follow state fields
  isFollowing?: boolean;
  isAuthenticated?: boolean;
}

interface PostsDisplayProps {
  categoryId: string;
  mediaType: string;
  initialPosts?: Post[];
  className?: string;
  searchQuery?: string;
}

export function PostsDisplay({
  categoryId,
  mediaType,
  initialPosts = [],
  className,
  searchQuery = '',
}: PostsDisplayProps) {
  // Store posts and pagination state
  const [posts, setPosts] = useState<Post[]>(initialPosts);
  const [nextCursor, setNextCursor] = useState<string | null | undefined>(undefined);
  const [isInitialLoad, setIsInitialLoad] = useState(initialPosts.length === 0);
  const { isAuthenticated } = useConvexAuth();
  
  // Set up intersection observer for infinite scrolling
  const { ref, inView } = useInView({
    threshold: 0,
    rootMargin: '200px',
  });

  // Query for posts - either search results or category posts
  const postsResult = useQuery(
    searchQuery ? api.posts.searchPosts : api.categories.getPostsByCategory,
    searchQuery 
      ? { query: searchQuery, mediaType, cursor: nextCursor || undefined, limit: 10 }
      : { categoryId, mediaType, cursor: nextCursor || undefined, limit: 10 }
  );

  // Query for follow states if authenticated and we have posts
  const followStates = useQuery(
    api.following.getFollowStates,
    isAuthenticated && posts.length > 0
      ? { postIds: posts.map(post => post._id) }
      : "skip"
  );

  // Reset posts when category or search query changes
  useEffect(() => {
    if (initialPosts.length > 0) {
      setPosts(initialPosts.map(post => ({
        ...post,
        isAuthenticated
      })));
      setNextCursor(undefined);
    }
    setIsInitialLoad(initialPosts.length === 0);
  }, [categoryId, searchQuery, initialPosts, isAuthenticated]);

  // Load initial posts if not provided
  useEffect(() => {
    if (isInitialLoad && postsResult) {
      const newPosts = postsResult.posts as Post[];
      const postsWithAuth = newPosts.map(post => ({
        ...post,
        isAuthenticated,
        isFollowing: followStates && Array.isArray(followStates) 
          ? followStates.includes(post._id)
          : false
      }));
      setPosts(postsWithAuth);
      setNextCursor(postsResult.nextCursor);
      setIsInitialLoad(false);
    }
  }, [isInitialLoad, postsResult, isAuthenticated, followStates]);

  // Update follow states when they load
  useEffect(() => {
    if (followStates && Array.isArray(followStates)) {
      setPosts(currentPosts => 
        currentPosts.map(post => ({
          ...post,
          isAuthenticated,
          isFollowing: followStates.includes(post._id)
        }))
      );
    }
  }, [followStates, isAuthenticated]);

  // Load more posts when bottom is reached
  useEffect(() => {
    if (inView && nextCursor && !isInitialLoad && postsResult) {
      const newPosts = (postsResult.posts as Post[]).map(post => ({
        ...post,
        isAuthenticated,
        isFollowing: followStates && Array.isArray(followStates) 
          ? followStates.includes(post._id)
          : false
      }));
      setPosts(prev => [...prev, ...newPosts]);
      setNextCursor(postsResult.nextCursor);
    }
  }, [inView, nextCursor, isInitialLoad, postsResult, isAuthenticated, followStates]);

  // Loading state
  if (isInitialLoad && !postsResult) {
    return (
      <div className={className}>
        {[1, 2, 3].map((i) => (
          <PostCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  // No posts state
  if (posts.length === 0 && !isInitialLoad) {
    return (
      <div className={`py-8 text-center text-muted-foreground ${className}`}>
        {searchQuery 
          ? `No ${mediaType} found matching "${searchQuery}"`
          : `No ${mediaType} found in this category`}
      </div>
    );
  }

  return (
    <div className={className}>
      {/* Post cards */}
      {posts.map((post) => (
        <PostCard key={post._id} post={post} />
      ))}

      {/* Loading indicator and intersection observer target */}
      {nextCursor && (
        <div ref={ref} className="py-4 flex justify-center">
          <PostCardSkeleton />
        </div>
      )}
    </div>
  );
}

// Post card component
function PostCard({ post }: { post: Post }) {
  return (
    <Card className="overflow-hidden transition-all hover:shadow-none shadow-none border-l-0 border-r-0 border-t-0 border-b-1 rounded-none">
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          {post.featuredImg && (
            <div className="flex-shrink-0 w-24 h-24">
              <AspectRatio ratio={1/1} className="overflow-hidden rounded-md">
                <Image
                  src={post.featuredImg}
                  alt={post.title}
                  fill
                  sizes="96px"
                  className="object-cover"
                />
              </AspectRatio>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex justify-between items-start gap-4">
              <Link href={`/${post.categorySlug}/${post.postSlug}`} className="block flex-1">
                <h3 className="text-lg font-semibold leading-tight line-clamp-2">{post.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
                  {post.body.substring(0, 150)}...
                </p>
              </Link>
              {post.feedUrl && (
                <div className="flex-shrink-0">
                  <FollowButton
                    postId={post._id}
                    feedUrl={post.feedUrl}
                    postTitle={post.title}
                    initialIsFollowing={post.isFollowing ?? false}
                    isAuthenticated={post.isAuthenticated}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Skeleton loader for post cards
function PostCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          <Skeleton className="flex-shrink-0 w-24 h-24 rounded-md" />
          <div className="flex-1">
            <Skeleton className="w-3/4 h-6 mb-2" />
            <Skeleton className="w-full h-4 mb-1" />
            <Skeleton className="w-full h-4 mb-1" />
            <Skeleton className="w-2/3 h-4 mb-2" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
} 