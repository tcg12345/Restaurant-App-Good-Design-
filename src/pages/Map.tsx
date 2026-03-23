import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, useMotionValue, useTransform, animate } from 'motion/react';
import { Search, Star, Heart, Navigation, SlidersHorizontal, Bookmark, Users, MapPinned, ChevronDown, Layers, X, Box, Square } from 'lucide-react';
import { cn } from '../lib/utils';

declare global {
  interface Window {
    mapkit: any;
  }
}

const MAPKIT_TOKEN = import.meta.env.VITE_APPLE_MAPKIT_TOKEN || '';

const MOCK_MARKERS = [
  { id: '1', name: 'Lumière', lat: 40.7128, lng: -74.0060, rating: 4.9, price: '$$$$' },
  { id: '2', name: 'Alchemist', lat: 40.7282, lng: -73.9942, rating: 4.7, price: '$$$' },
  { id: '3', name: 'Sakura Zen', lat: 40.7589, lng: -73.9851, rating: 4.8, price: '$$$$' },
];

const MAP_STYLES = [
  { id: 'standard', label: 'Standard', mapType: 'Standard' },
  { id: 'muted', label: 'Muted', mapType: 'MutedStandard' },
  { id: 'satellite', label: 'Satellite', mapType: 'Satellite' },
  { id: 'hybrid', label: 'Hybrid', mapType: 'Hybrid' },
] as const;

const FILTERS = [
  { icon: Bookmark, label: 'Hitlist', active: false },
  { icon: Users, label: 'Anyone', hasDropdown: true, active: false },
  { icon: MapPinned, label: 'Nearby', active: false },
];

// Wait for mapkit to be available
const waitForMapKit = (): Promise<any> => {
  return new Promise((resolve) => {
    if (window.mapkit) {
      resolve(window.mapkit);
      return;
    }
    const check = setInterval(() => {
      if (window.mapkit) {
        clearInterval(check);
        resolve(window.mapkit);
      }
    }, 100);
  });
};

export const Map: React.FC = () => {
  const [selectedMarker, setSelectedMarker] = useState<string | null>(null);
  const [activeStyle, setActiveStyle] = useState<string>('standard');
  const [showStylePicker, setShowStylePicker] = useState(false);
  const [is3D, setIs3D] = useState(false);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const annotationsRef = useRef<{ [id: string]: any }>({});
  const mapkitRef = useRef<any>(null);
  const initializedRef = useRef(false);

  // Sheet height: 0 = collapsed (peek), 1 = fully open
  const sheetY = useMotionValue(0);
  const PEEK_HEIGHT = 130;
  const SHEET_HEIGHT = typeof window !== 'undefined' ? window.innerHeight * 0.75 : 600;
  const dragRange = SHEET_HEIGHT - PEEK_HEIGHT;

  const translateY = useTransform(sheetY, [0, dragRange], [dragRange, 0]);

  const snapSheet = (open: boolean) => {
    animate(sheetY, open ? dragRange : 0, {
      type: 'spring',
      damping: 30,
      stiffness: 200,
      mass: 0.8,
    });
  };

  // Initialize Apple MapKit JS
  useEffect(() => {
    if (!mapContainerRef.current || initializedRef.current) return;
    initializedRef.current = true;

    const initMap = async () => {
      const mk = await waitForMapKit();
      mapkitRef.current = mk;

      mk.init({
        authorizationCallback: (done: (token: string) => void) => {
          done(MAPKIT_TOKEN);
        },
      });

      const map = new mk.Map(mapContainerRef.current, {
        center: new mk.Coordinate(40.735, -73.99),
        cameraDistance: 25000,
        showsCompass: mk.FeatureVisibility.Hidden,
        showsMapTypeControl: false,
        showsZoomControl: false,
        colorScheme: mk.Map.ColorSchemes.Light,
      });

      // Add markers
      const annotations = MOCK_MARKERS.map((markerData) => {
        const coord = new mk.Coordinate(markerData.lat, markerData.lng);

        const annotation = new mk.MarkerAnnotation(coord, {
          title: markerData.name,
          glyphText: '🍽',
          color: '#8B4513',
          data: { id: markerData.id },
        });

        annotationsRef.current[markerData.id] = annotation;
        return annotation;
      });

      map.addAnnotations(annotations);

      // Handle annotation selection
      map.addEventListener('select', (event: any) => {
        const annotation = event.annotation;
        if (annotation?.data?.id) {
          setSelectedMarker(annotation.data.id);
        }
      });

      map.addEventListener('deselect', () => {
        setSelectedMarker(null);
      });

      mapRef.current = map;
    };

    initMap();

    return () => {
      if (mapRef.current) {
        mapRef.current.destroy();
        mapRef.current = null;
      }
    };
  }, []);

  // Update marker styles when selection changes
  useEffect(() => {
    Object.entries(annotationsRef.current).forEach(([id, annotation]) => {
      const isSelected = id === selectedMarker;
      annotation.color = isSelected ? '#D4A574' : '#8B4513';
      annotation.glyphText = isSelected ? '⭐' : '🍽';
    });
  }, [selectedMarker]);

  const flyToMarker = useCallback((marker: typeof MOCK_MARKERS[0]) => {
    setSelectedMarker(marker.id);
    const mk = mapkitRef.current;
    if (mapRef.current && mk) {
      const coordinate = new mk.Coordinate(marker.lat, marker.lng);
      mapRef.current.setCenterAnimated(coordinate, true);
      mapRef.current.setCameraDistanceAnimated(5000, true);
    }
  }, []);

  return (
    <div className="relative h-screen w-full overflow-hidden bg-muted">
      {/* Apple MapKit Map */}
      <div ref={mapContainerRef} className="absolute inset-0" style={{ width: '100%', height: '100%' }} />

      {/* Floating Action Buttons */}
      <div className="absolute right-6 top-6 flex flex-col gap-3 z-30">
        <button
          onClick={() => {
            if (navigator.geolocation) {
              navigator.geolocation.getCurrentPosition((pos) => {
                const mk = mapkitRef.current;
                if (mapRef.current && mk) {
                  const coordinate = new mk.Coordinate(pos.coords.latitude, pos.coords.longitude);
                  mapRef.current.setCenterAnimated(coordinate, true);
                  mapRef.current.setCameraDistanceAnimated(5000, true);

                  // Add user location annotation
                  const userAnnotation = new mk.MarkerAnnotation(coordinate, {
                    color: '#3B82F6',
                    glyphText: '📍',
                    title: 'You',
                    displayPriority: 1000,
                  });
                  mapRef.current.addAnnotation(userAnnotation);
                }
              });
            }
          }}
          className="w-12 h-12 glass rounded-full flex items-center justify-center shadow-xl text-on-surface/60 hover:text-primary transition-colors"
        >
          <Navigation size={20} />
        </button>
        <button className="w-12 h-12 glass rounded-full flex items-center justify-center shadow-xl text-on-surface/60 hover:text-primary transition-colors">
          <Heart size={20} />
        </button>
        <button
          onClick={() => {
            const map = mapRef.current;
            const mk = mapkitRef.current;
            if (!map || !mk) return;
            const next = !is3D;
            setIs3D(next);

            if (next) {
              // Switch to 3D: tilt camera and zoom in
              map.mapType = mk.Map.MapTypes.Standard;
              map.setCameraDistanceAnimated(3000, true);

              // Use a small delay to let the camera distance animate, then tilt
              setTimeout(() => {
                try {
                  // MapKit JS 5.x supports camera property for 3D
                  const center = map.center;
                  const camera = new mk.MapCamera();
                  camera.centerCoordinate = center;
                  camera.distance = 3000;
                  camera.pitch = 60;
                  camera.heading = -20;
                  map.setCameraAnimated(camera, true);
                } catch {
                  // Fallback: at minimum set camera distance
                  map.setCameraDistanceAnimated(3000, true);
                }
              }, 300);
            } else {
              // Switch to 2D: flatten camera
              try {
                const center = map.center;
                const camera = new mk.MapCamera();
                camera.centerCoordinate = center;
                camera.distance = 15000;
                camera.pitch = 0;
                camera.heading = 0;
                map.setCameraAnimated(camera, true);
              } catch {
                map.setCameraDistanceAnimated(15000, true);
              }
            }
          }}
          className={cn(
            "w-12 h-12 glass rounded-full flex items-center justify-center shadow-xl transition-colors",
            is3D ? "text-primary" : "text-on-surface/60 hover:text-primary"
          )}
        >
          {is3D ? <Square size={20} /> : <Box size={20} />}
        </button>
        <div className="relative">
          <button
            onClick={() => setShowStylePicker(!showStylePicker)}
            className={cn(
              "w-12 h-12 glass rounded-full flex items-center justify-center shadow-xl transition-colors",
              showStylePicker ? "text-primary" : "text-on-surface/60 hover:text-primary"
            )}
          >
            {showStylePicker ? <X size={20} /> : <Layers size={20} />}
          </button>
          {showStylePicker && (
            <motion.div
              initial={{ opacity: 0, scale: 0.85, x: 10 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              className="absolute right-14 top-0 glass rounded-2xl shadow-2xl border border-white/20 p-2 flex flex-col gap-1 min-w-[140px]"
            >
              {MAP_STYLES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    const map = mapRef.current;
                    const mk = mapkitRef.current;
                    if (map && mk && s.id !== activeStyle) {
                      map.mapType = mk.Map.MapTypes[s.mapType];
                      setActiveStyle(s.id);
                    }
                    setShowStylePicker(false);
                  }}
                  className={cn(
                    "flex items-center gap-3 px-4 py-2.5 rounded-xl text-left transition-colors whitespace-nowrap",
                    activeStyle === s.id
                      ? "bg-primary/10 text-primary"
                      : "text-on-surface/70 hover:bg-on-surface/5"
                  )}
                >
                  <span className={cn(
                    "w-2 h-2 rounded-full flex-shrink-0",
                    activeStyle === s.id ? "bg-primary" : "bg-on-surface/20"
                  )} />
                  <span className="text-xs font-bold uppercase tracking-wider">{s.label}</span>
                </button>
              ))}
            </motion.div>
          )}
        </div>
      </div>

      {/* Bottom Sheet */}
      <motion.div
        style={{ y: translateY, height: SHEET_HEIGHT }}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={0.1}
        onDragEnd={(_, info) => {
          const currentVal = sheetY.get();
          const velocity = info.velocity.y;
          if (velocity < -300 || (currentVal > dragRange * 0.3 && velocity <= 0)) {
            snapSheet(true);
          } else if (velocity > 300 || (currentVal < dragRange * 0.7 && velocity >= 0)) {
            snapSheet(false);
          } else {
            snapSheet(currentVal > dragRange * 0.5);
          }
        }}
        onDrag={(_, info) => {
          const currentVal = sheetY.get();
          const newVal = currentVal - info.delta.y;
          sheetY.set(Math.max(0, Math.min(dragRange, newVal)));
        }}
        dragListener={true}
        dragMomentum={false}
        className="absolute bottom-0 left-0 right-0 glass rounded-t-[3rem] shadow-[0_-20px_50px_rgba(0,0,0,0.1)] z-40 border-t border-white/40 flex flex-col"
      >
        {/* Handle */}
        <div className="w-full flex flex-col items-center pt-4 pb-4 cursor-grab active:cursor-grabbing flex-shrink-0">
          <div className="w-12 h-1.5 bg-on-surface/10 rounded-full" />
        </div>

        {/* Search Bar & Filters */}
        <div className="px-6 pb-4 flex-shrink-0">
          <div className="flex items-center gap-3 overflow-x-auto no-scrollbar">
            <button className="w-12 h-12 rounded-full border-2 border-on-surface/10 flex items-center justify-center flex-shrink-0 hover:bg-muted transition-colors">
              <Search size={20} className="text-on-surface/70" />
            </button>
            <button className="w-12 h-12 rounded-full border-2 border-on-surface/10 flex items-center justify-center flex-shrink-0 hover:bg-muted transition-colors">
              <SlidersHorizontal size={18} className="text-on-surface/70" />
            </button>
            {FILTERS.map((filter) => (
              <button
                key={filter.label}
                className={cn(
                  "flex items-center gap-2 px-5 py-3 rounded-full border-2 border-on-surface/10 whitespace-nowrap flex-shrink-0 transition-colors hover:bg-muted",
                  filter.active && "bg-primary/10 border-primary/30 text-primary"
                )}
              >
                <filter.icon size={16} className={filter.active ? "text-primary" : "text-on-surface/50"} />
                <span className="text-xs font-bold uppercase tracking-wider">{filter.label}</span>
                {filter.hasDropdown && <ChevronDown size={14} className="text-on-surface/40" />}
              </button>
            ))}
          </div>
        </div>

        {/* Results List */}
        <div className="px-6 flex-1 overflow-y-auto no-scrollbar pb-32">
          <div className="space-y-6">
            {MOCK_MARKERS.map((marker) => (
              <div
                key={marker.id}
                className={cn(
                  "flex gap-4 group cursor-pointer rounded-2xl p-2 -mx-2 transition-colors",
                  selectedMarker === marker.id && "bg-primary/5"
                )}
                onClick={() => flyToMarker(marker)}
              >
                <div className="w-24 h-24 rounded-2xl overflow-hidden flex-shrink-0">
                  <img
                    src={`https://images.unsplash.com/photo-${1414235077428 + parseInt(marker.id) * 100000000000}?auto=format&fit=crop&q=80&w=200`}
                    alt={marker.name}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                    referrerPolicy="no-referrer"
                  />
                </div>
                <div className="flex-1 py-1">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-serif font-bold text-lg">{marker.name}</h3>
                    <div className="flex items-center gap-1 text-primary">
                      <Star size={12} className="fill-primary" />
                      <span className="text-xs font-bold">{marker.rating}</span>
                    </div>
                  </div>
                  <p className="text-xs text-on-surface/40 font-medium uppercase tracking-wider mb-2">Modern French • {marker.price}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-bold uppercase tracking-wider">Michelin</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary/10 text-secondary font-bold uppercase tracking-wider">Top Rated</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
};
