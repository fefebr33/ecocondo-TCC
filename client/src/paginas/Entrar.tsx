import { ArrowRight, Leaf, Recycle, ShieldCheck, UsersRound } from "lucide-react";
import { Link } from "wouter";

type RoleOption = {
  role: "administrador" | "coletor" | "morador";
  title: string;
  description: string;
  icon: typeof ShieldCheck;
};

const roles: RoleOption[] = [
  {
    role: "administrador",
    title: "Administrador",
    description: "Gerencia moradores, coletas, relatórios, auditoria e configurações do condomínio.",
    icon: ShieldCheck,
  },
  {
    role: "coletor",
    title: "Coletor",
    description: "Acompanha e atualiza o status das coletas agendadas.",
    icon: Recycle,
  },
  {
    role: "morador",
    title: "Morador",
    description: "Consulta coletas, participa de campanhas e resgata recompensas.",
    icon: UsersRound,
  },
];

export default function Login() {
  return (
    <div className="min-h-screen bg-[#f8faf8] text-foreground">
      <header className="mx-auto flex h-[76px] max-w-[1180px] items-center px-5 sm:px-8">
        <Link href="/" className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[linear-gradient(145deg,#0f7350,#0c4f3a)] text-white">
            <Leaf className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-[15px] font-bold tracking-[-.03em]">EcoCondo</span>
            <span className="block text-[10px] font-medium tracking-[.13em] text-muted-foreground uppercase">Gestão circular</span>
          </span>
        </Link>
      </header>

      <main className="mx-auto max-w-[720px] px-5 pb-20 pt-6 sm:px-8">
        <p className="inline-flex items-center gap-2 rounded-full border border-[#cfe2d5] bg-white px-3 py-1.5 text-[11px] font-bold tracking-[.1em] text-[#0e6548] uppercase">
          <span className="h-1.5 w-1.5 rounded-full bg-[#52a66b]" />
          Login de demonstração
        </p>
        <h1 className="mt-6 text-3xl font-bold tracking-[-.05em] sm:text-4xl">Entrar como qual perfil?</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
          Cada perfil tem uma visão diferente da plataforma. Escolha um para explorar o EcoCondo.
        </p>

        <div className="mt-9 grid gap-4">
          {roles.map(({ role, title, description, icon: Icon }) => (
            <a
              key={role}
              href={`/api/auth/entrar?role=${role}`}
              className="group flex items-center gap-4 rounded-[22px] border border-[#dbe8e0] bg-white p-5 shadow-[0_18px_50px_-30px_rgba(9,68,47,.35)] transition-colors hover:border-[#0f7350]/40 hover:bg-[#f7fbf8]"
            >
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#e8f4ed] text-[#0f7350]">
                <Icon className="h-6 w-6" />
              </span>
              <span className="flex-1">
                <span className="block text-base font-bold tracking-[-.02em]">{title}</span>
                <span className="mt-1 block text-sm leading-5 text-muted-foreground">{description}</span>
              </span>
              <ArrowRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-[#0f7350]" />
            </a>
          ))}
        </div>

        <p className="mt-8 text-xs leading-5 text-muted-foreground">
          Contas de demonstração criadas automaticamente para fins de apresentação — nenhuma senha é necessária.
        </p>
      </main>
    </div>
  );
}
