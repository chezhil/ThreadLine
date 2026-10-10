// Section ids of the profile & settings page. Kept apart from the client
// component so the server page can validate ?tab= without importing from it.
export const ACCOUNT_TAB_IDS = ["profile", "preferences", "notifications", "security", "activity"] as const;
export type AccountTab = (typeof ACCOUNT_TAB_IDS)[number];

export const isAccountTab = (v: string | null | undefined): v is AccountTab => ACCOUNT_TAB_IDS.some((id) => id === v);
