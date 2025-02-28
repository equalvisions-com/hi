import mysql, { RowDataPacket, ResultSetHeader, PoolOptions } from 'mysql2/promise';
import { XMLParser } from 'fast-xml-parser';
import 'server-only';
import type { RSSItem } from './rss';

/**
 * NOTE on TypeScript linter errors:
 * 
 * This file contains several TypeScript linter errors related to accessing properties
 * on dynamically parsed XML data. These errors are expected due to the nature of
 * RSS/Atom feeds which can have widely varying structures and property names.
 * 
 * The code includes extensive runtime type checking to ensure safe operation despite
 * these linting warnings. Common errors include:
 * 
 * 1. "Property 'attr' does not exist on type '{}'"
 * 2. "Element implicitly has an 'any' type because expression of type '@_url' can't be used to index"
 * 
 * These errors occur because TypeScript cannot infer the shape of parsed XML objects.
 * Type assertions (as Record<string, unknown>) are used at key points to address
 * these issues without compromising type safety where it matters.
 */

// Define types for logging
type LogParams = string | number | boolean | object | null | undefined;

// Add a production-ready logging utility
const logger = {
  debug: (message: string, ...args: LogParams[]) => {
    // Only log debug messages in development
    if (process.env.NODE_ENV !== 'production') {
      console.log(`🔍 DEBUG: ${message}`, ...args);
    }
  },
  info: (message: string, ...args: LogParams[]) => {
    console.log(`ℹ️ INFO: ${message}`, ...args);
  },
  warn: (message: string, ...args: LogParams[]) => {
    console.warn(`⚠️ WARN: ${message}`, ...args);
  },
  error: (message: string, ...args: LogParams[]) => {
    console.error(`❌ ERROR: ${message}`, ...args);
  },
  cache: (message: string, ...args: LogParams[]) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`💾 CACHE: ${message}`, ...args);
    } else {
      // In production, only log cache misses or errors, not hits
      if (message.includes('error') || message.includes('miss') || message.includes('stale')) {
        console.log(`💾 CACHE: ${message}`, ...args);
      }
    }
  },
  external: (message: string, ...args: LogParams[]) => {
    // Always log external API calls in both environments
    console.log(`🌐 EXTERNAL: ${message}`, ...args);
  }
};

// Initialize parser once, not on every request
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: true,
  trimValues: true,
  parseTagValue: false,
  isArray: (tagName) => tagName === "item",
});

// Configure connection pool for high concurrency
const poolConfig: PoolOptions = {
  uri: process.env.DATABASE_URL,
  connectionLimit: 500,      // Default is 10, increase for high concurrency
  queueLimit: 750,           // Maximum connection requests to queue
  waitForConnections: true, // Queue requests when no connections available
  enableKeepAlive: true,    // Keep connections alive
  keepAliveInitialDelay: 10000, // 10 seconds
  // Add timeouts to prevent hanging connections
  connectTimeout: 10000,    // 10 seconds
  // Remove invalid options that are causing warnings
  // acquireTimeout: 10000,
  // timeout: 60000,
};

// Initialize MySQL connection pool
const pool = mysql.createPool(poolConfig);

// Set up connection timeouts using the recommended approach
pool.on('connection', function (connection) {
  logger.debug('New database connection established');
  // Set session variables for timeouts
  connection.query('SET SESSION wait_timeout=28800'); // 8 hours
  connection.query('SET SESSION interactive_timeout=28800'); // 8 hours
});

// Handle connection errors - using process error handler instead of pool.on('error')
// since mysql2 doesn't support the 'error' event directly on the pool
process.on('uncaughtException', (err) => {
  if (err.message && err.message.includes('mysql')) {
    logger.error(`Database error: ${err.message}`);
    // Don't crash the server on connection errors
    // Just log them and let the pool handle reconnection
  } else {
    // For other uncaught exceptions, log and exit
    logger.error(`Uncaught exception: ${err.message}`);
    process.exit(1);
  }
});

// Add connection monitoring
process.on('exit', () => {
  gracefulShutdown();
});

// Handle graceful shutdown for SIGINT and SIGTERM
process.on('SIGINT', () => {
  gracefulShutdown('SIGINT signal received');
});

process.on('SIGTERM', () => {
  gracefulShutdown('SIGTERM signal received');
});

// Graceful shutdown function
async function gracefulShutdown(msg?: string) {
  if (msg) {
    logger.info(`${msg}: Closing database pool connections`);
  }
  
  try {
    await pool.end();
    logger.info('Database pool connections closed successfully');
  } catch (err) {
    logger.error(`Error closing database pool: ${err}`);
  }
  
  // If this was triggered by a signal, exit with a success code
  if (msg) {
    process.exit(0);
  }
}

// Add error handling for database operations
const executeQuery = async <T extends mysql.RowDataPacket[] | mysql.ResultSetHeader>(
  query: string, 
  params: unknown[] = []
): Promise<T> => {
  let connection;
  try {
    connection = await pool.getConnection();
    
    // Validate connection is still alive with a ping
    await connection.ping();
    
    const [result] = await connection.query<T>(query, params);
    return result;
  } catch (error) {
    logger.error(`Database query error: ${error}`);
    throw error;
  } finally {
    if (connection) connection.release();
  }
};

// Define interfaces for RSS item related types
// These interfaces are exported for use in other files
export interface MediaItem {
  "@_url"?: string;
  "@_medium"?: string;
  "@_type"?: string;
  attr?: {
    "@_url"?: string;
    "@_medium"?: string;
    "@_type"?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface EnclosureItem {
  "@_url"?: string;
  "@_type"?: string;
  "@_length"?: string;
  attr?: {
    "@_url"?: string;
    "@_type"?: string;
    "@_length"?: string;
    [key: string]: unknown;
  };
  url?: string;
  [key: string]: unknown;
}

export interface ItunesImage {
  "@_href"?: string;
  attr?: {
    "@_href"?: string;
    [key: string]: unknown;
  };
  url?: string;
  href?: string;
  [key: string]: unknown;
}

// Add RSSFeed interface definition
interface RSSFeed {
  title: string;
  description: string;
  link: string;
  items: RSSItem[];
}

// This is the parsed channel or feed object structure
interface ParsedChannel {
  title: string | Record<string, unknown>;
  description?: string | Record<string, unknown>;
  subtitle?: string | Record<string, unknown>;
  link?: string | Record<string, unknown> | Array<Record<string, unknown>>;
  item?: Record<string, unknown>[];
  entry?: Record<string, unknown>[];
  [key: string]: unknown;
}

// Function to create a fallback feed when there's an error
function createFallbackFeed(url: string, error: unknown): RSSFeed {
  const errorMessage = error instanceof Error ? error.message : String(error);
  logger.warn(`Creating fallback feed for ${url} due to error: ${errorMessage}`);
  
  return {
    title: `Error fetching feed from ${url}`,
    description: `There was an error fetching the feed: ${errorMessage}`,
    link: url,
    items: [{
      title: 'Error fetching feed',
      description: `There was an error fetching the feed from ${url}: ${errorMessage}`,
      link: url,
      guid: `error-${Date.now()}`,
      pubDate: new Date().toISOString(),
      image: undefined,
      feedUrl: url
    }]
  };
}

// Function to fetch and parse RSS feed
async function fetchAndParseFeed(url: string): Promise<RSSFeed> {
  try {
    // Fetch the feed with a timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
    
    logger.external(`Fetching feed from ${url}`);
    const response = await fetch(url, { 
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RSSReader/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Failed to fetch feed: ${response.status} ${response.statusText}`);
    }

    const xml = await response.text();
    logger.debug(`Received ${xml.length} bytes from ${url}`);
    
    if (xml.length < 100) {
      logger.warn(`Suspiciously small XML response from ${url}: ${xml.substring(0, 100)}`);
    }
    
    // kSpecial handling for Libsyn feeds which have a specific format for iTunes images
    const isLibsynFeed = url.includes('libsyn.com');
    if (isLibsynFeed) {
      logger.debug('Detected Libsyn feed, using special handling for iTunes images');
    }
    
    try {
      // Use the parser instance we created at the top of the file
      const result = parser.parse(xml);
      
      logger.debug(`Parsed XML structure: ${Object.keys(result).join(', ')}`);
      
      // Handle both RSS and Atom formats
      let channel: ParsedChannel;
      let items: Record<string, unknown>[] = [];
      
      if (result.rss && result.rss.channel) {
        // RSS format
        channel = result.rss.channel as ParsedChannel;
        items = channel.item || [];
        logger.debug(`Detected RSS format with ${items.length} items`);
      } else if (result.feed) {
        // Atom format
        channel = result.feed as ParsedChannel;
        items = channel.entry || [];
        logger.debug(`Detected Atom format with ${items.length} items`);
      } else {
        logger.warn(`Unrecognized feed format. Available keys: ${Object.keys(result).join(', ')}`);
        throw new Error('Unsupported feed format');
      }
      
      // Extract channel-level image for fallback
      let channelImage: string | null = null;
      
      // Check for channel-level iTunes image
      if (channel['itunes:image']) {
        if (typeof channel['itunes:image'] === 'object' && channel['itunes:image'] !== null) {
          const itunesImage = channel['itunes:image'] as Record<string, unknown>;
          
          // Direct @_href attribute (common in libsyn feeds)
          if (itunesImage['@_href']) {
            channelImage = String(itunesImage['@_href']);
            logger.debug(`Found channel iTunes image with direct @_href: ${channelImage}`);
          } else if (itunesImage.attr && typeof itunesImage.attr === 'object') {
            const attr = itunesImage.attr as Record<string, unknown>;
            if (attr['@_href']) {
              channelImage = String(attr['@_href']);
              logger.debug(`Found channel iTunes image with attr/@_href: ${channelImage}`);
            }
          }
        }
      }
      
      // Check for standard channel image
      if (!channelImage && channel.image) {
        if (typeof channel.image === 'object' && channel.image !== null) {
          const image = channel.image as Record<string, unknown>;
          if (image.url) {
            channelImage = String(image.url);
            logger.debug(`Found standard channel image: ${channelImage}`);
          }
        }
      }
      
      // Extract feed information
      const feed: RSSFeed = {
        title: getTextContent(channel.title),
        description: getTextContent(channel.description || channel.subtitle || ''),
        link: getLink(channel),
        items: []
      };
      
      logger.debug(`Feed title: "${feed.title}", description length: ${feed.description.length}, link: ${feed.link}`);
      
      // For Libsyn feeds, try to extract item-level iTunes images from the raw XML
      const itemItunesImages: Record<string, string> = {};
      if (isLibsynFeed) {
        // Extract item-level iTunes images using regex
        const itemImageMatches = xml.matchAll(/<item>[\s\S]*?<itunes:image href="([^"]+)"[\s\S]*?<guid[^>]*>([^<]+)<\/guid>/gi);
        for (const match of itemImageMatches) {
          if (match[1] && match[2]) {
            const imageUrl = match[1];
            const guid = match[2];
            itemItunesImages[guid] = imageUrl;
            logger.debug(`Found item-level iTunes image for guid ${guid}: ${imageUrl}`);
          }
        }
      }
      
      // Process items with error handling for each item
      feed.items = items.map((item: Record<string, unknown>, index: number) => {
        try {
          // Add channel reference to item for image extraction
          if (channelImage) {
            item.channelImage = channelImage;
          }
          
          // For Libsyn feeds, add the item-level iTunes image if we found it
          const itemGuid = getTextContent(item.guid || item.id || item.link);
          if (isLibsynFeed && itemItunesImages[itemGuid]) {
            // Add the image URL directly to the item
            if (!item['itunes:image']) {
              item['itunes:image'] = { '@_href': itemItunesImages[itemGuid] };
              logger.debug(`Added item-level iTunes image for guid ${itemGuid}: ${itemItunesImages[itemGuid]}`);
            }
          }
          
          // Extract image with priority to item-level images
          const itemImage = extractImage(item);
          
          const processedItem: RSSItem = {
            title: getTextContent(item.title),
            description: getTextContent(item.description || item.summary || item.content || ''),
            link: getLink(item),
            guid: itemGuid,
            pubDate: formatDate(item.pubDate || item.published || item.updated || new Date().toISOString()),
            image: itemImage || channelImage || undefined,
            feedUrl: url // Add the feedUrl property which is required by the RSSItem interface
          };
          
          if (index < 2) {
            logger.debug(`Sample item ${index}: title="${processedItem.title}", guid=${processedItem.guid}, link=${processedItem.link}, image=${processedItem.image}`);
          }
          
          return processedItem;
        } catch (itemError) {
          logger.warn(`Error processing feed item ${index}: ${itemError}`);
          // Return a minimal valid item to prevent the entire feed from failing
          return {
            title: 'Error processing item',
            description: '',
            link: '',
            guid: `error-${Date.now()}-${Math.random()}`,
            pubDate: new Date().toISOString(),
            image: channelImage || undefined,
            feedUrl: url // Add the feedUrl property here too
          };
        }
      }).filter((item: RSSItem) => {
        const isValid = Boolean(item.guid && item.title);
        if (!isValid) {
          logger.warn(`Filtered out invalid item: guid=${item.guid}, title=${item.title}`);
        }
        return isValid;
      }); // Filter out invalid items
      
      logger.info(`Successfully parsed feed from ${url} with ${feed.items.length} valid items`);
      return feed;
    } catch (parseError) {
      logger.error(`XML parsing error for ${url}: ${parseError}`);
      logger.debug(`First 500 characters of XML: ${xml.substring(0, 500).replace(/\n/g, ' ')}`);
      throw parseError;
    }
  } catch (error) {
    logger.error(`Error fetching feed from ${url}: ${error}`);
    // Return a fallback feed instead of throwing
    return createFallbackFeed(url, error);
  }
}

// Helper function to safely extract text content
function getTextContent(node: unknown): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'object' && node !== null) {
    const nodeObj = node as Record<string, unknown>;
    if ('#text' in nodeObj) return String(nodeObj['#text'] || '');
    if ('attr' in nodeObj && '#text' in nodeObj) return String(nodeObj['#text'] || '');
  }
  return String(node || '');
}

// Helper function to extract link from different formats
function getLink(node: Record<string, unknown>): string {
  if (!node) return '';
  if (typeof node.link === 'string') return node.link as string;
  
  if (node.link && typeof node.link === 'object' && !Array.isArray(node.link)) {
    const linkObj = node.link as Record<string, unknown>;
    if (linkObj.attr && typeof linkObj.attr === 'object') {
      const attrObj = linkObj.attr as Record<string, unknown>;
      if ('@_href' in attrObj) return String(attrObj['@_href']);
    }
  }
  
  if (Array.isArray(node.link)) {
    const links = node.link as Record<string, unknown>[];
    const mainLink = links.find(l => {
      if (!l.attr) return true;
      const attr = l.attr as Record<string, unknown>;
      return !attr['@_rel'] || attr['@_rel'] === 'alternate';
    });
    
    if (mainLink) {
      if (mainLink.attr) {
        const attr = mainLink.attr as Record<string, unknown>;
        if ('@_href' in attr) return String(attr['@_href']);
      }
      return String(mainLink);
    }
    
    if (links.length > 0) {
      if (links[0].attr) {
        const attr = links[0].attr as Record<string, unknown>;
        if ('@_href' in attr) return String(attr['@_href']);
      }
      return String(links[0]);
    }
  }
  
  return '';
}

// Helper function to extract image from item
function extractImage(item: Record<string, unknown>): string | null {
  try {
    // Debug logging for podcast feeds
    if (item['itunes:image']) {
      logger.debug(`Found itunes:image in item: ${JSON.stringify(item['itunes:image']).substring(0, 200)}`);
    }
    
    // Check for itunes:image
    if (item['itunes:image']) {
      // Standard format with attr/@_href
      if (typeof item['itunes:image'] === 'object' && item['itunes:image'] !== null) {
        const itunesImage = item['itunes:image'] as Record<string, unknown>;
        
        // Direct @_href attribute (common in libsyn feeds)
        if (itunesImage['@_href']) {
          logger.debug(`Using direct @_href attribute: ${itunesImage['@_href']}`);
          return String(itunesImage['@_href']);
        }
        
        // Nested attr/@_href format
        if (itunesImage.attr && typeof itunesImage.attr === 'object') {
          const attr = itunesImage.attr as Record<string, unknown>;
          if (attr['@_href']) {
            logger.debug(`Using nested attr/@_href format: ${attr['@_href']}`);
            return String(attr['@_href']);
          }
        }
        
        // Alternative format: url attribute directly on the object
        if (itunesImage.url) {
          logger.debug(`Using url attribute: ${itunesImage.url}`);
          return String(itunesImage.url);
        }
        
        // Alternative format: href directly on the object
        if (itunesImage.href) {
          logger.debug(`Using href attribute: ${itunesImage.href}`);
          return String(itunesImage.href);
        }
        
        // Log all keys for debugging
        logger.debug(`iTunes image keys: ${Object.keys(itunesImage).join(', ')}`);
      }
      
      // Alternative format: direct string URL
      if (typeof item['itunes:image'] === 'string' && 
          item['itunes:image'].match(/^https?:\/\//)) {
        logger.debug(`Using direct string URL: ${item['itunes:image']}`);
        return item['itunes:image'];
      }
    }
    
    // Also check for iTunes image at the channel level which may be stored with the item
    if (item['itunes:image:href'] && typeof item['itunes:image:href'] === 'string') {
      logger.debug(`Using itunes:image:href: ${item['itunes:image:href']}`);
      return item['itunes:image:href'];
    }

    // Check for media:content
    if (item['media:content']) {
      if (Array.isArray(item['media:content'])) {
        // Find the first image in the array
        for (const media of item['media:content']) {
          if (typeof media === 'object' && media !== null) {
            const mediaObj = media as Record<string, unknown>;
            if (mediaObj.attr && typeof mediaObj.attr === 'object') {
              const attr = mediaObj.attr as Record<string, unknown>;
              if ((attr['@_medium'] === 'image') || 
                  (attr['@_type'] && String(attr['@_type']).startsWith('image/'))) {
                if (attr['@_url']) return String(attr['@_url']);
              }
            }
          }
        }
      } else if (typeof item['media:content'] === 'object' && item['media:content'] !== null) {
        const mediaContent = item['media:content'] as Record<string, unknown>;
        if (mediaContent.attr && typeof mediaContent.attr === 'object') {
          const attr = mediaContent.attr as Record<string, unknown>;
          if (attr['@_url']) {
            // Make sure it's not an audio file
            if (attr['@_medium'] === 'image' || 
                (attr['@_type'] && String(attr['@_type']).startsWith('image/'))) {
              return String(attr['@_url']);
            }
          }
        }
      }
    }
    
    // Check for media:thumbnail
    if (item['media:thumbnail']) {
      if (Array.isArray(item['media:thumbnail'])) {
        const thumbnail = item['media:thumbnail'][0] as Record<string, unknown>;
        if (thumbnail && thumbnail.attr && typeof thumbnail.attr === 'object') {
          const attr = thumbnail.attr as Record<string, unknown>;
          if (attr['@_url']) return String(attr['@_url']);
        }
      } else if (typeof item['media:thumbnail'] === 'object' && item['media:thumbnail'] !== null) {
        const thumbnail = item['media:thumbnail'] as Record<string, unknown>;
        if (thumbnail.attr && typeof thumbnail.attr === 'object') {
          const attr = thumbnail.attr as Record<string, unknown>;
          if (attr['@_url']) return String(attr['@_url']);
        }
      }
    }
    
    // Check for enclosure
    if (item.enclosure) {
      if (Array.isArray(item.enclosure)) {
        // First try to find an image by type
        for (const enc of item.enclosure) {
          if (typeof enc === 'object' && enc !== null) {
            const enclosure = enc as Record<string, unknown>;
            if (enclosure.attr && typeof enclosure.attr === 'object') {
              const attr = enclosure.attr as Record<string, unknown>;
              // Skip audio files
              if (attr['@_type'] && String(attr['@_type']).startsWith('audio/')) {
                continue;
              }
              if (attr['@_type'] && String(attr['@_type']).startsWith('image/')) {
                if (attr['@_url']) return String(attr['@_url']);
              }
            }
          }
        }
        
        // If no typed image found, check for any URL that looks like an image
        for (const enc of item.enclosure) {
          if (typeof enc === 'object' && enc !== null) {
            const enclosure = enc as Record<string, unknown>;
            if (enclosure.attr && typeof enclosure.attr === 'object') {
              const attr = enclosure.attr as Record<string, unknown>;
              if (attr['@_url']) {
                const url = String(attr['@_url']);
                // Skip audio files
                if (attr['@_type'] && String(attr['@_type']).startsWith('audio/')) {
                  continue;
                }
                if (url.match(/\.(mp3|m4a|wav|ogg|flac)($|\?)/i)) {
                  continue;
                }
                if (
                  // Check for common image extensions
                  url.match(/\.(jpg|jpeg|png|gif|webp|svg)($|\?)/i) ||
                  // Check for URLs containing image-related terms
                  /\/(image|img|photo|thumbnail|cover|banner|logo)s?\//i.test(url) ||
                  // Check for CDN image providers (common pattern without hardcoding specific domains)
                  /cdn(-cgi)?\/image/i.test(url)
                ) {
                  return url;
                }
              }
            }
          }
        }
      } else if (typeof item.enclosure === 'object' && item.enclosure !== null) {
        // Cast to a record type to avoid property access errors
        const enclosure = item.enclosure as Record<string, unknown>;
        
        // First check if it has attr property
        if (enclosure.attr && typeof enclosure.attr === 'object') {
          const attr = enclosure.attr as Record<string, unknown>;
          
          // Skip audio files
          if (attr['@_type'] && String(attr['@_type']).startsWith('audio/')) {
            // Skip this enclosure
          } else if (attr['@_url']) {
            const url = String(attr['@_url']);
            // Skip audio files by extension
            if (url.match(/\.(mp3|m4a|wav|ogg|flac)($|\?)/i)) {
              // Skip this enclosure
            } else if (attr['@_type'] && String(attr['@_type']).startsWith('image/')) {
              return url;
            } else if (
              // Check for common image extensions
              url.match(/\.(jpg|jpeg|png|gif|webp|svg)($|\?)/i) ||
              // Check for URLs containing image-related terms
              /\/(image|img|photo|thumbnail|cover|banner|logo)s?\//i.test(url) ||
              // Check for CDN image providers
              /cdn(-cgi)?\/image/i.test(url)
            ) {
              return url;
            }
          }
        }
        
        // Also check for direct properties without attr wrapper
        if (enclosure['@_url']) {
          const url = String(enclosure['@_url']);
          // Skip audio files
          if (enclosure['@_type'] && String(enclosure['@_type']).startsWith('audio/')) {
            // Skip this enclosure
          } else if (url.match(/\.(mp3|m4a|wav|ogg|flac)($|\?)/i)) {
            // Skip this enclosure
          } else if (enclosure['@_type'] && String(enclosure['@_type']).startsWith('image/')) {
            return url;
          } else if (
            // Check for common image extensions
            url.match(/\.(jpg|jpeg|png|gif|webp|svg)($|\?)/i) ||
            // Check for URLs containing image-related terms
            /\/(image|img|photo|thumbnail|cover|banner|logo)s?\//i.test(url) ||
            // Check for CDN image providers
            /cdn(-cgi)?\/image/i.test(url)
          ) {
            return url;
          }
        }
        
        if (enclosure.url) {
          const url = String(enclosure.url);
          // Skip audio files
          if (url.match(/\.(mp3|m4a|wav|ogg|flac)($|\?)/i)) {
            // Skip this enclosure
          } else if (
            // Check for common image extensions
            url.match(/\.(jpg|jpeg|png|gif|webp|svg)($|\?)/i) ||
            // Check for URLs containing image-related terms
            /\/(image|img|photo|thumbnail|cover|banner|logo)s?\//i.test(url) ||
            // Check for CDN image providers
            /cdn(-cgi)?\/image/i.test(url)
          ) {
            return url;
          }
        }
      }
    }
    
    // Check for image in content
    const contentFields = ['content', 'description', 'summary', 'content:encoded'];
    for (const field of contentFields) {
      const content = item[field];
      if (typeof content === 'string' && content.length > 0) {
        // Try different image tag patterns
        const patterns = [
          /<img[^>]+src=["']([^"']+)["']/i,
          /<img[^>]+src=([^ >]+)/i,
          /src=["']([^"']+\.(?:jpg|jpeg|png|gif|webp))["']/i
        ];
        
        for (const pattern of patterns) {
          const match = content.match(pattern);
          if (match && match[1]) {
            // Ignore data URLs
            if (!match[1].startsWith('data:')) {
              return match[1];
            }
          }
        }
      }
    }
    
    // Use the channelImage property we added in fetchAndParseFeed
    if (item.channelImage && typeof item.channelImage === 'string') {
      return item.channelImage;
    }
    
    // Try to get channel-level image as a last resort
    if (item.channel && typeof item.channel === 'object' && item.channel !== null) {
      const channel = item.channel as Record<string, unknown>;
      
      // Check for channel image
      if (channel.image && typeof channel.image === 'object' && channel.image !== null) {
        const image = channel.image as Record<string, unknown>;
        if (image.url) return String(image.url);
      }
      
      // Check for channel itunes:image
      if (channel['itunes:image'] && typeof channel['itunes:image'] === 'object' && channel['itunes:image'] !== null) {
        const itunesImage = channel['itunes:image'] as Record<string, unknown>;
        if (itunesImage.attr && typeof itunesImage.attr === 'object') {
          const attr = itunesImage.attr as Record<string, unknown>;
          if (attr['@_href']) return String(attr['@_href']);
        }
      }
    }
    
    return null;
  } catch (error) {
    logger.warn(`Error extracting image: ${error}`);
    return null;
  }
}

// Helper function to format date consistently
function formatDate(dateStr: unknown): string {
  try {
    // Ensure we have a string before creating a Date
    const dateString = typeof dateStr === 'string' 
      ? dateStr 
      : dateStr instanceof Date
        ? dateStr.toISOString()
        : String(dateStr || '');
        
    // Handle common RSS date formats that JavaScript's Date constructor might struggle with
    let normalizedDateString = dateString;
    
    // Handle RFC 822/RFC 2822 format (e.g., "Wed, 12 Dec 2018 14:00:00 -0000")
    const rfc822Regex = /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+)(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+([+-]\d{4}|[A-Z]{3,4})$/;
    if (rfc822Regex.test(dateString)) {
      // JavaScript's Date constructor should handle this format, but let's log for debugging
      logger.debug(`Parsing RFC 822 date format: ${dateString}`);
    }
    
    // Handle pubDate without timezone (add Z for UTC)
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(dateString)) {
      normalizedDateString = `${dateString}Z`;
      logger.debug(`Added Z suffix to ISO date without timezone: ${normalizedDateString}`);
    }
    
    // Handle pubDate with only date part
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
      normalizedDateString = `${dateString}T00:00:00Z`;
      logger.debug(`Added time component to date-only string: ${normalizedDateString}`);
    }
    
    // Create Date object from normalized string
    const date = new Date(normalizedDateString);
    
    // Check if date is valid
    if (isNaN(date.getTime())) {
      logger.warn(`Invalid date format encountered: ${dateString}, falling back to current date`);
      return new Date().toISOString();
    }
    
    // Return consistent ISO format
    return date.toISOString();
  } catch (error) {
    // Log the specific error for debugging
    logger.warn(`Error parsing date "${dateStr}": ${error instanceof Error ? error.message : String(error)}`);
    // We don't use the error, just return a default date
    return new Date().toISOString();
  }
}

// Function to get or create a feed in PlanetScale
async function getOrCreateFeed(feedUrl: string, postTitle: string): Promise<number> {
  try {
    // Check if feed exists
    const rows = await executeQuery<RowDataPacket[]>(
      'SELECT id FROM rss_feeds WHERE feed_url = ?',
      [feedUrl]
    );
    
    if (rows.length > 0) {
      return Number(rows[0].id);
    }
    
    // Create new feed
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const currentTimeMs = Date.now(); // Use milliseconds for last_fetched (bigint column)
    const result = await executeQuery<ResultSetHeader>(
      'INSERT INTO rss_feeds (feed_url, title, last_fetched, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [feedUrl, postTitle, currentTimeMs, now, now]
    );
    
    return Number(result.insertId);
  } catch (error) {
    logger.error(`Error getting or creating feed for ${feedUrl}: ${error}`);
    throw error;
  }
}

// Function to execute a batch of operations in a transaction
async function executeBatchTransaction<T extends mysql.RowDataPacket[] | mysql.ResultSetHeader>(
  operations: Array<{ query: string; params: unknown[] }>
): Promise<T[]> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    const results: T[] = [];
    for (const op of operations) {
      const [result] = await connection.query<T>(op.query, op.params);
      results.push(result);
    }
    
    await connection.commit();
    return results;
  } catch (error) {
    await connection.rollback();
    logger.error(`Transaction error: ${error}`);
    throw error;
  } finally {
    connection.release();
  }
}

// Function to store RSS entries with transaction support
async function storeRSSEntriesWithTransaction(feedId: number, entries: RSSItem[]): Promise<void> {
  try {
    if (entries.length === 0) return;
    
    // Get all existing entries in one query
    const existingEntries = await executeQuery<RowDataPacket[]>(
      'SELECT guid FROM rss_entries WHERE feed_id = ?',
      [feedId]
    );
    
    // Create a Set for faster lookups
    const existingGuids = new Set(existingEntries.map(row => row.guid));
    
    // Filter entries that don't exist yet
    const newEntries = entries.filter(entry => !existingGuids.has(entry.guid));
    
    if (newEntries.length === 0) {
      logger.debug(`No new entries to insert for feed ${feedId}`);
      
      // Just update the last_fetched timestamp
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const currentTimeMs = Date.now();
      await executeQuery<ResultSetHeader>(
        'UPDATE rss_feeds SET updated_at = ?, last_fetched = ? WHERE id = ?',
        [now, currentTimeMs, feedId]
      );
      return;
    }
    
    // Prepare batch operations
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const currentTimeMs = Date.now();
    
    // Split into chunks of 100 entries to avoid too large queries
    const chunkSize = 100;
    const chunks = [];
    
    for (let i = 0; i < newEntries.length; i += chunkSize) {
      chunks.push(newEntries.slice(i, i + chunkSize));
    }
    
    // Create operations for each chunk
    const operations = chunks.map(chunk => {
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const values = chunk.flatMap(entry => {
        // Ensure pubDate is properly formatted as ISO string
        const normalizedPubDate = formatDate(entry.pubDate);
        
        return [
          Number(feedId),
          String(entry.guid),
          String(entry.title),
          String(entry.link),
          String(entry.description?.slice(0, 200) || ''),
          normalizedPubDate, // Use the normalized date
          entry.image ? String(entry.image) : null,
          String(now)
        ];
      });
      
      return {
        query: `INSERT INTO rss_entries (feed_id, guid, title, link, description, pub_date, image, created_at) VALUES ${placeholders}`,
        params: values
      };
    });
    
    // Add the update operation
    operations.push({
      query: 'UPDATE rss_feeds SET updated_at = ?, last_fetched = ? WHERE id = ?',
      params: [now, currentTimeMs, feedId]
    });
    
    // Execute all operations in a transaction
    await executeBatchTransaction(operations);
    logger.info(`Batch inserted ${newEntries.length} entries for feed ${feedId} in ${chunks.length} chunks`);
  } catch (error) {
    logger.error(`Error storing RSS entries with transaction for feed ${feedId}: ${error}`);
    throw error;
  }
}

// Add a new function to acquire a lock
async function acquireFeedRefreshLock(feedUrl: string): Promise<boolean> {
  try {
    // Use an atomic INSERT operation to acquire a lock
    // If another process already has the lock, this will fail with a duplicate key error
    const lockKey = `refresh_lock:${feedUrl}`;
    const expiryTime = Date.now() + 60000; // Lock expires after 60 seconds
    
    const result = await executeQuery<ResultSetHeader>(
      'INSERT INTO rss_locks (lock_key, expires_at, created_at) VALUES (?, ?, ?) ' +
      'ON DUPLICATE KEY UPDATE lock_key = IF(expires_at < ?, VALUES(lock_key), lock_key), ' +
      'expires_at = IF(expires_at < ?, VALUES(expires_at), expires_at)',
      [lockKey, expiryTime, new Date(), Date.now(), expiryTime]
    );
    
    // If rows affected is 1, we acquired the lock
    // If rows affected is 0, someone else has the lock
    return result.affectedRows > 0;
  } catch (error) {
    logger.error(`Error acquiring lock for ${feedUrl}: ${error}`);
    // In case of error, assume we don't have the lock
    return false;
  }
}

// Function to release a lock
async function releaseFeedRefreshLock(feedUrl: string): Promise<void> {
  try {
    const lockKey = `refresh_lock:${feedUrl}`;
    await executeQuery<ResultSetHeader>('DELETE FROM rss_locks WHERE lock_key = ?', [lockKey]);
  } catch (error) {
    logger.error(`Error releasing lock for ${feedUrl}: ${error}`);
  }
}

// Get RSS entries with caching
export async function getRSSEntries(postTitle: string, feedUrl: string): Promise<RSSItem[]> {
  try {
    logger.info(`Checking for RSS feed: ${postTitle} (${feedUrl})`);
    
    // Check if we have recent entries in the database
    const feeds = await executeQuery<RowDataPacket[]>(
      'SELECT id, feed_url, title, updated_at, last_fetched FROM rss_feeds WHERE feed_url = ?',
      [feedUrl]
    );
    
    const currentTime = Date.now();
    let feedId: number;
    let shouldFetchFresh = true;
    
    if (feeds.length > 0) {
      feedId = Number(feeds[0].id);
      // Check if feed was fetched recently (less than 4 hours ago)
      const lastFetchedMs = Number(feeds[0].last_fetched);
      const timeSinceLastFetch = currentTime - lastFetchedMs;
      const fourHoursInMs = 4 * 60 * 60 * 1000;
      
      if (timeSinceLastFetch < fourHoursInMs) {
        shouldFetchFresh = false;
        logger.cache(`Using cached data for ${postTitle} (last fetched ${Math.round(timeSinceLastFetch / 60000)} minutes ago)`);
      } else {
        logger.cache(`Data is stale for ${postTitle} (last fetched ${Math.round(timeSinceLastFetch / 60000)} minutes ago)`);
      }
    } else {
      // Create new feed
      logger.cache(`No existing data for ${postTitle}, creating new feed entry`);
      feedId = await getOrCreateFeed(feedUrl, postTitle);
    }
    
    // If we need fresh data, fetch it
    if (shouldFetchFresh) {
      // Try to acquire a lock before fetching fresh data
      const lockAcquired = await acquireFeedRefreshLock(feedUrl);
      
      if (lockAcquired) {
        try {
          logger.debug(`Acquired refresh lock for ${postTitle}`);
          
          // Double-check if someone else refreshed while we were acquiring the lock
          const refreshCheck = await executeQuery<RowDataPacket[]>(
            'SELECT last_fetched FROM rss_feeds WHERE feed_url = ?',
            [feedUrl]
          );
          
          if (refreshCheck.length > 0) {
            const lastFetchedMs = Number(refreshCheck[0].last_fetched);
            const timeSinceLastFetch = currentTime - lastFetchedMs;
            const fourHoursInMs = 4 * 60 * 60 * 1000;
            
            if (timeSinceLastFetch < fourHoursInMs) {
              // Someone else refreshed the data while we were acquiring the lock
              logger.debug(`Another process refreshed the data for ${postTitle} while we were acquiring the lock`);
              shouldFetchFresh = false;
            }
          }
          
          if (shouldFetchFresh) {
            try {
              const freshFeed = await fetchAndParseFeed(feedUrl);
              if (freshFeed.items.length > 0) {
                logger.info(`Storing ${freshFeed.items.length} fresh entries for ${postTitle}`);
                await storeRSSEntriesWithTransaction(feedId, freshFeed.items);
              } else {
                logger.warn(`Feed ${postTitle} returned 0 items, not updating database`);
              }
            } catch (fetchError) {
              logger.error(`Error fetching feed ${postTitle}: ${fetchError}`);
              // Continue execution to return whatever data we have in the database
            }
          }
        } finally {
          // Always release the lock when done
          await releaseFeedRefreshLock(feedUrl);
          logger.debug(`Released refresh lock for ${postTitle}`);
        }
      } else {
        logger.info(`Another process is currently refreshing data for ${postTitle}, using existing data`);
        // Another process is refreshing, we'll use whatever data is available
      }
    }
    
    // Get all entries for this feed from the database
    logger.debug(`Retrieving entries for ${postTitle} from database`);
    const entries = await executeQuery<RowDataPacket[]>(
      'SELECT guid, title, link, description, pub_date as pubDate, image FROM rss_entries WHERE feed_id = ? ORDER BY pub_date DESC',
      [feedId]
    );
    
    if (entries.length === 0) {
      logger.warn(`No entries found in database for ${postTitle}, fetching fresh data as fallback`);
      
      // If we have no entries in the database, try to fetch fresh data as a fallback
      try {
        const freshFeed = await fetchAndParseFeed(feedUrl);
        if (freshFeed.items.length > 0) {
          logger.info(`Fallback: Storing ${freshFeed.items.length} fresh entries for ${postTitle}`);
          await storeRSSEntriesWithTransaction(feedId, freshFeed.items);
          
          // Return the fresh items directly
          return freshFeed.items;
        }
      } catch (fallbackError) {
        logger.error(`Fallback fetch failed for ${postTitle}: ${fallbackError}`);
        // Continue to return empty array
      }
    }
    
    logger.info(`Retrieved ${entries.length} entries for ${postTitle}`);
    return entries.map((entry: RowDataPacket) => ({
      guid: entry.guid,
      title: entry.title,
      link: entry.link,
      description: entry.description,
      pubDate: formatDate(entry.pubDate), // Normalize the date format
      image: entry.image,
      feedUrl
    }));
  } catch (error) {
    logger.error(`Error in getRSSEntries for ${postTitle}: ${error}`);
    
    // Try a direct fetch as a last resort
    try {
      logger.info(`Attempting direct fetch for ${postTitle} as last resort`);
      const directFeed = await fetchAndParseFeed(feedUrl);
      return directFeed.items;
    } catch (directError) {
      logger.error(`Direct fetch failed for ${postTitle}: ${directError}`);
    return [];
    }
  }
}

// Function to fetch and store RSS feed (used by page.tsx)
export async function fetchAndStoreRSSFeed(feedUrl: string, postTitle: string): Promise<void> {
  try {
    // Use the same getRSSEntries function to maintain consistency
    await getRSSEntries(postTitle, feedUrl);
  } catch (error) {
    logger.error(`Error in fetchAndStoreRSSFeed for ${postTitle}: ${error}`);
  }
}

// Function to store RSS entries in PlanetScale (for backward compatibility)
export async function storeRSSEntries(feedId: number, entries: RSSItem[]): Promise<void> {
  // Call the transaction-based version for better performance
  return storeRSSEntriesWithTransaction(feedId, entries);
}

// Function to ensure the RSS locks table exists
async function ensureRSSLocksTableExists(): Promise<void> {
  try {
    // Check if the table exists
    const connection = await pool.getConnection();
    try {
      const [tables] = await connection.query<RowDataPacket[]>(
        "SHOW TABLES LIKE 'rss_locks'"
      );
      
      if (tables.length === 0) {
        logger.info('Creating rss_locks table...');
        
        // Create the table
        await connection.query(`
          CREATE TABLE IF NOT EXISTS rss_locks (
            lock_key VARCHAR(255) PRIMARY KEY,
            expires_at BIGINT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          ) ENGINE=InnoDB;
        `);
        
        logger.info('rss_locks table created successfully');
      } else {
        logger.debug('rss_locks table already exists');
      }
    } finally {
      connection.release();
    }
  } catch (error) {
    logger.error(`Error ensuring rss_locks table exists: ${error}`);
    // Don't throw the error, just log it
    // The application can still function without the locks table
  }
}

// Call the function to ensure the table exists
ensureRSSLocksTableExists().catch(err => {
  logger.error(`Failed to check/create rss_locks table: ${err}`);
});