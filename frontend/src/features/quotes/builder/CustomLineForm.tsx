/**
 * A special-order line that is not in the catalogue (D16: an LVL beam the store orders in). It carries
 * its own price, weight and size so the load and the vehicle class are right. The store confirms it
 * offline; it reserves no stock.
 */
import { SELL_UNITS, type SellUnit } from '@instasupply/shared';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Field, Select, TextInput } from '@/components/ui/Form';
import { StoreSelect } from '@/features/stores/components/StoreSelect';

import { newLineKey, type CustomDraftLine } from './draft';

const num = (value: string) => Number(value.replace(',', '.'));

export function CustomLineForm({
  requestLine,
  initialName,
  initialQuantity,
  onAdd,
  onCancel,
}: {
  requestLine: number | null;
  initialName: string;
  initialQuantity: number;
  onAdd: (line: CustomDraftLine) => void;
  onCancel: () => void;
}) {
  const [storeId, setStoreId] = useState('');
  const [name, setName] = useState(initialName);
  const [unit, setUnit] = useState<SellUnit>('each');
  const [size, setSize] = useState('');
  const [quantity, setQuantity] = useState(String(initialQuantity));
  const [price, setPrice] = useState('');
  const [weight, setWeight] = useState('');
  const [dims, setDims] = useState({ l: '', w: '', h: '' });

  const priceCents = Math.round(num(price) * 100);
  const qty = Math.floor(num(quantity));
  const weightKg = num(weight);
  const dimsCm = { l: num(dims.l), w: num(dims.w), h: num(dims.h) };
  const problems = [
    !storeId && 'Choose the store that supplies it.',
    name.trim().length < 2 && 'Name the item.',
    !(qty >= 1 && qty <= 9999) && 'Quantity is 1 to 9,999.',
    !(priceCents >= 1 && priceCents <= 10_000_000) && 'Enter the unit price the store quoted.',
    !(weightKg > 0 && weightKg <= 5000) && 'Enter the weight of one unit in kg.',
    !(dimsCm.l > 0 && dimsCm.w > 0 && dimsCm.h > 0) && 'Enter the size of one unit in cm.',
  ].filter((problem): problem is string => typeof problem === 'string');

  return (
    <Card>
      <CardHeader
        title="Special-order line"
        description={
          requestLine === null ? 'Not in the catalogue.' : `Answers request line ${requestLine + 1}.`
        }
      />
      <CardBody className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Store" required>
            {(id) => (
              <StoreSelect id={id} value={storeId} onChange={setStoreId} liveOnly allLabel="Choose a store" />
            )}
          </Field>
          <Field label="Item" required>
            {(id) => (
              <TextInput
                id={id}
                value={name}
                placeholder="LVL beam 1-3/4 × 11-7/8 in"
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>
          <Field label="Unit">
            {(id) => (
              <Select id={id} value={unit} onChange={(event) => setUnit(event.target.value as SellUnit)}>
                {SELL_UNITS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Size (optional)">
            {(id) => (
              <TextInput
                id={id}
                value={size}
                placeholder="16 ft"
                onChange={(event) => setSize(event.target.value)}
              />
            )}
          </Field>
          <Field label="Quantity" required>
            {(id) => (
              <TextInput
                id={id}
                type="number"
                min={1}
                max={9999}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            )}
          </Field>
          <Field label="Unit price ($)" required hint="The price the store agreed to.">
            {(id, describedBy) => (
              <TextInput
                id={id}
                inputMode="decimal"
                aria-describedby={describedBy}
                value={price}
                placeholder="189.00"
                onChange={(event) => setPrice(event.target.value)}
              />
            )}
          </Field>
          <Field label="Weight per unit (kg)" required>
            {(id) => (
              <TextInput
                id={id}
                inputMode="decimal"
                value={weight}
                onChange={(event) => setWeight(event.target.value)}
              />
            )}
          </Field>
          <fieldset>
            <legend className="text-sm font-medium text-slate-700">
              Size per unit (cm) <span className="text-rose-500">*</span>
            </legend>
            <div className="mt-1.5 flex gap-2">
              {(['l', 'w', 'h'] as const).map((side) => (
                <TextInput
                  key={side}
                  inputMode="decimal"
                  aria-label={{ l: 'Length in cm', w: 'Width in cm', h: 'Height in cm' }[side]}
                  placeholder={side.toUpperCase()}
                  value={dims[side]}
                  onChange={(event) => setDims((current) => ({ ...current, [side]: event.target.value }))}
                />
              ))}
            </div>
          </fieldset>
        </div>
        {problems.length > 0 && (name || price || weight) ? (
          <ul className="list-disc pl-5 text-xs text-slate-500">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={problems.length > 0}
            onClick={() =>
              onAdd({
                kind: 'custom',
                key: newLineKey(),
                requestLine,
                storeId,
                name: name.trim(),
                unit,
                size: size.trim() || null,
                quantity: qty,
                unitPriceCents: priceCents,
                weightKg: Math.round(weightKg * 1000) / 1000,
                dimsCm: {
                  l: Math.round(dimsCm.l * 10) / 10,
                  w: Math.round(dimsCm.w * 10) / 10,
                  h: Math.round(dimsCm.h * 10) / 10,
                },
                note: '',
              })
            }
          >
            Add line
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
