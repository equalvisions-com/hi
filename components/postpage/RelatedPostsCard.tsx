import { Card, CardContent } from "@/components/ui/card";
import Image from "next/image";
import { FollowButton } from "@/components/follow-button/FollowButton";
import { Id } from "@/convex/_generated/dataModel";
import Link from "next/link";
import { memo } from "react";

export interface RelatedPost {
  title: string;
  featuredImg?: string;
  postSlug: string;
  categorySlug: string;
  mediaType: string;
  _id: Id<"posts">;
  feedUrl: string;
}

interface RelatedPostsCardProps {
  posts: RelatedPost[];
  followStates?: {
    [postId: string]: {
      isAuthenticated: boolean;
      isFollowing: boolean;
    };
  };
}

export const RelatedPostsCard = memo(function RelatedPostsCard({ posts, followStates = {} }: RelatedPostsCardProps) {
  if (!posts.length) return null;

  return (
    <Card className="h-fit shadow-none">
      <CardContent className="p-4">
        <h2 className="text-lg font-semibold mb-4">You May Also Like</h2>
        <div className="space-y-4">
          {posts.map((post) => {
            const followState = followStates[post._id.toString()] || {
              isAuthenticated: false,
              isFollowing: false
            };

            return (
              <div key={post._id} className="flex items-center gap-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {post.featuredImg && (
                    <Link href={`/${post.mediaType === 'newsletter' ? 'newsletters' : post.mediaType === 'podcast' ? 'podcasts' : post.categorySlug}/${post.postSlug}`}>
                      <div className="relative w-9 h-9 shrink-0">
                        <Image
                          src={post.featuredImg}
                          alt={post.title}
                          fill
                          className="object-cover rounded-lg border"
                          sizes="(max-width: 768px) 36px, 36px"
                            quality={60}
                          blurDataURL="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDABQODxIPDRQSEBIXFRQdHx4dHRsdHR4dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR3/2wBDAR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR3/wAARCAAIAAoDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k="
                          placeholder="blur"
                        />
                      </div>
                    </Link>
                  )}
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/${post.mediaType === 'newsletter' ? 'newsletters' : post.mediaType === 'podcast' ? 'podcasts' : post.categorySlug}/${post.postSlug}`}
                      className="text-sm font-medium hover:underline line-clamp-2"
                    >
                      {post.title}
                    </Link>
                  </div>
                </div>
                <div className="shrink-0">
                  <FollowButton
                    postId={post._id}
                    feedUrl={post.feedUrl}
                    postTitle={post.title}
                    initialIsFollowing={followState.isFollowing}
                    isAuthenticated={followState.isAuthenticated}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}, (prevProps, nextProps) => {
  // Custom comparison function to determine if re-render is needed
  if (prevProps.posts.length !== nextProps.posts.length) return false;
  
  // Compare posts
  const postsEqual = prevProps.posts.every((prevPost, index) => {
    const nextPost = nextProps.posts[index];
    return prevPost._id === nextPost._id &&
           prevPost.title === nextPost.title &&
           prevPost.featuredImg === nextPost.featuredImg &&
           prevPost.postSlug === nextPost.postSlug &&
           prevPost.categorySlug === nextPost.categorySlug &&
           prevPost.feedUrl === nextPost.feedUrl;
  });
  
  if (!postsEqual) return false;
  
  // Compare followStates
  const prevStates = prevProps.followStates || {};
  const nextStates = nextProps.followStates || {};
  const stateIds = new Set([...Object.keys(prevStates), ...Object.keys(nextStates)]);
  
  return Array.from(stateIds).every(id => {
    const prevState = prevStates[id] || { isAuthenticated: false, isFollowing: false };
    const nextState = nextStates[id] || { isAuthenticated: false, isFollowing: false };
    return prevState.isAuthenticated === nextState.isAuthenticated &&
           prevState.isFollowing === nextState.isFollowing;
  });
});

export const RelatedPostsCardSkeleton = () => (
  <Card className="h-fit shadow-none">
    <CardContent className="p-4">
      <h2 className="text-lg font-semibold mb-4">You May Also Like</h2>
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="flex items-center gap-3 animate-pulse">
            <div className="w-9 h-9 bg-muted rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-muted rounded w-3/4" />
              <div className="h-4 bg-muted rounded w-1/2" />
            </div>
            <div className="shrink-0 w-20 h-8 bg-muted rounded" />
          </div>
        ))}
      </div>
    </CardContent>
  </Card>
); 