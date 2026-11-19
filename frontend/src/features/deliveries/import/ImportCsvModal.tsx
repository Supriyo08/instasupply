import { MAX_DELIVERIES_PER_IMPORT } from '@instasupply/shared';
import Papa from 'papaparse';
import { useRef, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Feedback';
import { DownloadIcon, InfoIcon, SpreadsheetIcon, UploadIcon, WarningIcon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { call, errorMessage } from '@/lib/firebase/callables';

import { downloadTemplate, mapRow, normalizeHeader, type ParsedRow } from './csv';

export function ImportCsvModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const validRows = rows.filter((row) => row.input);
  const invalidCount = rows.length - validRows.length;
  const geocodeCount = validRows.filter((row) => row.needsGeocoding).length;

  const reset = () => {
    setRows([]);
    setFileName(null);
    setParseError(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const close = () => {
    reset();
    onClose();
  };

  const onFile = (file: File) => {
    setFileName(file.name);
    setParseError(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: normalizeHeader,
      complete: (result) => {
        if (result.data.length === 0) {
          setParseError('The file has no rows.');
          setRows([]);
          return;
        }
        if (result.data.length > MAX_DELIVERIES_PER_IMPORT) {
          setParseError(
            `Import up to ${MAX_DELIVERIES_PER_IMPORT} rows at a time (this file has ${result.data.length}).`,
          );
          setRows([]);
          return;
        }
        setRows(result.data.map(mapRow));
      },
      error: (error) => setParseError(error.message),
    });
  };

  const runImport = async () => {
    if (validRows.length === 0) return;
    setImporting(true);
    try {
      const response = await call('createDeliveries', { deliveries: validRows.map((row) => row.input!) });
      // Map server-side errors (e.g. address not found) back onto the preview rows.
      const serverErrors = new Map(
        response.errors.map((error) => [validRows[error.index]!.rowNumber, error.message]),
      );
      const createdRows = new Set(response.created.map((item) => validRows[item.index]!.rowNumber));
      if (response.created.length) {
        toast.success(
          `Imported ${response.created.length} deliver${response.created.length === 1 ? 'y' : 'ies'}`,
          serverErrors.size ? `${serverErrors.size} row(s) need attention.` : undefined,
        );
      }
      if (serverErrors.size === 0) {
        close();
        return;
      }
      setRows((current) =>
        current
          .filter((row) => !createdRows.has(row.rowNumber))
          .map((row) =>
            serverErrors.has(row.rowNumber)
              ? { ...row, input: null, error: serverErrors.get(row.rowNumber)! }
              : row,
          ),
      );
    } catch (error) {
      toast.error('Import failed', errorMessage(error));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size="xl"
      title="Import deliveries from CSV"
      description="Upload a spreadsheet export. Rows are validated before anything is created."
      footer={
        <>
          <Button variant="ghost" icon={DownloadIcon} onClick={downloadTemplate} className="mr-auto">
            Download template
          </Button>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button
            icon={UploadIcon}
            loading={importing}
            disabled={validRows.length === 0}
            onClick={() => void runImport()}
          >
            Import {validRows.length ? validRows.length : ''} row{validRows.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center transition-colors hover:border-brand-400 hover:bg-brand-50/40">
          <SpreadsheetIcon size={26} className="text-brand-500" aria-hidden />
          <span className="text-sm font-medium text-slate-800">{fileName ?? 'Choose a .csv file'}</span>
          <span className="text-xs text-slate-500">
            Columns: customerName, customerPhone, address, lat, lng, priority, codAmount, requireCode…
          </span>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
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

        {rows.length > 0 ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="success">{validRows.length} ready</Badge>
              {invalidCount ? <Badge tone="danger">{invalidCount} with errors</Badge> : null}
              {geocodeCount ? <Badge tone="info">{geocodeCount} will be geocoded</Badge> : null}
            </div>
            {geocodeCount ? (
              <Callout tone="info" icon={InfoIcon}>
                Rows without lat/lng are located from the address on the server. Check their pins afterwards.
              </Callout>
            ) : null}
            <div className="max-h-80 overflow-auto rounded-xl ring-1 ring-slate-200">
              <table className="min-w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Row</th>
                    <th className="px-3 py-2 font-medium">Customer</th>
                    <th className="px-3 py-2 font-medium">Address</th>
                    <th className="px-3 py-2 font-medium">Priority</th>
                    <th className="px-3 py-2 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <tr key={row.rowNumber} className={row.error ? 'bg-rose-50/50' : undefined}>
                      <td className="px-3 py-2 text-slate-400 tabular-nums">{row.rowNumber}</td>
                      <td className="px-3 py-2 font-medium text-slate-800">{row.raw.customerName || '—'}</td>
                      <td className="max-w-64 truncate px-3 py-2 text-slate-600">{row.raw.address || '—'}</td>
                      <td className="px-3 py-2 text-slate-600 capitalize">
                        {row.input?.priority ?? row.raw.priority ?? '—'}
                      </td>
                      <td className="px-3 py-2">
                        {row.error ? (
                          <span className="font-medium text-rose-600">{row.error}</span>
                        ) : row.needsGeocoding ? (
                          <span className="text-sky-700">Ready · will geocode</span>
                        ) : (
                          <span className="text-emerald-700">Ready</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={reset}
              className="text-xs font-medium text-slate-500 hover:text-slate-800"
            >
              Choose a different file
            </button>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
