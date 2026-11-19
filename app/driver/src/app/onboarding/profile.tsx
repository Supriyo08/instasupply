import { useState } from 'react';

import { Banner, Button, Input, Screen } from '@/components/ui';
import { completeProfile, rememberedSignUpName, signOut } from '@/features/auth/auth-service';
import { useSession } from '@/features/auth/SessionProvider';
import { StepHeader } from '@/features/auth/StepHeader';
import { VehicleFields, type VehicleValue } from '@/features/auth/VehicleFields';
import { describeError } from '@/lib/errors';

export default function ProfileStep() {
  const { user } = useSession();
  const [name, setName] = useState(user?.displayName || rememberedSignUpName() || '');
  const [vehicle, setVehicle] = useState<VehicleValue>({ type: 'scooter', plate: '', model: '' });
  const [errors, setErrors] = useState<Partial<Record<'name' | 'plate', string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const next: typeof errors = {};
    if (name.trim().length < 2) next.name = 'Enter your full name.';
    if (vehicle.plate.trim().length < 4) next.plate = 'Enter your vehicle registration number.';
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    setError(null);
    try {
      await completeProfile({
        displayName: name.trim(),
        vehicleType: vehicle.type,
        vehiclePlate: vehicle.plate.trim(),
        vehicleModel: vehicle.model.trim() || null,
      });
      // The session moves on to phone verification once the profile exists.
    } catch (cause) {
      setError(describeError(cause));
      setBusy(false);
    }
  };

  return (
    <Screen keyboard>
      <StepHeader
        step={2}
        total={4}
        title="Your vehicle"
        subtitle="Dispatch uses this to plan your routes and to tell customers who is coming."
      />
      {error ? <Banner tone="danger" message={error} /> : null}
      <Input
        label="Full name"
        icon="person-outline"
        value={name}
        onChangeText={setName}
        error={errors.name}
      />
      <VehicleFields value={vehicle} onChange={setVehicle} errors={{ plate: errors.plate }} />
      <Button label="Continue" size="lg" loading={busy} onPress={submit} />
      <Button label="Use a different account" variant="ghost" onPress={() => void signOut()} />
    </Screen>
  );
}
