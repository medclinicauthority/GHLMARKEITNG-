# GHL Workflow Agent

AI-powered GoHighLevel workflow builder. One prompt → real workflow built in your GHL account.

## Setup

### 1. Deploy to Vercel
- Go to vercel.com → New Project → Import this repo
- Click Deploy

### 2. Add your GHL Token (Environment Variable)
In Vercel dashboard → Your Project → Settings → Environment Variables:

| Name | Value |
|------|-------|
| `VITE_GHL_TOKEN` | Your GHL Private Integration Token |

**How to get your GHL token:**
1. Go to GHL → Settings → Private Integrations → Create New
2. Enable scopes: Contacts (Read/Write), Workflows (Read/Write), Locations (Read)
3. Copy the token and paste it into Vercel

### 3. Add to GHL Sidebar
1. In GHL → Settings → Custom Menu Links → Add Link
2. Name: "AI Workflow Builder"
3. URL: Your Vercel deployment URL (e.g. https://your-app.vercel.app)
4. Check "Open in iframe"
5. Save — it now appears in your sidebar!

## Local Development
```bash
npm install
npm run dev
```
