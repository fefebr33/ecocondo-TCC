import PageIntro from "@/components/PageIntro";
import { Button } from "@/components/ui/button";
import { Leaf } from "lucide-react";

export default function ModulePlaceholder({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div>
      <PageIntro eyebrow={eyebrow} title={title} description={description} />
      <section className="grid min-h-[410px] place-items-center rounded-[26px] border border-dashed border-[#cadfd2] bg-white px-6 text-center shadow-[0_16px_34px_-28px_rgba(4,66,42,.28)]">
        <div className="max-w-md"><span className="mx-auto grid h-14 w-14 place-items-center rounded-[22px] bg-[#e8f4ed] text-[#0f7350]"><Leaf className="h-6 w-6" /></span><h2 className="mt-5 text-xl font-bold tracking-[-0.035em]">Módulo em organização</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Esta área já está preparada na navegação do EcoCondo e receberá as regras, dados e fluxos específicos do módulo na próxima etapa de implementação.</p><Button variant="outline" className="mt-6 rounded-xl border-[#cfe1d7] bg-white text-[#0f7350] hover:bg-[#edf7f1]">Consultar especificação</Button></div>
      </section>
    </div>
  );
}
