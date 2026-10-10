"use client";
import { useState } from "react";
import type { z } from "zod";

// Tiny form state helper: string inputs in, the SAME zod schema the API route
// uses for validation, errors keyed by field path (matching the server's
// `{ fieldErrors }` shape so server errors land on the same fields).
export function useZodForm<S extends z.ZodTypeAny>(schema: S, initial: Record<string, string>) {
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);

  function set(name: string, value: string) {
    setValues((v) => ({ ...v, [name]: value }));
    setErrors((e) => {
      if (!e[name] && !e._form) return e;
      const next = { ...e };
      delete next[name];
      delete next._form;
      return next;
    });
  }

  function validate(): z.infer<S> | null {
    const parsed = schema.safeParse(values);
    if (parsed.success) {
      setErrors({});
      return parsed.data;
    }
    const out: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.length ? issue.path.join(".") : "_form";
      (out[key] ??= []).push(issue.message);
    }
    setErrors(out);
    return null;
  }

  function field(name: string) {
    return {
      value: values[name] ?? "",
      onChange: (e: { target: { value: string } }) => set(name, e.target.value),
      error: errors[name]?.[0],
    };
  }

  return { values, setValues, set, errors, setErrors, submitting, setSubmitting, validate, field };
}
