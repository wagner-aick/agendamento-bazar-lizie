/* =============================================================================
   Bazar de Fábrica Lizie — Painel da equipe
   Minimalista: lista por horário, busca, filtro e atualização automática.
   ============================================================================= */

(function () {
  "use strict";

  var API_BASE = "https://molespouzrulyubcfxph.supabase.co/functions/v1/admin";
  var CHAVE_SESSAO = "bazar_admin_senha";
  var INTERVALO_ATUALIZACAO = 15000;

  var state = {
    senha: "",
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

  function formatarDataHora(iso) {
    if (!iso) return "";
    var data = new Date(iso);
    if (isNaN(data.getTime())) return "";
    return data.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function dataCurta(iso) {
    if (!iso) return "";
    var partes = String(iso).split("-");
    if (partes.length !== 3) return iso;
    return partes[2] + "." + partes[1];
  }

  function protocoloCurto(id) {
    return "LZ-" + String(id || "").replace(/-/g, "").slice(0, 8).toUpperCase();
  }

  /* ------------------------------------------------------------- elementos */

  var telaLogin = $("#tela-login");
  var telaPainel = $("#tela-painel");
  var topo = $("#topo");
  var formLogin = $("#form-login");
  var campoSenha = $("#senha");
  var controleSenha = $("#controle-senha");
  var erroLogin = $("#erro-login");
  var botaoEntrar = $("#entrar");
  var botaoMostrar = $("#mostrar-senha");
  var acoesTopo = $("#acoes-topo");
  var botaoAtualizar = $("#atualizar");
  var botaoSair = $("#sair");
  var buscaInput = $("#busca");
  var chipsEl = $("#chips");
  var gruposEl = $("#grupos");
  var subtitulo = $("#subtitulo");
  var vazioEl = $("#vazio");
  var vazioTitulo = $("#vazio-titulo");
  var botaoLimpar = $("#limpar-filtros");
  var botaoExportar = $("#exportar");
  var avisoEl = $("#aviso");

  var avisoTimer = null;
  var buscaTimer = null;
  var atualizacaoTimer = null;

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

  /* ---------------------------------------------------------------- login */

  function definirCarregando(ativo) {
    state.carregando = ativo;
    botaoEntrar.disabled = ativo;
    botaoEntrar.setAttribute("data-carregando", ativo ? "true" : "false");
    botaoAtualizar.disabled = ativo;
  }

  async function carregar(senha, silencioso) {
    if (state.carregando) return;
    definirCarregando(true);
    if (!silencioso) erroLoginVisivel("");

    try {
      var resposta = await fetch(API_BASE + "/dados", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ senha: senha })
      });

      var corpo = null;
      try {
        corpo = await resposta.json();
      } catch (e) {
        corpo = null;
      }

      if (!resposta.ok || !corpo || corpo.ok !== true) {
        var codigo = corpo && corpo.erro ? corpo.erro : "";
        var mensagem = corpo && corpo.mensagem ? corpo.mensagem : "Não foi possível carregar os dados.";

        if (codigo === "SENHA_INVALIDA" || resposta.status === 401) {
          encerrarSessao();
          mostrarLogin();
          erroLoginVisivel(mensagem);
          campoSenha.focus();
          return;
        }

        throw new Error(mensagem);
      }

      state.dados = corpo.dados;
      state.senha = senha;
      state.ultimaCarga = Date.now();
      sessionStorage.setItem(CHAVE_SESSAO, senha);

      mostrarPainel();
    } catch (erro) {
      var texto = erro && erro.message ? erro.message : "Sem conexão com o servidor.";
      if (state.dados) {
        mostrarAviso(texto, "erro");
      } else {
        erroLoginVisivel(texto);
      }
    } finally {
      definirCarregando(false);
    }
  }

  function encerrarSessao() {
    sessionStorage.removeItem(CHAVE_SESSAO);
    state.senha = "";
    state.dados = null;
  }

  function mostrarLogin() {
    pararAtualizacao();
    document.body.classList.add("sem-rolagem");
    topo.classList.add("topo--login");
    telaPainel.hidden = true;
    telaLogin.hidden = false;
    acoesTopo.hidden = true;
    campoSenha.value = "";
    erroLoginVisivel("");
    campoSenha.focus();
  }

  function mostrarPainel() {
    document.body.classList.remove("sem-rolagem");
    topo.classList.remove("topo--login");
    telaLogin.hidden = true;
    telaPainel.hidden = false;
    acoesTopo.hidden = false;
    erroLoginVisivel("");
    renderizar();
    iniciarAtualizacao();
  }

  function iniciarAtualizacao() {
    pararAtualizacao();
    atualizacaoTimer = setInterval(function () {
      if (document.visibilityState === "visible" && state.senha && !state.carregando) {
        carregar(state.senha, true);
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
    carregar(senha, false);
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

  botaoSair.addEventListener("click", function () {
    encerrarSessao();
    mostrarLogin();
    mostrarAviso("Sessão encerrada.", "info");
  });

  botaoAtualizar.addEventListener("click", function () {
    if (state.senha) carregar(state.senha, true);
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

  /* ---------------------------------------------------------------- export */

  function celulaCsv(valor) {
    var texto = String(valor == null ? "" : valor);
    if (/^[=+\-@]/.test(texto)) texto = "'" + texto;
    return '"' + texto.replace(/"/g, '""') + '"';
  }

  botaoExportar.addEventListener("click", function () {
    var lista = inscricoesFiltradas();
    if (!lista.length) {
      mostrarAviso("Nada para exportar.", "erro");
      return;
    }

    var linhas = [
      ["Horário", "Nome", "CPF", "E-mail", "Celular", "Inscrito em", "Protocolo"]
    ];

    lista.forEach(function (item) {
      linhas.push([
        item.horario,
        item.nome,
        item.cpf,
        item.email,
        formatarCelular(item.celular),
        formatarDataHora(item.criado_em),
        protocoloCurto(item.protocolo)
      ]);
    });

    var csv = "\uFEFF" + linhas.map(function (linha) {
      return linha.map(celulaCsv).join(";");
    }).join("\r\n");

    var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    var data = (state.dados.evento && state.dados.evento.data) || "bazar";
    link.href = url;
    link.download = "inscricoes-bazar-" + data + ".csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 2000);

    mostrarAviso("CSV baixado.", "sucesso");
  });

  /* ------------------------------------------------------------ ciclo de vida */

  document.addEventListener("visibilitychange", function () {
    if (
      document.visibilityState === "visible" &&
      state.senha &&
      Date.now() - state.ultimaCarga > 8000
    ) {
      carregar(state.senha, true);
    }
  });

  var senhaSalva = sessionStorage.getItem(CHAVE_SESSAO);
  if (senhaSalva) {
    carregar(senhaSalva, true);
  } else {
    campoSenha.focus();
  }
})();
