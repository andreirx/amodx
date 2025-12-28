# AMODX Commerce & AI Discovery Guide

> **Turn your site into a readable database for ChatGPT.**

The AMODX Commerce Module is not just a shopping cart; it is an **Agentic Commerce Protocol** engine. It creates structured data, JSON-LD schemas, and live inventory feeds specifically designed so AI Agents (ChatGPT, Perplexity, Google Gemini) can index, rank, and recommend your products.

---

## 1. The Workflow: Creating AI-Ready Products

### Step 1: Define the Product
1.  Log in to the **Admin Cockpit**.
2.  Navigate to **Products** in the sidebar.
3.  Click **Add Product**.

### Step 2: Critical Data Fields
To ensure AI indexing works, you must fill these specific fields accurately:

*   **Title:** Clear, natural language. Avoid "ALL CAPS" or keyword stuffing.
    *   *Bad:* "SUPER SHOES 5000 SALE!!"
    *   *Good:* "Ergonomic Running Shoes - Series 5"
*   **Description:** This is fed directly to LLMs. Use **plain text**. Describe materials, use-cases, and benefits.
    *   *Limit:* 5,000 characters.
    *   *Tip:* Write as if explaining the product to a smart assistant, not a search engine.
*   **Images:**
    *   **Main Image:** Required. High resolution.
    *   **Gallery:** Add detailed shots. AI vision models analyze these.
*   **Pricing:**
    *   **Price:** The standard price.
    *   **Sale Price:** If set, the AI will highlight this as a "Deal".
*   **Availability:**
    *   Keep this accurate (`In Stock`, `Preorder`). Feeds are refreshed every 15 minutes. If ChatGPT sends a user to a product that is out of stock, your "Trust Score" with the AI drops.

### Step 3: Connect Payment (Paddle)
AMODX uses Paddle (or Stripe) for the actual transaction handling.
1.  Create the product in your Paddle Dashboard.
2.  Copy the **Price ID** (e.g., `pri_01h...`).
3.  Paste it into the **Payment Link ID** field in AMODX.
4.  **Save** and set status to **Active**.

---

## 2. Integration Strategies: Linking Products

You have two ways to sell on your site. Choose the strategy that fits your goal.

### Strategy A: The "Direct Checkout" (SaaS / Digital Goods)
*Best for: Simple subscriptions, straightforward courses.*

1.  Use the **Pricing Block** plugin on your landing page.
2.  In the **Button Link** field, paste the raw Paddle Checkout link (or use the Paddle Overlay integration).
3.  **Result:** User clicks -> Checkout opens immediately.
4.  **Downside:** No dedicated SEO page for the product. Harder for AI to "understand" the item in depth.

### Strategy B: The "AI Funnel" (Physical Goods / High Ticket)
*Best for: Items needing explanation, physical products, high-SEO targets.*

1.  Create the Product in the **Products** tab.
2.  Note the auto-generated URL: `https://your-site.com/products/{uuid}`.
3.  On your Home Page or Landing Page (Hero/Pricing Block), set the Button Link to **that internal URL**.
4.  **Result:**
    *   User clicks -> Goes to Product Detail Page.
    *   **Schema.org JSON-LD** is injected automatically.
    *   **OpenAI Feed** picks up this specific URL.
    *   User buys from the detail page.

---

## 3. The AI Discovery Engine (Under the Hood)

AMODX automatically generates two invisible endpoints for every tenant.

### 1. The Schema Injection
Every Product Page (`/products/[id]`) automatically renders **Structured Data (`application/ld+json`)**.
This tells Google and Perplexity:
*   "This is a Product."
*   "This is the Price."
*   "This is the Availability."
*   "This is the Brand."

You do not need an SEO plugin. It is native to the renderer.

### 2. The OpenAI Feed
**Endpoint:** `https://your-site.com/openai-feed`

This endpoint outputs a strictly formatted JSON feed compliant with the **OpenAI Product Spec**.
*   **Refresh Rate:** Real-time (cached for 15 minutes).
*   **Filtering:** Only sends `Active` products.
*   **Usage:** You can submit this URL to ChatGPT Search or OpenAI's Merchant integration (when available) to have your inventory listed live in chat results.

---

## 4. Best Practices for AIO (Artificial Intelligence Optimization)

To rank high in ChatGPT/Perplexity answers:

1.  **Context is King:** In your Product Description, answer questions users might ask.
    *   *Don't just say:* "100% Wool."
    *   *Say:* "Made from 100% Merino Wool, suitable for hiking in temperatures down to -5°C."
2.  **Consistency:** Ensure your **Availability** status in Admin matches reality. High bounce rates from broken links hurt AI ranking.
3.  **Rich Media:** Fill out the **Additional Images**. Multi-modal AIs look at all images to verify product details.
4.  **Categorization:** Use the **Category** field (e.g., `Apparel > Men > Shoes`). This helps the AI taxonomy engine classify your item correctly.

---

## 5. Troubleshooting

**"My product isn't showing in the feed."**
*   Check that Status is set to **Active** (Drafts are excluded).
*   Ensure **Main Image** is set.
*   Ensure **Price** is set.

**"The Buy Now button does nothing."**
*   Ensure you pasted the **Payment Link ID** (Paddle Price ID) in the product settings.
*   Check that your Paddle/Stripe keys are configured in **Settings -> Integrations**.
* 