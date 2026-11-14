import { Plantao } from "./api";

interface StatusInfo {
  cor: string;
  label: string;
}

// Cores conforme a legenda do documento de arquitetura (seção "Agenda de Plantões").
export const STATUS_MAP: Record<Plantao["status"], StatusInfo> = {
  agendado: { cor: "#F2C94C", label: "Agendado" },
  nf_emitida: { cor: "#2D9CDB", label: "NF emitida" },
  nf_confirmada: { cor: "#27AE60", label: "NF confirmada" },
  aguardando_nova_data: { cor: "#9B51E0", label: "Aguardando nova data" },
  cancelamento_administrativo: {
    cor: "#EB5757",
    label: "Cancelamento administrativo",
  },
  cancelado: { cor: "#828282", label: "Cancelado" },
};
