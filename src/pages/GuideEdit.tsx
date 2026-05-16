/**
 * GuideEdit — route wrapper for /guides/:id/edit. Loads the existing
 * guide, hands it to the global GuideCreator via context, and navigates
 * back to the reader page when the sheet closes.
 */
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { getGuideById, type Guide } from '../lib/supabase-guides';
import { useAuth } from '../contexts/AuthContext';
import { useGuideCreator } from '../contexts/GuideCreatorContext';

export const GuideEdit: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { openGuideCreator, isOpen } = useGuideCreator();
  const [guide, setGuide] = useState<Guide | null>(null);
  const [loading, setLoading] = useState(true);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      const g = await getGuideById(id);
      if (cancelled) return;
      setGuide(g);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Once the guide is loaded and we know it's the user's own, open the
  // global creator with it pre-populated. Only do this once per mount.
  useEffect(() => {
    if (!guide || opened) return;
    if (guide.userId !== user?.id) return;
    openGuideCreator(guide);
    setOpened(true);
  }, [guide, user?.id, opened, openGuideCreator]);

  // When the sheet closes, navigate back to the reader.
  useEffect(() => {
    if (opened && !isOpen) {
      navigate(`/guides/${id}`);
    }
  }, [opened, isOpen, id, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f4f2ec]">
        <Loader2 size={28} className="animate-spin text-primary/60" />
      </div>
    );
  }

  if (!guide || guide.userId !== user?.id) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f4f2ec] p-6 text-center">
        <p className="text-sm text-on-surface/55">You can't edit this guide.</p>
      </div>
    );
  }

  // The page itself is just a thin background — the editor is the sheet.
  return <div className="min-h-screen bg-[#f4f2ec]" />;
};
