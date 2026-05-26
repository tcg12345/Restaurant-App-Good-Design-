// Step 1 of the Advanced Recipe Builder.
// Captures: name (req), one-line summary (req), cuisine (req), course
// chips, difficulty cards, hero image (req).

import React, { useCallback, useRef, useState } from 'react';
import { Image as ImageIcon, Camera, X, ChevronDown } from 'lucide-react';
import { useSettings } from '../../contexts/SettingsContext';
import {
  CUISINE_OPTIONS,
  COURSE_OPTIONS,
  type AdvancedRecipeState,
  type Action,
} from '../AdvancedRecipeBuilder';
import { CuisinePickerSheet } from './CuisinePickerSheet';

interface Props {
  state: AdvancedRecipeState;
  dispatch: React.Dispatch<Action>;
}

const DIFFICULTY_CARDS: Array<{ level: 'Easy' | 'Medium' | 'Hard'; sub: string }> = [
  { level: 'Easy', sub: 'Few steps, forgiving technique' },
  { level: 'Medium', sub: 'Some prep and timing required' },
  { level: 'Hard', sub: 'Multiple techniques, careful timing' },
];

export const StepBasics: React.FC<Props> = ({ state, dispatch }) => {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const { phoneMode } = useSettings();
  const [cuisinePickerOpen, setCuisinePickerOpen] = useState(false);

  // Cover photo upload — reads first file, encodes to base64. Mirrors
  // the basic modal's cover-upload pattern (no resize since the cover
  // can be embedded in the JSON home_meals blob).
  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      dispatch({ type: 'SET_FIELD', field: 'coverPhoto', value: String(reader.result || '') });
    };
    reader.readAsDataURL(file);
  }, [dispatch]);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  return (
    <>
      <div className="arb-field">
        <label className="arb-label">
          Recipe name <span className="req">*</span>
        </label>
        <input
          type="text"
          className="arb-input is-title"
          value={state.name}
          onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'name', value: e.target.value })}
          placeholder="Spring Pea Carbonara"
        />
      </div>

      <div className="arb-field">
        <label className="arb-label">
          One-line summary <span className="req">*</span>
        </label>
        <p className="arb-help">A short line that tells someone why they'd want to cook this.</p>
        <textarea
          className="arb-textarea"
          value={state.summary}
          onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'summary', value: e.target.value })}
          placeholder="Glossy, peppery, and brightened by sweet spring peas — a Roman classic that comes together in under an hour."
          rows={3}
        />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: phoneMode ? '1fr' : 'minmax(0, 1fr) minmax(0, 1.4fr)',
          gap: phoneMode ? 24 : 16,
        }}
      >
        <div className="arb-field" style={{ marginBottom: 0 }}>
          <label className="arb-label">
            Cuisine <span className="req">*</span>
          </label>
          {phoneMode ? (
            <button
              type="button"
              className={`arb-cuisine-trigger${state.cuisine ? '' : ' is-empty'}`}
              onClick={() => setCuisinePickerOpen(true)}
            >
              <span>{state.cuisine || 'Select a cuisine…'}</span>
              <ChevronDown size={18} />
            </button>
          ) : (
            <select
              className="arb-select"
              value={state.cuisine}
              onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'cuisine', value: e.target.value })}
            >
              <option value="">Select a cuisine…</option>
              {CUISINE_OPTIONS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          )}
        </div>

        <div className="arb-field" style={{ marginBottom: 0 }}>
          <label className="arb-label">
            Course <span className="req">*</span>
          </label>
          <div className="arb-chip-row" style={{ marginTop: 10 }}>
            {COURSE_OPTIONS.map((c) => {
              const isActive = state.course.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  className={`arb-chip${isActive ? ' is-active' : ''}`}
                  onClick={() => dispatch({ type: 'TOGGLE_COURSE', course: c })}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <CuisinePickerSheet
        isOpen={cuisinePickerOpen}
        options={CUISINE_OPTIONS}
        selected={state.cuisine}
        onClose={() => setCuisinePickerOpen(false)}
        onSelect={(c) => dispatch({ type: 'SET_FIELD', field: 'cuisine', value: c })}
      />

      <div className="arb-field" style={{ marginTop: 24 }}>
        <label className="arb-label">
          Difficulty <span className="req">*</span>
        </label>
        <div className="arb-difficulty-row">
          {DIFFICULTY_CARDS.map((d) => {
            const isActive = state.difficulty === d.level;
            return (
              <button
                key={d.level}
                type="button"
                data-level={d.level}
                className={`arb-difficulty-card${isActive ? ' is-active' : ''}`}
                onClick={() => dispatch({ type: 'SET_FIELD', field: 'difficulty', value: d.level })}
              >
                <div className="arb-difficulty-card-title">
                  <span className="dot" />
                  {d.level}
                </div>
                <div className="arb-difficulty-card-sub">{d.sub}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="arb-field">
        <label className="arb-label">
          Hero image <span className="req">*</span>
        </label>
        {state.coverPhoto ? (
          <div className="arb-dropzone-preview" style={{ backgroundImage: `url("${state.coverPhoto}")` }}>
            <button
              type="button"
              className="arb-dropzone-preview-remove"
              onClick={() => dispatch({ type: 'SET_FIELD', field: 'coverPhoto', value: '' })}
              aria-label="Remove image"
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <div
            className={`arb-dropzone${phoneMode ? ' is-mobile' : ''}`}
            onClick={() => fileRef.current?.click()}
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            role="button"
            tabIndex={0}
          >
            <div className="arb-dropzone-icon">
              {phoneMode ? <Camera size={26} /> : <ImageIcon size={22} />}
            </div>
            <div>
              <div className="arb-dropzone-text">
                {phoneMode ? (
                  <>Tap to <span className="accent">add a photo</span></>
                ) : (
                  <>Drop a photo here or <span className="accent">browse</span></>
                )}
              </div>
              <div className="arb-dropzone-sub">
                {phoneMode
                  ? 'A landscape shot of the final dish works best'
                  : 'A landscape shot of the final dish works best. JPG, PNG, or WebP up to 10MB.'}
              </div>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={onFileChange}
              style={{ display: 'none' }}
            />
          </div>
        )}
      </div>
    </>
  );
};
