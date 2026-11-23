// =============================================================================
// Bazar de Fábrica Lizie — API de agendamento
//   GET  /bazar/horarios  -> horários e vagas restantes (sem dado pessoal)
//   POST /bazar/agendar   -> cria a inscrição (validação fica no banco)
// =============================================================================

const ORIGENS_FIXAS = new Set(["https://wagner-aick.github.io"]);

function origemPermitida(req: Request) {
  const origem = req.headers.get("origin") || "";
  if (ORIGENS_FIXAS.has(origem)) return origem;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origem)) return origem;
  return "https://wagner-aick.github.io";
}

function cors(req: Request) {
  return {
    "Access-Control-Allow-Origin": origemPermitida(req),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_BODY_BYTES = 4096;

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
  CPF_INVALIDO: { status: 422, mensagem: "CPF inválido. Confira os números digitados." },
  EMAIL_INVALIDO: { status: 422, mensagem: "E-mail inválido. Confira o endereço digitado." },
  CELULAR_INVALIDO: { status: 422, mensagem: "Celular inválido. Informe DDD + número." },
  NOME_INVALIDO: { status: 422, mensagem: "Informe o nome completo." },
  ORIGEM_INVALIDA: { status: 422, mensagem: "Selecione como soube do bazar." },
  TERMOS_OBRIGATORIOS: {
    status: 422,
    mensagem: "É necessário aceitar o aviso sobre pequenos defeitos das peças.",
  },
  INSCRICOES_ENCERRADAS: {
    status: 403,
    mensagem: "As inscrições para este bazar estão encerradas.",
  },
  AGENDAMENTO_NAO_ABERTO: {
    status: 403,
    mensagem: "As inscrições ainda não abriram. O agendamento abre em 24/11, às 13:00.",
  },
  MUITAS_TENTATIVAS: {
    status: 429,
    mensagem: "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.",
  },
  REQUISICAO_INVALIDA: { status: 400, mensagem: "Requisição inválida." },
};

function json(body: unknown, status: number, req: Request, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors(req),
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      ...extra,
    },
  });
}

function falha(codigo: string, req: Request) {
  const alvo = ERROS[codigo];
  if (!alvo) {
    console.error("bazar: erro nao mapeado", codigo);
    return json(
      { ok: false, erro: "ERRO_INTERNO", mensagem: "Não foi possível concluir o agendamento. Tente novamente." },
      500,
      req,
    );
  }
  return json({ ok: false, erro: codigo, mensagem: alvo.mensagem }, alvo.status, req);
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

/**
 * IP confiável: só headers definidos pela borda da Supabase.
 * X-Forwarded-For é controlado pelo cliente e NÃO é usado.
 */
async function hashIp(req: Request) {
  const ip = (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    "local"
  ).trim();

  const bytes = new TextEncoder().encode(`lizie-bazar:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function texto(valor: unknown, max: number) {
  return typeof valor === "string" ? valor.trim().slice(0, max) : "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors(req) });
  }

  const url = new URL(req.url);
  const rota = url.pathname.replace(/\/+$/, "").split("/").pop();

  try {
    if (req.method === "GET" && rota === "horarios") {
      const dados = await rpc("bazar_horarios_disponiveis", {});
      return json(dados, 200, req, {
        "Cache-Control": "public, max-age=15, stale-while-revalidate=30",
      });
    }

    if (req.method === "POST" && rota === "agendar") {
      const textoCorpo = await req.text();
      if (new TextEncoder().encode(textoCorpo).length > MAX_BODY_BYTES) {
        return falha("REQUISICAO_INVALIDA", req);
      }

      let corpo: Record<string, unknown>;
      try {
        corpo = JSON.parse(textoCorpo);
      } catch {
        return falha("REQUISICAO_INVALIDA", req);
      }

      if (typeof corpo !== "object" || corpo === null || Array.isArray(corpo)) {
        return falha("REQUISICAO_INVALIDA", req);
      }

      if (texto(corpo.website, 200) !== "") {
        return json({ ok: true, protocolo: null, horario: null, vagasRestantes: null }, 200, req);
      }

      const nome = texto(corpo.nome, 120);
      const email = texto(corpo.email, 254);
      const cpf = texto(corpo.cpf, 20);
      const celular = texto(corpo.celular, 20);
      const comoSoube = texto(corpo.comoSoube, 40);
      const horarioId = Number(corpo.horarioId);

      if (!Number.isInteger(horarioId) || horarioId < 1 || horarioId > 32767) {
        return falha("HORARIO_INVALIDO", req);
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
        erro?: string;
        protocolo?: string;
        horario?: string;
        vagas_restantes?: number;
      };

      if (!resultado || resultado.ok !== true) {
        return falha(resultado?.erro ?? "ERRO_INTERNO", req);
      }

      return json({
        ok: true,
        protocolo: resultado.protocolo ?? null,
        horario: resultado.horario ?? null,
        vagasRestantes: resultado.vagas_restantes ?? null,
      }, 200, req);
    }

    return json({ ok: false, erro: "ROTA_NAO_ENCONTRADA" }, 404, req);
  } catch (erro) {
    const codigo = erro instanceof Error ? erro.message : "ERRO_INTERNO";
    return falha(codigo, req);
  }
});
