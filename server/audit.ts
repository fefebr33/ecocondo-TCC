import { logsAuditoria, tiposEntidadeAuditoria } from "../drizzle/schema";

type TipoEntidadeAuditoria = (typeof tiposEntidadeAuditoria)[number];

export type RegistroAuditoria = {
  condominioId: number;
  autorId: number;
  tipoEntidade: TipoEntidadeAuditoria;
  entidadeId: number;
  acao: string;
  resumo: string;
  estadoAnterior?: Record<string, unknown> | null;
  estadoNovo?: Record<string, unknown> | null;
};

function serializarEstado(valor: Record<string, unknown> | null | undefined) {
  if (!valor) return null;
  return JSON.stringify(valor, (_chave, item) => (item instanceof Date ? item.toISOString() : item));
}

export async function writeAuditLog(db: any, registro: RegistroAuditoria) {
  await db.insert(logsAuditoria).values({
    condominioId: registro.condominioId,
    autorId: registro.autorId,
    tipoEntidade: registro.tipoEntidade,
    entidadeId: registro.entidadeId,
    acao: registro.acao,
    resumo: registro.resumo,
    estadoAnterior: serializarEstado(registro.estadoAnterior),
    estadoNovo: serializarEstado(registro.estadoNovo),
  });
}

export function collectionAuditState(registro: { status: string; pesoGramas: number | null; pontosConcedidos: number; coletorId: number | null; agendadaPara: Date; concluidaEm: Date | null; observacoes: string | null }) {
  return {
    status: registro.status,
    pesoGramas: registro.pesoGramas,
    pontosConcedidos: registro.pontosConcedidos,
    coletorId: registro.coletorId,
    agendadaPara: registro.agendadaPara,
    concluidaEm: registro.concluidaEm,
    observacoes: registro.observacoes,
  };
}

export function incidentAuditState(registro: { status: string; bloco: string; tipoResiduo: string; local: string; descricao: string; notaResolucao: string | null; resolvidoPorId: number | null; resolvidaEm: Date | null }) {
  return {
    status: registro.status,
    bloco: registro.bloco,
    tipoResiduo: registro.tipoResiduo,
    local: registro.local,
    descricao: registro.descricao,
    notaResolucao: registro.notaResolucao,
    resolvidoPorId: registro.resolvidoPorId,
    resolvidaEm: registro.resolvidaEm,
  };
}
