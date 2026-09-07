import { useMemo, useRef } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useLists } from "../contexts/ListsContext";
import {
  readTastePreferences,
  tastePreferencesFromQuiz,
  sanitizeTastePreferences,
  TASTE_PREFERENCES_KEY,
  type TastePreferences,
} from "../lib/taste-preferences";
export function useTastePreferences() {
  const { user, profile } = useAuth();
  const owner = useRef(user?.id);
  owner.current = user?.id;
  const { restaurantMeta, stashMetaKey, cloudLoaded, cloudSyncReady } =
    useLists();
  const raw = restaurantMeta[TASTE_PREFERENCES_KEY];
  const record = useMemo(
    () => readTastePreferences(raw, user?.id ?? ""),
    [raw, user?.id],
  );
  const quizRaw = profile?.user_id === user?.id ? profile?.taste_profile : null;
  const preferences = useMemo(() => {
    if (record) return record.values;
    return tastePreferencesFromQuiz(quizRaw);
  }, [record, quizRaw]);
  const save = (values: TastePreferences) => {
    if (!user || owner.current !== user.id || !cloudLoaded)
      throw new Error("Wait for your account to finish loading.");
    stashMetaKey(TASTE_PREFERENCES_KEY, {
      version: 1,
      ownerId: user.id,
      updatedAt: Date.now(),
      values: sanitizeTastePreferences(values),
    });
  };
  return {
    preferences,
    record,
    save,
    ready: !!user && cloudLoaded,
    cloudSyncReady,
  };
}
