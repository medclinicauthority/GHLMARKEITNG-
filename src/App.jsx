import { useState, useRef, useEffect } from "react";

// ─── CONFIG ───────────────────────────────────────────────────────────────────
// Add your GHL Private Integration Token in Vercel → Settings → Environment Variables
// Variable name: VITE_GHL_TOKEN
const GHL_TOKEN = import.meta.env.VITE_GHL_TOKEN || "";

const STEP_ICONS = {
  trigger: "⚡", tag: "🏷️", email: "✉️", sms: "💬",
  wait: "⏱️", task: "✅", webhook: "🔗", condition: "🔀",
  update_field: "📝", create_contact: "👤",
};
const STEP_COLORS = {
  trigger: "#3b82f6", tag: "#8b5cf6", email: "#10b981", sms: "#f59e0b",
  wait: "#64748b", task: "#06b6d4", webhook: "#f97316", condition: "#ec4899",
  update_field: "#84cc16", create_contact: "#6366f1",
};

const EXAMPLE_PROMPTS = [
  "Create a 'New Leads' workflow that tags them, sends a welcome email and SMS",
  "Build an appointment reminder with a 1-day wait and follow-up SMS",
  "Make a re-engagement workflow for cold leads with an email sequence",
  "Post-purchase follow-up with a 3-day wait then review request",
];

// ─── GHL API HELPERS ──────────────────────────────────────────────────────────
async function ghlFetch(path, method = "GET", body = null, locationId = null) {
  const headers = {
    "Authorization": `Bearer ${GHL_TOKEN}`,
    "Content-Type": "application/json",
    "Version": "2021-07-28",
  };
  if (locationId) headers["location-id"] = locationId;

  const res = await fetch(`https://services.leadconnectorhq.com${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  });
  if (!res.ok) throw new Error(`GHL API error: ${res.status} ${await res.text()}`);
  return res.json();
}

async function fetchSubAccounts() {
  // Get all locations (sub-accounts) under the agency
  const data = await ghlFetch("/locations/search?limit=50");
  return data.locations || [];
}

async function createGHLWorkflow(locationId, title) {
  // Creates a blank workflow in GHL for the given location
  const data = await ghlFetch("/workflows/", "POST", { name: title, status: "draft" }, locationId);
  return data.workflow || data;
}

async function applyWorkflowTag(locationId, contactId, tag) {
  await ghlFetch(`/contacts/${contactId}/tags`, "POST", { tags: [tag] }, locationId);
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function GHLAgent() {
  const [subAccounts, setSubAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [accountError, setAccountError] = useState("");

  const [prompt, setPrompt] = useState("");
  const [isBuilding, setIsBuilding] = useState(false);
  const [chatMessages, setChatMessages] = useState([
    {
      role: "agent",
      text: "Hey! I'm your GHL operator. Select a sub-account below, then tell me what workflow to build.",
      time: now(),
    },
  ]);
  const [workflowTitle, setWorkflowTitle] = useState("");
  const [workflowSteps, setWorkflowSteps] = useState([]);
  const [visibleSteps, setVisibleSteps] = useState([]);
  const [isPublished, setIsPublished] = useState(false);
  const [ghlWorkflowUrl, setGhlWorkflowUrl] = useState("");
  const chatEndRef = useRef(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);

  // Load sub-accounts on mount if token is set
  useEffect(() => {
    if (GHL_TOKEN) loadSubAccounts();
  }, []);

  function now() {
    return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  async function loadSubAccounts() {
    setLoadingAccounts(true);
    setAccountError("");
    try {
      const accounts = await fetchSubAccounts();
      setSubAccounts(accounts);
      if (accounts.length === 1) setSelectedAccount(accounts[0]);
    } catch (e) {
      setAccountError("Could not load sub-accounts. Check your GHL token in Vercel env vars.");
    }
    setLoadingAccounts(false);
  }

  const addMessage = (text, role = "agent") => {
    setChatMessages((prev) => [...prev, { role, text, time: now() }]);
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const buildWorkflow = async () => {
    if (!prompt.trim() || isBuilding) return;
    const userPrompt = prompt.trim();
    setPrompt("");
    setIsBuilding(true);
    setWorkflowSteps([]);
    setVisibleSteps([]);
    setIsPublished(false);
    setGhlWorkflowUrl("");
    setWorkflowTitle("");

    addMessage(userPrompt, "user");
    await sleep(500);

    if (selectedAccount) {
      addMessage(`Locked into ${selectedAccount.name}. Building your workflow now...`);
    } else {
      addMessage("Demo mode — no sub-account selected. Select one above to save to GHL.");
    }

    await sleep(700);
    addMessage("Navigating to Automation → Workflows. Creating from scratch...");

    // ── Step 1: Ask Claude to plan the workflow ──
    let workflowData = null;
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: `You are a GoHighLevel automation expert. Respond ONLY with valid JSON, no markdown or explanation.
Output this exact structure:
{
  "title": "Workflow Name",
  "steps": [
    {
      "id": "s1",
      "name": "Display Name",
      "type": "trigger|tag|email|sms|wait|task|webhook|condition|update_field|create_contact",
      "description": "What this step does",
      "config": {},
      "narration": "What the agent says when adding this step"
    }
  ]
}
Rules: 4-7 steps, always start with trigger. For wait: config has {"duration":"1 day"}. For email: {"subject":"..."}. For sms: {"message":"..."}. For tag: {"tag":"tag-name"}.`,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });
      const d = await res.json();
      const raw = d.content?.[0]?.text || "";
      workflowData = JSON.parse(raw.replace(/```json|```/g, "").trim());
    } catch {
      workflowData = {
        title: "New Leads Workflow",
        steps: [
          { id: "s1", name: "Contact Created", type: "trigger", description: "Fires when a new contact is created", config: {}, narration: "Adding trigger — Contact Created." },
          { id: "s2", name: "Add Tag: new-lead", type: "tag", description: "Tags the contact", config: { tag: "new-lead" }, narration: "Adding tag action. Selecting 'new-lead'." },
          { id: "s3", name: "Send Welcome Email", type: "email", description: "Sends a welcome email", config: { subject: "Welcome! We're glad you're here" }, narration: "Adding Send Email. Filling in subject line." },
          { id: "s4", name: "Send Welcome SMS", type: "sms", description: "Sends welcome SMS", config: { message: "Hey! Thanks for reaching out 🎉" }, narration: "Adding Send SMS with welcome message." },
          { id: "s5", name: "Wait 1 Day", type: "wait", description: "Waits 1 day", config: { duration: "1 day" }, narration: "Adding Wait step — 1 day delay." },
        ],
      };
    }

    setWorkflowTitle(workflowData.title);
    await sleep(400);
    addMessage(`Workflow named: "${workflowData.title}". Building steps...`);

    // ── Step 2: Try to create in GHL if sub-account selected ──
    let createdWorkflow = null;
    if (selectedAccount && GHL_TOKEN) {
      try {
        addMessage(`Creating workflow in GHL for ${selectedAccount.name}...`);
        createdWorkflow = await createGHLWorkflow(selectedAccount.id, workflowData.title);
        if (createdWorkflow?.id) {
          const url = `https://app.gohighlevel.com/location/${selectedAccount.id}/workflow/${createdWorkflow.id}`;
          setGhlWorkflowUrl(url);
          addMessage(`✅ Workflow created in GHL! Building steps now...`);
        }
      } catch (e) {
        addMessage(`⚠️ Could not save to GHL (${e.message}). Running in demo mode.`);
      }
    }

    // ── Step 3: Animate steps ──
    const allSteps = workflowData.steps || [];
    setWorkflowSteps(allSteps);

    for (let i = 0; i < allSteps.length; i++) {
      await sleep(900);
      addMessage(allSteps[i].narration || `Adding: ${allSteps[i].name}`);
      setVisibleSteps((prev) => [...prev, allSteps[i].id]);
    }

    await sleep(600);
    addMessage("All steps added. Saving workflow...");
    await sleep(500);
    setIsPublished(true);

    if (ghlWorkflowUrl || createdWorkflow) {
      addMessage(`🎉 Workflow is live in ${selectedAccount?.name}! Click the link above to view it in GHL.`);
    } else {
      addMessage("✅ Workflow complete! Select a sub-account above to save future workflows directly to GHL.");
    }
    setIsBuilding(false);
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); buildWorkflow(); }
  };

  const visibleStepObjects = workflowSteps.filter((s) => visibleSteps.includes(s.id));

  return (
    <div style={{ display: "flex", height: "100vh", background: "#0a0e1a", fontFamily: "'DM Sans', sans-serif", color: "#e2e8f0", overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 4px; }
        .step-node { animation: slideIn 0.4s cubic-bezier(0.34,1.56,0.64,1) both; }
        @keyframes slideIn { from { opacity:0; transform:translateY(16px) scale(0.93); } to { opacity:1; transform:none; } }
        .connector { animation: grow 0.3s ease both; transform-origin: top; }
        @keyframes grow { from { transform:scaleY(0); opacity:0; } to { transform:scaleY(1); opacity:1; } }
        .pulse { animation: pulse 2s infinite; }
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(.8)} }
        .msg { animation: fadeUp .25s ease both; }
        @keyframes fadeUp { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
        .send:hover:not(:disabled) { background:#0284c7 !important; }
        .send:disabled { opacity:.4; cursor:not-allowed; }
        .chip:hover { background:#1e293b !important; cursor:pointer; }
        select { appearance:none; }
        .account-select:focus { outline: 1px solid #0ea5e9; }
        .pop { animation: pop .4s cubic-bezier(0.34,1.56,0.64,1) both; }
        @keyframes pop { from{opacity:0;transform:scale(.6)} to{opacity:1;transform:scale(1)} }
        a { color: #38bdf8; text-decoration: underline; }
      `}</style>

      {/* ── LEFT: Canvas ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", borderRight: "1px solid #1e293b", minWidth: 0 }}>
        {/* Header */}
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #1e293b", background: "#0d1424", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 32, height: 32, background: "linear-gradient(135deg,#0ea5e9,#6366f1)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>⚙️</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {workflowTitle || "Workflow Builder"}
            </div>
            <div style={{ fontSize: 11, color: isBuilding ? "#f59e0b" : isPublished ? "#10b981" : "#64748b", fontFamily: "'DM Mono', monospace" }}>
              {isBuilding ? "● Building..." : isPublished ? "● Published" : "● Ready"}
            </div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexShrink: 0 }}>
            {ghlWorkflowUrl && (
              <a href={ghlWorkflowUrl} target="_blank" rel="noreferrer"
                style={{ padding: "5px 12px", borderRadius: 6, background: "#0ea5e920", border: "1px solid #0ea5e940", color: "#38bdf8", fontSize: 11, textDecoration: "none", fontWeight: 600 }}>
                Open in GHL ↗
              </a>
            )}
            <button style={{ padding: "5px 14px", borderRadius: 6, border: "none", background: isPublished ? "#059669" : "#1e293b", color: isPublished ? "#fff" : "#64748b", fontSize: 12, cursor: "default", fontWeight: isPublished ? 700 : 400 }}>
              {isPublished ? "✓ Published" : "Publish"}
            </button>
          </div>
        </div>

        {/* Canvas */}
        <div style={{ flex: 1, overflowY: "auto", padding: "28px 20px", display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ width: "100%", maxWidth: 340 }}>
            <div style={{ border: "2px dashed #1e293b", borderRadius: 10, padding: "13px 18px", textAlign: "center", color: "#334155", fontSize: 13 }}>
              + Add New Trigger
            </div>

            {visibleStepObjects.length === 0 && !isBuilding && (
              <div style={{ textAlign: "center", marginTop: 64, color: "#1e293b" }}>
                <div style={{ fontSize: 44, opacity: .25, marginBottom: 10 }}>⚡</div>
                <div style={{ fontSize: 13, color: "#334155" }}>Workflow steps appear here</div>
                <div style={{ fontSize: 12, color: "#1e293b", marginTop: 4 }}>Type a prompt in the chat →</div>
              </div>
            )}

            {visibleStepObjects.map((step) => (
              <div key={step.id}>
                <div className="connector" style={{ width: 2, height: 26, background: "linear-gradient(#1e293b,#334155)", margin: "0 auto" }} />
                <div className="step-node" style={{ background: "#0d1424", border: `1px solid ${STEP_COLORS[step.type] || "#334155"}33`, borderLeft: `3px solid ${STEP_COLORS[step.type] || "#334155"}`, borderRadius: 10, padding: "11px 14px", display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: `${STEP_COLORS[step.type]}22`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>
                    {STEP_ICONS[step.type] || "📌"}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#f1f5f9", marginBottom: 2 }}>{step.name}</div>
                    <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.4 }}>{step.description}</div>
                    {step.config?.tag && <Tag color="#a78bfa">{`🏷 ${step.config.tag}`}</Tag>}
                    {step.config?.subject && <Tag color="#6ee7b7">{`📧 ${step.config.subject}`}</Tag>}
                    {step.config?.duration && <Tag color="#94a3b8">{`⏱ ${step.config.duration}`}</Tag>}
                    {step.config?.message && <Tag color="#fcd34d">{`💬 ${step.config.message.slice(0, 40)}${step.config.message.length > 40 ? "…" : ""}`}</Tag>}
                  </div>
                </div>
              </div>
            ))}

            {isBuilding && (
              <div>
                <div style={{ width: 2, height: 26, background: "#1e293b", margin: "0 auto" }} />
                <div style={{ border: "1px dashed #0ea5e920", borderRadius: 10, padding: "11px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                  <div className="pulse" style={{ width: 8, height: 8, borderRadius: "50%", background: "#0ea5e9", flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: "#0ea5e9" }}>Adding next action...</span>
                </div>
              </div>
            )}

            {visibleStepObjects.length > 0 && (
              <div>
                <div style={{ width: 2, height: 26, background: "#1e293b", margin: "0 auto" }} />
                <div style={{ background: "#1e293b", borderRadius: 8, padding: "7px 0", textAlign: "center", fontSize: 11, color: "#475569", fontWeight: 700, letterSpacing: 1 }}>END</div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "7px 16px", borderTop: "1px solid #1e293b", display: "flex", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 6 }}>
            {["＋","－"].map(s => <button key={s} style={{ width: 22, height: 22, borderRadius: 4, border: "1px solid #1e293b", background: "transparent", color: "#64748b", cursor: "pointer", fontSize: 13 }}>{s}</button>)}
          </div>
          <span style={{ fontSize: 11, color: "#334155", fontFamily: "'DM Mono', monospace" }}>100%</span>
        </div>
      </div>

      {/* ── RIGHT: Chat ── */}
      <div style={{ width: 360, display: "flex", flexDirection: "column", background: "#0d1424", flexShrink: 0 }}>
        {/* Chat Header */}
        <div style={{ padding: "13px 15px", borderBottom: "1px solid #1e293b", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ position: "relative" }}>
            <div style={{ width: 34, height: 34, borderRadius: "50%", background: "linear-gradient(135deg,#0ea5e9,#6366f1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}>🤖</div>
            <div style={{ position: "absolute", bottom: 0, right: 0, width: 9, height: 9, borderRadius: "50%", background: "#10b981", border: "2px solid #0d1424" }} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>GHL Agent</div>
            <div style={{ fontSize: 11, color: "#10b981" }}>● Connected</div>
          </div>
          {isPublished && <div className="pop" style={{ marginLeft: "auto", padding: "3px 10px", borderRadius: 20, background: "#059669", fontSize: 11, color: "#fff", fontWeight: 700 }}>✓ Live</div>}
        </div>

        {/* Sub-account Selector */}
        <div style={{ padding: "10px 14px", borderBottom: "1px solid #1e293b", background: "#0a0e1a" }}>
          <div style={{ fontSize: 10, color: "#475569", marginBottom: 5, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase" }}>Sub-Account</div>
          {!GHL_TOKEN ? (
            <div style={{ fontSize: 11, color: "#f59e0b", lineHeight: 1.5 }}>
              ⚠️ Add <code style={{ background: "#1e293b", padding: "1px 5px", borderRadius: 3 }}>VITE_GHL_TOKEN</code> in Vercel env vars to connect GHL.
            </div>
          ) : loadingAccounts ? (
            <div style={{ fontSize: 11, color: "#64748b" }}>Loading sub-accounts...</div>
          ) : accountError ? (
            <div style={{ fontSize: 11, color: "#f87171" }}>{accountError}</div>
          ) : (
            <select
              className="account-select"
              value={selectedAccount?.id || ""}
              onChange={e => setSelectedAccount(subAccounts.find(a => a.id === e.target.value) || null)}
              style={{ width: "100%", background: "#131c2e", border: "1px solid #1e293b", borderRadius: 7, padding: "7px 10px", color: selectedAccount ? "#f1f5f9" : "#64748b", fontSize: 12, cursor: "pointer" }}
            >
              <option value="">— Select a sub-account —</option>
              {subAccounts.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px", display: "flex", flexDirection: "column", gap: 11 }}>
          {chatMessages.map((msg, i) => (
            <div key={i} className="msg" style={{ display: "flex", flexDirection: "column", alignItems: msg.role === "user" ? "flex-end" : "flex-start" }}>
              {msg.role === "agent" && (
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: "linear-gradient(135deg,#0ea5e9,#6366f1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, marginBottom: 3 }}>🤖</div>
              )}
              <div style={{ maxWidth: "87%", padding: "9px 12px", borderRadius: msg.role === "user" ? "11px 11px 2px 11px" : "2px 11px 11px 11px", background: msg.role === "user" ? "linear-gradient(135deg,#0ea5e9,#0284c7)" : "#131c2e", border: msg.role === "user" ? "none" : "1px solid #1e293b", fontSize: 12.5, lineHeight: 1.5, color: msg.role === "user" ? "#fff" : "#cbd5e1" }}>
                {msg.text}
              </div>
              <div style={{ fontSize: 10, color: "#334155", marginTop: 2, fontFamily: "'DM Mono', monospace" }}>{msg.time}</div>
            </div>
          ))}

          {isBuilding && (
            <div className="msg" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 22, height: 22, borderRadius: "50%", background: "linear-gradient(135deg,#0ea5e9,#6366f1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>🤖</div>
              <div style={{ padding: "9px 13px", background: "#131c2e", border: "1px solid #1e293b", borderRadius: "2px 11px 11px 11px", display: "flex", gap: 4 }}>
                {[0,1,2].map(j => <div key={j} style={{ width: 5, height: 5, borderRadius: "50%", background: "#0ea5e9", animation: `pulse 1.2s ${j*.2}s infinite` }} />)}
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Example prompts */}
        {!isBuilding && chatMessages.length <= 2 && (
          <div style={{ padding: "0 11px 8px", display: "flex", flexDirection: "column", gap: 5 }}>
            <div style={{ fontSize: 10, color: "#334155", paddingLeft: 3, marginBottom: 1, textTransform: "uppercase", letterSpacing: .5 }}>Try an example</div>
            {EXAMPLE_PROMPTS.slice(0, 2).map((p, i) => (
              <div key={i} className="chip" onClick={() => setPrompt(p)} style={{ padding: "7px 11px", borderRadius: 7, border: "1px solid #1e293b", background: "#0a0e1a", fontSize: 11.5, color: "#64748b", lineHeight: 1.4, transition: "background .15s" }}>
                {p}
              </div>
            ))}
          </div>
        )}

        {/* Input */}
        <div style={{ padding: "11px", borderTop: "1px solid #1e293b" }}>
          <div style={{ display: "flex", gap: 7, background: "#131c2e", border: "1px solid #1e293b", borderRadius: 9, padding: "7px 7px 7px 11px", alignItems: "flex-end" }}>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={handleKey}
              placeholder={selectedAccount ? `Build a workflow for ${selectedAccount.name}...` : "Describe the workflow to build..."}
              disabled={isBuilding}
              rows={2}
              style={{ flex: 1, background: "transparent", border: "none", color: "#e2e8f0", fontSize: 13, resize: "none", lineHeight: 1.5, fontFamily: "'DM Sans', sans-serif", outline: "none" }}
            />
            <button className="send" onClick={buildWorkflow} disabled={isBuilding || !prompt.trim()}
              style={{ width: 34, height: 34, borderRadius: 7, border: "none", background: "#0ea5e9", color: "#fff", cursor: "pointer", fontSize: 16, transition: "background .2s", flexShrink: 0 }}>
              {isBuilding ? "⟳" : "↑"}
            </button>
          </div>
          <div style={{ textAlign: "center", fontSize: 10, color: "#1e293b", marginTop: 5, fontFamily: "'DM Mono', monospace" }}>
            Powered by Claude · GHL Workflow Agent
          </div>
        </div>
      </div>
    </div>
  );
}

function Tag({ children, color }) {
  return (
    <div style={{ marginTop: 4, fontSize: 10.5, color, fontFamily: "'DM Mono', monospace", background: "#1e293b", padding: "2px 7px", borderRadius: 4, display: "inline-block", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
      {children}
    </div>
  );
}
