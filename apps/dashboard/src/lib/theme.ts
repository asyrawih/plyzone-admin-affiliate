import { useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";
const KEY = "klsm-theme";

export function getTheme(): Theme {
  try { const v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : "system"; } catch { return "system"; }
}
function isDark(t: Theme) { return t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches); }
export function applyTheme(t: Theme) {
  const dark = isDark(t);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}
export function setTheme(t: Theme) {
  try { t === "system" ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, t); } catch { /* storage diblokir */ }
  applyTheme(t);
}
/** Tema aktif + setter. Ikuti perubahan tema OS saat mode "system". Pemilihan disimpan di localStorage (per browser). */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [t, setT] = useState<Theme>(getTheme);
  useEffect(() => {
    applyTheme(t);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const h = () => { if (t === "system") applyTheme(t); };
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, [t]);
  return [t, (n) => { setTheme(n); setT(n); }];
}
