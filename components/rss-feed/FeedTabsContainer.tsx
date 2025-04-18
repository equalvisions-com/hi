'use client';

import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { SwipeableTabs } from "@/components/ui/swipeable-tabs";
import dynamic from 'next/dynamic';
import type { FeaturedEntry } from "@/lib/featured_redis";
import { UserMenuClientWithErrorBoundary } from '../user-menu/UserMenuClient';
import Link from 'next/link';
import { MobileSearch } from '@/components/mobile/MobileSearch';
import { useSidebar } from '@/components/ui/sidebar-context';
import { SignInButton } from "@/components/ui/SignInButton";
import { Loader2 } from 'lucide-react';
import { SkeletonFeed } from '@/components/ui/skeleton-feed';
import { useRouter } from 'next/navigation';

// Lazy load both components
const RSSEntriesClientWithErrorBoundary = dynamic(
  () => import("@/components/rss-feed/RSSEntriesDisplay.client").then(mod => mod.RSSEntriesClientWithErrorBoundary),
  { 
    ssr: false,
    loading: () => <SkeletonFeed count={5} />
  }
);

const FeaturedFeedWrapper = dynamic(
  () => import("@/components/featured/FeaturedFeedWrapper").then(mod => mod.FeaturedFeedWrapper),
  {
    ssr: false,
    loading: () => <SkeletonFeed count={5} />
  }
);

// Define the RSSItem interface based on the database schema
export interface RSSItem {
  guid: string;
  title: string;
  link: string;
  pubDate: string;
  content: string;
  contentSnippet?: string;
  description?: string;
  image?: string;
  mediaType?: string;
  feedUrl: string;
  feedTitle?: string;
}

// Interface for post metadata
interface PostMetadata {
  title: string;
  featuredImg?: string;
  mediaType?: string;
  postSlug: string;
  categorySlug: string;
  verified?: boolean;
}

// Define the interfaces that match the expected types in the child components
interface FeaturedEntryWithData {
  entry: FeaturedEntry;
  initialData: {
    likes: { isLiked: boolean; count: number };
    comments: { count: number };
    retweets?: { isRetweeted: boolean; count: number };
  };
  postMetadata: PostMetadata;
}

interface RSSEntryWithData {
  entry: RSSItem;
  initialData: {
    likes: { isLiked: boolean; count: number };
    comments: { count: number };
    retweets?: { isRetweeted: boolean; count: number };
  };
  postMetadata: {
    title: string;
    featuredImg?: string;
    mediaType?: string;
    categorySlug?: string;
    postSlug?: string;
    verified?: boolean;
  };
}

// Define types for our props
interface FeedTabsContainerProps {
  initialData: {
    entries: unknown[]; // Using unknown for type safety
    totalEntries: number;
    hasMore: boolean;
    postTitles?: string[];
  } | null;
  featuredData?: {
    entries: unknown[]; // Using unknown for type safety
    totalEntries: number;
  } | null;
  pageSize?: number;
}

// Memoized component for the "Following" tab content - REMOVED as we pass component directly
/*
const FollowingTabContent = React.memo(({ 
  initialData, 
  pageSize 
}: { 
  initialData: FeedTabsContainerProps['initialData'], 
  pageSize: number 
}) => {
  if (!initialData) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>No entries found. Please sign in and add some RSS feeds to get started.</p>
        <p className="text-sm mt-2">If you&apos;ve already added feeds, try refreshing the page.</p>
      </div>
    );
  }

  return (
    <RSSEntriesClient
      initialData={initialData as { 
        entries: RSSEntryWithData[]; 
        totalEntries: number; 
        hasMore: boolean; 
        postTitles?: string[]; 
      }}
      pageSize={pageSize}
    />
  );
});
FollowingTabContent.displayName = 'FollowingTabContent';
*/

// Memoized component for the "Discover" tab content - REMOVED as we pass component directly
/*
const DiscoverTabContent = React.memo(({ 
  featuredData 
}: { 
  featuredData: FeedTabsContainerProps['featuredData'] 
}) => {
  return (
    <FeaturedFeedWrapper 
      initialData={featuredData as { 
        entries: FeaturedEntryWithData[]; 
        totalEntries: number; 
      } | null} 
    />
  );
});
DiscoverTabContent.displayName = 'DiscoverTabContent';
*/

export function FeedTabsContainer({ 
  initialData, 
  featuredData: initialFeaturedData, 
  pageSize = 30
}: FeedTabsContainerProps) {
  // Get user data from context
  const { displayName, isBoarded, profileImage, isAuthenticated, pendingFriendRequestCount } = useSidebar();
  const router = useRouter();
  
  // State to track loaded data
  const [rssData, setRssData] = useState(initialData);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [featuredData, setFeaturedData] = useState(initialFeaturedData);
  const [featuredLoading, setFeaturedLoading] = useState(false);
  const [featuredError, setFeaturedError] = useState<string | null>(null);
  
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  
  // Add refs to track fetch requests in progress
  const featuredFetchInProgress = useRef(false);
  const rssFetchInProgress = useRef(false);
  
  // Function to fetch featured data
  const fetchFeaturedData = useCallback(async () => {
    // Skip if data is already loaded, loading is in progress, or a fetch has been initiated
    if (featuredData !== null || featuredLoading || featuredFetchInProgress.current) return;
    
    // Set ref to indicate fetch is in progress
    featuredFetchInProgress.current = true;
    setFeaturedLoading(true);
    setFeaturedError(null);
    
    try {
      console.log('Fetching featured data...');
      const response = await fetch('/api/featured-feed');
      if (!response.ok) {
        throw new Error('Failed to fetch featured data');
      }
      
      const data = await response.json();
      setFeaturedData(data);
    } catch (err) {
      console.error('Error fetching featured data:', err);
      setFeaturedError('Failed to load featured content. Please try again.');
    } finally {
      setFeaturedLoading(false);
      // Reset the ref
      featuredFetchInProgress.current = false;
    }
  }, [featuredData, featuredLoading]);
  
  // Function to fetch RSS data
  const fetchRSSData = useCallback(async () => {
    // Skip if data is already loaded, loading is in progress, or a fetch has been initiated
    if (rssData !== null || isLoading || rssFetchInProgress.current) return;
    
    // Check if user is authenticated before fetching RSS data
    if (!isAuthenticated) {
      console.log('User not authenticated, redirecting to sign-in page');
      router.push('/signin');
      return;
    }
    
    // Set ref to indicate fetch is in progress
    rssFetchInProgress.current = true;
    setIsLoading(true);
    setError(null);
    
    try {
      console.log('Fetching RSS data...');
      const response = await fetch('/api/rss-feed');
      if (!response.ok) {
        throw new Error('Failed to fetch RSS feed data');
      }
      
      const data = await response.json();
      setRssData(data);
    } catch (err) {
      console.error('Error fetching RSS data:', err);
      setError('Failed to load RSS feed data. Please try again.');
    } finally {
      setIsLoading(false);
      // Reset the ref
      rssFetchInProgress.current = false;
    }
  }, [rssData, isLoading, isAuthenticated, router]);
  
  // Handle tab change
  const handleTabChange = useCallback((index: number) => {
    console.log(`Tab changed to ${index === 0 ? 'Discover' : 'Following'}`);
    
    // If switching to the "Following" tab (index 1), check authentication
    if (index === 1 && !isAuthenticated) {
      console.log('User not authenticated, redirecting to sign-in page');
      router.push('/signin');
      return;
    }
    
    // Only update active tab index if not redirecting
    setActiveTabIndex(index);
    // The useEffect will handle data fetching when activeTabIndex changes
  }, [isAuthenticated, router]);
  
  // Add a single useEffect to handle data fetching for the active tab
  useEffect(() => {
    console.log(`Tab mount/update: activeTabIndex=${activeTabIndex}, 
      featuredData=${Boolean(featuredData)}, 
      rssData=${Boolean(rssData)},
      isLoading=${isLoading}, 
      featuredLoading=${featuredLoading}`);
    
    // Fetch data for the active tab only if we don't have it already
    const fetchDataForActiveTab = async () => {
      if (activeTabIndex === 0) {
        // Featured tab (Discover)
        if (featuredData === null && !featuredLoading && !featuredFetchInProgress.current) {
          console.log('Fetching featured data for initial tab');
          await fetchFeaturedData();
        }
      } else if (activeTabIndex === 1) {
        // RSS tab (Following) - First check authentication
        if (!isAuthenticated) {
          console.log('User not authenticated, redirecting to sign-in page');
          router.push('/signin');
          return;
        }
        
        // Only fetch if authenticated
        if (rssData === null && !isLoading && !rssFetchInProgress.current) {
          console.log('Fetching RSS data for initial tab');
          await fetchRSSData();
        }
      }
    };
    
    fetchDataForActiveTab();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabIndex]);
  
  // Memoize the tabs configuration
  const tabs = useMemo(() => [
    // Discover tab - first in order
    {
      id: 'discover',
      label: 'Discover',
      component: () => {
        if (featuredError) {
          return (
            <div className="p-8 text-center text-destructive">
              <p>{featuredError}</p>
              <button 
                className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-md"
                onClick={() => fetchFeaturedData()}
              >
                Try Again
              </button>
            </div>
          );
        }
        
        if (featuredLoading || featuredData === null) {
          return <SkeletonFeed count={5} />;
        }
        
        return (
          <FeaturedFeedWrapper
            initialData={featuredData as any /* Adjust typing */}
          />
        );
      }
    },
    // Following tab - shows RSS feed content
    {
      id: 'following',
      label: 'Following',
      component: () => {
        if (error) {
          return (
            <div className="p-8 text-center text-destructive">
              <p>{error}</p>
              <button 
                className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-md"
                onClick={() => fetchRSSData()}
              >
                Try Again
              </button>
            </div>
          );
        }
        
        if (isLoading || rssData === null) {
          return <SkeletonFeed count={5} />;
        }
        
        return (
          <RSSEntriesClientWithErrorBoundary 
            initialData={rssData as any /* Adjust typing */} 
            pageSize={pageSize} 
          />
        );
      }
    }
  ], [
    rssData,
    featuredData,
    pageSize,
    error,
    isLoading,
    fetchRSSData,
    featuredError,
    featuredLoading,
    fetchFeaturedData
  ]);

  return (
    <div className="w-full">
      <div className="grid grid-cols-2 items-center px-4 pt-2 pb-2 z-50 sm:block md:hidden">
        <div>
          {isAuthenticated ? (
            <UserMenuClientWithErrorBoundary 
              initialDisplayName={displayName}
              isBoarded={isBoarded} 
              initialProfileImage={profileImage}
              pendingFriendRequestCount={pendingFriendRequestCount}
            />
          ) : (
            <SignInButton />
          )}
        </div>
        <div className="flex justify-end">
          <MobileSearch />
        </div>
      </div>
     
      <SwipeableTabs 
        tabs={tabs} 
        onTabChange={handleTabChange}
        defaultTabIndex={activeTabIndex} 
      />
    </div>
  );
}

// Use React.memo for the error boundary wrapper to prevent unnecessary re-renders
export const FeedTabsContainerWithErrorBoundary = React.memo(
  (props: FeedTabsContainerProps) => {
    return (
      <React.Fragment>
        <FeedTabsContainer {...props} />
      </React.Fragment>
    );
  }
);
FeedTabsContainerWithErrorBoundary.displayName = 'FeedTabsContainerWithErrorBoundary'; 