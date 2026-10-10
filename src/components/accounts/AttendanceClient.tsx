"use client";
import { useMemo, useState } from "react";
import { Button, Card, CardHeader, ConfirmButton, EmptyState, Input, Select, Table } from "@/components/ui";
import { firstError, postJson, useApi } from "@/lib/useApi";
import { currentMonthKey, monthLabel } from "@/lib/accounts/period";
import { inr, todayIST } from "@/lib/accounts/format";
import { ATTENDANCE_STATUSES, SHIFTS, attendanceBatchSchema, type AttendanceStatus } from "@/lib/validation/accounts";
import { MonthPicker } from "./MonthPicker";
import { ErrorNote, Loading, PageTitle } from "./Stat";
import { roleLabel } from "./WorkersClient";

interface Worker {
  id: string;
  name: string;
  role: string;
  archivedAt: string | null;
}
interface Machine {
  id: string;
  name: string;
  type: string;
  status: string;
}
interface Mark {
  workerId: string;
  status: AttendanceStatus;
  machineId: string | null;
}

const STATUS_LABEL: Record<AttendanceStatus, string> = { present: "Present", half_day: "Half day", absent: "Absent" };
const STATUS_TONE: Record<AttendanceStatus, string> = {
  present: "border-green-300 bg-green-100 text-green-800",
  half_day: "border-amber-300 bg-amber-100 text-amber-800",
  absent: "border-red-300 bg-red-100 text-red-800",
};
const MACHINE_FOR_ROLE: Record<string, string> = { spinner: "spinning", weaver: "loom", dyer: "dyeing" };

export function AttendanceClient() {
  return (
    <div className="flex flex-col gap-6">
      <PageTitle title="Attendance" subtitle="Mark the muster for a shift. Operators marked on a machine have their wage charged to the orders that machine produced that day." />
      <MusterSheet />
      <MonthlyRegister />
    </div>
  );
}

function MusterSheet() {
  const [date, setDate] = useState(todayIST());
  const [shift, setShift] = useState<string>(SHIFTS[0]);
  const workers = useApi<{ workers: Worker[] }>("/api/workers");
  const sheet = useApi<{ marks: (Mark & { id: string })[]; machines: Machine[]; locked: boolean }>(
    `/api/attendance?date=${date}&shift=${encodeURIComponent(shift)}`,
  );
  // Local edits on top of what's saved, keyed by sheet so switching date/shift starts clean.
  const [edits, setEdits] = useState<{ key: string; marks: Record<string, Mark | null> }>({ key: "", marks: {} });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const sheetKey = `${date}|${shift}`;
  const localEdits = edits.key === sheetKey ? edits.marks : {};

  const saved = useMemo(() => {
    const m: Record<string, Mark & { id: string }> = {};
    for (const a of sheet.data?.marks ?? []) m[a.workerId] = { id: a.id, workerId: a.workerId, status: a.status, machineId: a.machineId };
    return m;
  }, [sheet.data]);

  const current = (id: string): Mark | null => (id in localEdits ? localEdits[id] : saved[id] ?? null);
  const setMark = (id: string, mark: Mark | null) => {
    setFlash(null);
    setEdits((e) => ({ key: sheetKey, marks: { ...(e.key === sheetKey ? e.marks : {}), [id]: mark } }));
  };
  const machines = sheet.data?.machines ?? [];
  // Archived workers are off the muster, except where this sheet already
  // marked them (that mark can still be corrected or removed).
  const list = (workers.data?.workers ?? []).filter((w) => !w.archivedAt || saved[w.id]);
  const locked = sheet.data?.locked ?? false;
  const dirty = Object.keys(localEdits).length > 0;

  async function removeMark(workerId: string) {
    const mark = saved[workerId];
    if (!mark) return null;
    const res = await postJson(`/api/attendance/${mark.id}`, undefined, "DELETE");
    if (!res.ok) return firstError(res, "Couldn't remove the mark");
    setEdits((e) => {
      const marks = { ...(e.key === sheetKey ? e.marks : {}) };
      delete marks[workerId];
      return { key: sheetKey, marks };
    });
    sheet.refetch();
    return null;
  }

  function markAllPresent() {
    const next: Record<string, Mark | null> = { ...localEdits };
    for (const w of list) {
      if (!current(w.id)) next[w.id] = { workerId: w.id, status: "present", machineId: null };
    }
    setEdits({ key: sheetKey, marks: next });
  }

  async function save() {
    const entries = list.map((w) => current(w.id)).filter((m): m is Mark => !!m);
    const payload = { date, shift, entries };
    const parsed = attendanceBatchSchema.safeParse(payload);
    if (!parsed.success) {
      const out: Record<string, string[]> = {};
      for (const i of parsed.error.issues) (out[i.path.join(".") || "_form"] ??= []).push(i.message);
      setErrors(out);
      return;
    }
    setSaving(true);
    const res = await postJson<{ created: number; updated: number; unchanged: number }>("/api/attendance", payload);
    setSaving(false);
    if (!res.ok) {
      setErrors(res.fieldErrors ?? { _form: ["Couldn't save attendance"] });
      return;
    }
    setErrors({});
    setEdits({ key: sheetKey, marks: {} });
    setFlash(`Saved: ${res.data.created} new, ${res.data.updated} updated, ${res.data.unchanged} unchanged.`);
    sheet.refetch();
  }

  // Map server/zod errors on entries.N.* back to worker rows.
  const entryIndex = new Map(
    list
      .map((w) => current(w.id))
      .filter((m): m is Mark => !!m)
      .map((m, i) => [m.workerId, i]),
  );
  const rowError = (workerId: string) => {
    const i = entryIndex.get(workerId);
    if (i === undefined) return undefined;
    return errors[`entries.${i}.machineId`]?.[0] ?? errors[`entries.${i}.workerId`]?.[0] ?? errors[`entries.${i}.status`]?.[0];
  };

  return (
    <Card>
      <CardHeader title="Muster sheet" />
      <div className="mb-3 grid gap-3 sm:grid-cols-[auto_auto_1fr] sm:items-end">
        <Input label="Date" type="date" max={todayIST()} value={date} onChange={(e) => setDate(e.target.value)} error={errors.date?.[0]} />
        <Select label="Shift" value={shift} onChange={(e) => setShift(e.target.value)} options={SHIFTS.map((s) => ({ value: s, label: s }))} error={errors.shift?.[0]} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={markAllPresent} disabled={!list.length || locked}>
            Mark unmarked present
          </Button>
          <Button type="button" onClick={save} disabled={saving || !dirty || locked}>
            {saving ? "Saving…" : "Save sheet"}
          </Button>
        </div>
      </div>
      {flash && <p role="status" className="mb-2 text-sm text-green-700">{flash}</p>}
      {locked && (
        <p role="status" className="mb-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Wages for {monthLabel(date.slice(0, 7))} have been paid out, so this month&apos;s attendance is locked.
        </p>
      )}
      {(errors._form || errors.entries) && <p className="mb-2 text-sm text-red-600">{(errors._form ?? errors.entries)[0]}</p>}
      {(workers.error || sheet.error) && <ErrorNote message={`Couldn't load the sheet: ${workers.error ?? sheet.error}`} onRetry={() => { workers.refetch(); sheet.refetch(); }} />}
      {(workers.loading || sheet.loading) && !(workers.data && sheet.data) && <Loading />}
      {workers.data && sheet.data && (
        list.length === 0 ? (
          <EmptyState title="No workers yet" description="Add workers under the Workers tab first." />
        ) : (
          <div className="divide-y divide-border rounded-md border border-border">
            {list.map((w) => {
              const mark = current(w.id);
              const suggested = machines.filter((m) => m.type === MACHINE_FOR_ROLE[w.role]);
              const others = machines.filter((m) => m.type !== MACHINE_FOR_ROLE[w.role]);
              const err = rowError(w.id);
              return (
                <div key={w.id} className="flex flex-col gap-2 p-3 md:flex-row md:items-center">
                  <div className="md:w-48">
                    <p className="text-sm font-medium text-foreground">{w.name}{w.archivedAt ? " (archived)" : ""}</p>
                    <p className="text-xs text-gray-500">{roleLabel(w.role)}{w.id in localEdits ? " · edited" : saved[w.id] ? " · saved" : ""}</p>
                  </div>
                  <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={`${w.name} attendance`}>
                    {ATTENDANCE_STATUSES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        role="radio"
                        aria-checked={mark?.status === s}
                        disabled={locked}
                        onClick={() => setMark(w.id, { workerId: w.id, status: s, machineId: s === "absent" ? null : mark?.machineId ?? null })}
                        className={`rounded-full border px-3 py-1 text-xs font-medium ${
                          mark?.status === s ? STATUS_TONE[s] : "border-border bg-white text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        {STATUS_LABEL[s]}
                      </button>
                    ))}
                    {mark && !saved[w.id] && (
                      <button type="button" className="px-2 text-xs text-gray-500 underline" onClick={() => setMark(w.id, null)}>
                        clear
                      </button>
                    )}
                    {saved[w.id] && !locked && <ConfirmButton label="Remove mark" confirmLabel="Remove" onConfirm={() => removeMark(w.id)} />}
                  </div>
                  <div className="md:ml-auto md:w-64">
                    <select
                      aria-label={`${w.name} machine`}
                      className={`w-full rounded-md border bg-white px-3 py-1.5 text-sm ${err ? "border-red-400" : "border-border"}`}
                      disabled={!mark || mark.status === "absent" || locked}
                      value={mark?.machineId ?? ""}
                      onChange={(e) => mark && setMark(w.id, { ...mark, machineId: e.target.value || null })}
                    >
                      <option value="">No machine (indirect)</option>
                      {suggested.length > 0 && (
                        <optgroup label="Their machine type">
                          {suggested.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name} · {m.status.toLowerCase()}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {others.length > 0 && (
                        <optgroup label="Other machines">
                          {others.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name} · {m.status.toLowerCase()}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}
      {machines.length === 0 && sheet.data && (
        <p className="mt-2 text-xs text-gray-500">No machines exist yet, so every mark counts as indirect labour until production adds machines.</p>
      )}
    </Card>
  );
}

interface RegisterRow {
  workerId: string;
  name: string;
  role: string;
  dailyWage: number;
  present: number;
  halfDay: number;
  absent: number;
  daysMarked: number;
  wages: number;
}

function MonthlyRegister() {
  const thisMonth = currentMonthKey();
  const [month, setMonth] = useState(thisMonth);
  const { data, loading, error, refetch } = useApi<{ rows: RegisterRow[]; totals: { wages: number; present: number; halfDay: number; absent: number } }>(
    `/api/attendance?month=${month}`,
  );
  return (
    <Card>
      <CardHeader title="Monthly register & wages" action={<MonthPicker month={month} onChange={setMonth} max={thisMonth} />} />
      {error && <ErrorNote message={`Couldn't load the register: ${error}`} onRetry={refetch} />}
      {loading && !data && <Loading />}
      {data && (
        <>
          <Table
            columns={[
              { header: "Worker", render: (r: RegisterRow) => <span className="font-medium">{r.name}</span> },
              { header: "Role", render: (r) => roleLabel(r.role) },
              { header: "Present", className: "text-right tabular-nums", render: (r) => r.present },
              { header: "Half day", className: "text-right tabular-nums", render: (r) => r.halfDay },
              { header: "Absent", className: "text-right tabular-nums", render: (r) => (r.absent ? <span className="text-red-700">{r.absent}</span> : 0) },
              { header: "Day wage", className: "text-right tabular-nums", render: (r) => inr(r.dailyWage) },
              { header: "Wages earned", className: "text-right tabular-nums font-medium", render: (r) => inr(r.wages) },
            ]}
            rows={data.rows}
            keyFor={(r) => r.workerId}
            emptyState={<EmptyState title="No workers yet" />}
          />
          <p className="mt-2 text-right text-sm text-gray-600">
            {data.totals.present} present · {data.totals.halfDay} half · {data.totals.absent} absent · total wages earned{" "}
            <span className="font-semibold text-foreground">{inr(data.totals.wages)}</span>
          </p>
        </>
      )}
    </Card>
  );
}
