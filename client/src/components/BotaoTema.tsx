import { Button } from "@/components/ui/button";
import { useTheme } from "@/contexts/ThemeContext";
import { Moon, Sun } from "lucide-react";

/** Alterna entre o modo claro e o escuro (no sistema e no tablet da estação). */
export default function BotaoTema({ className = "" }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  if (!toggleTheme) return null;
  const escuro = theme === "dark";
  return (
    <Button type="button" variant="ghost" size="icon" onClick={toggleTheme} aria-label={escuro ? "Usar modo claro" : "Usar modo escuro"} title={escuro ? "Modo claro" : "Modo escuro"} className={`h-10 w-10 rounded-xl border border-[#dfe9e3] bg-white text-muted-foreground hover:bg-[#edf7f1] hover:text-[#0f7350] ${className}`}>
      {escuro ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
    </Button>
  );
}
