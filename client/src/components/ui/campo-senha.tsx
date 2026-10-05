import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Eye, EyeOff } from "lucide-react";
import * as React from "react";

/** Campo de senha com botão de olho dentro da caixa para mostrar ou esconder o que foi digitado. */
function CampoSenha({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "type">) {
  const [visivel, setVisivel] = React.useState(false);
  const Icone = visivel ? EyeOff : Eye;

  return (
    <div className="relative">
      <Input
        {...props}
        type={visivel ? "text" : "password"}
        className={cn("pr-11", className)}
      />
      <button
        type="button"
        onClick={() => setVisivel(atual => !atual)}
        aria-label={visivel ? "Esconder senha" : "Mostrar senha"}
        aria-pressed={visivel}
        title={visivel ? "Esconder senha" : "Mostrar senha"}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Icone className="h-4 w-4" />
      </button>
    </div>
  );
}

export { CampoSenha };
