// =============================================================================
// Bazar de Fábrica Lizie — Painel da equipe
// Edge Function separada (verify_jwt = false) para consultar as inscrições.
//   POST /admin/dados  { senha } -> valida no banco (bcrypt) e devolve tudo
//
// A senha nunca é gravada no código nem no navegador de forma permanente.
// =============================================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

const MAX_BODY_BYTES = 2048;

const ERROS: Record<string, { status: number; mensagem: string }> = {
  SENHA_INVALIDA: {
    status: 401,
    mensagem: "Senha incorreta. Confira e tente novamente.",
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

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, "Cache-Control": "no-store", ...extra },
  });
}

function falha(codigo: string) {
  const alvo = ERROS[codigo];
  if (!alvo) {
    console.error("admin: erro nao mapeado", codigo);
    return json(
      { ok: false, erro: "ERRO_INTERNO", mensagem: "Não foi possível carregar os dados. Tente novamente." },
      500,
    );
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

async function hashIp(req: Request) {
  const encaminhado = req.headers.get("x-forwarded-for") ?? "";
  const ip = (
    encaminhado.split(",")[0] ||
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    "0.0.0.0"
  ).trim();
  const bytes = new TextEncoder().encode(`lizie-bazar-admin:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const url = new URL(req.url);
  const rota = url.pathname.replace(/\/+$/, "").split("/").pop();

  try {
    if (req.method === "POST" && rota === "dados") {
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

      const senha = typeof corpo?.senha === "string" ? corpo.senha : "";
      if (senha.length < 1 || senha.length > 200) {
        return falha("SENHA_INVALIDA");
      }

      const dados = await rpc("bazar_admin_dados", {
        p_senha: senha,
        p_ip_hash: await hashIp(req),
      });

      return json({ ok: true, dados });
    }

    return json({ ok: false, erro: "ROTA_NAO_ENCONTRADA" }, 404);
  } catch (erro) {
    const codigo = erro instanceof Error ? erro.message : "ERRO_INTERNO";
    return falha(codigo);
  }
});
