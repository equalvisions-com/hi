'use client';

import { type Message as UIMessage, useChat } from 'ai/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { MessageContent, MessageSchema } from '@/app/types/article';
import Image from "next/image";

// Simple typing indicator component with animated dots.
function TypingIndicator() {
  return (
    <div className="flex space-x-1">
      <div className="w-2 h-2 bg-primary/50 rounded-full animate-bounce"></div>
      <div className="w-2 h-2 bg-primary/50 rounded-full animate-bounce delay-100"></div>
      <div className="w-2 h-2 bg-primary/50 rounded-full animate-bounce delay-200"></div>
    </div>
  );
}

// Helper function to truncate text with ellipsis
function truncateText(text: string, maxLength: number): string {
  if (!text) return '';
  return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
}

export function ChatPage() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/chat',
    onError: (error) => {
      console.error('Chat error:', error);
    }
  });

  // Compute the ID of the last message in the conversation.
  const lastMessageId = messages[messages.length - 1]?.id;

  // Custom message rendering function
  const renderMessage = (message: UIMessage) => {
    const isUser = message.role === 'user';
    let content: MessageContent | string;

    if (isUser) {
      content = message.content;
    } else {
      // Only show the typing indicator if this is the last assistant message and it's still empty.
      const isLatestAssistantMessage = message.id === lastMessageId;
      if (isLatestAssistantMessage && isLoading && (!message.content || message.content.trim() === "")) {
        return (
          <div className="flex justify-start mb-4 w-full" key={message.id}>
            <div className="max-w-[80%] p-3 rounded-lg bg-muted text-muted-foreground">
              <TypingIndicator />
            </div>
          </div>
        );
      }
      
      // Extract content from message with priority order
      try {
        // 1. Check for tool invocation results first (most reliable source)
        const toolInvocation = message.toolInvocations?.[0];
        if (toolInvocation?.state === 'result' && toolInvocation.result) {
          if (typeof toolInvocation.result === 'object' && 
              'message' in toolInvocation.result && 
              'articles' in toolInvocation.result) {
            content = toolInvocation.result;
          } else if (typeof toolInvocation.result === 'string') {
            try {
              const parsed = JSON.parse(toolInvocation.result);
              content = 'message' in parsed && 'articles' in parsed 
                ? parsed 
                : { message: String(toolInvocation.result), articles: [] };
            } catch {
              content = { message: String(toolInvocation.result), articles: [] };
            }
          } else {
            content = { message: 'Received response', articles: [] };
          }
        } 
        // 2. Check message content
        else if (message.content) {
          if (typeof message.content === 'string') {
            try {
              const parsed = JSON.parse(message.content);
              content = 'message' in parsed && 'articles' in parsed 
                ? parsed 
                : { message: message.content, articles: [] };
            } catch {
              content = { message: message.content, articles: [] };
            }
          } else {
            content = { 
              message: typeof message.content === 'object' ? 'Received response' : String(message.content), 
              articles: [] 
            };
          }
        } 
        // 3. Check message parts as last resort
        else if (message.parts?.length) {
          const textPart = message.parts.find(part => part.type === 'text');
          if (textPart && 'text' in textPart) {
            try {
              const parsed = JSON.parse(textPart.text);
              content = 'message' in parsed && 'articles' in parsed 
                ? parsed 
                : { message: textPart.text, articles: [] };
            } catch {
              content = { message: textPart.text, articles: [] };
            }
          } else {
            content = { message: 'No readable content available', articles: [] };
          }
        } else {
          content = { message: 'No content available', articles: [] };
        }

        // Validate content against schema if it's an object
        if (typeof content === 'object' && content !== null) {
          try {
            content = MessageSchema.parse(content);
          } catch {
            // If validation fails, ensure we have a valid structure
            if (typeof content.message === 'string') {
              content = { 
                message: content.message, 
                articles: Array.isArray(content.articles) ? content.articles : [] 
              };
            } else {
              content = { message: 'Received response with invalid format', articles: [] };
            }
          }
        }
      } catch {
        // Final fallback if all parsing attempts fail
        content = { message: 'Unable to process response', articles: [] };
      }
    }

    return (
      <div className="flex flex-col w-full mb-4 overflow-hidden" key={message.id}>
        <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} w-full overflow-hidden`}>
          {typeof content === 'string' ? (
            <div className={`max-w-[80%] p-3 rounded-lg ${isUser ? 'bg-primary/10 text-primary-foreground dark:text-primary' : 'bg-muted text-foreground'}`}>
              <p className="break-words whitespace-normal overflow-hidden">{content}</p>
            </div>
          ) : content.articles?.length > 0 ? (
            <div className="w-full max-w-full overflow-hidden">
              <p className="text-sm text-muted-foreground break-words whitespace-normal mb-4 overflow-hidden">{content.message}</p>
              <div className="w-full max-w-full overflow-hidden">
                <Carousel
                  opts={{
                    align: "start",
                    loop: true,
                  }}
                  className="w-full max-w-full"
                >
                  <CarouselContent className="-ml-2 md:-ml-4 max-w-full">
                    {content.articles.map((article, index) => (
                      <CarouselItem key={`${article.link}-${index}`} className="pl-2 md:pl-4 basis-[90%] sm:basis-[70%] md:basis-[70%] lg:basis-[70%] max-w-full">
                        <a
                          href={article.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block"
                        >
                          <Card className="w-full bg-card hover:bg-muted/50 transition-colors shadow-none">
                            <CardHeader className="p-3">
                              <div className="space-y-2">
                                <CardTitle className="text-sm font-medium line-clamp-2 text-card-foreground h-[40px] overflow-hidden">
                                  {article.title}
                                </CardTitle>
                                <div className="flex items-center gap-2">
                                  {article.publisherIconUrl && (
                                    <div className="flex-shrink-0 w-4 h-4 relative">
                                      <Image
                                        src={article.publisherIconUrl}
                                        alt={article.source || "Publisher"}
                                        width={16}
                                        height={16}
                                        className="object-contain"
                                      />
                                    </div>
                                  )}
                                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                    {article.source && <span className="font-medium" title={article.source}>{truncateText(article.source, 26)}</span>}
                                    {article.date && (
                                      <>
                                        <span>•</span>
                                        <span>{article.date}</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </CardHeader>
                          </Card>
                        </a>
                      </CarouselItem>
                    ))}
                  </CarouselContent>
                  <CarouselPrevious className="-left-3 bg-card border-border hidden md:flex" />
                  <CarouselNext className="-right-3 bg-card border-border hidden md:flex" />
                </Carousel>
              </div>
            </div>
          ) : (
            <div className={`max-w-[80%] p-3 rounded-lg ${isUser ? 'bg-primary/10 text-primary-foreground dark:text-primary' : 'bg-muted text-foreground'}`}>
              <p className="mb-2 break-words whitespace-normal overflow-hidden">{content.message}</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="w-full h-[calc(100vh-100px)] overflow-hidden" style={{ maxWidth: '100%', width: '100%' }}>
      {/* Chat messages area */}
      <div className="h-full flex flex-col">
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4">
          {messages.length === 0 && (
            <div className="h-full flex items-center justify-center">
              <p className="text-muted-foreground text-center max-w-md">
                Start a conversation with our AI assistant. You can ask questions about articles, products, or get general information.
              </p>
            </div>
          )}
          <div className="w-full" style={{ maxWidth: '100%' }}>
            {messages.map((message, index) => (
              <div key={index} className="w-full overflow-hidden" style={{ maxWidth: '100%' }}>
                {renderMessage(message)}
              </div>
            ))}
          </div>
        </div>

        {/* Input Form */}
        <div className="p-4 border-t border-border">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <Input
              value={input}
              onChange={handleInputChange}
              placeholder="Ask me anything..."
              className="flex-1 min-w-0"
              disabled={isLoading}
            />
            <Button type="submit" disabled={isLoading}>
              Send
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
} 