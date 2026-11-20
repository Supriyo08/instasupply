import { CITIES, isInServiceArea, type GeocodeAddressResponse, type LatLng } from '@instasupply/shared';
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
import { call, errorMessage } from '@/lib/api';

type GeocodeResult = GeocodeAddressResponse['results'][number];

/**
 * Address search (server-side geocoding, biased to the Greater Toronto Area) plus click/drag-to-place
 * pin. Coordinates are what the driver navigates to, so the pin is the source of truth: the caller
 * refuses to save without one (verified defect R39), and the text under the map says where it landed.
 */
export function LocationPicker({
  address,
  location,
  locationLabel,
  onLocationChange,
  onAddressSuggestion,
  error,
}: {
  address: string;
  location: LatLng | null;
  /** The geocoder's label for the current pin, if it came from a search. */
  locationLabel?: string | null;
  onLocationChange: (location: LatLng, label?: string | null) => void;
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
      // Only results inside the service area can be delivered to; a far-away match is never offered.
      const inArea = response.results.filter((result) => isInServiceArea(result.location));
      setResults(inArea);
      if (inArea.length === 0) {
        setSearchError(
          response.results.length
            ? 'No match inside the Greater Toronto Area. Check the address or drop the pin on the map.'
            : 'No matches. Click the map to drop a pin instead.',
        );
      }
      if (inArea.length === 1) {
        onLocationChange(inArea[0]!.location, inArea[0]!.label);
        setResults(null);
      }
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
        onLocationChange({ lat: point.lat, lng: point.lng }, null);
      },
    }),
    [onLocationChange],
  );

  const outside = location ? !isInServiceArea(location) : false;
  const message =
    error ??
    searchError ??
    (location
      ? outside
        ? 'This pin is outside the Greater Toronto Area service area. Move it to the jobsite.'
        : `Pin at ${locationLabel ?? `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`} — drag it to adjust.`
      : 'Search the address or click the map to place the drop-off pin.');

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
        <ul
          className="max-h-36 divide-y divide-slate-100 overflow-y-auto rounded-lg ring-1 ring-slate-200"
          aria-label="Address matches"
        >
          {results.map((result) => (
            <li key={`${result.location.lat},${result.location.lng}`}>
              <button
                type="button"
                className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  onLocationChange(result.location, result.label);
                  onAddressSuggestion?.(result.label);
                  setResults(null);
                }}
              >
                <PinIcon size={14} className="mt-0.5 shrink-0 text-slate-400" aria-hidden />
                <span>
                  {result.label}
                  <span className="block text-[11px] text-slate-400">
                    {result.areaLabel} · {CITIES[result.cityId]?.name ?? result.cityId}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div
        className="h-64 overflow-hidden rounded-xl ring-1 ring-slate-200"
        role="application"
        aria-label="Drop-off map: click to place the pin, drag the pin to move it"
      >
        <BaseMap center={location ?? DEFAULT_CENTER} zoom={location ? 15 : 11}>
          <InvalidateOnResize />
          <ClickToPick onPick={(point) => onLocationChange(point, null)} />
          <FlyTo target={location} />
          {location ? (
            <Marker
              position={toLeaflet(location)}
              icon={destinationIcon()}
              draggable
              eventHandlers={markerHandlers}
              title="Drop-off pin"
            />
          ) : null}
        </BaseMap>
      </div>
      <p
        role="status"
        className={
          error || searchError || outside ? 'text-xs font-medium text-rose-600' : 'text-xs text-slate-500'
        }
      >
        {message}
      </p>
    </div>
  );
}
