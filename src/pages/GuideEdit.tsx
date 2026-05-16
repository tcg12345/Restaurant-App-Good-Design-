/**
 * GuideEdit — route wrapper for /guides/:id/edit. Loads the existing
 * guide and mounts the creator sheet pre-populated. On close, navigates
 * back to the guide's reader page.
 */
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { getGuideById, type Guide } from '../lib/supabase-guides';
import { useAuth } from '../contexts/AuthContext';
import { GuideCreatorSheet } from '../components/GuideCreatorSheet';

export const GuideEdit: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [guide, setGuide] = useState<Guide | null>(null);
  const [loading, setLoading] = useState(true);

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

  return (
    <GuideCreatorSheet
      open
      initialGuide={guide}
      onClose={() => navigate(`/guides/${guide.id}`)}
    />
  );
};
