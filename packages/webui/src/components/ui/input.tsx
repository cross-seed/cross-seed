import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "border-zinc-200 file:text-zinc-950 placeholder:text-zinc-500 selection:bg-zinc-900 selection:text-zinc-50 flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:border-zinc-800 dark:file:text-zinc-50 dark:placeholder:text-zinc-400 dark:selection:bg-zinc-50 dark:selection:text-zinc-900",
        "focus-visible:border-zinc-950 focus-visible:ring-zinc-950/50 focus-visible:ring-[3px] dark:focus-visible:border-zinc-300 dark:focus-visible:ring-zinc-300/50",
        "aria-invalid:ring-red-500/20 dark:aria-invalid:ring-red-500/40 aria-invalid:border-red-500 dark:aria-invalid:ring-red-900/20 dark:dark:aria-invalid:ring-red-900/40 dark:aria-invalid:border-red-900",
        className
      )}
      {...props}
    />
  )
}

export { Input }
