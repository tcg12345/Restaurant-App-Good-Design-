// Step 2 of the Advanced Recipe Builder — "Details".
// Cuisine (underline trigger → search sheet on phone, styled select on
// desktop), course chips, difficulty cards with colored dots, and the
// optional cover photo (dashed slot → preview). The photo is only
// *required* when publishing publicly — validation enforces that at
// publish time, so the label says optional here.

import React, { useCallback, useRef, useState } from 'react';
import { Camera, X, ChevronDown } from 'lucide-react';
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

const DIFFICULTY_CARDS: Array<{ level: 'Easy' | 'Medium' | 'Hard'; sub: string; dot: string }> = [
  { level: 'Easy', sub: 'Few steps, forgiving', dot: '#2e9c6e' },
  { level: 'Medium', sub: 'Some prep & timing', dot: '#e0a030' },
  { level: 'Hard', sub: 'Careful technique', dot: '#c74b2e' },
];

export const StepDetails: React.FC<Props> = ({ state, dispatch }) => {
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
    <div className="rcx-stack">
      <div>
        <div className="rcx-kicker">Cuisine</div>
        {phoneMode ? (
          <button
            type="button"
            className={`rcx-cuisine-trigger${state.cuisine ? '' : ' is-empty'}`}
            onClick={() => setCuisinePickerOpen(true)}
          >
            <span>{state.cuisine || 'Select a cuisine'}</span>
            <ChevronDown size={15} strokeWidth={2.2} />
          </button>
        ) : (
          <div className="rcx-select-wrap">
            <select
              className={`rcx-select${state.cuisine ? '' : ' is-empty'}`}
              value={state.cuisine}
              onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'cuisine', value: e.target.value })}
            >
              <option value="">Select a cuisine</option>
              {CUISINE_OPTIONS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <ChevronDown size={15} strokeWidth={2.2} />
          </div>
        )}
      </div>

      <div>
        <div className="rcx-kicker">Course</div>
        <div className="rcx-chips">
          {COURSE_OPTIONS.map((c) => {
            const isActive = state.course.includes(c);
            return (
              <button
                key={c}
                type="button"
                className={`rcx-chip${isActive ? ' is-on' : ''}`}
                onClick={() => dispatch({ type: 'TOGGLE_COURSE', course: c })}
              >
                {c}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="rcx-kicker">Difficulty</div>
        <div className="rcx-diff-grid">
          {DIFFICULTY_CARDS.map((d) => {
            const isActive = state.difficulty === d.level;
            return (
              <button
                key={d.level}
                type="button"
                className={`rcx-diff-card${isActive ? ' is-on' : ''}`}
                onClick={() => dispatch({ type: 'SET_FIELD', field: 'difficulty', value: d.level })}
              >
                <span className="rcx-diff-dot" style={{ background: d.dot }} />
                <span className="rcx-diff-label">{d.level}</span>
                <span className="rcx-diff-sub">{d.sub}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="rcx-kicker">
          Photo<span className="rcx-kicker-opt"> · optional</span>
        </div>
        {state.coverPhoto ? (
          <div className="rcx-photo-preview">
            <img src={state.coverPhoto} alt="Recipe cover" referrerPolicy="no-referrer" />
            <button
              type="button"
              className="rcx-photo-remove"
              onClick={() => dispatch({ type: 'SET_FIELD', field: 'coverPhoto', value: '' })}
              aria-label="Remove photo"
            >
              <X size={13} strokeWidth={2.4} />
            </button>
          </div>
        ) : (
          <div
            className="rcx-photo-slot"
            onClick={() => fileRef.current?.click()}
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
            role="button"
            tabIndex={0}
          >
            <span className="rcx-photo-slot-icon"><Camera size={18} /></span>
            <span className="rcx-photo-slot-text">
              <strong>Add a photo</strong> of the final dish
            </span>
            <span className="rcx-photo-slot-sub">
              {phoneMode ? 'Needed to publish publicly.' : 'Drop one here or tap to browse. Needed to publish publicly.'}
            </span>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={onFileChange}
          style={{ display: 'none' }}
        />
      </div>

      <CuisinePickerSheet
        isOpen={cuisinePickerOpen}
        options={CUISINE_OPTIONS}
        selected={state.cuisine}
        onClose={() => setCuisinePickerOpen(false)}
        onSelect={(c) => dispatch({ type: 'SET_FIELD', field: 'cuisine', value: c })}
      />
    </div>
  );
};
