import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const state = {
  opcoes: [],
  contagens: new Map(),
  jaVotou: false,
};

const els = {
  pergunta:    document.querySelector('[data-pergunta]'),
  opcoes:      document.querySelector('[data-opcoes]'),
  status:      document.querySelector('[data-status]'),
  total:       document.querySelector('[data-total]'),
  telaIntro:   document.querySelector('[data-tela="intro"]'),
  telaEnquete: document.querySelector('[data-tela="enquete"]'),
  comecar:     document.querySelector('[data-comecar]'),
  ctaTexto:    document.querySelector('[data-cta-texto]'),
  totalIntro:  document.querySelector('[data-total-intro]'),
};

async function init() {
  await carregarOpcoes();
  await carregarContagensIniciais();
  renderizar();
  inscreverRealtime();
  verificarSeJaVotou();
  configurarIntro();
}

function configurarIntro() {
  els.comecar.addEventListener('click', mostrarEnquete);
  // Se já votou, troca o texto do CTA pra refletir o estado
  if (state.jaVotou) {
    els.ctaTexto.textContent = 'Ver resultados';
  }
}

function mostrarEnquete() {
  els.telaIntro.classList.add('saindo');
  els.telaIntro.addEventListener('animationend', () => {
    els.telaIntro.hidden = true;
    els.telaEnquete.hidden = false;
  }, { once: true });
}

async function carregarOpcoes() {
  const { data, error } = await supabase
    .from('opcoes')
    .select('*')
    .order('ordem', { ascending: true });
  if (error) throw error;
  state.opcoes = data;
}

async function carregarContagensIniciais() {
  for (const opcao of state.opcoes) {
    state.contagens.set(opcao.id, 0);
  }
  const { data, error } = await supabase.from('votos').select('opcao_id');
  if (error) throw error;
  for (const voto of data) {
    state.contagens.set(voto.opcao_id, (state.contagens.get(voto.opcao_id) || 0) + 1);
  }
}

function renderizar() {
  els.opcoes.innerHTML = state.opcoes.map((opcao) => `
    <button class="opcao" data-opcao-id="${opcao.id}" type="button">
      <div class="opcao-header">
        <span class="opcao-texto">${escapar(opcao.texto)}</span>
        <span class="opcao-numero" data-numero>${state.contagens.get(opcao.id)}</span>
      </div>
      <div class="opcao-barra">
        <div class="opcao-barra-fill" data-fill style="width: ${calcularPercentual(opcao.id)}%"></div>
      </div>
      <span class="opcao-percentual" data-percentual>${formatarPercentual(opcao.id)}</span>
    </button>
  `).join('');

  els.opcoes.querySelectorAll('.opcao').forEach((btn) => {
    btn.addEventListener('click', () => votar(Number(btn.dataset.opcaoId)));
    btn.addEventListener('mousemove', (e) => {
      const r = btn.getBoundingClientRect();
      btn.style.setProperty('--mx', `${e.clientX - r.left}px`);
      btn.style.setProperty('--my', `${e.clientY - r.top}px`);
    });
  });

  atualizarTotal();
  atualizarLider();
}

function calcularPercentual(opcaoId) {
  const total = totalVotos();
  if (total === 0) return 0;
  return (state.contagens.get(opcaoId) / total) * 100;
}

function formatarPercentual(opcaoId) {
  return `${calcularPercentual(opcaoId).toFixed(1)}%`;
}

function totalVotos() {
  let t = 0;
  for (const c of state.contagens.values()) t += c;
  return t;
}

function atualizarTotal() {
  const total = totalVotos();
  els.total.textContent = total;
  if (els.totalIntro) els.totalIntro.textContent = total;
}

function atualizarLider() {
  let liderId = null;
  let max = 0;
  for (const [id, count] of state.contagens) {
    if (count > max) {
      max = count;
      liderId = id;
    }
  }
  els.opcoes.querySelectorAll('.opcao').forEach((btn) => {
    const id = Number(btn.dataset.opcaoId);
    btn.classList.toggle('lider', id === liderId && max > 0);
  });
}

function inscreverRealtime() {
  supabase
    .channel('votos-canal')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'votos' },
      (payload) => {
        const opcaoId = payload.new.opcao_id;
        atualizarSurgical(opcaoId);
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('[realtime] inscrito no canal de votos');
      }
    });
}

// ---------------------------------------------------------------------------
// CORAÇÃO DO PROJETO
// ---------------------------------------------------------------------------
// Quando chega um INSERT em `votos`, o payload já carrega `opcao_id`.
// Usamos esse dado para tocar SÓ o nó da DOM da opção votada — sem destruir
// e recriar a lista. O número da opção votada é o único elemento que muda
// "cirurgicamente"; percentuais e barras das demais opções precisam ser
// recalculados porque o total do denominador mudou (decisão consciente).
// ---------------------------------------------------------------------------
function atualizarSurgical(opcaoId) {
  state.contagens.set(opcaoId, (state.contagens.get(opcaoId) || 0) + 1);

  const opcaoEl = els.opcoes.querySelector(`[data-opcao-id="${opcaoId}"]`);
  if (opcaoEl) {
    const numeroEl = opcaoEl.querySelector('[data-numero]');
    const valorAtual = parseInt(numeroEl.textContent, 10) || 0;
    const valorNovo = state.contagens.get(opcaoId);
    animarNumero(numeroEl, valorAtual, valorNovo, 700);
    numeroEl.classList.remove('pulse');
    void numeroEl.offsetWidth;
    numeroEl.classList.add('pulse');
  }

  for (const opcao of state.opcoes) {
    const el = els.opcoes.querySelector(`[data-opcao-id="${opcao.id}"]`);
    if (!el) continue;
    const fillEl = el.querySelector('[data-fill]');
    const percEl = el.querySelector('[data-percentual]');
    const perc = calcularPercentual(opcao.id);
    fillEl.style.width = `${perc}%`;
    percEl.textContent = `${perc.toFixed(1)}%`;
  }

  atualizarTotal();
  atualizarLider();
}

async function votar(opcaoId) {
  if (state.jaVotou) {
    mostrarStatus('Você já votou nesta enquete.', 'ok');
    return;
  }

  const voterHash = getVoterHash();

  const { error } = await supabase
    .from('votos')
    .insert({ opcao_id: opcaoId, voter_hash: voterHash });

  if (error) {
    if (error.code === '23505') {
      marcarComoVotado('Você já votou nesta enquete.');
    } else {
      mostrarStatus('Erro ao votar. Tente novamente.', 'erro');
      console.error('[votar] erro:', error);
    }
    return;
  }

  marcarComoVotado('Voto registrado.');
}

function marcarComoVotado(msg) {
  state.jaVotou = true;
  localStorage.setItem('ja_votou', '1');
  mostrarStatus(msg, 'ok');
  bloquearBotoes();
}

function mostrarStatus(msg, tipo = '') {
  els.status.textContent = msg;
  els.status.className = `status ${tipo}`.trim();
}

function bloquearBotoes() {
  els.opcoes.querySelectorAll('.opcao').forEach((btn) => {
    btn.disabled = true;
  });
}

function verificarSeJaVotou() {
  if (localStorage.getItem('ja_votou') === '1') {
    state.jaVotou = true;
    mostrarStatus('Você já votou nesta enquete.', 'ok');
    bloquearBotoes();
  }
}

function getVoterHash() {
  let hash = localStorage.getItem('voter_hash');
  if (!hash) {
    hash = crypto.randomUUID();
    localStorage.setItem('voter_hash', hash);
  }
  return hash;
}

// Count-up animado: rola o número de `de` até `para` em `duracao` ms.
// easeOutCubic pra dar a sensação de placar.
function animarNumero(el, de, para, duracao = 700) {
  if (de === para) return;
  const inicio = performance.now();
  function frame(now) {
    const t = Math.min(1, (now - inicio) / duracao);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(de + (para - de) * eased);
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function escapar(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

init().catch((err) => {
  console.error('[init] erro:', err);
  mostrarStatus('Erro ao carregar a enquete. Veja o console.', 'erro');
});
