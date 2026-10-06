import { describe, expect, it } from "vitest";
import { analisarItem, decidirAnalise, ERRO_SEM_CHAVE_IA, mesmaCor, simularLeitura, type ItemParaAnalise } from "./analiseDescarte";
import { normalizarCodigoAdesivo } from "@shared/adesivos";

const item: ItemParaAnalise = {
  tipoDeclarado: "reciclavel",
  pesoDeclaradoGramas: 2000,
  imagemDataUrl: null,
  corSacoEsperada: "Azul",
  coresPorTipo: { reciclavel: "Azul", organico: "Marrom", rejeito: "Preto", eletronico: "Laranja", perigoso: "Vermelho" },
};
const regras = { aprovacaoAutomatica: true, confiancaMinima: 80 };

describe("decisão da análise automática", () => {
  it("aprova sozinho só quando tipo, peso, cor e confiança conferem", () => {
    expect(decidirAnalise(item, simularLeitura(item), regras)).toEqual({ resultado: "aprovado_automatico", motivos: [] });
  });

  it("qualquer divergência manda para a avaliação humana, com o motivo", () => {
    expect(decidirAnalise(item, simularLeitura(item, "cor_errada"), regras).motivos.join(" ")).toMatch(/Cor do saco/);
    expect(decidirAnalise(item, simularLeitura(item, "tipo_diferente"), regras).motivos.join(" ")).toMatch(/identificou orgânico/);
    expect(decidirAnalise(item, simularLeitura(item, "peso_diferente"), regras).motivos.join(" ")).toMatch(/Peso lido na foto \(1,20 kg\)/);
    const ilegivel = decidirAnalise(item, simularLeitura(item, "foto_ilegivel"), regras);
    expect(ilegivel.resultado).toBe("pendente");
    expect(ilegivel.motivos.join(" ")).toMatch(/Foto ilegível.*Confiança da análise baixa/);
  });

  it("tolera pequena diferença de peso (10% ou 100 g) e respeita a confiança mínima e os alertas antifraude", () => {
    expect(decidirAnalise(item, { ...simularLeitura(item), pesoLidoGramas: 2150 }, regras).resultado).toBe("aprovado_automatico");
    expect(decidirAnalise(item, { ...simularLeitura(item), pesoLidoGramas: 2300 }, regras).resultado).toBe("pendente");
    expect(decidirAnalise(item, { ...simularLeitura(item), confianca: 79 }, regras).resultado).toBe("pendente");
    expect(decidirAnalise(item, simularLeitura(item), { ...regras, alertasAntifraude: ["peso acima do histórico"] }).motivos).toEqual(["Alerta antifraude: peso acima do histórico."]);
    expect(decidirAnalise(item, simularLeitura(item), { ...regras, aprovacaoAutomatica: false }).resultado).toBe("pendente");
  });

  it("falha da API nunca aprova", () => {
    expect(decidirAnalise(item, { ...simularLeitura(item), erro: "sem conexão com a API" }, regras)).toMatchObject({ resultado: "erro" });
  });

  it("compara cores sem acento nem maiúsculas", () => {
    expect(mesmaCor("marrom", "Marrom")).toBe(true);
    expect(mesmaCor("Lilás", "lilas")).toBe(true);
    expect(mesmaCor("Azul", "Verde")).toBe(false);
  });
});

describe("código dos adesivos", () => {
  it("lê o código digitado de qualquer jeito ou o link do QR", () => {
    expect(normalizarCodigoAdesivo("ec 7k3f 9q2m")).toBe("EC-7K3F-9Q2M");
    expect(normalizarCodigoAdesivo("https://ecocondo.app/leitura?adesivo=EC-7K3F-9Q2M")).toBe("EC-7K3F-9Q2M");
    expect(normalizarCodigoAdesivo("EC-0000-1111")).toBeNull();
    expect(normalizarCodigoAdesivo("")).toBeNull();
  });
});

describe("sem a chave da API", () => {
  it("só simula na estação em modo demonstração; na estação de verdade o descarte vai para a conferência humana", async () => {
    const chave = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const comFoto = { ...item, imagemDataUrl: "data:image/png;base64,iVBORw0KGgo=" };
      const real = await analisarItem(comFoto, { estacaoDemonstracao: false });
      expect(real.erro).toBe(ERRO_SEM_CHAVE_IA);
      expect(decidirAnalise(item, real, regras).resultado).toBe("erro");
      const demonstracao = await analisarItem(comFoto, { estacaoDemonstracao: true });
      expect(decidirAnalise(item, demonstracao, regras).resultado).toBe("aprovado_automatico");
    } finally {
      if (chave !== undefined) process.env.ANTHROPIC_API_KEY = chave;
    }
  });
});
