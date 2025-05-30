import { NextRequest, NextResponse } from 'next/server';
import type { RSSItem } from "@/lib/rss";
import { executeRead } from '@/lib/database';
import { refreshExistingFeeds } from '@/lib/rss.server';
import type { RSSEntryRow } from '@/lib/types';

// Use Edge runtime for this API route
export const runtime = 'edge';

// Define interface for the joined query result
interface JoinedRSSEntry extends Omit<RSSEntryRow, 'id' | 'feed_id' | 'created_at'> {
  feed_title: string;
  feed_url: string;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const postTitlesParam = searchParams.get('postTitles');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const pageSize = parseInt(searchParams.get('pageSize') || '30', 10);
    // Get total entries from query params if available (passed from client during pagination)
    const cachedTotalEntries = searchParams.get('totalEntries') 
      ? parseInt(searchParams.get('totalEntries') || '0', 10) 
      : null;
    
    console.log(`📡 API: /api/rss/paginate called with page=${page}, pageSize=${pageSize}`);
    
    if (!postTitlesParam) {
      console.error('❌ API: Post titles are required');
      return NextResponse.json(
        { error: 'Post titles are required' },
        { status: 400 }
      );
    }

    let postTitles: string[] = [];
    try {
      postTitles = JSON.parse(decodeURIComponent(postTitlesParam));
      if (!Array.isArray(postTitles)) {
        throw new Error('Post titles must be an array');
      }
    } catch (error) {
      console.error('❌ API: Invalid post titles format', error);
      return NextResponse.json(
        { error: 'Invalid post titles format' },
        { status: 400 }
      );
    }

    console.log(`📋 API: Post titles: ${postTitles.join(', ')}`);
    
    if (postTitles.length === 0) {
      console.warn('⚠️ API: No post titles provided');
      return NextResponse.json({ entries: [], hasMore: false, totalEntries: 0, postTitles: [] });
    }

    // Only check if feeds need refreshing on the first page
    // Skip refresh checks during pagination to improve performance
    if (page === 1) {
      console.log(`🔄 API: Checking if any feeds need refreshing (first page only)`);
      await refreshExistingFeeds(postTitles);
    } else {
      console.log(`⏩ API: Skipping feed refresh check for page ${page}`);
    }

    // Calculate offset for pagination
    const offset = (page - 1) * pageSize;
    
    // Create placeholders for the SQL query
    const placeholders = postTitles.map(() => '?').join(',');
    
    // Build the SQL query to fetch entries from multiple feeds in one query
    const entriesQuery = `
      SELECT e.*, f.title as feed_title, f.feed_url
      FROM rss_entries e
      JOIN rss_feeds f ON e.feed_id = f.id
      WHERE f.title IN (${placeholders})
      ORDER BY e.pub_date DESC
      LIMIT ? OFFSET ?
    `;
    
    // Measure query execution time
    const queryStartTime = performance.now();
    
    let totalEntries: number;
    
    // Only fetch count if we don't have the cached value and it's the first page or cached value is null
    if (cachedTotalEntries === null) {
      console.log('🔢 API: Fetching total count of entries');
      // Build the SQL query to count total entries
      const countQuery = `
        SELECT COUNT(e.id) as total
        FROM rss_entries e
        JOIN rss_feeds f ON e.feed_id = f.id
        WHERE f.title IN (${placeholders})
      `;
      
      // Execute count query
      const countResult = await executeRead(countQuery, [...postTitles]);
      totalEntries = Number((countResult.rows[0] as { total: number }).total);
      console.log(`🔢 API: Found ${totalEntries} total entries across all requested feeds (from database)`);
    } else {
      // Use the cached total entries value
      totalEntries = cachedTotalEntries;
      console.log(`🔢 API: Using cached total count: ${totalEntries} entries`);
    }
    
    // Execute entries query
    const entriesResult = await executeRead(
      entriesQuery, 
      [
        ...postTitles,
        pageSize, 
        offset
      ]
    );
    
    // Log query execution time
    const queryEndTime = performance.now();
    const queryDuration = queryEndTime - queryStartTime;
    console.log(`⏱️ API: Query execution completed in ${queryDuration.toFixed(2)}ms`);
    
    const entries = entriesResult.rows as JoinedRSSEntry[];
    
    console.log(`✅ API: Retrieved ${entries.length} entries for page ${page} of ${Math.ceil(totalEntries / pageSize)}`);
    console.log(`📊 API: Pagination details - page ${page}, offset ${offset}, pageSize ${pageSize}, total ${totalEntries}`);
    
    // Map the entries to the expected format
    const mappedEntries: RSSItem[] = entries.map(entry => ({
      guid: entry.guid,
      title: entry.title,
      link: entry.link,
      pubDate: entry.pub_date,
      description: entry.description || undefined,
      image: entry.image || undefined,
      mediaType: entry.media_type || undefined,
      feedTitle: entry.feed_title,
      feedUrl: entry.feed_url
    }));
    
    // Determine if there are more entries
    // Add a small buffer (2) to account for potential inconsistencies in cached counts
    const hasMore = cachedTotalEntries !== null 
      ? totalEntries > (offset + entries.length + 2) 
      : totalEntries > (offset + entries.length);
    
    console.log(`🚀 API: Returning ${mappedEntries.length} merged entries for page ${page} (total: ${totalEntries}, hasMore: ${hasMore})`);
    
    // Prepare the response data
    const responseData = {
      entries: mappedEntries,
      hasMore,
      totalEntries,
      postTitles
    };
    
    // Set cache control headers for HTTP caching
    const headers = new Headers();
    headers.set('Cache-Control', 'public, max-age=300, s-maxage=300, stale-while-revalidate=86400');
    headers.set('Vercel-CDN-Cache-Control', 'max-age=300');
    headers.set('CDN-Cache-Control', 'max-age=300');
    headers.set('Surrogate-Control', 'max-age=300');
    
    return NextResponse.json(responseData, { headers });
    
  } catch (error) {
    console.error('❌ API: Error fetching merged feed', error);
    return NextResponse.json(
      { error: 'Failed to fetch merged feed' },
      { status: 500 }
    );
  }
} 