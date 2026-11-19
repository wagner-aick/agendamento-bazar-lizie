// =============================================================================
// Bazar de Fábrica Lizie — API de agendamento
// Edge Function pública (verify_jwt = false) que faz o papel de "porteiro":
//   GET  /bazar/horarios  -> horários e vagas restantes (sem dado pessoal)
//   POST /bazar/agendar   -> cria a inscrição (validação fica no banco)
//
// O cliente nunca recebe chave do Supabase. A service_role só existe aqui,
// no runtime da Edge Function.
// =============================================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const JSON_HEADERS = {
  ...CORS,
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_BODY_BYTES = 4096;

/** Mensagens amigáveis. Nada de detalhe interno vaza para o cliente. */
const ERROS: Record<string, { status: number; mensagem: string }> = {
  CPF_JA_CADASTRADO: {
    status: 409,
    mensagem: "Este CPF já possui um agendamento. Cada CPF pode agendar uma única vez.",
  },
  HORARIO_ESGOTADO: {
    status: 409,
    mensagem: "As vagas deste horário acabaram de ser preenchidas. Escolha outro horário.",
  },
  HORARIO_INVALIDO: {
    status: 422,
    mensagem: "Horário inválido. Atualize a página e escolha novamente.",
  },
  CPF_INVALIDO: {
    status: 422,
    mensagem: "CPF inválido. Confira os números digitados.",
  },
  EMAIL_INVALIDO: {
    status: 422,
    mensagem: "E-mail inválido. Confira o endereço digitado.",
  },
  CELULAR_INVALIDO: {
    status: 422,
    mensagem: "Celular inválido. Informe DDD + número.",
  },
  NOME_INVALIDO: {
    status: 422,
    mensagem: "Informe o nome completo.",
  },
  ORIGEM_INVALIDA: {
    status: 422,
    mensagem: "Selecione como soube do bazar.",
  },
  TERMOS_OBRIGATORIOS: {
    status: 422,
    mensagem: "É necessário aceitar o aviso sobre pequenos defeitos das peças.",
  },
  INSCRICOES_ENCERRADAS: {
    status: 403,
    mensagem: "As inscrições para este bazar estão encerradas.",
  },
  MUITAS_TENTATIVAS: {
    status: 429,
    mensagem: "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.",
  },
  REQUISICAO_INVALIDA: {
    status: 400,
    mensagem: "Requisição inválida.",
  },
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, "Cache-Control": "no-store", ...extra },
  });
}

function falha(codigo: string) {
  const alvo = ERROS[codigo];
  if (!alvo) {
    console.error("bazar: erro nao mapeado", codigo);
    return json({ ok: false, erro: "ERRO_INTERNO", mensagem: "Não foi possível concluir o agendamento. Tente novamente." }, 500);
  }
  return json({ ok: false, erro: codigo, mensagem: alvo.mensagem }, alvo.status);
}

async function rpc(nome: string, corpo: unknown) {
  const resposta = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${nome}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify(corpo),
  });

  const texto = await resposta.text();
  let dados: unknown = null;
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    dados = null;
  }

  if (!resposta.ok) {
    const mensagem = (dados as { message?: string } | null)?.message ?? "ERRO_INTERNO";
    throw new Error(mensagem);
  }

  return dados;
}

/** Hash do IP: guardamos só isso, por 2 dias, para conter flood. */
async function hashIp(req: Request) {
  const encaminhado = req.headers.get("x-forwarded-for") ?? "";
  const ip = (encaminhado.split(",")[0] || req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "0.0.0.0").trim();
  const bytes = new TextEncoder().encode(`lizie-bazar:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function texto(valor: unknown, max: number) {
  return typeof valor === "string" ? valor.trim().slice(0, max) : "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const url = new URL(req.url);
  const rota = url.pathname.replace(/\/+$/, "").split("/").pop();

  try {
    if (req.method === "GET" && rota === "horarios") {
      const dados = await rpc("bazar_horarios_disponiveis", {});
      return json(dados, 200, { "Cache-Control": "public, max-age=15, stale-while-revalidate=30" });
    }

    if (req.method === "POST" && rota === "agendar") {
      const tamanho = Number(req.headers.get("content-length") ?? "0");
      if (tamanho > MAX_BODY_BYTES) {
        return falha("REQUISICAO_INVALIDA");
      }

      let corpo: Record<string, unknown>;
      try {
        corpo = await req.json();
      } catch {
        return falha("REQUISICAO_INVALIDA");
      }

      if (typeof corpo !== "object" || corpo === null || Array.isArray(corpo)) {
        return falha("REQUISICAO_INVALIDA");
      }

      // Honeypot: campo invisível. Humano nunca preenche.
      if (texto(corpo.website, 200) !== "") {
        return json({ ok: true, protocolo: null, horario: null, vagasRestantes: null });
      }

      const nome = texto(corpo.nome, 120);
      const email = texto(corpo.email, 254);
      const cpf = texto(corpo.cpf, 20);
      const celular = texto(corpo.celular, 20);
      const comoSoube = texto(corpo.comoSoube, 40);
      const horarioId = Number(corpo.horarioId);

      if (!Number.isInteger(horarioId) || horarioId < 1 || horarioId > 32767) {
        return falha("HORARIO_INVALIDO");
      }

      const resultado = await rpc("bazar_agendar", {
        p_nome: nome,
        p_email: email,
        p_cpf: cpf,
        p_celular: celular,
        p_horario_id: horarioId,
        p_como_soube: comoSoube,
        p_aceita_novidades: corpo.aceitaNovidades === true,
        p_aceita_termos: corpo.aceitaTermos === true,
        p_ip_hash: await hashIp(req),
      }) as {
        ok?: boolean;
        protocolo?: string;
        horario?: string;
        vagas_restantes?: number;
      };

      return json({
        ok: true,
        protocolo: resultado?.protocolo ?? null,
        horario: resultado?.horario ?? null,
        vagasRestantes: resultado?.vagas_restantes ?? null,
      });
    }

    return json({ ok: false, erro: "ROTA_NAO_ENCONTRADA" }, 404);
  } catch (erro) {
    const codigo = erro instanceof Error ? erro.message : "ERRO_INTERNO";
    return falha(codigo);
  }
});
