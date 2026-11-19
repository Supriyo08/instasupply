import type { DeliveryStatus, LatLng } from '@instasupply/shared';
import type { ViewStyle } from 'react-native';

export interface MapStop {
  id: string;
  location: LatLng;
  /** Short marker label, e.g. the stop number. */
  label: string;
  title: string;
  subtitle?: string;
  status: DeliveryStatus;
  highlighted?: boolean;
}

export interface RouteMapProps {
  driver: (LatLng & { heading?: number | null }) | null;
  stops: MapStop[];
  path: LatLng[];
  onStopPress?: (id: string) => void;
  style?: ViewStyle;
  /** Disable gestures for small previews. */
  interactive?: boolean;
}

export const DEFAULT_CENTER: LatLng = { lat: 12.9716, lng: 77.5946 };
