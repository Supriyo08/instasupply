import type { Jobsite, LatLng, Receiving, VehicleClass } from '@instasupply/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useUid } from '@/features/session/SessionProvider';

import { useJobsites } from './hooks';

const STORAGE_KEY = 'instasupply.site.v1';

/** A place chosen without saving a jobsite: GPS, a dropped pin or an address search result. */
export interface SitePoint {
  location: LatLng;
  /** "Current location", "Dropped pin" or the address searched for. */
  label: string;
  addressLine: string | null;
  source: 'gps' | 'pin' | 'search';
}

/** Where "Deliver to" points. Every distance, promise and price preview uses it (MARKETPLACE §7.2). */
export interface CurrentSite {
  kind: 'jobsite' | 'point';
  /** Set for a saved jobsite. */
  jobsite: Jobsite | null;
  label: string;
  location: LatLng;
  addressLine: string | null;
  receiving: Receiving;
  maxVehicleClass: VehicleClass | null;
}

interface Stored {
  jobsiteId: string | null;
  point: SitePoint | null;
}

interface SiteContextValue {
  /** Null until the customer picks a place (and while nothing is stored). */
  site: CurrentSite | null;
  /** False until the stored choice and, when signed in, the jobsites have loaded. */
  ready: boolean;
  chooseJobsite: (jobsiteId: string) => void;
  choosePoint: (point: SitePoint) => void;
  clear: () => void;
}

const SiteContext = createContext<SiteContextValue | null>(null);

function fromJobsite(jobsite: Jobsite): CurrentSite {
  return {
    kind: 'jobsite',
    jobsite,
    label: jobsite.label,
    location: jobsite.location,
    addressLine: jobsite.line1,
    receiving: jobsite.receiving,
    maxVehicleClass: jobsite.maxVehicleClass,
  };
}

function fromPoint(point: SitePoint): CurrentSite {
  return {
    kind: 'point',
    jobsite: null,
    label: point.label,
    location: point.location,
    addressLine: point.addressLine,
    receiving: 'attended',
    maxVehicleClass: null,
  };
}

/**
 * The current site: a saved jobsite, or for guests (and customers without one) a GPS, pin or search
 * location, stored on the device under `instasupply.site.v1`. A signed-in customer without a stored
 * choice gets their default jobsite.
 */
export function SiteProvider({ children }: { children: ReactNode }) {
  const uid = useUid();
  const jobsites = useJobsites(uid);
  const [stored, setStored] = useState<Stored>({ jobsiteId: null, point: null });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        const saved = JSON.parse(raw) as Partial<Stored>;
        setStored({ jobsiteId: saved.jobsiteId ?? null, point: saved.point ?? null });
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!loaded) return;
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stored)).catch(() => undefined);
  }, [stored, loaded]);

  const chooseJobsite = useCallback((jobsiteId: string) => setStored({ jobsiteId, point: null }), []);
  const choosePoint = useCallback((point: SitePoint) => setStored({ jobsiteId: null, point }), []);
  const clear = useCallback(() => setStored({ jobsiteId: null, point: null }), []);

  const value = useMemo<SiteContextValue>(() => {
    let site: CurrentSite | null = null;
    if (uid) {
      const chosen = stored.jobsiteId
        ? jobsites.data.find((item) => item.id === stored.jobsiteId)
        : undefined;
      if (chosen) site = fromJobsite(chosen);
      else if (stored.point) site = fromPoint(stored.point);
      else if (jobsites.defaultJobsite) site = fromJobsite(jobsites.defaultJobsite);
    } else if (stored.point) {
      site = fromPoint(stored.point);
    }
    return {
      site,
      ready: loaded && (!uid || !jobsites.loading),
      chooseJobsite,
      choosePoint,
      clear,
    };
  }, [
    uid,
    stored,
    jobsites.data,
    jobsites.defaultJobsite,
    jobsites.loading,
    loaded,
    chooseJobsite,
    choosePoint,
    clear,
  ]);

  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}

export function useSite(): SiteContextValue {
  const value = useContext(SiteContext);
  if (!value) throw new Error('useSite must be used inside <SiteProvider>.');
  return value;
}
