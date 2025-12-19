# AMODX Tenant Features Configuration Guide

This manual explains how to configure the external services required for Authentication (Google) and Payments (Paddle), if a tenant requires them.

---

## 🔐 Google Login (Comments & Identity)
To allow visitors to log in to a specific client site (e.g., `dental-clinic.com`), you must configure a Google Cloud App for them.

**Why?** Google requires a strict whitelist of domains. You cannot use a shared "Agency" app for all clients.

1.  **Create Project:** Go to [Google Cloud Console](https://console.cloud.google.com/) and create a project (e.g., "Dental Clinic Site").
2.  **Consent Screen:** Configure the OAuth Consent Screen.
    *   *User Type:* External.
    *   *App Name:* The Client's Brand Name.
3.  **Create Credentials:** Go to Credentials -> Create OAuth Client ID -> Web Application.
4.  **Configure URLs:**
    *   **Authorized Origins:** `https://dental-clinic.com` (The production domain).
    *   **Authorized Redirect URI:** `https://dental-clinic.com/api/auth/callback/google`
5.  **Save in AMODX:**
    *   Copy **Client ID** and **Client Secret**.
    *   Go to AMODX Admin -> Select Site -> Settings.
    *   Paste them into the **Identity (Google OAuth)** section.
    *   Save.

**Result:** The "Login with Google" button will now appear on that client's site.

---

## 💳 Paddle Payments (Digital Products)
To enable the Pricing Table buttons to actually charge money.

1.  **Setup Paddle:** Create an account at [Paddle.com](https://www.paddle.com).
2.  **Get Token:** Go to Developer Tools -> Authentication -> Copy **Client Token**.
3.  **Configure AMODX:**
    *   Go to AMODX Admin -> Settings -> Payments.
    *   Paste the Client Token.
    *   Set Environment to "Production" (or Sandbox for testing).
4.  **Create Product:**
    *   In Paddle, create a product/subscription.
    *   Copy the **Price ID** (starts with `pri_`).
5.  **Link on Site:**
    *   In the AMODX Editor, add a **Pricing Block**.
    *   In the "Button Link" or "Product ID" field, paste the Paddle Price ID.
    *   *Note: If using the basic Link field, ensure your renderer is set up to intercept Paddle links, or use the dedicated checkout overlay.*
