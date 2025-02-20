import { NextRequest, NextResponse } from 'next/server';
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

export async function GET(
  request: NextRequest,
  context: { params: { guid: string } }
) {
  try {
    // Await the params
    const { guid } = await context.params;
    
    const token = await convexAuthNextjsToken();
    if (!token) {
      return NextResponse.json({ isLiked: false, count: 0 });
    }

    // Decode the URL-encoded guid
    const decodedGuid = decodeURIComponent(guid);

    const [isLiked, count] = await Promise.all([
      fetchQuery(api.likes.isLiked, { entryGuid: decodedGuid }, { token }),
      fetchQuery(api.likes.getLikeCount, { entryGuid: decodedGuid }, { token }),
    ]);

    return NextResponse.json({ isLiked, count });
  } catch (error) {
    console.error('Error fetching like status:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
} 