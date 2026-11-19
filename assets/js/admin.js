/* =============================================================================
   Bazar de Fábrica Lizie — Painel da equipe
   A senha é enviada por HTTPS para a Edge Function "admin" e validada no banco
   com bcrypt. Nenhum dado pessoal fica em localStorage.
   ============================================================================= */

(function () {
  "use strict";

  var API_BASE = "https://molespouzrulyubcfxph.supabase.co/functions/v1/admin";
  var CHAVE_SESSAO = "bazar_admin_senha";

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

  function formatarDataCurta(iso) {
    if (!iso) return "";
    var data = new Date(iso);
    if (isNaN(data.getTime())) return "";
    return data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  }

  function protocoloCurto(id) {
    return "LZ-" + String(id || "").replace(/-/g, "").slice(0, 8).toUpperCase();
  }

  function dataLonga(iso) {
    if (!iso) return "";
    var partes = String(iso).split("-");
    if (partes.length !== 3) return iso;
    var meses = [
      "janeiro", "fevereiro", "março", "abril", "maio", "junho",
      "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
    ];
    return Number(partes[2]) + " de " + (meses[Number(partes[1]) - 1] || "") + " de " + partes[0];
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
  var filtroHorario = $("#filtro-horario");
  var botaoExportar = $("#exportar");
  var resumoEl = $("#resumo");
  var horariosEl = $("#horarios");
  var notaHorarios = $("#nota-horarios");
  var contagemEl = $("#contagem");
  var subtitulo = $("#subtitulo");
  var vazioEl = $("#vazio");
  var vazioTitulo = $("#vazio-titulo");
  var vazioTexto = $("#vazio-texto");
  var botaoLimpar = $("#limpar-filtros");
  var tabelaWrap = $("#tabela-wrap");
  var corpoTabela = $("#corpo-tabela");
  var cartoesEl = $("#cartoes");
  var avisoEl = $("#aviso");

  var avisoTimer = null;
  var buscaTimer = null;

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
      if (silencioso && !state.primeiraCarga) {
        mostrarAviso("Dados atualizados.", "sucesso");
      }
      state.primeiraCarga = true;
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
    state.primeiraCarga = false;
  }

  function mostrarLogin() {
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

  /* --------------------------------------------------------------- render */

  function inscricoesFiltradas() {
    var dados = state.dados;
    if (!dados) return [];
    var termo = normalizar(state.busca);
    var digitos = somenteDigitos(state.busca);

    return dados.inscricoes.filter(function (item) {
      if (state.horario && item.horario !== state.horario) return false;
      if (!termo) return true;

      var alvo = normalizar(
        item.nome + " " + item.email + " " + item.cpf + " " + item.como_soube
      );
      if (alvo.indexOf(termo) !== -1) return true;
      if (digitos && somenteDigitos(item.celular + " " + item.cpf).indexOf(digitos) !== -1) return true;
      return false;
    });
  }

  function renderizarResumo() {
    var dados = state.dados;
    if (!dados) return;

    var total = Number(dados.total) || 0;
    var capacidade = 0;
    var ocupadas = 0;
    var esgotados = 0;

    dados.horarios.forEach(function (h) {
      capacidade += Number(h.vagas_max) || 0;
      ocupadas += Number(h.ocupadas) || 0;
      if (Number(h.ocupadas) >= Number(h.vagas_max)) esgotados += 1;
    });

    var restantes = Math.max(capacidade - ocupadas, 0);

    var cartoes = [
      { rotulo: "Inscritos", valor: String(total), dica: total === 1 ? "pessoa agendada" : "pessoas agendadas", destaque: true },
      { rotulo: "Ocupação", valor: ocupadas + "/" + capacidade, dica: capacidade ? Math.round((ocupadas / capacidade) * 100) + "% das vagas" : "sem vagas" },
      { rotulo: "Vagas restantes", valor: String(restantes), dica: restantes === 1 ? "vaga disponível" : "vagas disponíveis" },
      { rotulo: "Horários esgotados", valor: String(esgotados), dica: "de " + dados.horarios.length + " horários" }
    ];

    resumoEl.textContent = "";
    cartoes.forEach(function (item) {
      var card = criar("div", "resumo__cartao" + (item.destaque ? " resumo__cartao--destaque" : ""));
      card.appendChild(criar("span", "resumo__rotulo", item.rotulo));
      card.appendChild(criar("strong", "resumo__valor", item.valor));
      card.appendChild(criar("span", "resumo__dica", item.dica));
      resumoEl.appendChild(card);
    });
  }

  function renderizarHorarios() {
    var dados = state.dados;
    if (!dados) return;

    var totalOcupadas = 0;
    var totalVagas = 0;

    horariosEl.textContent = "";

    dados.horarios.forEach(function (h) {
      var ocupadas = Number(h.ocupadas) || 0;
      var maximo = Number(h.vagas_max) || 0;
      var restantes = Math.max(maximo - ocupadas, 0);
      var cheio = ocupadas >= maximo;
      totalOcupadas += ocupadas;
      totalVagas += maximo;

      var card = criar("button", "horario" + (cheio ? " horario--cheio" : ""));
      card.type = "button";
      card.setAttribute("aria-pressed", state.horario === h.hora ? "true" : "false");
      card.setAttribute("aria-label", "Filtrar por " + h.hora + ", " + ocupadas + " de " + maximo + " vagas");

      var topo = criar("span", "horario__topo");
      topo.appendChild(criar("span", "horario__hora", h.hora));
      topo.appendChild(criar("span", "horario__conta", ocupadas + "/" + maximo));
      card.appendChild(topo);

      var barra = criar("span", "horario__barra");
      var preenchido = criar("span", "horario__preenchido");
      preenchido.style.transform = "scaleX(" + (maximo ? Math.min(ocupadas / maximo, 1) : 0) + ")";
      barra.appendChild(preenchido);
      card.appendChild(barra);

      card.appendChild(criar("span", "horario__nota", cheio ? "Esgotado" : restantes + (restantes === 1 ? " vaga livre" : " vagas livres")));

      card.addEventListener("click", function () {
        state.horario = state.horario === h.hora ? "" : h.hora;
        filtroHorario.value = state.horario;
        renderizarHorarios();
        renderizarLista();
      });

      horariosEl.appendChild(card);
    });

    notaHorarios.textContent = totalOcupadas + " de " + totalVagas + " vagas ocupadas";
  }

  function renderizarFiltro() {
    var atual = state.horario;
    filtroHorario.textContent = "";

    var todos = document.createElement("option");
    todos.value = "";
    todos.textContent = "Todos os horários";
    filtroHorario.appendChild(todos);

    (state.dados ? state.dados.horarios : []).forEach(function (h) {
      var opcao = document.createElement("option");
      opcao.value = h.hora;
      opcao.textContent = h.hora + " · " + h.ocupadas + "/" + h.vagas_max;
      filtroHorario.appendChild(opcao);
    });

    filtroHorario.value = atual;
  }

  function criarCelula(texto, classe) {
    var td = document.createElement("td");
    if (classe) td.className = classe;
    td.textContent = texto;
    return td;
  }

  function renderizarTabela(lista) {
    corpoTabela.textContent = "";

    lista.forEach(function (item) {
      var tr = document.createElement("tr");

      tr.appendChild(criarCelula(item.horario, "tabela__hora"));
      tr.appendChild(criarCelula(item.nome, "tabela__nome"));
      tr.appendChild(criarCelula(item.cpf, "tabela__protocolo"));

      var tdContato = document.createElement("td");
      var contato = criar("div", "tabela__contato");
      contato.appendChild(criar("span", "", item.email));
      contato.appendChild(criar("span", "", formatarCelular(item.celular)));
      tdContato.appendChild(contato);
      tr.appendChild(tdContato);

      tr.appendChild(criarCelula(item.como_soube, ""));
      tr.appendChild(criarCelula(formatarDataHora(item.criado_em), "tabela__protocolo"));
      tr.appendChild(criarCelula(protocoloCurto(item.protocolo), "tabela__protocolo"));

      corpoTabela.appendChild(tr);
    });
  }

  function renderizarCartoes(lista) {
    cartoesEl.textContent = "";

    lista.forEach(function (item) {
      var li = criar("li", "cartao");

      var topo = criar("div", "cartao__topo");
      topo.appendChild(criar("span", "cartao__hora", item.horario));
      topo.appendChild(criar("span", "cartao__protocolo", protocoloCurto(item.protocolo)));
      li.appendChild(topo);

      li.appendChild(criar("strong", "cartao__nome", item.nome));
      li.appendChild(criar("p", "cartao__cpf", item.cpf));

      var linhas = criar("div", "cartao__linhas");
      linhas.appendChild(criar("span", "", item.email));
      linhas.appendChild(criar("span", "", formatarCelular(item.celular)));
      li.appendChild(linhas);

      var rodape = criar("div", "cartao__rodape");
      rodape.appendChild(criar("span", "", item.como_soube));
      rodape.appendChild(criar("span", "", formatarDataCurta(item.criado_em)));
      li.appendChild(rodape);

      cartoesEl.appendChild(li);
    });
  }

  function renderizarLista() {
    if (!state.dados) return;

    var lista = inscricoesFiltradas();
    var total = state.dados.inscricoes.length;
    var filtrando = Boolean(state.busca || state.horario);

    contagemEl.textContent = filtrando
      ? lista.length + " de " + total
      : lista.length + (lista.length === 1 ? " inscrição" : " inscrições");

    renderizarTabela(lista);
    renderizarCartoes(lista);

    var vazia = lista.length === 0;
    vazioEl.hidden = !vazia;
    tabelaWrap.hidden = vazia;
    cartoesEl.hidden = vazia;

    if (vazia) {
      if (total === 0) {
        vazioTitulo.textContent = "Ainda não há inscrições";
        vazioTexto.textContent = "As inscrições aparecem aqui assim que alguém agendar.";
        botaoLimpar.hidden = true;
      } else {
        vazioTitulo.textContent = "Nenhuma inscrição encontrada";
        vazioTexto.textContent = "Ajuste a busca ou o filtro de horário.";
        botaoLimpar.hidden = false;
      }
    } else {
      botaoLimpar.hidden = true;
    }
  }

  function renderizar() {
    if (!state.dados) return;

    var evento = state.dados.evento || {};
    var horario = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    subtitulo.textContent =
      (evento.nome ? evento.nome : "Bazar") +
      (evento.data ? " · " + dataLonga(evento.data) : "") +
      " · atualizado às " + horario;

    renderizarResumo();
    renderizarHorarios();
    renderizarFiltro();
    renderizarLista();
  }

  /* --------------------------------------------------------------- filtros */

  buscaInput.addEventListener("input", function () {
    clearTimeout(buscaTimer);
    buscaTimer = setTimeout(function () {
      state.busca = buscaInput.value;
      renderizarLista();
    }, 120);
  });

  filtroHorario.addEventListener("change", function () {
    state.horario = filtroHorario.value;
    renderizarHorarios();
    renderizarLista();
  });

  botaoLimpar.addEventListener("click", function () {
    state.busca = "";
    state.horario = "";
    buscaInput.value = "";
    filtroHorario.value = "";
    renderizarHorarios();
    renderizarLista();
    buscaInput.focus();
  });

  /* ---------------------------------------------------------------- export */

  function celulaCsv(valor) {
    var texto = String(valor == null ? "" : valor);
    // Evita injeção de fórmula ao abrir no Excel/Sheets.
    if (/^[=+\-@]/.test(texto)) texto = "'" + texto;
    return '"' + texto.replace(/"/g, '""') + '"';
  }

  botaoExportar.addEventListener("click", function () {
    var lista = inscricoesFiltradas();
    if (!lista.length) {
      mostrarAviso("Nada para exportar com os filtros atuais.", "erro");
      return;
    }

    var linhas = [
      ["Horário", "Nome", "CPF", "E-mail", "Celular", "Como soube", "Novidades", "Inscrito em", "Protocolo"]
    ];

    lista.forEach(function (item) {
      linhas.push([
        item.horario,
        item.nome,
        item.cpf,
        item.email,
        formatarCelular(item.celular),
        item.como_soube,
        item.novidades ? "Sim" : "Não",
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

    mostrarAviso("CSV exportado com " + lista.length + (lista.length === 1 ? " inscrição." : " inscrições."), "sucesso");
  });

  /* ------------------------------------------------------------ ciclo de vida */

  document.addEventListener("visibilitychange", function () {
    if (
      document.visibilityState === "visible" &&
      state.senha &&
      Date.now() - state.ultimaCarga > 60000
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
