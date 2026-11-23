// =============================================================================
// Bazar de Fábrica Lizie — Painel da equipe
//   POST /admin/login  { senha } -> token de sessão (12h) + dados
//   POST /admin/dados  { token } -> dados atualizados
//
// A senha só trafega no login. O navegador guarda um token opaco, nunca a senha.
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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_BODY_BYTES = 2048;

const ERROS: Record<string, { status: number; mensagem: string }> = {
  SENHA_INVALIDA: {
    status: 401,
    mensagem: "Senha incorreta. Confira e tente novamente.",
  },
  SESSAO_EXPIRADA: {
    status: 401,
    mensagem: "Sessão expirada. Entre novamente.",
  },
  NAO_ENCONTRADO: {
    status: 404,
    mensagem: "Essa inscrição não existe mais.",
  },
  MUITAS_TENTATIVAS: {
    status: 429,
    mensagem: "Muitas tentativas. Aguarde 10 minutos e tente de novo.",
  },
  ADMIN_NAO_CONFIGURADO: {
    status: 503,
    mensagem: "O painel ainda não foi configurado. Fale com o responsável.",
  },
  REQUISICAO_INVALIDA: {
    status: 400,
    mensagem: "Requisição inválida.",
  },
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
    console.error("admin: erro nao mapeado", codigo);
    return json(
      { ok: false, erro: "ERRO_INTERNO", mensagem: "Não foi possível carregar os dados. Tente novamente." },
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

/** IP confiável: só headers definidos pela borda. X-Forwarded-For é ignorado. */
async function hashIp(req: Request) {
  const ip = (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    "local"
  ).trim();

  const bytes = new TextEncoder().encode(`lizie-bazar-admin:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function corpoJson(req: Request) {
  const texto = await req.text();
  if (new TextEncoder().encode(texto).length > MAX_BODY_BYTES) return null;
  try {
    const corpo = JSON.parse(texto);
    if (typeof corpo !== "object" || corpo === null || Array.isArray(corpo)) return null;
    return corpo as Record<string, unknown>;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors(req) });
  }

  const url = new URL(req.url);
  const rota = url.pathname.replace(/\/+$/, "").split("/").pop();

  try {
    if (req.method === "POST" && rota === "login") {
      const corpo = await corpoJson(req);
      if (!corpo) return falha("REQUISICAO_INVALIDA", req);

      const senha = typeof corpo.senha === "string" ? corpo.senha : "";
      if (senha.length < 1 || senha.length > 200) {
        return falha("SENHA_INVALIDA", req);
      }

      const resultado = await rpc("bazar_admin_login", {
        p_senha: senha,
        p_ip_hash: await hashIp(req),
      }) as { ok?: boolean; erro?: string; token?: string; dados?: unknown };

      if (!resultado || resultado.ok !== true) {
        return falha(resultado?.erro ?? "ERRO_INTERNO", req);
      }

      return json({ ok: true, token: resultado.token, dados: resultado.dados }, 200, req);
    }

    if (req.method === "POST" && rota === "dados") {
      const corpo = await corpoJson(req);
      if (!corpo) return falha("REQUISICAO_INVALIDA", req);

      const token = typeof corpo.token === "string" ? corpo.token : "";
      if (!/^[a-f0-9]{64}$/.test(token)) {
        return falha("SESSAO_EXPIRADA", req);
      }

      const resultado = await rpc("bazar_admin_dados_token", {
        p_token: token,
      }) as { ok?: boolean; erro?: string; dados?: unknown };

      if (!resultado || resultado.ok !== true) {
        return falha(resultado?.erro ?? "ERRO_INTERNO", req);
      }

      return json({ ok: true, dados: resultado.dados }, 200, req);
    }

    if (req.method === "POST" && rota === "excluir") {
      const corpo = await corpoJson(req);
      if (!corpo) return falha("REQUISICAO_INVALIDA", req);

      const token = typeof corpo.token === "string" ? corpo.token : "";
      if (!/^[a-f0-9]{64}$/.test(token)) {
        return falha("SESSAO_EXPIRADA", req);
      }

      const id = typeof corpo.id === "string" ? corpo.id : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        return falha("REQUISICAO_INVALIDA", req);
      }

      const resultado = await rpc("bazar_admin_excluir", {
        p_token: token,
        p_id: id,
      }) as { ok?: boolean; erro?: string; removidos?: number };

      if (!resultado || resultado.ok !== true) {
        return falha(resultado?.erro ?? "ERRO_INTERNO", req);
      }

      return json({ ok: true, removidos: resultado.removidos ?? 1 }, 200, req);
    }

    if (req.method === "POST" && rota === "presencas") {
      const corpo = await corpoJson(req);
      if (!corpo) return falha("REQUISICAO_INVALIDA", req);

      const token = typeof corpo.token === "string" ? corpo.token : "";
      if (!/^[a-f0-9]{64}$/.test(token)) {
        return falha("SESSAO_EXPIRADA", req);
      }

      const resultado = await rpc("bazar_admin_presencas", {
        p_token: token,
      }) as { ok?: boolean; erro?: string; presencas?: unknown };

      if (!resultado || resultado.ok !== true) {
        return falha(resultado?.erro ?? "ERRO_INTERNO", req);
      }

      return json({ ok: true, presencas: resultado.presencas ?? [] }, 200, req);
    }

    if (req.method === "POST" && rota === "presenca") {
      const corpo = await corpoJson(req);
      if (!corpo) return falha("REQUISICAO_INVALIDA", req);

      const token = typeof corpo.token === "string" ? corpo.token : "";
      if (!/^[a-f0-9]{64}$/.test(token)) {
        return falha("SESSAO_EXPIRADA", req);
      }

      const id = typeof corpo.id === "string" ? corpo.id : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        return falha("REQUISICAO_INVALIDA", req);
      }

      const resultado = await rpc("bazar_admin_presenca", {
        p_token: token,
        p_id: id,
        p_chegou: corpo.chegou === true,
      }) as { ok?: boolean; erro?: string; chegou_em?: string | null };

      if (!resultado || resultado.ok !== true) {
        return falha(resultado?.erro ?? "ERRO_INTERNO", req);
      }

      return json({ ok: true, chegou_em: resultado.chegou_em ?? null }, 200, req);
    }

    return json({ ok: false, erro: "ROTA_NAO_ENCONTRADA" }, 404, req);
  } catch (erro) {
    const codigo = erro instanceof Error ? erro.message : "ERRO_INTERNO";
    return falha(codigo, req);
  }
});
