import { useLocation, useNavigate } from 'react-router-dom';
import { GuidesBrowser, type BrowseGuide } from '../components/GuidesBrowser';
import { useBrowseGuides } from '../components/HomeGuides';
import { usePageBack } from '../lib/usePageBack';

/** A real history entry keeps the collection underneath each opened guide. */
export function GuidesPage() {
  const location = useLocation();
  const collection: BrowseGuide[] | undefined = Array.isArray(location.state?.guideCollection) ? location.state.guideCollection : undefined;
  const { guides, loading } = useBrowseGuides(!collection);
  const navigate = useNavigate();
  const back = usePageBack('/');
  return <GuidesBrowser open variant="page" isMobile realGuides={collection ?? guides} loading={!collection && loading} cityName={location.state?.cityName} onClose={back}
    onOpenGuide={id => navigate(`/guides/${encodeURIComponent(id)}`)} />;
}
