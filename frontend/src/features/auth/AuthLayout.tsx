import type { ReactNode } from 'react';

import { LiveIcon, ShieldIcon, StoreIcon } from '@/components/ui/icons';

import { BrandMark } from './BrandMark';

const HIGHLIGHTS = [
  { icon: StoreIcon, title: 'Supplier portal', text: 'Accept, prepare and hand over store orders on time.' },
  {
    icon: LiveIcon,
    title: 'Live dispatch',
    text: 'Jobs, drivers and deliveries across the GTA in one view.',
  },
  {
    icon: ShieldIcon,
    title: 'Proof at every step',
    text: 'Pickup PINs, hand-off codes and delivery photos.',
  },
];

/** The split frame of the sign-in, set-password and reset-password pages. */
export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-brand-950 p-12 text-white lg:flex lg:flex-col">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(99,102,241,0.45),transparent_55%),radial-gradient(circle_at_80%_70%,rgba(16,185,129,0.25),transparent_50%)]" />
        <div className="relative flex items-center gap-3">
          <BrandMark className="size-10" />
          <span className="text-lg font-semibold tracking-tight">InstaSupply Console</span>
        </div>
        <div className="relative mt-auto max-w-md">
          <h1 className="text-4xl leading-tight font-semibold tracking-tight">
            Building supplies to the jobsite, the same day.
          </h1>
          <ul className="mt-10 space-y-5">
            {HIGHLIGHTS.map(({ icon: Icon, title: heading, text }) => (
              <li key={heading} className="flex gap-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/10 ring-1 ring-white/15">
                  <Icon size={18} aria-hidden />
                </span>
                <span>
                  <span className="block font-medium">{heading}</span>
                  <span className="text-sm text-brand-200">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <main className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <BrandMark className="size-9" />
            <span className="text-lg font-semibold tracking-tight">InstaSupply Console</span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
          {children}
        </div>
      </main>
    </div>
  );
}
