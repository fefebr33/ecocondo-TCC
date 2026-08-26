import { ReactNode } from "react";

export default function PageIntro({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-col gap-5 sm:mb-9 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        {eyebrow && <p className="mb-2 text-[11px] font-bold tracking-[0.14em] text-[#0f7350] uppercase">{eyebrow}</p>}
        <h1 className="text-3xl font-bold tracking-[-0.05em] text-foreground sm:text-[34px]">{title}</h1>
        <p className="mt-2.5 text-sm leading-6 text-muted-foreground sm:text-[15px]">{description}</p>
      </div>
      {action}
    </div>
  );
}
