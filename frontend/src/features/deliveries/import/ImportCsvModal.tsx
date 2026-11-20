import { formatPhone, MAX_DELIVERIES_PER_IMPORT } from '@instasupply/shared';
import Papa from 'papaparse';
import { useRef, useState } from 'react';
import { Link } from 'react-router';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Feedback';
import {
  DownloadIcon,
  ErrorIcon,
  InfoIcon,
  SpreadsheetIcon,
  SuccessIcon,
  UploadIcon,
  WarningIcon,
} from '@/components/ui/icons';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { ApiError, call, errorMessage, isNetworkError } from '@/lib/api';

import {
  COLUMN_LABEL,
  downloadTemplate,
  mapHeaders,
  mapRow,
  projectRow,
  type HeaderReport,
  type ParsedRow,
} from './csv';

/**
 * Rows are sent in small chunks, one call at a time, so no request runs long enough to time out while
 * the server keeps working (R44, R49 to R51). Each chunk is one server transaction: a refusal means
 * nothing of it was created.
 */
const CHUNK_SIZE = 20;
const CHUNK_TIMEOUT_MS = 120_000;

type RowState = ParsedRow & { createdOrderId?: string };

/** An answer that does not tell whether the server created the rows: a dropped connection or a timeout. */
function isUncertain(error: unknown): boolean {
  if (isNetworkError(error)) return true;
  if (!(error instanceof ApiError)) return true;
  return ['deadline-exceeded', 'unavailable', 'cancelled', 'internal'].includes(error.status);
}

export function ImportCsvModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<RowState[]>([]);
  const [headers, setHeaders] = useState<HeaderReport | null>(null);
  const [ignoredConfirmed, setIgnoredConfirmed] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  /** Set after an answer that leaves it unknown whether rows were created: Import stays off for this file. */
  const [uncertain, setUncertain] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const pending = rows.filter((row) => row.input && !row.createdOrderId);
  const created = rows.filter((row) => row.createdOrderId);
  const invalidCount = rows.filter((row) => !row.input && !row.createdOrderId).length;
  const geocodeCount = pending.filter((row) => row.needsGeocoding).length;
  const needsConfirm = !!headers && headers.ignored.length > 0 && !ignoredConfirmed;

  const reset = (keepUncertain = false) => {
    setRows([]);
    setHeaders(null);
    setIgnoredConfirmed(false);
    setFileName(null);
    setParseError(null);
    if (!keepUncertain) setUncertain(null);
    setFailure(null);
    setProgress(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const close = () => {
    if (importing) return;
    reset();
    onClose();
  };

  const onFile = (file: File) => {
    // After an uncertain answer, Import stays off until the dialog is closed and the list checked (R44).
    reset(true);
    setFileName(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: (result) => {
        if (result.data.length === 0) {
          setParseError('The file has no rows.');
          return;
        }
        if (result.data.length > MAX_DELIVERIES_PER_IMPORT) {
          setParseError(
            `Import up to ${MAX_DELIVERIES_PER_IMPORT} rows at a time (this file has ${result.data.length}).`,
          );
          return;
        }
        const report = mapHeaders(result.meta.fields ?? []);
        if (!report.sourceOf.customerName || !report.sourceOf.address) {
          setParseError(
            'The file needs at least a site contact column and an address column. Download the template to see the headers.',
          );
          return;
        }
        setHeaders(report);
        setRows(result.data.map((record, index) => mapRow(projectRow(record, report.sourceOf), index)));
      },
      error: (error) => setParseError(error.message),
    });
  };

  const runImport = async () => {
    if (pending.length === 0 || importing || uncertain || needsConfirm) return;
    setImporting(true);
    setFailure(null);
    const queue = pending.slice();
    setProgress({ done: 0, total: queue.length });
    let createdCount = 0;
    let rejectedCount = 0;
    for (let start = 0; start < queue.length; start += CHUNK_SIZE) {
      const chunk = queue.slice(start, start + CHUNK_SIZE);
      try {
        const response = await call(
          'createDeliveries',
          { deliveries: chunk.map((row) => row.input!) },
          { timeoutMs: CHUNK_TIMEOUT_MS },
        );
        const createdByRow = new Map(
          response.created.map((item) => [chunk[item.index]!.rowNumber, item.orderId]),
        );
        const errorByRow = new Map(
          response.errors.map((item) => [chunk[item.index]!.rowNumber, item.message]),
        );
        createdCount += createdByRow.size;
        rejectedCount += errorByRow.size;
        setRows((current) =>
          current.map((row) =>
            createdByRow.has(row.rowNumber)
              ? { ...row, createdOrderId: createdByRow.get(row.rowNumber)! }
              : errorByRow.has(row.rowNumber)
                ? { ...row, input: null, error: errorByRow.get(row.rowNumber)! }
                : row,
          ),
        );
        setProgress({ done: Math.min(start + chunk.length, queue.length), total: queue.length });
      } catch (caught) {
        if (isUncertain(caught)) {
          setUncertain(
            `The server did not answer for rows ${chunk[0]!.rowNumber}–${chunk[chunk.length - 1]!.rowNumber} (${errorMessage(caught)}). They may still be created.`,
          );
        } else {
          setFailure(errorMessage(caught));
        }
        break;
      }
    }
    setImporting(false);
    if (createdCount > 0) {
      toast.success(
        `Imported ${createdCount} deliver${createdCount === 1 ? 'y' : 'ies'}`,
        rejectedCount ? `${rejectedCount} row(s) need attention.` : undefined,
      );
    }
  };

  const allDone = rows.length > 0 && pending.length === 0 && invalidCount === 0 && created.length > 0;

  return (
    <Modal
      open={open}
      onClose={close}
      size="xl"
      dismissOnBackdrop={false}
      title="Import deliveries from CSV"
      description="Upload a spreadsheet export of manual deliveries. Rows are checked before anything is created."
      footer={
        <>
          <Button variant="ghost" icon={DownloadIcon} onClick={downloadTemplate} className="mr-auto">
            Download template
          </Button>
          <Button variant="secondary" onClick={close} disabled={importing}>
            {created.length || uncertain ? 'Close' : 'Cancel'}
          </Button>
          {!allDone ? (
            <Button
              icon={UploadIcon}
              loading={importing}
              disabled={pending.length === 0 || !!uncertain || needsConfirm}
              onClick={() => void runImport()}
            >
              {importing && progress
                ? `Importing ${progress.done} of ${progress.total}`
                : `Import ${pending.length || ''} row${pending.length === 1 ? '' : 's'}`}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-4">
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center transition-colors hover:border-brand-400 hover:bg-brand-50/40">
          <SpreadsheetIcon size={26} className="text-brand-500" aria-hidden />
          <span className="text-sm font-medium text-slate-800">{fileName ?? 'Choose a .csv file'}</span>
          <span className="text-xs text-slate-500">
            Columns: customerName, customerPhone, address, lat, lng, packageCount, priority, requireCode,
            windowStart, windowEnd…
          </span>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            disabled={importing}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onFile(file);
            }}
          />
        </label>

        {parseError ? (
          <Callout tone="warning" icon={WarningIcon}>
            {parseError}
          </Callout>
        ) : null}

        {uncertain ? (
          <Callout tone="warning" icon={WarningIcon} title="The import may still be running">
            <p>
              {uncertain} Do not import this file again: check the list first, then import only the rows that
              are missing.
            </p>
            <Link
              to="/deliveries?tab=unassigned"
              onClick={close}
              className="mt-1 inline-block font-semibold text-amber-900 underline"
            >
              Open unassigned deliveries
            </Link>
          </Callout>
        ) : null}

        {failure ? (
          <Callout tone="danger" icon={ErrorIcon} title="The server refused the next rows">
            {failure} Nothing from those rows was created; fix the file or try again.
          </Callout>
        ) : null}

        {headers && (headers.ignored.length > 0 || headers.duplicates.length > 0) ? (
          <Callout tone="warning" icon={WarningIcon} title="Some columns will not be imported">
            <ul className="list-disc space-y-0.5 pl-4">
              {headers.ignored.map((item) => (
                <li key={item.header}>
                  <span className="font-medium">“{item.header}”</span>: {item.reason}
                </li>
              ))}
            </ul>
            <label className="mt-2 flex items-center gap-2 font-medium">
              <input
                type="checkbox"
                checked={ignoredConfirmed}
                onChange={(event) => setIgnoredConfirmed(event.target.checked)}
                className="size-4 rounded border-amber-400"
              />
              Import without these columns
            </label>
          </Callout>
        ) : null}

        {headers ? (
          <p className="text-xs text-slate-500">
            Using:{' '}
            {headers.mapped.map((item, index) => (
              <span key={item.column}>
                {index ? ', ' : ''}“{item.header}” → {COLUMN_LABEL[item.column]}
              </span>
            ))}
          </p>
        ) : null}

        {rows.length > 0 ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm" aria-live="polite">
              {created.length ? <Badge tone="success">{created.length} created</Badge> : null}
              <Badge tone="brand">{pending.length} ready</Badge>
              {invalidCount ? <Badge tone="danger">{invalidCount} with errors</Badge> : null}
              {geocodeCount ? <Badge tone="info">{geocodeCount} will be geocoded</Badge> : null}
            </div>
            {geocodeCount ? (
              <Callout tone="info" icon={InfoIcon}>
                Rows without latitude and longitude are located from the address on the server. Add
                coordinates where you can, and check those pins on the delivery page afterwards.
              </Callout>
            ) : null}
            {allDone ? (
              <Callout tone="success" icon={SuccessIcon}>
                Every row was imported. The new deliveries are in the unassigned queue.
              </Callout>
            ) : null}
            <div className="max-h-80 overflow-auto rounded-xl ring-1 ring-slate-200">
              <table className="min-w-full text-left text-xs">
                <caption className="sr-only">Rows in the file and what happens to each</caption>
                <thead className="sticky top-0 bg-slate-50 text-slate-500">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Row
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Site contact
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Phone
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Address
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Priority
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Result
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <tr key={row.rowNumber} className={row.error ? 'bg-rose-50/50' : undefined}>
                      <td className="px-3 py-2 text-slate-400 tabular-nums">{row.rowNumber}</td>
                      <td className="px-3 py-2 font-medium text-slate-800">{row.raw.customerName || '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                        {row.input?.customerPhone
                          ? formatPhone(row.input.customerPhone)
                          : row.raw.customerPhone || '—'}
                      </td>
                      <td className="max-w-64 truncate px-3 py-2 text-slate-600">{row.raw.address || '—'}</td>
                      <td className="px-3 py-2 text-slate-600 capitalize">
                        {row.input?.priority ?? row.raw.priority ?? '—'}
                      </td>
                      <td className="px-3 py-2">
                        {row.createdOrderId ? (
                          <span className="font-medium text-emerald-700">Created {row.createdOrderId}</span>
                        ) : row.error ? (
                          <span className="font-medium text-rose-600">{row.error}</span>
                        ) : row.needsGeocoding ? (
                          <span className="text-sky-700">Ready · will geocode</span>
                        ) : (
                          <span className="text-slate-700">Ready</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!importing ? (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="text-xs font-medium text-slate-500 hover:text-slate-800"
              >
                Choose a different file
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </Modal>
  );
}
