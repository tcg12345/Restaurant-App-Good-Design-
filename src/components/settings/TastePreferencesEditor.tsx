import React, { useEffect, useState } from "react";
import {
  Sparkles,
  ArrowUpRight,
  Check,
  ChevronDown,
  SlidersHorizontal,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTastePreferences } from "../../hooks/useTastePreferences";
import { useAssistantContext } from "../../contexts/AssistantContext";
import { CUISINE_TYPES } from "../../lib/places";
import { APP_GOAL_LABELS, APP_GOALS } from "../../lib/app-goal";
import {
  DIETARY_PREFERENCES,
  sanitizeTastePreferences,
  type TastePreferences,
} from "../../lib/taste-preferences";
import "./TastePreferencesEditor.css";

export function TastePreferencesEditor() {
  const store = useTastePreferences();
  const assistant = useAssistantContext();
  const navigate = useNavigate();
  return (
    <TastePreferencesForm
      {...store}
      onAsk={(text) => {
        assistant.setAttachment(null);
        assistant.requestOpen(text);
      }}
      onViewProfile={() => navigate("/profile/taste")}
    />
  );
}
export function TastePreferencesForm({
  preferences,
  save,
  ready,
  cloudSyncReady,
  onAsk,
  onViewProfile,
}: {
  preferences: TastePreferences;
  save: (p: TastePreferences) => void;
  ready: boolean;
  cloudSyncReady: boolean;
  onAsk: (text: string) => void;
  onViewProfile: () => void;
}) {
  const [draft, setDraft] = useState(preferences);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [picker, setPicker] = useState<"cuisines" | "avoidCuisines" | null>(
    null,
  );
  const [query, setQuery] = useState("");
  const [request, setRequest] = useState("");
  useEffect(() => {
    if (!dirty) setDraft(preferences);
  }, [preferences, dirty]);
  const update = (patch: Partial<TastePreferences>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
    setMessage("");
  };
  const toggle = (
    key: "cuisines" | "avoidCuisines" | "dietary",
    value: string,
  ) => {
    const selected = draft[key].includes(value);
    const next = {
      ...draft,
      [key]: selected
        ? draft[key].filter((v) => v !== value)
        : [...draft[key], value],
    };
    if (!selected && key === "cuisines")
      next.avoidCuisines = next.avoidCuisines.filter((v) => v !== value);
    if (!selected && key === "avoidCuisines")
      next.cuisines = next.cuisines.filter((v) => v !== value);
    update(next);
  };
  const commit = () => {
    try {
      save(sanitizeTastePreferences(draft));
      setDirty(false);
      setMessage(
        cloudSyncReady
          ? "Preferences saved."
          : "Saved on this device. Reopen when connected to sync.",
      );
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Could not save. Please try again.",
      );
    }
  };
  const cuisines = CUISINE_TYPES.filter(
    (c) => c.type !== "" && c.label.toLowerCase().includes(query.toLowerCase()),
  );
  if (!ready)
    return (
      <p className="tp-loading" role="status">
        Loading your preferences…
      </p>
    );
  return (
    <div className="tp-editor">
      <div className="tp-intro">
        <span>
          <SlidersHorizontal size={23} strokeWidth={1.5} />
        </span>
        <h2>Make it more you.</h2>
        <p>
          Fine-tune what comes next. Your ratings, visits, and earned points
          stay exactly as they are.
        </p>
      </div>
      <section className="tp-ai">
        <div className="tp-ai-heading">
          <Sparkles size={19} />
          <h3>Put it in your own words</h3>
        </div>
        <p>
          “More Japanese spots, quieter rooms, and recipes I can make in 30
          minutes.”
        </p>
        <label className="sr-only" htmlFor="taste-ai-request">
          Changes to discuss with AI
        </label>
        <textarea
          id="taste-ai-request"
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          maxLength={1000}
          placeholder="What would you like to change?"
          rows={3}
        />
        <button
          type="button"
          disabled={!request.trim() || dirty}
          onClick={() =>
            onAsk(
              `Help me update my saved recommendation preferences: ${request.trim()}\nUse update_taste_profile to save only the changes I request. Do not edit my ratings, visits, points, or historical taste statistics.`,
            )
          }
        >
          Continue in AI <ArrowUpRight size={16} />
        </button>
        <small>
          {dirty
            ? "Save or discard your edits before continuing in AI."
            : "Review and send your request in the assistant. Changes appear here when saved."}
        </small>
      </section>
      <section className="tp-section">
        <h3>What brings you here?</h3>
        <div className="tp-goals">
          {APP_GOALS.map((goal) => (
            <button
              type="button"
              key={goal}
              aria-pressed={draft.goal === goal}
              onClick={() => update({ goal })}
            >
              <span>{APP_GOAL_LABELS[goal]}</span>
              {draft.goal === goal && <Check size={17} />}
            </button>
          ))}
        </div>
      </section>
      <section className="tp-section">
        <h3>Your kind of food</h3>
        <div className="tp-cuisine-rows">
          {(["cuisines", "avoidCuisines"] as const).map((key) => (
            <div key={key}>
              <button
                className="tp-cuisine-toggle"
                type="button"
                aria-expanded={picker === key}
                onClick={() => {
                  setPicker(picker === key ? null : key);
                  setQuery("");
                }}
              >
                <span>
                  <strong>
                    {key === "cuisines" ? "More of this" : "Less of this"}
                  </strong>
                  <small>{draft[key].join(", ") || "Choose cuisines"}</small>
                </span>
                <ChevronDown size={17} />
              </button>
              {picker === key && (
                <div className="tp-picker">
                  <label className="sr-only" htmlFor={`taste-search-${key}`}>
                    Search cuisines
                  </label>
                  <input
                    id={`taste-search-${key}`}
                    type="search"
                    placeholder="Search cuisines"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <div className="tp-chips">
                    {cuisines.map((c) => (
                      <button
                        key={c.label}
                        type="button"
                        aria-pressed={draft[key].includes(c.label)}
                        onClick={() => toggle(key, c.label)}
                      >
                        {c.label}
                        {draft[key].includes(c.label) && <Check size={12} />}
                      </button>
                    ))}
                  </div>
                  {!cuisines.length && <p>No matching cuisines.</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
      <section className="tp-section">
        <h3>Your usual budget</h3>
        <p>
          Select the ranges you want suggested. Leave all off to follow your
          dining history.
        </p>
        <div className="tp-segments">
          {[1, 2, 3, 4].map((tier) => (
            <button
              key={tier}
              type="button"
              aria-pressed={draft.prices.includes(tier)}
              onClick={() =>
                update({
                  prices: draft.prices.includes(tier)
                    ? draft.prices.filter((p) => p !== tier)
                    : [...draft.prices, tier],
                })
              }
            >
              {"$".repeat(tier)}
            </button>
          ))}
        </div>
      </section>
      <section className="tp-section">
        <h3>A little familiar. A little new.</h3>
        <div className="tp-segments">
          {(["familiar", "balanced", "adventurous"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={draft.discovery === value}
              onClick={() => update({ discovery: value })}
            >
              {
                {
                  familiar: "Favorites",
                  balanced: "A mix",
                  adventurous: "Explore",
                }[value]
              }
            </button>
          ))}
        </div>
      </section>
      <section className="tp-section">
        <h3>At the table</h3>
        <label className="tp-field">
          Atmosphere
          <input
            value={draft.atmosphere}
            maxLength={100}
            onChange={(e) => update({ atmosphere: e.target.value })}
            placeholder="Quiet, casual, outdoor seating…"
          />
        </label>
        <label className="tp-field">
          Default city for AI suggestions
          <input
            value={draft.city}
            maxLength={100}
            onChange={(e) => update({ city: e.target.value })}
            placeholder="e.g. New York, NY"
          />
        </label>
        <p>The location you actively choose in the app takes priority.</p>
      </section>
      <section className="tp-section">
        <h3>In your kitchen</h3>
        <div className="tp-chips">
          {[...new Set([...DIETARY_PREFERENCES, ...draft.dietary])].map(
            (value) => (
              <button
                key={value}
                type="button"
                aria-pressed={draft.dietary.includes(value)}
                onClick={() => toggle("dietary", value)}
              >
                {value}
              </button>
            ),
          )}
        </div>
        <label className="tp-field">
          Usual cooking time
          <select
            value={draft.cookingMinutes ?? ""}
            onChange={(e) =>
              update({
                cookingMinutes: e.target.value
                  ? Number(e.target.value)
                  : undefined,
              })
            }
          >
            <option value="">No preference</option>
            {[
              ...new Set([
                15,
                30,
                45,
                60,
                90,
                120,
                ...(draft.cookingMinutes ? [draft.cookingMinutes] : []),
              ]),
            ]
              .sort((a, b) => a - b)
              .map((n) => (
                <option key={n} value={n}>
                  {n} minutes or less
                </option>
              ))}
          </select>
        </label>
        <p>
          These guide recipe ideas and restaurant searches. Menu details still
          determine the available options.
        </p>
      </section>
      <section className="tp-section">
        <h3>Anything else AI should know?</h3>
        <p>
          Useful details, like mild spice, smaller menus, or cooking for two.
          Used by the assistant and AI recipe tools.
        </p>
        <label className="sr-only" htmlFor="taste-notes">
          Personalization notes
        </label>
        <textarea
          id="taste-notes"
          value={draft.notes}
          onChange={(e) => update({ notes: e.target.value })}
          maxLength={700}
          rows={4}
          placeholder="The little things that make a meal right for you."
        />
      </section>
      <section className="tp-usage">
        <h3>Where this makes a difference</h3>
        <p>
          Restaurant picks · Map suggestions · Home ideas & guides · Recipe
          discovery · AI cooking · Your group recommendations
        </p>
        <button
          type="button"
          onClick={() => update(sanitizeTastePreferences(null))}
        >
          Clear saved preferences
        </button>
        <p>
          Clearing returns suggestions to your dining history after you save.
        </p>
        <button type="button" onClick={onViewProfile}>
          View your earned taste profile <ArrowUpRight size={15} />
        </button>
      </section>
      <div className="tp-save">
        <button type="button" disabled={!dirty} onClick={commit}>
          Save preferences
        </button>
        {dirty && (
          <button
            type="button"
            className="tp-discard"
            onClick={() => {
              setDraft(preferences);
              setDirty(false);
              setMessage("");
            }}
          >
            Discard edits
          </button>
        )}
        <span role="status">{message}</span>
      </div>
    </div>
  );
}
