import { getInitialEntries } from "@/components/rss-feed/RSSEntriesDisplay.server";
import { getInitialEntries as getFeaturedEntries } from "@/components/featured/FeaturedFeed";
import { RightSidebar } from "@/components/homepage/RightSidebar";
import { FeedTabsContainerClientWrapper } from "@/components/rss-feed/FeedTabsContainerClientWrapper";
import { StandardSidebarLayout } from "@/components/ui/StandardSidebarLayout";
import { LAYOUT_CONSTANTS } from "@/lib/layout-constants";

/**
 * Server component that manages the overall layout for the homepage
 * Uses StandardSidebarLayout for consistent layout across the application
 */
export async function LayoutManager() {
  // Only pre-fetch featured data on initial load
  // RSS feed data will be lazily loaded when the user switches to that tab
  const featuredData = await getFeaturedEntries();
  
  // Prepare the feed content - no need to pass user profile props
  // as they're available from the context provider
  const mainContent = (
    <FeedTabsContainerClientWrapper
      initialData={null} // Pass null initially - data will be fetched when needed
      featuredData={featuredData}
      pageSize={30}
    />
  );
  
  // Prepare the right sidebar
  const rightSidebar = <RightSidebar />;
  
  // Custom class for main content to add padding at the bottom on all screen sizes
  const customMainContentClass = `${LAYOUT_CONSTANTS.MAIN_CONTENT_CLASS} sm:pb-[128px] md:pb-0`;
  
  // Use the standardized layout with mobile header
  return (
    <>
      <StandardSidebarLayout
        rightSidebar={rightSidebar}
        useCardStyle={false}
        containerClass={LAYOUT_CONSTANTS.CONTAINER_CLASS}
        mainContentClass={customMainContentClass}
      >
        {mainContent}
      </StandardSidebarLayout>
    </>
  );
}