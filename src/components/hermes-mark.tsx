import type { SVGProps } from "react";

export function HermesMark(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 40 34" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M3 29C7 14 18 7 38 3C29 11 20 19 3 29Z" />
    <path d="M4 30C14 23 22 18 34 13C29 23 18 29 4 30Z" opacity=".8" />
    <path d="M5 32C16 29 23 26 29 24C24 31 16 34 5 32Z" opacity=".6" />
  </svg>;
}
