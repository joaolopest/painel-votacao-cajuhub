# Painel de Votação em Tempo Real

Painel onde múltiplos usuários votam simultaneamente e os resultados aparecem na tela de todos, instantaneamente, sem reload — via Supabase Realtime (WebSockets).

## O que faz

- Pergunta com 4 opções de voto.
- Voto único por pessoa (localStorage no front + UNIQUE no banco).
- Quando alguém vota, todas as abas abertas atualizam em tempo real.
- O contador da opção votada é atualizado **cirurgicamente** — só aquele nó da DOM muda, nada é re-renderizado do zero.
- Feedback visual: contador, barra de progresso, percentual e destaque na opção líder.

## Stack

- HTML + CSS + JavaScript puros, sem framework, sem build step.
- Supabase (PostgreSQL + Realtime via WebSockets).
- Cliente Supabase JS via ESM CDN (`esm.sh`).

## Como rodar

### 1. Criar projeto no Supabase

1. Cria conta em https://supabase.com.
2. Cria um novo projeto.
3. Em **Project Settings → API**, copia:
   - `Project URL`
   - `anon public key`

### 2. Rodar o SQL

1. No painel do Supabase, vai em **SQL Editor**.
2. Cola o conteúdo de [`supabase.sql`](./supabase.sql) e executa.
3. Isso cria as tabelas `opcoes` e `votos`, configura RLS, habilita realtime e popula as 4 opções iniciais.

### 3. Configurar credenciais

```sh
cp config.example.js config.js
```

Abre `config.js` e cola a `Project URL` e a `anon public key`.

> `config.js` está no `.gitignore`. Nunca commite.

### 4. Servir os arquivos

O projeto usa ESM (`import`), então não dá pra abrir `index.html` direto pelo `file://`. Precisa servir por HTTP. Qualquer um basta:

```sh
# opção 1: python (vem instalado no Mac)
python3 -m http.server 8080

# opção 2: node
npx serve .

# opção 3: live-server (auto-reload no save)
npx live-server
```

Abre `http://localhost:8080`.

### 5. Testar tempo real

Abre **duas abas** no mesmo endereço. Vota numa. A outra atualiza sem reload — só o número e a barra da opção votada se mexem.

> Dica de teste: como o voto é único por pessoa (localStorage), pra simular votos diferentes na mesma máquina abre uma aba normal e outra anônima, ou limpa o localStorage entre votos.

---

## Decisões técnicas

### 1. Modelagem do banco — duas tabelas em vez de contador denormalizado

```
opcoes  (id, texto, ordem, criado_em)
votos   (id, opcao_id → opcoes.id, voter_hash UNIQUE, criado_em)
```

**Alternativa descartada:** contador denormalizado (`opcoes.total`). Realtime escutaria UPDATE e o payload já viria com o novo total — mais simples no front.

**Por que descartei:**
- Não dá pra auditar votos individuais.
- INSERT carrega `opcao_id` no payload, que é exatamente o dado que preciso pro update cirúrgico — então a "vantagem" do contador desaparece.
- UNIQUE em `voter_hash` no banco é a barreira honesta contra voto duplo. Só faz sentido se cada voto é uma linha.

**Tradeoff aceito:** a contagem inicial agrega votos no client (`SELECT opcao_id FROM votos` + agrupamento em JS). Pra escala maior, viraria uma view materializada ou função RPC. Pro escopo desta enquete, é trivial.

### 2. Update cirúrgico (o coração do projeto)

Veja [`app.js`, função `atualizarSurgical`](./app.js).

Quando o INSERT de realtime chega:

1. O payload contém `payload.new.opcao_id`.
2. Localizo o nó com `[data-opcao-id="..."]` e atualizo **só** o `<span data-numero>` daquela opção, com classe `.pulse` pra animar o feedback.
3. Recalculo as barras e percentuais de todas as opções — porque o denominador (total) mudou. Mas isso é mutação direta de elementos existentes, não re-render: nenhum nó é destruído, nenhum listener é reanexado.

**Decisão consciente:** o que é cirúrgico é o número da opção votada. Os percentuais relativos das outras opções precisam atualizar porque dependem do total — não tem como evitar sem mudar a UI pra mostrar só absolutos. Documentado no comentário acima da função.

**Alternativa ingênua (rejeitada):** chamar `renderizar()` de novo a cada evento, recriando todos os botões. Funciona, mas cria flicker, perde o `.pulse`, refaz listeners e custa mais à medida que escala.

### 3. Voto único sem auth — duas camadas, ambas honestas

- **Front (UX):** ao primeiro acesso, gero um UUID com `crypto.randomUUID()` e salvo em `localStorage` como `voter_hash`. Ao votar, salvo `ja_votou=1`. Se já tiver votado, os botões ficam desabilitados.
- **Banco (garantia real):** `votos.voter_hash` tem `UNIQUE`. Se o usuário burlar localStorage (limpar storage, modo anônimo), o INSERT falha com código `23505` e o front cai no caminho de "você já votou".

**O que NÃO impede:** voto múltiplo de quem abre em outro navegador/dispositivo. Não tem solução sem auth — e o enunciado proibiu auth. Decisão consciente.

### 4. Vanilla JS sem framework — DOM por `data-*`

- Estado vive num objeto `state` simples (Map de contagens).
- Cada elemento que pode mudar tem um `data-*` próprio (`data-opcao-id`, `data-numero`, `data-fill`, `data-percentual`, `data-total`, `data-status`).
- Todo update da tela é explícito. Sem reatividade automática.

Forçou pensar caso a caso onde renderizar e o que renderizar — que é o ponto pedagógico do enunciado.

---

## Estrutura

```
.
├── index.html           # estrutura semântica + data-attributes
├── styles.css           # tema dark, motion sutil, sem dependências
├── app.js               # lógica do front (módulo ES)
├── config.example.js    # template de credenciais (commitado)
├── config.js            # credenciais reais (NÃO commitado)
├── supabase.sql         # script de criação do banco
├── .gitignore
└── README.md
```

---

## Roteiro de defesa

Pontos pra abrir e mostrar no código durante a apresentação:

| Onde | O que mostrar |
|------|---------------|
| `app.js` → `atualizarSurgical()` | A função que pega o `opcao_id` do payload e atualiza só o nó da opção votada. **Coração do projeto.** |
| `app.js` → `inscreverRealtime()` | A inscrição no canal `postgres_changes` com filtro `event: 'INSERT'`. |
| `supabase.sql` → `unique (voter_hash)` | A barreira no banco contra voto duplo. |
| `supabase.sql` → `alter publication supabase_realtime add table public.votos` | A linha que faz o realtime efetivamente funcionar para esta tabela. |
| `app.js` → `votar()` (catch do `error.code === '23505'`) | Como o front trata a colisão de UNIQUE quando alguém burla o localStorage. |

### Respostas curtas pras perguntas do enunciado

- **WebSocket vs HTTP:** WebSocket é uma conexão TCP persistente, full-duplex — servidor e cliente trocam mensagens nos dois sentidos a qualquer momento. HTTP é request/response — o cliente sempre puxa.
- **Como o Supabase avisa o front:** o Postgres usa `LISTEN/NOTIFY` para emitir eventos quando linhas mudam em tabelas publicadas. O servidor de Realtime do Supabase escuta esses eventos, traduz em mensagens WebSocket e empurra para os clientes inscritos no canal.
- **Quem recebe o evento no código:** o callback registrado em `supabase.channel('votos-canal').on('postgres_changes', ...)` em `app.js`.
- **Dois usuários votam ao mesmo tempo:** o Postgres serializa os dois INSERTs (um após o outro). Cada um vira um evento separado de realtime. O front incrementa duas vezes em sequência. Sem race condition no banco.
- **Voto duplo:** localStorage bloqueia no front; UNIQUE no banco bloqueia mesmo se burlar. Quem trocar de navegador/dispositivo consegue — limitação consciente do escopo sem auth.
- **Dez abas abertas:** cada aba tem sua conexão WebSocket própria com o Supabase. Todas recebem o evento. Se a mesma máquina tentar votar de mais de uma aba, só o primeiro INSERT passa (mesmo `voter_hash`), os outros caem no `23505`.
