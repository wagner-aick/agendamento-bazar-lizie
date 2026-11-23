/* =============================================================================
   Bazar de Fábrica Lizie — Painel da equipe
   Minimalista: lista por horário, busca, filtro e atualização automática.
   O navegador guarda um token de 12h, nunca a senha.
   ============================================================================= */

(function () {
  "use strict";

  var API_BASE = "https://molespouzrulyubcfxph.supabase.co/functions/v1/admin";
  var CHAVE_TOKEN = "bazar_admin_token";
  var INTERVALO_ATUALIZACAO = 15000;
  var TEMPO_LIMITE = 12000;

  var state = {
    token: "",
    dados: null,
    busca: "",
    horario: "",
    carregando: false,
    ultimaCarga: 0
  };

  function $(seletor, raiz) {
    return (raiz || document).querySelector(seletor);
  }

  function criar(tag, classe, texto) {
    var el = document.createElement(tag);
    if (classe) el.className = classe;
    if (texto != null) el.textContent = texto;
    return el;
  }

  function normalizar(texto) {
    return String(texto || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function somenteDigitos(texto) {
    return String(texto || "").replace(/\D/g, "");
  }

  function formatarCelular(valor) {
    var d = somenteDigitos(valor);
    if (d.length === 11) return "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7);
    if (d.length === 10) return "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6);
    return valor || "";
  }

  function dataCurta(iso) {
    if (!iso) return "";
    var partes = String(iso).split("-");
    if (partes.length !== 3) return iso;
    return partes[2] + "." + partes[1];
  }

  /* ------------------------------------------------------------- elementos */

  var telaLogin = $("#tela-login");
  var telaPainel = $("#tela-painel");
  var abertura = $("#abertura");
  var topo = $("#topo");
  var formLogin = $("#form-login");
  var campoSenha = $("#senha");
  var controleSenha = $("#controle-senha");
  var erroLogin = $("#erro-login");
  var botaoEntrar = $("#entrar");
  var botaoMostrar = $("#mostrar-senha");
  var buscaInput = $("#busca");
  var chipsEl = $("#chips");
  var gruposEl = $("#grupos");
  var subtitulo = $("#subtitulo");
  var vazioEl = $("#vazio");
  var vazioTitulo = $("#vazio-titulo");
  var botaoLimpar = $("#limpar-filtros");
  var avisoEl = $("#aviso");

  var avisoTimer = null;
  var buscaTimer = null;
  var atualizacaoTimer = null;

  /* ------------------------------------------------------------- storage */

  function lerToken() {
    try {
      return sessionStorage.getItem(CHAVE_TOKEN) || "";
    } catch (erro) {
      return "";
    }
  }

  function gravarToken(token) {
    try {
      sessionStorage.setItem(CHAVE_TOKEN, token);
    } catch (erro) {
      /* modo privado: segue sem persistir */
    }
  }

  function apagarToken() {
    try {
      sessionStorage.removeItem(CHAVE_TOKEN);
    } catch (erro) {
      /* ignora */
    }
  }

  /* ---------------------------------------------------------------- avisos */

  function mostrarAviso(texto, tipo) {
    avisoEl.textContent = texto;
    avisoEl.setAttribute("data-tipo", tipo || "info");
    avisoEl.hidden = false;
    requestAnimationFrame(function () {
      avisoEl.setAttribute("data-visivel", "true");
    });
    clearTimeout(avisoTimer);
    avisoTimer = setTimeout(function () {
      avisoEl.removeAttribute("data-visivel");
      setTimeout(function () {
        avisoEl.hidden = true;
      }, 320);
    }, 4200);
  }

  function erroLoginVisivel(mensagem) {
    if (mensagem) {
      erroLogin.textContent = mensagem;
      erroLogin.hidden = false;
      controleSenha.setAttribute("data-erro", "true");
      campoSenha.setAttribute("aria-invalid", "true");
    } else {
      erroLogin.textContent = "";
      erroLogin.hidden = true;
      controleSenha.removeAttribute("data-erro");
      campoSenha.removeAttribute("aria-invalid");
    }
  }

  /* ---------------------------------------------------------------- rede */

  async function requisitar(rota, corpo) {
    var controle = new AbortController();
    var timer = setTimeout(function () {
      controle.abort();
    }, TEMPO_LIMITE);

    try {
      var resposta = await fetch(API_BASE + rota, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(corpo),
        signal: controle.signal
      });

      var dados = null;
      try {
        dados = await resposta.json();
      } catch (erro) {
        dados = null;
      }

      return { resposta: resposta, dados: dados };
    } finally {
      clearTimeout(timer);
    }
  }

  function definirCarregando(ativo) {
    state.carregando = ativo;
    botaoEntrar.disabled = ativo;
    botaoEntrar.setAttribute("data-carregando", ativo ? "true" : "false");
  }

  async function entrar(senha) {
    if (state.carregando) return;
    definirCarregando(true);
    erroLoginVisivel("");

    try {
      var resultado = await requisitar("/login", { senha: senha });
      var dados = resultado.dados;

      if (!resultado.resposta.ok || !dados || dados.ok !== true) {
        if (dados && dados.erro === "SENHA_INVALIDA") {
          erroLoginVisivel(dados.mensagem || "Senha incorreta.");
          campoSenha.focus();
          return;
        }
        throw new Error(dados && dados.mensagem ? dados.mensagem : "Não foi possível entrar.");
      }

      state.token = dados.token;
      state.dados = dados.dados;
      state.ultimaCarga = Date.now();
      gravarToken(state.token);
      campoSenha.value = "";
      mostrarPainel();
    } catch (erro) {
      var texto = erro && erro.name === "AbortError"
        ? "Tempo esgotado. Tente novamente."
        : (erro && erro.message ? erro.message : "Sem conexão com o servidor.");
      erroLoginVisivel(texto);
    } finally {
      definirCarregando(false);
    }
  }

  async function carregar(silencioso) {
    if (state.carregando || !state.token) return;
    definirCarregando(true);

    try {
      var resultado = await requisitar("/dados", { token: state.token });
      var dados = resultado.dados;

      if (!resultado.resposta.ok || !dados || dados.ok !== true) {
        if (resultado.resposta.status === 401) {
          encerrarSessao();
          mostrarLogin();
          erroLoginVisivel(dados && dados.mensagem ? dados.mensagem : "Sessão expirada. Entre novamente.");
          return;
        }
        throw new Error(dados && dados.mensagem ? dados.mensagem : "Não foi possível carregar os dados.");
      }

      state.dados = dados.dados;
      state.ultimaCarga = Date.now();

      if (telaPainel.hidden) {
        mostrarPainel();
      } else {
        if (!silencioso) renderizar();
        else renderizarComFoco();
      }
    } catch (erro) {
      var texto = erro && erro.name === "AbortError"
        ? "Conexão lenta. Tentando novamente…"
        : (erro && erro.message ? erro.message : "Sem conexão com o servidor.");

      if (state.dados) {
        mostrarAviso(texto, "erro");
      } else {
        mostrarLogin();
        erroLoginVisivel(texto);
      }
    } finally {
      definirCarregando(false);
    }
  }

  function encerrarSessao() {
    apagarToken();
    state.token = "";
    state.dados = null;
  }

  function mostrarLogin() {
    pararAtualizacao();
    document.body.classList.add("sem-rolagem");
    topo.classList.add("topo--login");
    abertura.hidden = true;
    telaPainel.hidden = true;
    telaLogin.hidden = false;
    campoSenha.value = "";
    erroLoginVisivel("");
    campoSenha.focus();
  }

  function mostrarPainel() {
    document.body.classList.remove("sem-rolagem");
    topo.classList.remove("topo--login");
    abertura.hidden = true;
    telaLogin.hidden = true;
    telaPainel.hidden = false;
    erroLoginVisivel("");
    renderizar();
    iniciarAtualizacao();
  }

  function iniciarAtualizacao() {
    pararAtualizacao();
    atualizacaoTimer = setInterval(function () {
      if (document.visibilityState === "visible" && state.token && !state.carregando) {
        carregar(true);
      }
    }, INTERVALO_ATUALIZACAO);
  }

  function pararAtualizacao() {
    clearInterval(atualizacaoTimer);
    atualizacaoTimer = null;
  }

  formLogin.addEventListener("submit", function (evento) {
    evento.preventDefault();
    var senha = campoSenha.value;
    if (!senha) {
      erroLoginVisivel("Digite a senha do painel.");
      campoSenha.focus();
      return;
    }
    entrar(senha);
  });

  botaoMostrar.addEventListener("click", function () {
    var visivel = campoSenha.type === "text";
    campoSenha.type = visivel ? "password" : "text";
    botaoMostrar.setAttribute("aria-pressed", visivel ? "false" : "true");
    botaoMostrar.setAttribute("aria-label", visivel ? "Mostrar senha" : "Ocultar senha");
    $(".ico-olho", botaoMostrar).hidden = !visivel;
    $(".ico-olho-cortado", botaoMostrar).hidden = visivel;
    campoSenha.focus();
  });

  /* --------------------------------------------------------------- filtros */

  function inscricoesFiltradas() {
    var dados = state.dados;
    if (!dados) return [];
    var termo = normalizar(state.busca);
    var digitos = somenteDigitos(state.busca);

    return dados.inscricoes.filter(function (item) {
      if (state.horario && item.horario !== state.horario) return false;
      if (!termo) return true;

      if (normalizar(item.nome).indexOf(termo) !== -1) return true;
      if (digitos && somenteDigitos(item.cpf + " " + item.celular).indexOf(digitos) !== -1) return true;
      return false;
    });
  }

  /* --------------------------------------------------------------- render */

  function renderizarChips() {
    var dados = state.dados;
    if (!dados) return;

    var rolagem = chipsEl.scrollLeft;
    chipsEl.textContent = "";

    function chip(valor, rotulo, quantidade) {
      var botao = criar("button", "chip");
      botao.type = "button";
      botao.setAttribute("aria-pressed", state.horario === valor ? "true" : "false");
      botao.setAttribute(
        "aria-label",
        rotulo + ", " + quantidade + (quantidade === 1 ? " inscrito" : " inscritos")
      );
      botao.appendChild(document.createTextNode(rotulo));
      var contador = criar("b", "", String(quantidade));
      contador.setAttribute("aria-hidden", "true");
      botao.appendChild(contador);
      botao.addEventListener("click", function () {
        state.horario = state.horario === valor ? "" : valor;
        renderizarChips();
        renderizarGrupos();
      });
      chipsEl.appendChild(botao);
    }

    chip("", "Todos", dados.inscricoes.length);

    dados.horarios.forEach(function (h) {
      chip(h.hora, h.hora, Number(h.ocupadas) || 0);
    });

    chipsEl.scrollLeft = rolagem;
  }

  function renderizarGrupos() {
    var dados = state.dados;
    if (!dados) return;

    var lista = inscricoesFiltradas();
    gruposEl.textContent = "";

    var porHora = {};
    lista.forEach(function (item) {
      if (!porHora[item.horario]) porHora[item.horario] = [];
      porHora[item.horario].push(item);
    });

    dados.horarios.forEach(function (h) {
      var pessoas = porHora[h.hora];
      if (!pessoas || !pessoas.length) return;

      var grupo = criar("section", "grupo");
      var topoGrupo = criar("header", "grupo__topo");
      topoGrupo.appendChild(criar("h2", "", h.hora));
      topoGrupo.appendChild(criar("span", "", pessoas.length + " de " + h.vagas_max));
      grupo.appendChild(topoGrupo);

      var ul = criar("ul", "pessoas");
      ul.setAttribute("aria-label", "Inscritos às " + h.hora);

      pessoas.forEach(function (item) {
        var li = criar("li", "pessoa");
        li.appendChild(criar("strong", "pessoa__nome", item.nome));

        var meta = criar("span", "pessoa__meta");
        meta.appendChild(criar("span", "", item.cpf));

        var tel = document.createElement("a");
        tel.className = "pessoa__tel";
        tel.href = "tel:+55" + somenteDigitos(item.celular);
        tel.textContent = formatarCelular(item.celular);
        meta.appendChild(tel);

        li.appendChild(meta);
        ul.appendChild(li);
      });

      grupo.appendChild(ul);
      gruposEl.appendChild(grupo);
    });

    var total = dados.inscricoes.length;
    var vazia = lista.length === 0;
    vazioEl.hidden = !vazia;
    gruposEl.hidden = vazia;

    if (vazia) {
      if (total === 0) {
        vazioTitulo.textContent = "Nenhum agendamento.";
        botaoLimpar.hidden = true;
      } else {
        vazioTitulo.textContent = "Nada encontrado.";
        botaoLimpar.hidden = false;
      }
    } else {
      botaoLimpar.hidden = true;
    }
  }

  function renderizar() {
    if (!state.dados) return;

    var evento = state.dados.evento || {};
    var total = Number(state.dados.total) || 0;
    subtitulo.textContent =
      (evento.data ? dataCurta(evento.data) + " · " : "") +
      (total === 0 ? "nenhum inscrito" : total + (total === 1 ? " inscrito" : " inscritos"));

    renderizarChips();
    renderizarGrupos();
  }

  /** Não destrói o foco nem a rolagem de quem está usando a tela. */
  function renderizarComFoco() {
    var focoNaLista =
      chipsEl.contains(document.activeElement) ||
      gruposEl.contains(document.activeElement);

    if (focoNaLista) return;
    renderizar();
  }

  buscaInput.addEventListener("input", function () {
    clearTimeout(buscaTimer);
    buscaTimer = setTimeout(function () {
      state.busca = buscaInput.value;
      renderizarGrupos();
    }, 120);
  });

  botaoLimpar.addEventListener("click", function () {
    state.busca = "";
    state.horario = "";
    buscaInput.value = "";
    renderizarChips();
    renderizarGrupos();
    buscaInput.focus();
  });

  /* ------------------------------------------------------------ ciclo de vida */

  document.addEventListener("visibilitychange", function () {
    if (
      document.visibilityState === "visible" &&
      state.token &&
      Date.now() - state.ultimaCarga > 8000
    ) {
      carregar(true);
    }
  });

  var tokenSalvo = lerToken();
  try {
    sessionStorage.removeItem("bazar_admin_senha");
  } catch (erro) {
    /* limpeza de versões antigas */
  }
  if (tokenSalvo) {
    state.token = tokenSalvo;
    carregar(true);
  } else {
    mostrarLogin();
  }
})();
