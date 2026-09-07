/** Development fixture: all edits stay in component state. */
import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { TastePreferencesForm } from "../src/components/settings/TastePreferencesEditor";
import { sanitizeTastePreferences } from "../src/lib/taste-preferences";
import "../src/index.css";
function Preview() {
  const [preferences, setPreferences] = useState(() =>
    sanitizeTastePreferences({
      goal: "both",
      cuisines: ["Italian", "Japanese"],
      prices: [2],
    }),
  );
  const [dark, setDark] = useState(false);
  const [request, setRequest] = useState("");
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); }, [dark]);
  return (
    <div
      style={
        {
          background: "var(--color-surface)",
          color: "var(--color-ink)",
          padding: "28px 22px",
          minHeight: "100vh",
        } as React.CSSProperties
      }
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          font: "600 16px system-ui",
          marginBottom: 24,
        }}
      >
        Taste profile settings
        <button onClick={() => setDark((d) => !d)}>
          {dark ? "Light" : "Dark"}
        </button>
      </header>
      <TastePreferencesForm
        preferences={preferences}
        save={setPreferences}
        ready
        cloudSyncReady
        onAsk={setRequest}
        onViewProfile={() => setRequest("Earned profile link clicked")}
      />
      {request && (
        <aside
          role="status"
          style={{ padding: 20, border: "1px solid", borderRadius: 18 }}
        >
          <h3>AI handoff preview</h3>
          <p>{request}</p>
          <button onClick={() => setRequest("")}>Close preview</button>
        </aside>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
