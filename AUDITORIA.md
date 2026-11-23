# Auditoria de segurança e qualidade

Data: 2026-11-23  
Escopo: site público, painel da equipe, Edge Functions, banco Supabase, GitHub Actions e hospedagem.  
Método: revisão estática + dois agentes independentes (front-end e backend) + inspeção do banco e logs + teste em produção com requisições controladas + pesquisa online.

Referências usadas:
- Canadian Centre for Cyber Security — *Managing security risks in vibe coding* (ITSM.60.043)
- IBM — *Vibe Coding Security Risks Aren't Like Ordinary Security Risks*
- Supabase — *Securing Edge Functions* e *Securing your data*
- Wiz — *Vibe Coding Security Fundamentals*
- Engadget — *5 Safety Practices To Know Before Vibe Coding*

---

## 1. Críticos

### C1. Rate limit contornável por `X-Forwarded-For` — CORRIGIDO
As duas Edge Functions usavam o primeiro item de `X-Forwarded-For`, controlado pelo cliente.
**Correção:** passaram a usar apenas `cf-connecting-ip` e `x-real-ip`, definidos pela borda.

**Evidência:** 9 tentativas inválidas de agendamento, cada uma com um `X-Forwarded-For` diferente:
```
1..8 -> 422 CPF_INVALIDO
9    -> 429 MUITAS_TENTATIVAS
```
Se o header fosse confiável, cada tentativa teria um IP novo e nenhuma seria bloqueada.

### C2. Contador público era desfeito pelo rollback — CORRIGIDO
`bazar_agendar` inseria a tentativa e depois usava `raise exception`; o PostgREST fazia rollback do insert e o limite nunca contava falhas.
**Correção:** a função retorna `{ok:false, erro}` em vez de lançar exceção. A tentativa é commitada. Sucesso zera o contador do IP.

**Evidência:** as 8 falhas acima foram contadas e a 9ª bloqueou. Antes, a tabela `bazar_tentativas` ficava vazia após erros.

---

## 2. Altos

### A1. Senha do painel em `sessionStorage` — CORRIGIDO
O navegador guardava a senha e a reenviava a cada 15 s.
**Correção:** `/admin/login` valida a senha uma vez e devolve um **token opaco de 12 h**. O navegador guarda só o token; `/admin/dados` usa o token. O token é hash SHA-256 no banco (`bazar_admin_sessoes`). A chave antiga `bazar_admin_senha` é removida no boot.

### A2. CORS `*` nas duas funções — CORRIGIDO
**Correção:** allowlist para `https://wagner-aick.github.io` e `http://localhost:*`/`127.0.0.1:*`.

**Evidência:** requisição com `Origin: https://evil.example` retornou:
```
Access-Control-Allow-Origin: https://wagner-aick.github.io
```
Não ecoa a origem maliciosa.

### A3. CPF duplicado como oráculo + ausência de captcha — RESIDUAL
A resposta 409 confirma que um CPF está inscrito, e não há captcha. O rate limit corrigido reduz a automação, mas não elimina a inferência.
**Recomendação:** Cloudflare Turnstile no `POST /agendar`; resposta neutra para CPF duplicado; confirmação por e-mail (OTP).

### A4. Autenticação do painel sem identidade/MFA — RESIDUAL ACEITO
Senha única compartilhada, sem usuário por pessoa, sem MFA e sem trilha de auditoria de acesso.
**Recomendação:** migrar para Supabase Auth + MFA TOTP e uma tabela de autorização. Para a portaria, o token de 12 h e o lockout por IP reduzem o risco.

### A5. Legado com CPF em texto claro e políticas `{public}` — CORRIGIDO
As tabelas antigas (`cadastros`, `agendamentos`, `calendario_vagas`, `aux_dias_semana`, `teste`) tinham políticas públicas e funções/sequences abertas.
**Correção:** todas as políticas foram removidas; `fn_cadastrar_cliente`, `sp_agendar_vaga` e `rls_auto_enable` tiveram EXECUTE revogado; sequences perderam grants; *default privileges* de `anon`/`authenticated` foram revogados para novos objetos. As tabelas (0 linhas) foram preservadas.

### A6. Envio sem timeout e erro mascarado — CORRIGIDO
Ambos os `fetch` principais ganharam `AbortController` de 12 s. No formulário, o sucesso não é mais renderizado dentro do `try` de rede. `INSCRICOES_ENCERRADAS` agora fecha o formulário e mostra o aviso.

### A7. Celular colado com `+55` era truncado — CORRIGIDO
`+55 21 99999-9999` virava `55219999999` (DDD 55, sem o último dígito).
**Correção:** remove o `55` inicial quando o total é 12–13 dígitos; `maxlength` passou para 19. Placeholder corrigido para `+55 21 90000-0000`.

---

## 3. Médios corrigidos

- **Contraste:** `--texto-suave` público foi para `rgba(0,0,0,.62)` e a nota de segurança para `.56`; tokens do painel ficaram em `.62`/`.58`.
- **Termos:** o erro do checkbox agora pinta a caixa (`.marcador[data-erro="true"]`).
- **Auto-refresh:** não destrói foco dentro dos chips/lista e preserva o `scrollLeft` dos chips.
- **Fluxo encerrado:** `form.hidden = encerrado || sucesso visível`; reabre se o evento for reaberto; `visibilitychange` reconsulta.
- **`sessionStorage`:** leitura/escrita protegidas por try/catch.
- **Listbox:** o botão não usa mais `aria-labelledby` (o valor selecionado passa a compor o nome acessível).
- **Alvos de toque:** telefone na lista ganhou área de toque maior.
- **Cabeçalho do painel:** título com ellipsis para zoom 200%.
- **README:** removida a promessa de CSV e de botões que não existem.

## 4. Riscos residuais (não bloqueantes)

| Risco | Por que ficou | Próximo passo |
|---|---|---|
| Headers HTTP (CSP real, `frame-ancestors`, HSTS completo) | GitHub Pages não permite headers customizados | Migrar para Cloudflare/Netlify ou aceitar o risco documentado; CSP em meta não cobre `frame-ancestors` |
| Retenção/LGPD | Exige decisão de negócio | Job `pg_cron` para expurgar tentativas e definir TTL das inscrições; aviso de privacidade com controlador/contato |
| Captcha / oráculo de CPF | Exige chave do Turnstile | Ativar Turnstile e resposta neutra |
| MFA/identidade no painel | Escopo maior | Supabase Auth + MFA |
| Actions por tag | Pinning exige SHA exato | Fixar por SHA e habilitar Dependabot |
| Menu do calendário com `role="menu"` | Padrão APG incompleto | Trocar por disclosure ou implementar setas/Esc |
| Horários inativos somem da lista | Regra de negócio | Incluir grupos a partir das inscrições, não só dos horários ativos |

## 5. O que já estava correto

- RLS ligado, sem políticas nas tabelas `bazar_*`, com grants revogados.
- Funções `SECURITY DEFINER` com `search_path = ''` e referências qualificadas.
- Overbooking tratado com `SELECT … FOR UPDATE` e `UNIQUE (cpf_hash)`.
- CPF como HMAC-SHA256 com pepper no Vault + máscara.
- Sem `innerHTML`/XSS; dados renderizados com `textContent`.
- Sem chave de serviço no cliente; `service_role` só no runtime das Functions.
- CSP sem `unsafe-inline`, `base-uri 'none'`, `object-src 'none'`, `connect-src` restrito.
- Workflow com permissões mínimas e artefato sem `supabase/`, `README.md` ou `.git`.
- Honeypot, validação dupla (cliente + banco), encerramento por fuso `America/Sao_Paulo`.
