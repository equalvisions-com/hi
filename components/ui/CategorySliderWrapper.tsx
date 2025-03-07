'use client';

import React, { useState, useEffect } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { CategorySlider, type Category } from './CategorySlider';
import { PostsDisplay, type Post } from './PostsDisplay';
import { cn } from '@/lib/utils';
import { SearchInput } from '@/components/ui/search-input';

interface CategorySliderWrapperProps {
  mediaType: string;
  className?: string;
}

// Define the shape of the data returned from the query
interface CategoryData {
  categories: Category[];
  featured: {
    posts: Post[];
    hasMore: boolean;
    nextCursor: string | null;
  };
  initialPostsByCategory: Record<string, {
    posts: Post[];
    hasMore: boolean;
    nextCursor: string | null;
  }>;
}

export function CategorySliderWrapper({
  mediaType,
  className,
}: CategorySliderWrapperProps) {
  // State for selected category and search
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('featured');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  
  // Fetch initial data (categories and featured posts)
  const initialData = useQuery(api.categories.getCategorySliderData, { 
    mediaType,
    postsPerCategory: 10
  }) as CategoryData | undefined;

  // Search query for posts across all categories
  const searchResults = useQuery(
    api.posts.searchPosts,
    searchQuery ? { 
      query: searchQuery,
      mediaType,
      limit: 10
    } : "skip"
  );
  
  // Set loading state based on data availability
  useEffect(() => {
    if (initialData) {
      setIsLoading(false);
    }
  }, [initialData]);
  
  // Prepare categories array with "Featured" as the first option
  const allCategories: Category[] = React.useMemo(() => {
    if (!initialData?.categories) return [{ _id: 'featured', name: 'Featured', slug: 'featured', mediaType }];
    
    // Ensure "Featured" is always the first item
    const regularCategories = initialData.categories;
    
    return [
      { _id: 'featured', name: 'Featured', slug: 'featured', mediaType },
      ...regularCategories
    ];
  }, [initialData?.categories, mediaType]);
  
  // Get initial posts for the selected category
  const getInitialPostsForCategory = (categoryId: string): Post[] => {
    if (!initialData) return [];
    
    if (categoryId === 'featured') {
      return initialData.featured.posts;
    }
    
    // Get posts for the selected category
    const categoryData = initialData.initialPostsByCategory[categoryId];
    if (!categoryData) return [];
    
    return categoryData.posts;
  };

  // Handle search input change
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    // When searching, we don't want to filter by category
    if (e.target.value) {
      setSelectedCategoryId('');
    } else {
      setSelectedCategoryId('featured');
    }
  };
  
  // Loading state
  if (isLoading) {
    return (
      <div className={cn("grid w-full", className)}>
        <div className="w-full overflow-hidden bg-background/85 backdrop-blur-md sticky top-0 z-10 py-2">
          <div className="flex gap-2 px-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div 
                key={i} 
                className="h-10 w-24 bg-muted/50 rounded-full animate-pulse"
              />
            ))}
          </div>
        </div>
        <div className="mt-4 space-y-4">
          {[1, 2, 3].map((i) => (
            <div 
              key={i} 
              className="h-64 bg-muted/30 rounded-lg animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }
  
  return (
    <div className={cn("w-full", className)}>
      {/* Sticky header container */}
      <div className="sticky top-0 z-10 bg-background/85 backdrop-blur-md border-b">
        {/* Search input */}
        <div className="px-4 py-2">
          <SearchInput
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder={`Search ${mediaType}...`}
          />
        </div>

        {/* Category slider - only show when not searching */}
        {!searchQuery && (
          <CategorySlider
            categories={allCategories}
            selectedCategoryId={selectedCategoryId}
            onSelectCategory={setSelectedCategoryId}
          />
        )}
      </div>
      
      {/* Posts display */}
      <PostsDisplay
        categoryId={selectedCategoryId}
        mediaType={mediaType}
        initialPosts={searchQuery ? (searchResults?.posts || []) : getInitialPostsForCategory(selectedCategoryId)}
        className="mt-4 pb-8"
        searchQuery={searchQuery}
      />
    </div>
  );
} 