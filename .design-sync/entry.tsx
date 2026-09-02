/**
 * Design-system entry for /design-sync.
 *
 * This repo is an application, not a published component library — there is
 * no dist entry to point the converter at. This barrel is that entry: it
 * names exactly the components that make up the app's visual system, so
 * window.GoodEats is the intended surface rather than whatever a
 * source scan happens to find.
 *
 * Deliberately EXCLUDES src/components/onboarding/* — the cream/terracotta
 * onboarding kit is one flow's styling, not the app's design language.
 */

export { GlassButton, GlassChipRow, GlassGroup, GlassSurface } from '../src/lib/glass-buttons';
export { OwnScoreBadge, ScoreBadge } from '../src/components/ScoreBadge';
export { ScoreRing } from '../src/components/cards/ScoreRing';
export { Avatar } from '../src/components/Avatar';
export { VerifiedBadge } from '../src/components/VerifiedBadge';
export { MichelinBadge, MichelinMark } from '../src/components/MichelinBadge';
export { EmptyState } from '../src/components/EmptyState';
export { Collapse } from '../src/components/Collapse';
export { LoadingSkeleton, LoadingSkeletonList } from '../src/components/LoadingSkeleton';
export { SearchField } from '../src/components/SearchField';
export { CardActionMenu } from '../src/components/CardActionMenu';
export { NumberWheelPicker, TimeWheelPicker } from '../src/components/WheelPicker';
export { FilterCheckRow, FilterDrillRow, FilterDrillSection, FilterOptionList, FilterSection, HoursFilterSection, Pill, PillRow, RangeSlider, Segment, SegmentItem } from '../src/components/filterPrimitives';
export { Calendar } from '../src/components/RatingShared';
