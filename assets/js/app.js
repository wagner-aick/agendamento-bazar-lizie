/* =============================================================================
   Bazar de Fábrica Lizie — agendamento
   Sem dependências. O cliente fala apenas com a Edge Function "bazar";
   nenhuma chave do Supabase fica exposta no navegador.
   ============================================================================= */

(function () {
  "use strict";

  // Troque aqui caso o projeto Supabase mude.
  var API_BASE = "https://molespouzrulyubcfxph.supabase.co/functions/v1/bazar";

  var state = {
    evento: null,
    horarios: [],
    horarioId: null,
    origem: "",
    enviando: false,
    agendamento: null,
    ultimaCarga: 0
  };

  var $ = function (seletor, raiz) {
    return (raiz || document).querySelector(seletor);
  };

  var form = $("#formulario");
  var sucesso = $("#sucesso");
  var cartao = $("#cartao");
  var avisoEl = $("#aviso");
  var botaoConfirmar = $("#confirmar");
  var avisoTimer = null;
  var encerradoSecao = $("#encerrado");
  var tituloEncerrado = $("#titulo-encerrado");
  var textoEncerrado = $("#texto-encerrado");
  var contagemEl = $("#contagem");
  var contagemTimer = null;

  /* ------------------------------------------------------------- utilidades */

  function somenteDigitos(texto) {
    return (texto || "").replace(/\D/g, "");
  }

  function preservarCursor(input, transformar, contar) {
    var inicio = input.selectionStart == null ? input.value.length : input.selectionStart;
    var antes = input.value;
    var referencia = 0;
    var i;
    for (i = 0; i < inicio; i += 1) {
      referencia += contar(antes.charAt(i));
    }
    var novo = transformar(antes);
    if (novo === antes) return;
    input.value = novo;
    var contados = 0;
    var pos = 0;
    for (i = 0; i < novo.length; i += 1) {
      if (contados >= referencia) break;
      contados += contar(novo.charAt(i));
      pos = i + 1;
    }
    try {
      input.setSelectionRange(pos, pos);
    } catch (erro) {
      /* alguns navegadores móveis não permitem; sem problema */
    }
  }

  function contarDigito(caractere) {
    return /\d/.test(caractere) ? 1 : 0;
  }

  function contarCaractere() {
    return 1;
  }

  /* ------------------------------------------------------------- formatação */

  function formatarCpf(valor) {
    var d = somenteDigitos(valor).slice(0, 11);
    if (d.length <= 3) return d;
    if (d.length <= 6) return d.slice(0, 3) + "." + d.slice(3);
    if (d.length <= 9) return d.slice(0, 3) + "." + d.slice(3, 6) + "." + d.slice(6);
    return d.slice(0, 3) + "." + d.slice(3, 6) + "." + d.slice(6, 9) + "-" + d.slice(9);
  }

  function formatarCelular(valor) {
    var d = somenteDigitos(valor);
    if ((d.length === 12 || d.length === 13) && d.slice(0, 2) === "55") {
      d = d.slice(2);
    }
    d = d.slice(0, 11);
    if (d.length <= 2) return d;
    var ddd = d.slice(0, 2);
    var resto = d.slice(2);
    if (resto.length <= 4) return ddd + " " + resto;
    var celular = resto.charAt(0) === "9" || resto.length > 8;
    var corte = celular ? 5 : 4;
    if (resto.length <= corte) return ddd + " " + resto;
    return ddd + " " + resto.slice(0, corte) + "-" + resto.slice(corte);
  }

  var PARTICULAS = { de: 1, da: 1, do: 1, das: 1, dos: 1, e: 1, y: 1 };

  function formatarNome(valor) {
    var limpo = (valor || "")
      .replace(/[0-9]/g, "")
      .replace(/[^A-Za-zÀ-ÖØ-öø-ÿ'’\-\s]/g, "")
      .replace(/\s{2,}/g, " ");
    return limpo
      .toLocaleLowerCase("pt-BR")
      .split(" ")
      .map(function (palavra) {
        if (!palavra) return palavra;
        if (PARTICULAS[palavra]) return palavra;
        return palavra.charAt(0).toLocaleUpperCase("pt-BR") + palavra.slice(1);
      })
      .join(" ");
  }

  function cpfValido(valor) {
    var cpf = somenteDigitos(valor);
    if (cpf.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(cpf)) return false;

    var soma = 0;
    var i;
    for (i = 0; i < 9; i += 1) soma += Number(cpf.charAt(i)) * (10 - i);
    var resto = (soma * 10) % 11;
    if (resto === 10) resto = 0;
    if (resto !== Number(cpf.charAt(9))) return false;

    soma = 0;
    for (i = 0; i < 10; i += 1) soma += Number(cpf.charAt(i)) * (11 - i);
    resto = (soma * 10) % 11;
    if (resto === 10) resto = 0;
    return resto === Number(cpf.charAt(10));
  }

  function emailValido(valor) {
    return /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(valor) && valor.length <= 254;
  }

  function celularValido(valor) {
    var d = somenteDigitos(valor);
    if (d.length > 11 && d.slice(0, 2) === "55") d = d.slice(2);
    if (d.length < 10 || d.length > 11) return false;
    var ddd = Number(d.slice(0, 2));
    return ddd >= 11 && ddd <= 99;
  }

  function nomeValido(valor) {
    var partes = valor.trim().split(/\s+/).filter(Boolean);
    return partes.length >= 2 && partes.join(" ").length >= 5;
  }

  /* ---------------------------------------------------------------- campos */

  var campos = {
    nome: { input: $("#nome"), erro: $("#erro-nome"), valida: nomeValido, mensagem: "Informe o nome e o sobrenome." },
    email: { input: $("#email"), erro: $("#erro-email"), valida: emailValido, mensagem: "Informe um e-mail válido." },
    celular: { input: $("#celular"), erro: $("#erro-celular"), valida: celularValido, mensagem: "Informe DDD + número." },
    cpf: { input: $("#cpf"), erro: $("#erro-cpf"), valida: cpfValido, mensagem: "CPF inválido. Confira os números." }
  };

  function marcarErro(nome, mensagem) {
    var campo = campos[nome];
    var caixa = campo.input.closest(".campo");
    if (!caixa) return;
    if (mensagem) {
      caixa.setAttribute("data-erro", "true");
      campo.input.setAttribute("aria-invalid", "true");
      campo.erro.textContent = mensagem;
      campo.erro.hidden = false;
    } else {
      caixa.removeAttribute("data-erro");
      campo.input.removeAttribute("aria-invalid");
      campo.erro.hidden = true;
      campo.erro.textContent = "";
    }
  }

  function limparErroGenerico(idErro, seletorCampo) {
    var erro = document.getElementById(idErro);
    if (!erro) return;
    erro.hidden = true;
    erro.textContent = "";
    var caixa = document.querySelector(seletorCampo);
    if (caixa) caixa.removeAttribute("data-erro");
  }

  function validarCampo(nome, silencioso) {
    var campo = campos[nome];
    var valor = campo.input.value.trim();
    if (!campo.valida(valor)) {
      if (!silencioso) marcarErro(nome, campo.mensagem);
      return false;
    }
    marcarErro(nome, "");
    return true;
  }

  function validarHorario(silencioso) {
    var caixa = document.querySelector('[data-campo="horario"]');
    var erro = $("#erro-horario");
    var escolhido = state.horarios.filter(function (h) {
      return h.id === state.horarioId;
    })[0];

    if (!escolhido) {
      if (!silencioso) {
        caixa.setAttribute("data-erro", "true");
        erro.textContent = "Escolha o horário da sua visita.";
        erro.hidden = false;
      }
      return false;
    }
    if (escolhido.vagas_restantes <= 0) {
      if (!silencioso) {
        caixa.setAttribute("data-erro", "true");
        erro.textContent = "Este horário esgotou. Escolha outro.";
        erro.hidden = false;
      }
      return false;
    }
    caixa.removeAttribute("data-erro");
    erro.hidden = true;
    return true;
  }

  function validarOrigem(silencioso) {
    var caixa = document.querySelector('[data-campo="origem"]');
    var erro = $("#erro-origem");
    if (!state.origem) {
      if (!silencioso) {
        caixa.setAttribute("data-erro", "true");
        erro.textContent = "Selecione como soube do bazar.";
        erro.hidden = false;
      }
      return false;
    }
    caixa.removeAttribute("data-erro");
    erro.hidden = true;
    return true;
  }

  function validarTermos(silencioso) {
    var caixa = document.querySelector('[data-campo="termos"]');
    var erro = $("#erro-termos");
    var marcado = $("#termos").checked;
    if (!marcado) {
      if (!silencioso) {
        caixa.setAttribute("data-erro", "true");
        erro.textContent = "É necessário aceitar este aviso para continuar.";
        erro.hidden = false;
      }
      return false;
    }
    caixa.removeAttribute("data-erro");
    erro.hidden = true;
    return true;
  }

  function validarTudo(silencioso) {
    var ok = true;
    ["nome", "email", "celular", "cpf"].forEach(function (nome) {
      if (!validarCampo(nome, silencioso)) ok = false;
    });
    if (!validarHorario(silencioso)) ok = false;
    if (!validarOrigem(silencioso)) ok = false;
    if (!validarTermos(silencioso)) ok = false;
    return ok;
  }

  function focarPrimeiroErro() {
    var alvo = document.querySelector('[data-erro="true"] input, [data-erro="true"] .selecao__botao');
    if (alvo) {
      alvo.focus();
      alvo.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  /* ---------------------------------------------------------------- máscaras */

  function aplicarMascara(input, transformar, contar) {
    input.addEventListener("input", function () {
      preservarCursor(input, transformar, contar);
    });
  }

  aplicarMascara($("#cpf"), formatarCpf, contarDigito);
  $("#celular").addEventListener("input", function () {
    var input = this;
    var d = somenteDigitos(input.value);
    if (d.length > 11 && d.slice(0, 2) === "55") d = d.slice(2);
    d = d.slice(0, 11);
    var local = formatarCelular(d);
    var novo = local ? "+55 " + local : "";
    if (novo !== input.value) {
      input.value = novo;
      try {
        input.setSelectionRange(novo.length, novo.length);
      } catch (erro) {
        /* alguns navegadores móveis não permitem */
      }
    }
  });
  aplicarMascara($("#nome"), formatarNome, contarCaractere);

  $("#email").addEventListener("input", function (evento) {
    var input = evento.target;
    preservarCursor(
      input,
      function (valor) {
        return valor.replace(/\s+/g, "").toLocaleLowerCase("pt-BR");
      },
      function (caractere) {
        return caractere === " " ? 0 : 1;
      }
    );
  });

  Object.keys(campos).forEach(function (nome) {
    var campo = campos[nome];
    campo.input.addEventListener("blur", function () {
      if (campo.input.value.trim() !== "") validarCampo(nome);
    });
    campo.input.addEventListener("input", function () {
      if (campo.input.closest(".campo").getAttribute("data-erro") === "true") {
        validarCampo(nome, true);
      }
    });
  });

  $("#termos").addEventListener("change", function () {
    if (this.checked) validarTermos();
  });

  /* -------------------------------------------------------------- seletores */

  function criarSelecao(raiz, aoEscolher) {
    var botao = $(".selecao__botao", raiz);
    var lista = $(".selecao__lista", raiz);
    var valorEl = $("[data-valor]", botao);
    var dicaEl = $("[data-dica]", botao);
    var indiceAtivo = -1;

    function itens() {
      return Array.prototype.slice.call(lista.querySelectorAll('[role="option"]'));
    }

    function habilitados() {
      return itens().filter(function (item) {
        return item.getAttribute("aria-disabled") !== "true";
      });
    }

    function estaAberto() {
      return raiz.getAttribute("data-aberto") === "true";
    }

    function abrir() {
      if (botao.disabled || estaAberto()) return;
      raiz.setAttribute("data-aberto", "true");
      lista.setAttribute("aria-hidden", "false");
      botao.setAttribute("aria-expanded", "true");
      var selecionado = lista.querySelector('[aria-selected="true"]:not([aria-disabled="true"])');
      var alvo = selecionado || habilitados()[0];
      definirAtivo(alvo);
    }

    function fechar(devolverFoco) {
      if (!estaAberto()) return;
      raiz.removeAttribute("data-aberto");
      lista.setAttribute("aria-hidden", "true");
      botao.setAttribute("aria-expanded", "false");
      itens().forEach(function (item) {
        item.removeAttribute("data-ativo");
      });
      indiceAtivo = -1;
      if (devolverFoco) botao.focus();
    }

    function definirAtivo(item) {
      itens().forEach(function (i) {
        i.removeAttribute("data-ativo");
      });
      if (!item) {
        indiceAtivo = -1;
        return;
      }
      item.setAttribute("data-ativo", "true");
      indiceAtivo = itens().indexOf(item);
      item.scrollIntoView({ block: "nearest" });
    }

    function mover(passo) {
      var disponiveis = itens().filter(function (item) {
        return item.getAttribute("aria-disabled") !== "true";
      });
      if (!disponiveis.length) return;
      var atual = lista.querySelector('[data-ativo="true"]');
      var indice = disponiveis.indexOf(atual);
      var proximo = indice < 0 ? (passo > 0 ? 0 : disponiveis.length - 1) : indice + passo;
      if (proximo < 0) proximo = disponiveis.length - 1;
      if (proximo >= disponiveis.length) proximo = 0;
      definirAtivo(disponiveis[proximo]);
    }

    function escolher(item) {
      if (!item || item.getAttribute("aria-disabled") === "true") return;
      itens().forEach(function (i) {
        i.setAttribute("aria-selected", i === item ? "true" : "false");
      });
      valorEl.textContent = item.getAttribute("data-rotulo") || item.textContent.trim();
      botao.removeAttribute("data-vazio");
      if (dicaEl) dicaEl.textContent = item.getAttribute("data-dica") || "";
      aoEscolher(item);
      fechar(true);
    }

    botao.addEventListener("click", function () {
      if (!estaAberto()) abrir();
      else fechar(false);
    });

    botao.addEventListener("keydown", function (evento) {
      if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
        evento.preventDefault();
        if (!estaAberto()) abrir();
        else mover(evento.key === "ArrowDown" ? 1 : -1);
      } else if (evento.key === "Enter" || evento.key === " ") {
        evento.preventDefault();
        if (!estaAberto()) abrir();
        else {
          var ativo = lista.querySelector('[data-ativo="true"]');
          escolher(ativo);
        }
      } else if (evento.key === "Escape") {
        fechar(true);
      } else if (evento.key === "Home" || evento.key === "End") {
        if (!estaAberto()) return;
        evento.preventDefault();
        var disponiveis = habilitados();
        definirAtivo(evento.key === "Home" ? disponiveis[0] : disponiveis[disponiveis.length - 1]);
      }
    });

    lista.addEventListener("click", function (evento) {
      var item = evento.target.closest('[role="option"]');
      if (item) escolher(item);
    });

    lista.addEventListener("mousemove", function (evento) {
      var item = evento.target.closest('[role="option"]');
      if (item && item !== lista.querySelector('[data-ativo="true"]')) definirAtivo(item);
    });

    document.addEventListener("click", function (evento) {
      if (!raiz.contains(evento.target)) fechar(false);
    });

    document.addEventListener("focusin", function (evento) {
      if (!raiz.contains(evento.target)) fechar(false);
    });

    return {
      botao: botao,
      valorEl: valorEl,
      dicaEl: dicaEl,
      lista: lista,
      fechar: fechar,
      definir: function (texto, dica) {
        valorEl.textContent = texto;
        botao.setAttribute("data-vazio", "true");
        if (dicaEl) dicaEl.textContent = dica || "";
      }
    };
  }

  var selecaoHorario = criarSelecao($("#selecao-horario"), function (item) {
    state.horarioId = Number(item.getAttribute("data-id"));
    document.querySelector('[data-campo="horario"]').removeAttribute("data-erro");
    $("#erro-horario").hidden = true;
  });

  var selecaoOrigem = criarSelecao($("#selecao-origem"), function (item) {
    state.origem = item.getAttribute("data-valor");
    document.querySelector('[data-campo="origem"]').removeAttribute("data-erro");
    $("#erro-origem").hidden = true;
  });

  /* ------------------------------------------------------------- horários */

  function rotuloVagas(quantidade) {
    if (quantidade <= 0) return "Esgotado";
    return quantidade + (quantidade === 1 ? " vaga restante" : " vagas restantes");
  }

  function renderizarHorarios() {
    var lista = selecaoHorario.lista;
    lista.textContent = "";

    if (!state.horarios.length) {
      var vazio = document.createElement("li");
      vazio.setAttribute("role", "option");
      vazio.setAttribute("aria-disabled", "true");
      vazio.textContent = "Nenhum horário disponível";
      lista.appendChild(vazio);
      selecaoHorario.definir("Nenhum horário disponível", "");
      selecaoHorario.botao.disabled = true;
      return;
    }

    state.horarios.forEach(function (horario) {
      var item = document.createElement("li");
      item.setAttribute("role", "option");
      item.setAttribute("data-id", String(horario.id));
      item.setAttribute("data-rotulo", horario.hora);
      item.setAttribute("data-valor", horario.hora);
      item.setAttribute("data-dica", rotuloVagas(horario.vagas_restantes));
      item.setAttribute("aria-selected", horario.id === state.horarioId ? "true" : "false");

      var hora = document.createElement("span");
      hora.textContent = horario.hora;
      item.appendChild(hora);

      var qtd = document.createElement("span");
      qtd.className = "qtd";
      qtd.textContent = rotuloVagas(horario.vagas_restantes);
      item.appendChild(qtd);

      if (horario.vagas_restantes <= 0) {
        item.setAttribute("aria-disabled", "true");
      }

      lista.appendChild(item);
    });

    selecaoHorario.botao.disabled = false;

    var atual = state.horarios.filter(function (h) {
      return h.id === state.horarioId;
    })[0];

    if (atual) {
      selecaoHorario.valorEl.textContent = atual.hora;
      selecaoHorario.dicaEl.textContent = rotuloVagas(atual.vagas_restantes);
      selecaoHorario.botao.removeAttribute("data-vazio");
    } else {
      state.horarioId = null;
      selecaoHorario.definir("Selecione um horário", "");
    }
  }

  function atualizarCapa() {
    // A capa é uma arte estática; nada a sincronizar no DOM.
  }

  async function carregarHorarios(forcar) {
    var agora = Date.now();
    if (!forcar && agora - state.ultimaCarga < 15000) return;
    try {
      var resposta = await fetch(API_BASE + "/horarios", { headers: { Accept: "application/json" } });
      if (!resposta.ok) throw new Error("HTTP " + resposta.status);
      var dados = await resposta.json();
      state.horarios = Array.isArray(dados.horarios) ? dados.horarios : [];
      state.evento = dados.evento || null;
      state.ultimaCarga = agora;
      atualizarCapa(state.evento);
      renderizarHorarios();

      if (state.evento && state.evento.aberto === false) {
        bloquearAgendamento();
      } else if (sucesso.hidden) {
        liberarAgendamento();
      }
    } catch (erro) {
      selecaoHorario.definir("Não foi possível carregar", "");
      selecaoHorario.botao.disabled = true;
      mostrarAviso("Não conseguimos carregar os horários. Verifique sua conexão e recarregue a página.", "erro");
    }
  }

  /* ------------------------------------------------ abertura programada */

  function quandoAbre(iso) {
    var data = new Date(iso);
    if (!iso || isNaN(data.getTime())) return "";
    var dia = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit"
    }).format(data);
    var hora = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(data);
    return dia + ", às " + hora;
  }

  function contagemRestante(iso) {
    var alvo = new Date(iso).getTime();
    if (!iso || !isFinite(alvo)) return "";
    var segundos = Math.floor((alvo - Date.now()) / 1000);
    if (segundos <= 0) return "";

    var dias = Math.floor(segundos / 86400);
    var horas = Math.floor((segundos % 86400) / 3600);
    var minutos = Math.floor((segundos % 3600) / 60);
    var resto = segundos % 60;
    var dois = function (n) {
      return String(n).padStart(2, "0");
    };

    if (dias > 0) return "Abre em " + dias + (dias === 1 ? " dia" : " dias") + " e " + horas + "h";
    if (horas > 0) return "Abre em " + horas + "h " + dois(minutos) + "min";
    if (minutos > 0) return "Abre em " + minutos + "min " + dois(resto) + "s";
    return "Abre em " + resto + "s";
  }

  function atualizarContagem() {
    var iso = state.evento && state.evento.abre_em;
    var texto = contagemRestante(iso);
    if (!texto) {
      desligarContagem();
      contagemEl.hidden = true;
      contagemEl.textContent = "";
      carregarHorarios(true);
      return;
    }
    contagemEl.textContent = texto;
    contagemEl.hidden = false;
  }

  function ligarContagem() {
    if (contagemTimer) return;
    contagemTimer = window.setInterval(atualizarContagem, 1000);
  }

  function desligarContagem() {
    if (!contagemTimer) return;
    window.clearInterval(contagemTimer);
    contagemTimer = null;
  }

  function bloquearAgendamento() {
    var iso = state.evento && state.evento.abre_em;
    var alvo = iso ? new Date(iso).getTime() : 0;
    var aguardando = Boolean(iso) && isFinite(alvo) && alvo > Date.now();

    form.hidden = true;
    selecaoHorario.botao.disabled = true;
    botaoConfirmar.disabled = true;
    encerradoSecao.hidden = false;

    if (aguardando) {
      tituloEncerrado.textContent = "As inscrições ainda não abriram";
      textoEncerrado.textContent = "O agendamento abre em " + quandoAbre(iso) + ".";
      atualizarContagem();
      ligarContagem();
    } else {
      tituloEncerrado.textContent = "Agendamento encerrado";
      textoEncerrado.textContent = "As inscrições para este bazar foram encerradas.";
      contagemEl.hidden = true;
      contagemEl.textContent = "";
      desligarContagem();
    }
  }

  function liberarAgendamento() {
    desligarContagem();
    encerradoSecao.hidden = true;
    contagemEl.hidden = true;
    contagemEl.textContent = "";
    form.hidden = false;
    selecaoHorario.botao.disabled = false;
    botaoConfirmar.disabled = false;
    renderizarHorarios();
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
      }, 340);
    }, 6000);
  }

  /* ---------------------------------------------------------------- envio */

  function montarPayload() {
    return {
      nome: $("#nome").value.trim(),
      email: $("#email").value.trim(),
      cpf: $("#cpf").value.trim(),
      celular: $("#celular").value.replace(/^\+55\s*/, "").trim(),
      horarioId: state.horarioId,
      comoSoube: state.origem,
      aceitaNovidades: $("#novidades").checked,
      aceitaTermos: $("#termos").checked,
      website: $("#website").value
    };
  }

  function definirCarregando(ativo) {
    state.enviando = ativo;
    botaoConfirmar.disabled = ativo;
    botaoConfirmar.setAttribute("data-carregando", ativo ? "true" : "false");
    botaoConfirmar.setAttribute("aria-busy", ativo ? "true" : "false");
  }

  form.addEventListener("submit", async function (evento) {
    evento.preventDefault();
    if (state.enviando) return;

    if (state.evento && state.evento.aberto === false) {
      var abreEm = state.evento.abre_em ? new Date(state.evento.abre_em).getTime() : 0;
      if (abreEm && abreEm > Date.now()) {
        mostrarAviso("O agendamento abre em " + quandoAbre(state.evento.abre_em) + ".", "info");
      } else {
        mostrarAviso("Agendamento encerrado.", "erro");
      }
      return;
    }

    if (!validarTudo(false)) {
      focarPrimeiroErro();
      return;
    }

    definirCarregando(true);

    var controle = new AbortController();
    var limite = setTimeout(function () {
      controle.abort();
    }, 12000);

    try {
      var resposta = await fetch(API_BASE + "/agendar", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(montarPayload()),
        signal: controle.signal
      });

      var dados = null;
      try {
        dados = await resposta.json();
      } catch (erroLeitura) {
        dados = null;
      }

      if (!resposta.ok || !dados || dados.ok !== true) {
        tratarFalha(dados, resposta.status);
        return;
      }

      if (!dados.protocolo) {
        // Honeypot: resposta neutra, sem criar nada.
        mostrarAviso("Não foi possível concluir. Tente novamente.", "erro");
        return;
      }

      state.agendamento = {
        protocolo: dados.protocolo,
        horario: dados.horario,
        nome: $("#nome").value.trim()
      };
      mostrarSucesso();
    } catch (erro) {
      mostrarAviso("Sem conexão com o servidor. Tente novamente em instantes.", "erro");
    } finally {
      definirCarregando(false);
    }
  });

  function tratarFalha(dados, status) {
    var codigo = dados && dados.erro ? dados.erro : "";
    var mensagem = dados && dados.mensagem ? dados.mensagem : "Não foi possível concluir o agendamento.";

    if (codigo === "CPF_JA_CADASTRADO") {
      marcarErro("cpf", mensagem);
      campos.cpf.input.focus();
      campos.cpf.input.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    if (codigo === "CPF_INVALIDO") {
      marcarErro("cpf", mensagem);
      campos.cpf.input.focus();
      return;
    }

    if (codigo === "EMAIL_INVALIDO") {
      marcarErro("email", mensagem);
      campos.email.input.focus();
      return;
    }

    if (codigo === "CELULAR_INVALIDO") {
      marcarErro("celular", mensagem);
      campos.celular.input.focus();
      return;
    }

    if (codigo === "NOME_INVALIDO") {
      marcarErro("nome", mensagem);
      campos.nome.input.focus();
      return;
    }

    if (codigo === "HORARIO_ESGOTADO" || codigo === "HORARIO_INVALIDO") {
      state.horarioId = null;
      carregarHorarios(true);
      var caixa = document.querySelector('[data-campo="horario"]');
      caixa.setAttribute("data-erro", "true");
      $("#erro-horario").textContent = mensagem;
      $("#erro-horario").hidden = false;
      selecaoHorario.botao.focus();
      return;
    }

    if (codigo === "TERMOS_OBRIGATORIOS") {
      validarTermos(false);
      $("#termos").focus();
      return;
    }

    if (codigo === "AGENDAMENTO_NAO_ABERTO" || codigo === "INSCRICOES_ENCERRADAS") {
      if (state.evento) state.evento.aberto = false;
      bloquearAgendamento();
      mostrarAviso(mensagem, "erro");
      return;
    }

    mostrarAviso(mensagem, "erro");
  }

  /* --------------------------------------------------------------- sucesso */

  var MESES = [
    "janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
  ];

  function dataLonga(iso) {
    if (!iso) return "";
    var partes = String(iso).split("-");
    if (partes.length !== 3) return iso;
    var dia = Number(partes[2]);
    var mes = MESES[Number(partes[1]) - 1] || "";
    return dia + " de " + mes + " de " + partes[0];
  }

  function protocoloCurto(id) {
    return "LZ-" + String(id).replace(/-/g, "").slice(0, 8).toUpperCase();
  }

  function mostrarSucesso() {
    var agendamento = state.agendamento;
    var evento = state.evento || {};
    var data = dataLonga(evento.data);

    $("#sucesso-nome").textContent = agendamento.nome;
    $("#sucesso-data").textContent = data || "01 de dezembro de 2026";
    $("#sucesso-horario").textContent = agendamento.horario || "";
    $("#sucesso-protocolo").textContent = protocoloCurto(agendamento.protocolo);

    var primeiroNome = agendamento.nome.split(" ")[0];
    $("#sucesso-resumo").textContent =
      primeiroNome + ", seu horário está reservado para " +
      (data ? data : "o dia do bazar") + ", às " + agendamento.horario + ".";

    form.hidden = true;
    sucesso.hidden = false;
    sucesso.setAttribute("tabindex", "-1");
    sucesso.focus({ preventScroll: true });

    var reduzir = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    sucesso.scrollIntoView({ behavior: reduzir ? "auto" : "smooth", block: "start" });

    // Atualiza as vagas em segundo plano.
    setTimeout(function () {
      carregarHorarios(true);
    }, 1200);
  }

  $("#reiniciar").addEventListener("click", function () {
    form.reset();
    state.horarioId = null;
    state.origem = "";
    state.agendamento = null;
    Object.keys(campos).forEach(function (nome) {
      marcarErro(nome, "");
    });
    limparErroGenerico("erro-horario", '[data-campo="horario"]');
    limparErroGenerico("erro-origem", '[data-campo="origem"]');
    limparErroGenerico("erro-termos", '[data-campo="termos"]');
    selecaoOrigem.valorEl.textContent = "Selecione uma opção";
    selecaoOrigem.botao.setAttribute("data-vazio", "true");
    selecaoOrigem.lista.querySelectorAll('[role="option"]').forEach(function (item) {
      item.setAttribute("aria-selected", "false");
    });
    renderizarHorarios();
    sucesso.hidden = true;
    if (state.evento && state.evento.aberto === false) {
      bloquearAgendamento();
    } else {
      liberarAgendamento();
    }
    carregarHorarios(true);
    $("#nome").focus();
    cartao.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  /* ------------------------------------------------------------ calendário */

  function montarIcs() {
    var agendamento = state.agendamento;
    if (!agendamento) return "";
    var evento = state.evento || {};
    var data = (evento.data || "2026-12-01").replace(/-/g, "");
    var hora = String(agendamento.horario || "09:00").replace(":", "");
    var inicio = data + "T" + hora + "00";
    var fimHora = String(Number(hora.slice(0, 2)) + 1).padStart(2, "0") + hora.slice(2);
    var fim = data + "T" + fimHora + "00";
    var agora = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

    var linhas = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Lizie//Bazar de Fabrica//PT-BR",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      "UID:" + agendamento.protocolo + "@bazar-lizie",
      "DTSTAMP:" + agora,
      "DTSTART:" + inicio,
      "DTEND:" + fim,
      "SUMMARY:Bazar de Fábrica Lizie — " + agendamento.horario,
      "LOCATION:Rua Capt. Felix\\, 34 - Benfica\\, Rio de Janeiro",
      "DESCRIPTION:Agendamento confirmado. Protocolo " + protocoloCurto(agendamento.protocolo) + ". Apresente seu CPF na entrada.",
      "BEGIN:VALARM",
      "TRIGGER:-PT2H",
      "ACTION:DISPLAY",
      "DESCRIPTION:Bazar de Fábrica Lizie em 2 horas",
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR"
    ];

    return linhas.join("\r\n");
  }

  function nomeArquivoIcs() {
    var agendamento = state.agendamento;
    return "bazar-lizie-" + (agendamento && agendamento.horario ? agendamento.horario.replace(":", "") : "agendamento") + ".ics";
  }

  function baixarIcs() {
    var texto = montarIcs();
    if (!texto) return;
    var blob = new Blob([texto], { type: "text/calendar;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = nomeArquivoIcs();
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 2000);
  }

  function dadosCalendario() {
    var agendamento = state.agendamento;
    if (!agendamento) return null;
    var evento = state.evento || {};
    var data = evento.data || "2026-12-01";
    var partes = String(agendamento.horario || "09:00").split(":");
    var hh = String(Number(partes[0])).padStart(2, "0");
    var mm = partes[1] || "00";
    var proxima = String(Number(partes[0]) + 1).padStart(2, "0");
    var compacta = data.replace(/-/g, "");
    return {
      titulo: "Bazar de Fábrica Lizie — " + agendamento.horario,
      local: "Rua Capt. Felix, 34 - Benfica, Rio de Janeiro - RJ",
      detalhes: "Agendamento confirmado. Protocolo " + protocoloCurto(agendamento.protocolo) + ". Apresente seu CPF na entrada.",
      googleInicio: compacta + "T" + hh + mm + "00",
      googleFim: compacta + "T" + proxima + mm + "00",
      outlookInicio: data + "T" + hh + ":" + mm + ":00",
      outlookFim: data + "T" + proxima + ":" + mm + ":00"
    };
  }

  function linkGoogle(dados) {
    var params = new URLSearchParams({
      action: "TEMPLATE",
      text: dados.titulo,
      dates: dados.googleInicio + "/" + dados.googleFim,
      ctz: "America/Sao_Paulo",
      details: dados.detalhes,
      location: dados.local
    });
    return "https://calendar.google.com/calendar/render?" + params.toString();
  }

  function linkOutlook(dados) {
    var params = new URLSearchParams({
      path: "/calendar/action/compose",
      rru: "addevent",
      subject: dados.titulo,
      startdt: dados.outlookInicio,
      enddt: dados.outlookFim,
      body: dados.detalhes,
      location: dados.local
    });
    return "https://outlook.live.com/calendar/0/deeplink/compose?" + params.toString();
  }

  var menuCalendario = $("#menu-calendario");
  var botaoCalendario = $("#baixar-calendario");

  function abrirMenuCalendario() {
    var dados = dadosCalendario();
    if (!dados) return;
    $("#cal-google").href = linkGoogle(dados);
    $("#cal-outlook").href = linkOutlook(dados);
    menuCalendario.hidden = false;
    botaoCalendario.setAttribute("aria-expanded", "true");
  }

  function fecharMenuCalendario() {
    if (menuCalendario.hidden) return;
    menuCalendario.hidden = true;
    botaoCalendario.setAttribute("aria-expanded", "false");
  }

  botaoCalendario.addEventListener("click", async function () {
    var texto = montarIcs();
    if (!texto) return;

    // No celular, abre a folha de compartilhamento do sistema: o usuário
    // escolhe o app de calendário que já usa.
    var movel = window.matchMedia("(pointer: coarse)").matches;
    if (movel && navigator.canShare && typeof File !== "undefined") {
      var arquivo = new File([texto], nomeArquivoIcs(), { type: "text/calendar" });
      if (navigator.canShare({ files: [arquivo] })) {
        try {
          await navigator.share({
            files: [arquivo],
            title: "Bazar de Fábrica Lizie",
            text: "Agendamento no Bazar de Fábrica Lizie"
          });
          return;
        } catch (erro) {
          if (erro && erro.name === "AbortError") return;
        }
      }
    }

    if (menuCalendario.hidden) abrirMenuCalendario();
    else fecharMenuCalendario();
  });

  $("#cal-ics").addEventListener("click", function () {
    baixarIcs();
    fecharMenuCalendario();
  });

  ["#cal-google", "#cal-outlook"].forEach(function (seletor) {
    $(seletor).addEventListener("click", fecharMenuCalendario);
  });

  document.addEventListener("click", function (evento) {
    if (!evento.target.closest("#calendario")) fecharMenuCalendario();
  });

  document.addEventListener("keydown", function (evento) {
    if (evento.key === "Escape") fecharMenuCalendario();
  });

  /* ------------------------------------------------------------- ciclo de vida */

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && sucesso.hidden) {
      carregarHorarios(false);
    }
  });

  carregarHorarios(true);
})();
