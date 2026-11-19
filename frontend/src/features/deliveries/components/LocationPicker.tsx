import type { GeocodeAddressResponse, LatLng } from '@instasupply/shared';
import type L from 'leaflet';
import { useMemo, useState } from 'react';
import { Marker } from 'react-leaflet';

import {
  BaseMap,
  ClickToPick,
  DEFAULT_CENTER,
  FlyTo,
  InvalidateOnResize,
  toLeaflet,
} from '@/components/map/BaseMap';
import { destinationIcon } from '@/components/map/markers';
import { Button } from '@/components/ui/Button';
import { PinIcon, SearchIcon } from '@/components/ui/icons';
import { call, errorMessage } from '@/lib/firebase/callables';

type GeocodeResult = GeocodeAddressResponse['results'][number];

/**
 * Address search (server-side geocoding) plus click/drag-to-place pin. Coordinates are what the
 * driver navigates to, so the pin is the source of truth.
 */
export function LocationPicker({
  address,
  location,
  onLocationChange,
  onAddressSuggestion,
  error,
}: {
  address: string;
  location: LatLng | null;
  onLocationChange: (location: LatLng) => void;
  onAddressSuggestion?: (label: string) => void;
  error?: string | null;
}) {
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const search = async () => {
    if (address.trim().length < 3) {
      setSearchError('Type the address first, then search.');
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      const response = await call('geocodeAddress', {
        query: address.trim(),
        near: location ?? DEFAULT_CENTER,
      });
      setResults(response.results);
      if (response.results.length === 0) setSearchError('No matches. Click the map to drop a pin instead.');
      if (response.results.length === 1) onLocationChange(response.results[0]!.location);
    } catch (caught) {
      setSearchError(errorMessage(caught));
    } finally {
      setSearching(false);
    }
  };

  const markerHandlers = useMemo(
    () => ({
      dragend(event: L.DragEndEvent) {
        const point = (event.target as L.Marker).getLatLng();
        onLocationChange({ lat: point.lat, lng: point.lng });
      },
    }),
    [onLocationChange],
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-700">
          Drop-off pin <span className="text-rose-500">*</span>
        </p>
        <Button
          size="sm"
          variant="subtle"
          icon={SearchIcon}
          loading={searching}
          onClick={() => void search()}
        >
          Find address
        </Button>
      </div>

      {results && results.length > 1 ? (
        <ul className="max-h-36 divide-y divide-slate-100 overflow-y-auto rounded-lg ring-1 ring-slate-200">
          {results.map((result) => (
            <li key={`${result.location.lat},${result.location.lng}`}>
              <button
                type="button"
                className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  onLocationChange(result.location);
                  onAddressSuggestion?.(result.label);
                  setResults(null);
                }}
              >
                <PinIcon size={14} className="mt-0.5 shrink-0 text-slate-400" aria-hidden />
                {result.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="h-64 overflow-hidden rounded-xl ring-1 ring-slate-200">
        <BaseMap center={location ?? DEFAULT_CENTER} zoom={location ? 15 : 12}>
          <InvalidateOnResize />
          <ClickToPick onPick={onLocationChange} />
          <FlyTo target={location} />
          {location ? (
            <Marker
              position={toLeaflet(location)}
              icon={destinationIcon()}
              draggable
              eventHandlers={markerHandlers}
            />
          ) : null}
        </BaseMap>
      </div>
      <p className={error || searchError ? 'text-xs font-medium text-rose-600' : 'text-xs text-slate-500'}>
        {error ??
          searchError ??
          (location
            ? `Pinned at ${location.lat.toFixed(5)}, ${location.lng.toFixed(5)} — drag the pin to adjust.`
            : 'Search the address or click the map to place the drop-off pin.')}
      </p>
    </div>
  );
}
