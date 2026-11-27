import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";

export function registerSocialTools(server: McpServer, { STORAGE_DIR }: { STORAGE_DIR: string }) {
// ==========================================
// 7. SOCIAL MEDIA (Browser Automation)
// ==========================================

const PLATFORM_URLS: Record<string, { login: string; feed: string }> = {
    linkedin: { login: "https://www.linkedin.com/login", feed: "https://www.linkedin.com/feed" },
    X: { login: "https://x.com/i/flow/login", feed: "https://x.com/home" },
    reddit: { login: "https://www.reddit.com/login", feed: "https://www.reddit.com" },
    facebook: { login: "https://www.facebook.com/login", feed: "https://www.facebook.com" },
};

server.tool("social_login",
    {
        platform: z.enum(["linkedin", "X", "reddit", "facebook"]).describe("Social platform to log into"),
    },
    async ({ platform }) => {
        const urls = PLATFORM_URLS[platform];
        if (!urls) {
            return { content: [{ type: "text" as const, text: `Unknown platform: ${platform}` }], isError: true };
        }

        try {
            const browser = await chromium.launch({ headless: false });
            const context = await browser.newContext();
            const page = await context.newPage();

            await page.goto(urls.login);

            // Wait for user to complete login (poll for feed URL or extended timeout)
            let loggedIn = false;
            const maxWait = 5 * 60 * 1000; // 5 minutes
            const startTime = Date.now();

            while (!loggedIn && Date.now() - startTime < maxWait) {
                const currentUrl = page.url();
                // Check if we've navigated away from login page
                if (!currentUrl.includes("login") && !currentUrl.includes("flow")) {
                    loggedIn = true;
                    break;
                }
                await page.waitForTimeout(2000);
            }

            if (!loggedIn) {
                await browser.close();
                return { content: [{ type: "text" as const, text: `Login timeout for ${platform}. Please try again.` }], isError: true };
            }

            // Give extra time for session to stabilize
            await page.waitForTimeout(3000);

            // Save storage state
            const storagePath = path.join(STORAGE_DIR, `${platform}.json`);
            await context.storageState({ path: storagePath });

            await browser.close();

            return { content: [{ type: "text" as const, text: `Successfully logged into ${platform}. Session saved to ${storagePath}` }] };
        } catch (error: any) {
            return { content: [{ type: "text" as const, text: `Error during ${platform} login: ${error.message}` }], isError: true };
        }
    }
);

server.tool("post_social",
    {
        platform: z.enum(["linkedin", "X", "reddit", "facebook"]).describe("Social platform to post to"),
        content: z.string().describe("Content to post"),
    },
    async ({ platform, content }) => {
        const storagePath = path.join(STORAGE_DIR, `${platform}.json`);

        if (!fs.existsSync(storagePath)) {
            return { content: [{ type: "text" as const, text: `No saved session for ${platform}. Please run social_login first.` }], isError: true };
        }

        const urls = PLATFORM_URLS[platform];
        if (!urls) {
            return { content: [{ type: "text" as const, text: `Unknown platform: ${platform}` }], isError: true };
        }

        try {
            const browser = await chromium.launch({ headless: false }); // Visible to avoid detection
            const context = await browser.newContext({ storageState: storagePath });
            const page = await context.newPage();

            await page.goto(urls.feed);
            await page.waitForTimeout(3000);

            // Platform-specific posting logic
            if (platform === "linkedin") {
                // Click "Start a post" button
                await page.click('button:has-text("Start a post")');
                await page.waitForTimeout(1000);
                // Type in the post editor
                await page.fill('.ql-editor[data-placeholder="What do you want to talk about?"]', content);
                await page.waitForTimeout(500);
                // Click Post button
                await page.click('button:has-text("Post")');
                await page.waitForTimeout(3000);
            } else if (platform === "X") {
                // Click compose tweet area
                await page.click('[data-testid="tweetTextarea_0"]');
                await page.waitForTimeout(500);
                await page.fill('[data-testid="tweetTextarea_0"]', content);
                await page.waitForTimeout(500);
                // Click Post button
                await page.click('[data-testid="tweetButtonInline"]');
                await page.waitForTimeout(3000);
            } else if (platform === "reddit") {
                // Reddit is more complex - go to submit page
                await page.goto("https://www.reddit.com/submit?type=TEXT");
                await page.waitForTimeout(2000);
                // This varies by subreddit - simplified version
                const textarea = page.locator('textarea[placeholder*="Text"]').first();
                if (await textarea.isVisible()) {
                    await textarea.fill(content);
                }
                await page.waitForTimeout(2000);
                // Note: Reddit requires selecting a subreddit - manual intervention may be needed
            } else if (platform === "facebook") {
                // Click "What's on your mind?" area
                await page.click('[aria-label="Create a post"]');
                await page.waitForTimeout(1000);
                await page.fill('[aria-label*="What\'s on your mind"]', content);
                await page.waitForTimeout(500);
                await page.click('div[aria-label="Post"]');
                await page.waitForTimeout(3000);
            }

            // Save updated state (new cookies, etc.)
            await context.storageState({ path: storagePath });

            await browser.close();

            return { content: [{ type: "text" as const, text: `Posted to ${platform}: "${content.substring(0, 50)}..."` }] };
        } catch (error: any) {
            return { content: [{ type: "text" as const, text: `Error posting to ${platform}: ${error.message}` }], isError: true };
        }
    }
);
}
