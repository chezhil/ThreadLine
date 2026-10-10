export interface ImportFieldDef {
  key: string;
  label: string;
  required: boolean;
  example: string;
}

export interface ImportTargetDef {
  key: string;
  label: string;
  description: string;
  fields: ImportFieldDef[];
}

export type RowStatus = "pending" | "ok" | "error";

export interface RowResult {
  index: number;
  ok: boolean;
  message: string;
}
