import type { StoreOrder } from '@instasupply/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { useToast } from '@/components/ui/Toast';
import { claimNotificationAlerts, freshIds } from '@/features/notifications/alert-state';

import { customerLabel } from './order-format';

/** While anything is New, the board chimes again every 30 s (MARKETPLACE §8). */
const CHIME_EVERY_MS = 30_000;

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & { webkitAudioContext?: AudioContextCtor };
  return window.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Two short rising tones: loud enough for a yard counter, short enough not to annoy. */
function playChime(context: AudioContext): void {
  const start = context.currentTime + 0.02;
  [880, 1320].forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    const at = start + index * 0.22;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.35, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.22);
  });
}

const desktopSupported = typeof window !== 'undefined' && 'Notification' in window;

/**
 * The board's new-order alert (MARKETPLACE §8, CLIENTS §4.4): when a `new` store order appears that was
 * not in the previous result, a chime, a toast and (while the tab is hidden and the user allowed it) a
 * desktop notification; the chime repeats every 30 s while anything is New, and the tab title reads
 * "(2) New". The first successful answer only fills the "seen" set, so opening the page does not announce
 * old orders (an initial error is not an answer: its empty list would make every waiting order "new").
 * While mounted it claims `store_order_new`, so the portal's notification toast does not repeat it.
 *
 * Browsers block sound until the user interacts with the page, so `soundReady` stays false (the board
 * shows "Turn on order sound") until the first click anywhere or a click on that button.
 */
export function useNewOrderAlerts(newOrders: readonly StoreOrder[], loading: boolean, error: unknown = null) {
  const toast = useToast();
  const navigate = useNavigate();
  const seen = useRef<Set<string> | null>(null);
  const context = useRef<AudioContext | null>(null);
  const [soundReady, setSoundReady] = useState(false);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const unlock = useCallback(() => {
    const Ctor = audioContextCtor();
    if (!Ctor) return;
    const audio = (context.current ??= new Ctor());
    void audio
      .resume()
      .then(() => setSoundReady(audio.state === 'running'))
      .catch(() => setSoundReady(false));
  }, []);

  const chime = useCallback(() => {
    const audio = context.current;
    if (!audio || audio.state !== 'running' || mutedRef.current) return;
    playChime(audio);
  }, []);

  // The first click or key press anywhere on the page unlocks the sound.
  useEffect(() => {
    if (soundReady) return;
    const onGesture = () => unlock();
    window.addEventListener('pointerdown', onGesture, { once: true });
    window.addEventListener('keydown', onGesture, { once: true });
    return () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };
  }, [soundReady, unlock]);

  useEffect(
    () => () => {
      void context.current?.close().catch(() => undefined);
      context.current = null;
    },
    [],
  );

  // This board announces new store orders itself.
  useEffect(() => claimNotificationAlerts('store_order_new'), []);

  // Announce ids that were not in the previous result.
  useEffect(() => {
    if (loading || error) return;
    const next = freshIds(
      seen.current,
      newOrders.map((order) => order.id),
    );
    seen.current = next.known;
    const freshSet = new Set(next.fresh);
    const fresh = newOrders.filter((order) => freshSet.has(order.id));
    if (fresh.length === 0) return;
    chime();
    for (const order of fresh.slice(0, 3)) {
      const title = `New order ${order.number}`;
      const body = `${order.itemsSummary} · ${customerLabel(order)}`;
      const href = `/portal/orders/${encodeURIComponent(order.id)}`;
      toast.show({
        tone: 'info',
        title,
        description: body,
        action: { label: 'Open', onClick: () => navigate(href) },
      });
      if (
        desktopSupported &&
        Notification.permission === 'granted' &&
        document.visibilityState === 'hidden'
      ) {
        const desktop = new Notification(title, {
          body,
          tag: `store-order-${order.id}`,
          icon: '/favicon.svg',
        });
        desktop.onclick = () => {
          window.focus();
          navigate(href);
          desktop.close();
        };
      }
    }
  }, [chime, error, loading, navigate, newOrders, toast]);

  // Repeat the chime while anything is waiting.
  const waiting = newOrders.length;
  useEffect(() => {
    if (waiting === 0) return;
    const timer = window.setInterval(chime, CHIME_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [chime, waiting]);

  // "(2) New · InstaSupply portal" in the tab title.
  useEffect(() => {
    if (waiting === 0) return;
    const base = document.title.replace(/^\(\d+\) New · /, '');
    document.title = `(${waiting}) New · ${base}`;
    return () => {
      document.title = document.title.replace(/^\(\d+\) New · /, '');
    };
  }, [waiting]);

  return { soundReady, unlock, muted, setMuted, chime };
}
