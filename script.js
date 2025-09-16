// FIFA Packs - Juego simple offline
// Datos, estado, UI y eventos

// (Utilidades aleatorias definidas más abajo para evitar duplicados)

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// Estado y persistencia
const STORAGE_KEYS = {
  currentUser: "fifa_current_user",
  userDataPrefix: "fifa_user_", // key: fifa_user_<username>
};

// Hash helper (SHA-256 -> hex) for optional passwords
async function hashPassword(pwd) {
  const enc = new TextEncoder();
  const data = enc.encode(String(pwd));
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

let state = {
  coins: 0,
  selectedPack: null,
  lastPulled: [],
  club: [],
  user: null,
  overrides: {}, // { imagePath: rating }
  lineup: Array(11).fill(null), // alineación previa al torneo
  lineupTarget: null, // índice de slot seleccionado para colocar
  autoKeepLock: false, // evita guardar auto inmediatamente al abrir
  tournament: {
    active: false,
    round: 0,
    maxRounds: 4,
    yourScore: 0,
    oppScore: 0,
    turnSeq: [], // e.g., ['opp','you', ...]
    turnIndex: 0,
    phase: 'idle', // defend_guess_side | defend_guess_shot | attack_choose_side | attack_shoot | idle
    ai: { attackSide: null, shotSide: null, defBlock: null, keeperGuess: null },
    stageIndex: 0,
    stages: ['Octavos de final','Cuartos de final','Semifinales','Final'],
    stageYour: 0,
    stageOpp: 0,
    pairsPerStage: 3,
    pairCountInStage: 0,
    penalties: { active: false, your: 0, opp: 0, round: 1, maxInitial: 5, turn: 'you' },
  },
};

function redeemCoupon(){
  const code = prompt('Ingresa el cupón');
  if (!code) return;
  const norm = String(code).trim().toUpperCase();
  if (norm !== 'FIFAPACKS') { toast('Cupón inválido'); return; }
  const username = state.user || 'Invitado';
  const key = `fifa_coupon_${username}_FIFAPACKS`;
  try {
    if (localStorage.getItem(key) === '1') { toast('Este cupón ya fue canjeado'); return; }
  } catch {}
  const amount = 500000;
  state.coins += amount;
  saveState();
  updateCoins();
  try { localStorage.setItem(key, '1'); } catch {}
  toast(`Cupón canjeado: +${amount.toLocaleString()} 🪙`);
}

// Índice seleccionado para la venta rápida
let exchangeSelectedIndex = null;
// DCP selección: índices de cartas del club seleccionadas
let dcpSelected = new Set();
let dcpMode = 'CR';
let dcpFilterDuplicatesOnly = false; // mostrar solo cartas que tengan duplicados en la lista DCP
const DCP_CONFIG = {
  CR: {
    title: 'DCP · Cristiano Ronaldo 97',
    count: 11,
    minAvg: 89,
    reward: { name: 'Cristiano Ronaldo', rating: 97, rarity: 'dcp', position: 'Centre Forward', image: 'tarjetas fifa/Cristiano Ronaldo dcp.png' },
    reqText: 'Requisito: 11 jugadores con media mínima 89 OVR. Al enviar la plantilla, recibirás a <strong>Cristiano Ronaldo 97</strong> y las cartas enviadas se perderán.'
  },
  MESSI: {
    title: 'DCP · Lionel Messi 97',
    count: 6,
    minAvg: 92,
    reward: { name: 'Lionel Messi', rating: 97, rarity: 'dcp', position: 'Right Winger', image: 'tarjetas fifa/messi dcp.png' },
    reqText: 'Requisito: 6 jugadores con media mínima 92 OVR. Al enviar la plantilla, recibirás a <strong>Lionel Messi 97</strong> y las cartas enviadas se perderán.'
  },
  DIAZ: {
    title: 'DCP · Díaz 98',
    count: 9,
    minAvg: 91,
    reward: { name: 'Díaz', rating: 98, rarity: 'dcp', position: 'Left Winger', image: 'tarjetas fifa/diaz dcp 98 lw.PNG' },
    reqText: 'Requisito: 9 jugadores con media mínima 91 OVR. Al enviar la plantilla, recibirás a <strong>Díaz 98</strong> y las cartas enviadas se perderán.'
  },
  RAPHINHA: {
    title: 'DCP · Raphinha 98',
    count: 6,
    minAvg: 93,
    reward: { name: 'Raphinha', rating: 98, rarity: 'dcp', position: 'Right Winger', image: 'tarjetas fifa/raphiña dcp 98 lw.png' },
    reqText: 'Requisito: 6 jugadores con media mínima 93 OVR. Al enviar la plantilla, recibirás a <strong>Raphinha 98</strong> y las cartas enviadas se perderán.'
  },
  MBAPPE: {
    title: 'DCP · Mbappé 96',
    count: 11,
    minAvg: 88,
    reward: { name: 'Mbappé', rating: 96, rarity: 'dcp', position: 'Striker', image: 'tarjetas fifa/mbappe dcp 96 st.png' },
    reqText: 'Requisito: 11 jugadores con media mínima 88 OVR. Al enviar la plantilla, recibirás a <strong>Mbappé 96</strong> y las cartas enviadas se perderán.'
  }
};

const STAGE_REWARDS = {
  'Octavos de final': 12000,
  'Cuartos de final': 14000,
  'Semifinales': 16000,
  'Final': 18000,
  'Campeon': 25000,
};

// Packs
const PACKS = {
  bronze: { name: "Bronce", price: 500, odds: { common: 0.66, rare: 0.17, world_tour_silver: 0.04, world_tour: 0.01, rttk: 0.01, miracle: 0.01, icon: 0.06, elite: 0.03, totw: 0.02 }, size: 5 },
  silver: { name: "Plata", price: 2500, odds: { common: 0.41, rare: 0.27, world_tour_silver: 0.05, world_tour: 0.02, rttk: 0.01, miracle: 0.01, icon: 0.12, elite: 0.09, totw: 0.02 }, size: 5 },
  gold:   { name: "Oro", price: 7500, odds: { common: 0.31, rare: 0.30, world_tour_silver: 0.01, world_tour: 0.04, rttk: 0.03, miracle: 0.03, icon: 0.14, elite: 0.10, totw: 0.04 }, size: 5 },
  promo:  { name: "Promo", price: 15000, odds: { common: 0.08, rare: 0.28, icon: 0.35, elite: 0.25, totw: 0.04 }, size: 5 },
  flash_duo: { name: "Flashback x2", price: 30000, odds: { common: 0.08, rare: 0.25, icon: 0.20, elite: 0.45, totw: 0.02 }, size: 5, guarantees: { elite: 2 } },
  icon_duo:  { name: "Icono x2",     price: 32000, odds: { common: 0.13, rare: 0.30, icon: 0.35, elite: 0.20, totw: 0.02 }, size: 5, guarantees: { icon: 2 } },
  totw_duo:  { name: "TOTW x2",      price: 31000, odds: { common: 0.12, rare: 0.26, icon: 0.25, elite: 0.02, totw: 0.35 }, size: 5, guarantees: { totw: 2 } },
  events: { name: "Eventos", price: 18000, odds: { common: 0.10, rare: 0.15, world_tour_silver: 0.10, world_tour: 0.25, rttk: 0.15, miracle: 0.15, icon: 0.05, elite: 0.03, totw: 0.02 }, size: 5, guarantees: { world_tour: 1, rttk: 1, miracle: 1, world_tour_silver: 1 } },
};

// Recompensa por descarte (si hay duplicados al guardar todo)
const DISCARD_VALUE = { 
  common: 100, 
  rare: 300, 
  world_tour_silver: 120,
  world_tour: 350,
  rttk: 500,
  miracle: 650,
  icon: 700, 
  elite: 1000, 
  totw: 800 
};

// Etiquetas legibles por rareza para UI del reveal
const RARITY_LABEL = { 
  common: 'ORO', 
  rare: 'HÉROE', 
  world_tour_silver: 'SILVER WORLD TOUR',
  world_tour: 'WORLD TOUR',
  rttk: 'RTTK',
  miracle: 'MIRACLE',
  icon: 'ICONO', 
  elite: 'ESPECIAL', 
  totw: 'TOTW', 
  dcp: 'DCP' 
};
const RARITY_ORDER = [
  'common',          // Oro
  'rare',            // Héroe
  'world_tour_silver', // Silver World Tour
  'world_tour',      // World Tour
  'rttk',            // RTTK
  'miracle',         // Miracle Moments
  'icon',            // Icono
  'elite',           // Flashback
  'totw',            // TOTW
  'dcp'              // DCP (reto)
];

// Versión de migración de datos del club
const MIGRATION_VERSION = 2;

// Overrides manuales de OVR por nombre visible
const OVERRIDE_RATINGS = {
  'Diaz': 83,
  'Rashford': 83,
};

  // Construir el pool a partir de las imágenes en 'tarjetas fifa/'
  // Nota: en el navegador no se puede listar el directorio. Por eso, mapeamos
  // los archivos detectados en la carpeta ahora mismo. Si agregas más, dime y lo actualizo.
  const IMAGE_FILES = [
    // Base y especiales (excluye DCP)
    "tarjetas fifa/Diaz base 86 lw.png",
    "tarjetas fifa/Lamine Yamal  Flashback 91 rw.png",
    "tarjetas fifa/Lamine Yamal base 86 rw.png",
    "tarjetas fifa/Musiala base 88 cam.png",
    "tarjetas fifa/Rashford base 82 lm.png",
    "tarjetas fifa/aimar heroes 85 cam.png",
    "tarjetas fifa/ait-nouri oro 83 lb.png",
    "tarjetas fifa/ansu fati showdown 91 lw.png",
    "tarjetas fifa/ansu fati showdown+ 93 lw.png",
    "tarjetas fifa/baah bronze 64 rw.png",
    "tarjetas fifa/bellinham oro 90 cm.png",
    "tarjetas fifa/bobb plata 74 rw.png",
    "tarjetas fifa/bum-kun-cha icono 87 st.png",
    "tarjetas fifa/caicedo showdown 84 cdm.png",
    "tarjetas fifa/caicedo showdown+ 86 cdm.png",
    "tarjetas fifa/cheilini icono 90 cb.png",
    "tarjetas fifa/cherki oro 81 cam.png",
    "tarjetas fifa/corona  Flashback 86 rm.png",
    "tarjetas fifa/cunha oro 84 st.png",
    "tarjetas fifa/de rossi heroes 85 cdm.png",
    "tarjetas fifa/delap oro 80 st.png",
    "tarjetas fifa/diaz Flashback 92 lw.png",
    "tarjetas fifa/ekitike oro 83 st.png",
    "tarjetas fifa/elanga oro 82 rm.png",
    "tarjetas fifa/frimpong oro 85 rm.png",
    "tarjetas fifa/gignac  Flashback 87 st.png",
    "tarjetas fifa/gittens oro 80 lm.png",
    "tarjetas fifa/gyokeres oro 88 st.png",
    "tarjetas fifa/iniesta icono 91 cm.png",
    "tarjetas fifa/joao pedro oro 81 st.png",
    "tarjetas fifa/kahn icono 93 gk.png",
    "tarjetas fifa/kerkez oro 82 lb.png",
    "tarjetas fifa/kroos icono 91 cm.png",
    "tarjetas fifa/kudus oro 83 rm.png",
    "tarjetas fifa/laudehr heroes 88 cam.png",
    "tarjetas fifa/lewandoski  Flashback 88 st.png",
    "tarjetas fifa/madueke oro 81 rm.png",
    "tarjetas fifa/marcelo icono 91 lb.png",
    "tarjetas fifa/mbappe  Flashback 88 st.png",
    "tarjetas fifa/mbeumo oro 84 rw.png",
    "tarjetas fifa/messi Flashback 93 rw.png",
    "tarjetas fifa/messi totw 89 cam.png",
    // TOTW adicionales
    "tarjetas fifa/neymar totw 89 cam.png",
    "tarjetas fifa/mbappe totw 94 lw.PNG",
    "tarjetas fifa/haaland totw 92 st.JPG",
    "tarjetas fifa/hakimi totw 91 rb.PNG",
    "tarjetas fifa/ronaldo totw 89 st.JPG",
    "tarjetas fifa/rejinders totw 89 cdm.PNG",
    "tarjetas fifa/doue totw 93 rw.PNG",
    // Oro que faltaban (desde la carpeta)
    "tarjetas fifa/antony oro 81 rm.JPG",
    "tarjetas fifa/cherki oro 81 cam.png",
    "tarjetas fifa/cubarsi oro 82 cb.JPG",
    "tarjetas fifa/doue oro 84 lm.JPG",
    "tarjetas fifa/estevao oro 79 rw.PNG",
    "tarjetas fifa/mainoo oro 81 cdm.JPG",
    "tarjetas fifa/messi oro 84 cam.JPG",
    "tarjetas fifa/modric oro 83 mc.JPG",
    "tarjetas fifa/ronaldo oro 85 st.JPG",
    "tarjetas fifa/trent oro 87 rb.PNG",
    "tarjetas fifa/van dijk oro 90 cb.JPG",
    "tarjetas fifa/modric  Flashback 92 cm.png",
    "tarjetas fifa/morgan icono 87 st.png",
    "tarjetas fifa/musiala Flashback 90 cam.png",
    "tarjetas fifa/necib heroes 88 cam.png",
    "tarjetas fifa/neymar totw 89 cam.png",
    "tarjetas fifa/pogba  Flashback 92 cm.png",
    "tarjetas fifa/pogba oro 78 mc.png",
    "tarjetas fifa/quaresma heroes 85 rm.png",
    "tarjetas fifa/rejinders oro 85 cm.png",
    "tarjetas fifa/rejinders showdown 88 cm.png",
    // Nuevas cartas detectadas en carpeta (.webp, World Tour, Miracle Moments, RTTK)
    "tarjetas fifa/alisson oro 89 por.webp",
    "tarjetas fifa/donnarumma oro 89 por.webp",
    "tarjetas fifa/dembele oro 90 dc.webp",
    "tarjetas fifa/bonmati oro 91 mc.webp",
    // RTTK y similares
    "tarjetas fifa/aina RTTK 87 lb.JPG",
    // World Tour (plata/oro)
    "tarjetas fifa/anselmino silver world tour 74 cb.JPG",
    "tarjetas fifa/bade world tour 84 cb.JPG",
    "tarjetas fifa/barry world tour 83 st.JPG",
    "tarjetas fifa/charlton silver world  tour 74 cam.PNG",
    "tarjetas fifa/cozza silver world tour 74 lb.JPG",
    "tarjetas fifa/diaz world tour 87 lw.JPG",
    "tarjetas fifa/eusebio silver world  tour 73 st.PNG",
    "tarjetas fifa/garincha silver world  tour 70 rw.PNG",
    "tarjetas fifa/gullit silver world tour 74 cam.JPG",
    "tarjetas fifa/hassan silver world tour 74 rm.JPG",
    "tarjetas fifa/henry silver world tour 74 st.JPG",
    "tarjetas fifa/lamine yamal world tour 90 rm.JPG",
    "tarjetas fifa/lemar world tour 85 cm.JPG",
    "tarjetas fifa/maradona silver world tour 74 cam.JPG",
    "tarjetas fifa/ndombele silver world tour 74 cm.JPG",
    "tarjetas fifa/rolanldinho silver world tour 74 lw.JPG",
    "tarjetas fifa/ronaldo silver world tour 74 st.JPG",
    "tarjetas fifa/yashin silver world  tour 72 gk.PNG",
    "tarjetas fifa/zlatan silver world tour 74 st.JPG",
    // Miracle Moments
    "tarjetas fifa/best miracle moments 91 rw.PNG",
    "tarjetas fifa/cannavaro miracle moments 90 cb.PNG",
    "tarjetas fifa/casillas miracle moments 91 gk.PNG",
    "tarjetas fifa/cole miracle moments 87 lb.PNG",
    "tarjetas fifa/drogba miracle moments 90 st.PNG",
    "tarjetas fifa/rodriges  Flashback 86 cam.png",
    "tarjetas fifa/ronaldo  Flashback 93 st.png",
    "tarjetas fifa/saint-maximin  Flashback 93 lw.png",
    "tarjetas fifa/salgado heroes 87 rb.png",
    "tarjetas fifa/scott heroes 85 cdm.png",
    "tarjetas fifa/sisi icono 86 cam.png",
    "tarjetas fifa/son  Flashback 89 st.png",
    "tarjetas fifa/sögger icono 86 cdm.png",
    "tarjetas fifa/thiago silva  Flashback 89 cb.png",
    "tarjetas fifa/totti icono 90 cam.png",
    "tarjetas fifa/trafford oro 81 gk.png",
    "tarjetas fifa/trent showdow+ 90 rb.png",
    "tarjetas fifa/ugarte showdown+ 85 cdm.png",
    "tarjetas fifa/wirts oro 89 cam.png",
    "tarjetas fifa/zamorano heroes 87 st.png",
    "tarjetas fifa/zlatan icono 92 st.png",
    "tarjetas fifa/zubamendi oro 83 cdm.png",
  ];

// Archivos que consideraremos como "Icono" (ligeramente menos raro que Flashback)
const ICON_FILES = new Set([
  "iniesta icono.png",
  "kahn icono.png",
  "kroos icono.png",
  "marcelo icono.png",
  "morgan icono.png",
  "sisi icono.png",
  "sögger icono.png",
  "totti icono.png",
  "zlatan icono.png",
  "bum-kun-cha icono.png",
  "cheilini icono.png",
]);

function titleCase(str) {
  return str
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// -----------------------------
// Lineup Builder
// -----------------------------
function toggleLineup(show){
  const sec = document.getElementById('lineup');
  if (!sec) return;
  if (show) {
    sec.style.display = 'flex';
    renderLineup();
    renderLineupClubList();
  } else {
    sec.style.display = 'none';
  }
}

function renderLineup(){
  const slots = document.querySelectorAll('#lineup .slot');
  slots.forEach((slot)=>{
    const idx = Number(slot.dataset.index);
    const p = state.lineup[idx];
    const baseLabel = slot.getAttribute('data-role') || slot.textContent;
    slot.textContent = p ? p.name : baseLabel; // keep role label if empty
    slot.classList.toggle('filled', !!p);
    slot.classList.toggle('selected', state.lineupTarget === idx);
    slot.onclick = () => {
      if (state.lineup[idx]){
        // Si está lleno: limpiar
        state.lineup[idx] = null;
        if (state.lineupTarget === idx) state.lineupTarget = null;
        updateLineupStatus();
        renderLineup();
      } else {
        // Si está vacío: seleccionar como destino
        state.lineupTarget = idx;
        renderLineup();
      }
    };

    // Drag from slot (move between slots)
    if (p){
      slot.setAttribute('draggable','true');
      slot.ondragstart = (e)=>{
        e.dataTransfer.setData('text/lineupIndex', String(idx));
        e.dataTransfer.effectAllowed = 'move';
      };
    } else {
      slot.removeAttribute('draggable');
      slot.ondragstart = null;
    }

    // Drop targets
    slot.ondragover = (e)=>{ e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; slot.classList.add('drag-over'); };
    slot.ondragleave = ()=> slot.classList.remove('drag-over');
    slot.ondrop = (e)=>{
      e.preventDefault();
      slot.classList.remove('drag-over');
      const fromIdxStr = e.dataTransfer.getData('text/lineupIndex');
      const playerName = e.dataTransfer.getData('text/playerName');
      if (fromIdxStr){
        const fromIdx = parseInt(fromIdxStr,10);
        if (!Number.isNaN(fromIdx) && state.lineup[fromIdx]){
          // mover o intercambiar entre slots
          if (fromIdx === idx) return;
          const moving = state.lineup[fromIdx];
          const target = state.lineup[idx] || null;
          state.lineup[fromIdx] = target; // si hay target, swap; si no, queda null (move)
          state.lineup[idx] = moving;
          renderLineup();
          return;
        }
      }
      if (playerName){
        const player = state.club.find(c=>c.name===playerName);
        if (!player) return;
        // evitar duplicados por nombre
        const exists = state.lineup.some(x=>x && x.name===player.name);
        if (exists){ toast('Ese jugador ya está en la alineación'); return; }
        placeInSlot(player, idx);
      }
    };
  });
  updateLineupStatus();
}

function renderLineupClubList(){
  const list = document.getElementById('lineupClubList');
  if (!list) return;
  list.innerHTML = '';
  if (!state.club.length){
    list.innerHTML = '<div class="empty">No tienes cartas en el club. Abre sobres y guarda cartas.</div>';
    return;
  }
  state.club.forEach((c, i)=>{
    const row = document.createElement('div');
    row.className = 'list-item';
    row.innerHTML = `<span class="tag ${c.rarity}">${c.rarity}</span> <span class="nm">${c.name}</span> <span class="rt">${c.rating}</span> <span class="pos">${mapPosition(c.position)}</span>`;
    const btn = document.createElement('button');
    btn.className = 'btn small';
    btn.textContent = 'Agregar';
    btn.onclick = () => addToLineup(c);
    row.appendChild(btn);
    // drag
    row.setAttribute('draggable','true');
    row.ondragstart = (e)=>{
      e.dataTransfer.setData('text/playerName', c.name);
      e.dataTransfer.effectAllowed = 'copy';
    };
    list.appendChild(row);
  });
}

function addToLineup(player){
  // Colocar en slot seleccionado si existe; si no, en el primer vacío
  let idx = Number.isInteger(state.lineupTarget) ? state.lineupTarget : state.lineup.findIndex((x)=>!x);
  if (idx === -1) { toast('Alineación completa'); return; }
  // Evitar duplicados por nombre
  if (state.lineup.some(x=>x && x.name===player.name)) { toast('Ese jugador ya está en la alineación'); return; }
  placeInSlot(player, idx);
}

function placeInSlot(player, idx){
  state.lineup[idx] = { name: player.name, rating: player.rating, rarity: player.rarity, position: player.position, image: player.image };
  state.lineupTarget = null;
  renderLineup();
}

function autoFillLineup(){
  const copy = [...state.lineup];
  let j = 0;
  for (let i=0;i<copy.length;i++){
    if (!copy[i]){
      while (j < state.club.length && state.club[j] == null) j++;
      if (j < state.club.length){
        const c = state.club[j++];
        copy[i] = { name: c.name, rating: c.rating, rarity: c.rarity, image: c.image };
      }
    }
  }
  state.lineup = copy;
  renderLineup();
}

function clearLineup(){
  state.lineup = Array(11).fill(null);
  renderLineup();
}

function updateLineupStatus(){
  const sel = state.lineup.filter(Boolean).length;
  const st = document.getElementById('lineupStatus');
  const btn = document.getElementById('confirmLineupBtn');
  if (st) st.textContent = `${sel} / 11 seleccionados`;
  if (btn) btn.disabled = sel !== 11;
}

function confirmLineupAndStart(){
  const sel = state.lineup.filter(Boolean).length;
  if (sel !== 11){ toast('Necesitas 11 jugadores'); return; }
  // almacenar en torneo y arrancar
  state.tournament.squad = state.lineup.map(x=>({ ...x }));
  toggleLineup(false);
  startTournament();
}

// Pequeña animación de monedas ganadas: "+X 🪙" flotante
function animateCoinGain(amount) {
  try {
    const target = document.getElementById("coins");
    if (!target || !amount) return;
    const rect = target.getBoundingClientRect();
    const el = document.createElement("div");
    el.textContent = `+${amount.toLocaleString()} 🪙`;
    el.style.position = "fixed";
    el.style.left = `${rect.left + rect.width / 2}px`;
    el.style.top = `${rect.top - 6}px`;
    el.style.transform = "translate(-50%, 0)";
    el.style.fontWeight = "900";
    el.style.color = "#2fd27a"; // verde éxito
    el.style.textShadow = "0 2px 8px rgba(0,0,0,.25)";
    el.style.zIndex = 1000;
    el.style.pointerEvents = "none";
    el.style.transition = "transform .9s ease, opacity .9s ease";
    el.style.opacity = "1";
    document.body.appendChild(el);
    // siguiente frame para animar
    requestAnimationFrame(() => {
      el.style.transform = "translate(-50%, -26px)";
      el.style.opacity = "0";
    });
    setTimeout(() => el.remove(), 1000);
  } catch {}
}

function handleChoice(side){
  const t = state.tournament;
  if (t.penalties && t.penalties.active) return onPenChoice(side);
  return onChoice(side);
}

function inferFromFilename(path) {
  const file = path.split("/").pop();
  const base = file.replace(/\.(png|jpg|jpeg)$/i, "");
  // Flags de rareza por palabras clave
  const isFlash = /flashback/i.test(base);
  const isHeroes = /heroes/i.test(base);
  const isBase = /base/i.test(base);
  const isIcon = /icono|icon/i.test(base) || ICON_FILES.has(file.toLowerCase());
  const isTotw = /totw/i.test(base);
  const isWorldTourSilver = /silver\s*world\s*tour/i.test(base);
  const isWorldTour = /(^|\s)world\s*tour/i.test(base) && !isWorldTourSilver;
  const isRTTK = /rttk/i.test(base);
  const isMiracle = /miracle\s*moments?/i.test(base);

  // Extraer OVR si viene incluido: patrones "OVR 91", "91", "_91"
  let extractedRating = null;
  // Busca "OVR <num>"
  const mOvr = base.match(/ovr\s*(\d{2})/i);
  if (mOvr) extractedRating = parseInt(mOvr[1], 10);
  if (!extractedRating) {
    // Toma el último número de 2 dígitos entre 60-99 (se ignoran mayores/menores)
    const nums = Array.from(base.matchAll(/(^|[^\d])(\d{2})(?=$|[^\d])/g)).map(x => parseInt(x[2],10)).filter(n=>n>=60 && n<=99);
    if (nums.length) extractedRating = nums[nums.length-1];
  }

  // Extraer posición si viene incluida: soporta abreviaturas comunes
  const POSITIONS = [
    'GK','POR',
    'CB','DFC','RB','LB','RWB','LWB','LD','LI',
    'CDM','DM','MCD',
    'CM','MC','LM','RM','CAM','MCO','LW','RW','MI','MD',
    'CF','ST','DC'
  ];
  let extractedPos = '';
  for (const p of POSITIONS) {
    const re = new RegExp(`(^|[^a-zA-Z])${p}([^a-zA-Z]|$)`, 'i');
    if (re.test(base)) { extractedPos = p.toUpperCase(); break; }
  }

  // Limpiar el nombre: quitar rarezas, OVR y posición
  const clean = base
    .replace(/\b(flashback|heroes|base|icono|icon|totw)\b/gi, "")
    .replace(/\bovr\s*\d{2}\b/gi, "")
    .replace(/\b(\d{2})\b/g, "")
    // IMPORTANTE: usar \\b porque "\b" en string JS es backspace
    .replace(new RegExp(`\\b(${POSITIONS.join('|')})\\b`, 'ig'), "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const name = titleCase(clean);

  // Rareza
  let rarity =
    isTotw ? "totw" :
    isIcon ? "icon" :
    isFlash ? "elite" :
    isMiracle ? "miracle" :
    isRTTK ? "rttk" :
    isWorldTourSilver ? "world_tour_silver" :
    isWorldTour ? "world_tour" :
    isHeroes ? "rare" :
    isBase ? "common" : "common";
  // Rating: preferir el extraído; sino, un básico por rareza
  let rating = extractedRating || (rarity === "elite" ? 90 : rarity === "icon" ? 88 : rarity === "rare" ? 86 : 83);
  // Aplicar override manual si existe
  if (OVERRIDE_RATINGS[name]) rating = OVERRIDE_RATINGS[name];
  // Override por imagen guardado por el usuario
  const userOv = state && state.overrides ? state.overrides[path] : null;
  if (userOv && userOv >= 60 && userOv <= 99) rating = userOv;
  // Posición: usar extraída si existe
  const position = extractedPos || "";

  return { name, rating, nation: "", position, rarity, image: path };
}

const PLAYERS = IMAGE_FILES.map(inferFromFilename);

// Busca un reemplazo: jugador distinto con misma rareza cuyo rating sea targetRating (o el más cercano menor).
// Si no hay de misma rareza, intenta cualquier rareza manteniendo el criterio de rating.
function findReplacement(targetRating, rarity, excludeNames = new Set()){
  // 1) Misma rareza, rating exacto
  let pool = PLAYERS.filter(p => p.rarity === rarity && p.rating === targetRating && !excludeNames.has(p.name));
  if (pool.length) return choice(pool);
  // 2) Misma rareza, ir bajando rating
  for (let r = targetRating - 1; r >= 70; r--) {
    pool = PLAYERS.filter(p => p.rarity === rarity && p.rating === r && !excludeNames.has(p.name));
    if (pool.length) return choice(pool);
  }
  // 3) Cualquier rareza, rating exacto
  pool = PLAYERS.filter(p => p.rating === targetRating && !excludeNames.has(p.name));
  if (pool.length) return choice(pool);
  // 4) Cualquier rareza, rating menor
  for (let r = targetRating - 1; r >= 70; r--) {
    pool = PLAYERS.filter(p => p.rating === r && !excludeNames.has(p.name));
    if (pool.length) return choice(pool);
  }
  // 5) Fallback: cualquiera por debajo del target
  pool = PLAYERS.filter(p => p.rating < targetRating && !excludeNames.has(p.name));
  if (pool.length) return choice(pool);
  return null;
}

// Utilidades
function mapPosition(pos){
  if (!pos) return '';
  const P = pos.toUpperCase();
  const map = {
    GK:'POR', POR:'POR',
    CB:'DFC', DFC:'DFC', RB:'LD', LB:'LI', RWB:'CAD', LWB:'CAI', LD:'LD', LI:'LI',
    CDM:'MCD', DM:'MCD', MCD:'MCD',
    CM:'MC', MC:'MC', LM:'MI', RM:'MD', CAM:'MCO', MCO:'MCO', LW:'EI', RW:'ED', MI:'MI', MD:'MD',
    CF:'SD', ST:'DEL', DC:'DEL'
  };
  return map[P] || P;
}
const rand = (n = 1) => Math.random() * n;
const choice = (arr) => arr[Math.floor(rand(arr.length))];

function weightedTier(odds) {
  const r = Math.random();
  let acc = 0;
  for (const [tier, p] of Object.entries(odds)) {
    acc += p;
    if (r <= acc) return tier;
  }
  return "common"; // fallback
}

function pullCard(packKey) {
  const pack = PACKS[packKey];
  const tier = weightedTier(pack.odds);
  let pool = PLAYERS.filter((p) => p.rarity === tier);
  if (!pool.length) pool = PLAYERS; // fallback si no hay del tier
  const base = choice(pool);
  // Salvaguarda: si por alguna razón no se extrajo el OVR al construir PLAYERS, reinténtalo aquí
  let rating = base.rating;
  if (!rating || rating < 60 || rating > 99) {
    try {
      const fname = (base.image || '').replace(/\.(png|jpg|jpeg)$/i,'');
      const mm = fname.match(/ovr\s*(\d{2})/i);
      if (mm) rating = parseInt(mm[1],10);
      if (!mm) {
        const nums = Array.from(fname.matchAll(/(^|[^\d])(\d{2})(?=$|[^\d])/g)).map(x=>parseInt(x[2],10)).filter(n=>n>=60 && n<=99);
        if (nums.length) rating = nums[nums.length-1];
      }
    } catch {}
  }
  // Aplicar overrides de usuario también aquí
  const userOv = state && state.overrides ? state.overrides[base.image] : null;
  const finalFromBase = (rating && rating>=60 && rating<=99) ? rating : base.rating;
  rating = (userOv && userOv>=60 && userOv<=99) ? userOv : finalFromBase;
  // Copia inmutable con id único
  return { ...base, rating, id: `${base.name}-${Date.now()}-${Math.floor(rand(1e6))}` };
}

// Extraer una carta de una rareza específica (para garantías de packs)
function pullSpecific(packKey, rarity) {
  let pool = PLAYERS.filter((p) => p.rarity === rarity);
  if (!pool.length) pool = PLAYERS; // fallback si no hay del tier
  const base = choice(pool);
  let rating = base.rating;
  // Respetar overrides guardados por usuario por imagen
  const userOv = state && state.overrides ? state.overrides[base.image] : null;
  if (userOv && userOv>=60 && userOv<=99) rating = userOv;
  return { ...base, rating, id: `${base.name}-${Date.now()}-${Math.floor(rand(1e6))}` };
}

function userKey(username) {
  return STORAGE_KEYS.userDataPrefix + encodeURIComponent(username);
}

function migrateClubData(){
  if (!state.user) return;
  const flagKey = userKey(state.user) + `:migrated_v${MIGRATION_VERSION}`;
  if (localStorage.getItem(flagKey) === '1') return; // ya migrado
  if (!Array.isArray(state.club) || !state.club.length) {
    localStorage.setItem(flagKey, '1');
    return;
  }
  let changed = 0;
  state.club = state.club.map((c)=>{
    const img = c.image || '';
    const parsed = inferFromFilename(img || (c.name ? c.name + '.png' : ''));
    // Detectar si el nombre viejo trae basura (icono/base/posiciones/cifras)
    const oldName = String(c.name||'');
    const hasGarbage = /(icono|icon|flashback|heroes|base)\b/i.test(oldName) || /\b(GK|CB|RB|LB|RWB|LWB|CDM|CM|LM|RM|CAM|LW|RW|CF|ST|POR|DFC|LD|LI|CAD|CAI|MCD|MC|MI|MD|MCO|ED|EI|SD|DEL|DC)\b/i.test(oldName) || /\b\d{2}\b/.test(oldName);
    const finalName = hasGarbage ? parsed.name : oldName || parsed.name;
    // Base: si el rating guardado es válido se respeta; si no, usar el del archivo
    let nextRating = (c.rating && c.rating>=60 && c.rating<=99) ? c.rating : parsed.rating;
    // Override manual (e.g., Diaz 83, Rashford 83)
    if (OVERRIDE_RATINGS[finalName]) nextRating = OVERRIDE_RATINGS[finalName];
    // Override guardado por usuario por imagen
    const userOv = state && state.overrides ? state.overrides[c.image] : null;
    if (userOv && userOv>=60 && userOv<=99) nextRating = userOv;
    const next = {
      name: finalName,
      rating: nextRating,
      nation: c.nation || parsed.nation || '',
      position: parsed.position || c.position || '',
      rarity: parsed.rarity || c.rarity || 'common',
      image: c.image || parsed.image,
    };
    if (next.name !== c.name || next.rating !== c.rating || next.position !== (c.position||'')) changed++;
    return next;
  });
  saveState();
  localStorage.setItem(flagKey, '1');
  // Tras normalizar, eliminar duplicados por nombre intercambiándolos o dando monedas
  try { const { exchanges, discards } = dedupeClub(); if (exchanges || discards) changed += exchanges + discards; } catch {}
  try { renderClub(); } catch {}
  if (changed) try { toast(`Club actualizado: ${changed} cambios (incluye migración y duplicados)`); } catch {}
}

// Elimina duplicados por nombre en el club.
// Mantiene una copia del más alto OVR y procesa los extras:
// - Intenta intercambio por otro jugador (OVR-1, misma rareza) con findReplacement()
// - Si no hay reemplazo, otorga monedas por descarte
function dedupeClub(){
  if (!Array.isArray(state.club) || !state.club.length) return { exchanges:0, discards:0 };
  // Agrupar por IMAGEN (identifica la carta exacta). Así permitimos variantes con el mismo nombre.
  const byImage = new Map();
  for (const c of state.club){
    const key = c.image || c.name; // fallback por si faltara image
    if (!byImage.has(key)) byImage.set(key, []);
    byImage.get(key).push(c);
  }
  const imagesKept = new Set();
  const newClub = [];
  let exchanges = 0, discards = 0;
  for (const [imgKey, arr] of byImage.entries()){
    // Mantener una copia (la de mayor OVR)
    arr.sort((a,b)=> (b.rating||0) - (a.rating||0));
    const keep = arr[0];
    newClub.push(keep);
    imagesKept.add(imgKey);
    // Resto: intercambiar o descartar
    for (let i=1;i<arr.length;i++){
      const dup = arr[i];
      const repl = findReplacement((dup.rating||0) - 1, dup.rarity, new Set(newClub.map(x=>x.name)));
      if (repl){
        if (!imagesKept.has(repl.image)){
          newClub.push({ name: repl.name, rating: repl.rating, nation: repl.nation, position: repl.position, rarity: repl.rarity, image: repl.image });
          imagesKept.add(repl.image);
          exchanges += 1;
        } else {
          const fallbackCoins = DISCARD_VALUE[dup.rarity] || 0;
          if (fallbackCoins) { state.coins += fallbackCoins; discards += 1; }
        }
      } else {
        const fallbackCoins = DISCARD_VALUE[dup.rarity] || 0;
        if (fallbackCoins) { state.coins += fallbackCoins; discards += 1; }
      }
    }
  }
  state.club = newClub;
  saveState();
  updateCoins();
  return { exchanges, discards };
}

function saveState() {
  // Permitir persistencia aunque no se haya iniciado sesión: usar "Invitado"
  const username = state.user || 'Invitado';
  // Conservar passwordHash previo si existiera
  const prev = loadUser(username) || {};
  const data = { coins: state.coins, club: state.club, overrides: state.overrides };
  if (prev && prev.passwordHash) data.passwordHash = prev.passwordHash;
  try {
    localStorage.setItem(userKey(username), JSON.stringify(data));
    // Si no había usuario activo, establecer el actual para futuras cargas
    if (!state.user) localStorage.setItem(STORAGE_KEYS.currentUser, username);
  } catch (e) {
    console.warn('No se pudo guardar en localStorage:', e);
  }
}

function loadUser(username) {
  const raw = localStorage.getItem(userKey(username));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function setTourResult(text, type = 'neutral') {
  const el = document.getElementById('tourLastResult');
  if (!el) return;
  el.textContent = text;
  el.classList.remove('neutral','goal-you','goal-opp','no-goal');
  el.classList.add(type);
}

function setUser(username) {
  state.user = username;
  localStorage.setItem(STORAGE_KEYS.currentUser, username);
  const existing = loadUser(username);
  if (existing) {
    state.coins = Number(existing.coins) || 0;
    state.club = Array.isArray(existing.club) ? existing.club : [];
    state.overrides = existing.overrides && typeof existing.overrides === 'object' ? existing.overrides : {};
  } else {
    state.coins = 20000; // monedas iniciales por cuenta
    state.club = [];
    state.overrides = {};
    saveState();
  }
  updateCoins();
  updateCurrentUser();
  // Asegurar que el botón de abrir sobre refleje las monedas actuales
  if (state.selectedPack) selectPack(state.selectedPack); else selectPack("bronze");
  // Ejecutar migración justo al establecer usuario para normalizar nombres/OVR/posición guardados
  try { migrateClubData(); } catch {}
}

function loadState() {
  const current = localStorage.getItem(STORAGE_KEYS.currentUser);
  if (!current) {
    // No hay sesión activa: mostrar overlay de autenticación
    try { showAuth(true); setTimeout(()=> document.getElementById('username')?.focus(), 0); } catch {}
    return;
  }
  setUser(current);
  try { showAuth(false); } catch {}
}

// UI Updates
function updateCoins() {
  $("#coins").textContent = `🪙 ${state.coins.toLocaleString()}`;
  // Revalidar disponibilidad del botón según el pack seleccionado
  if (state.selectedPack) {
    const can = canAfford(state.selectedPack);
    const btn = $("#openPackBtn");
    if (btn) btn.disabled = !can;
  }
}

// Debug helper: añadir monedas rápidamente y reflejar en UI
function addDebugCoins(amount){
  if (!amount || typeof amount !== 'number') return;
  state.coins += amount;
  saveState();
  updateCoins();
  try { toast(`+${amount.toLocaleString()} 🪙 añadidas para pruebas`); } catch {}
}

function updateCurrentUser() {
  const el = $("#currentUser");
  if (el) el.textContent = state.user ? `👤 ${state.user}` : "Invitado";
}

function selectPack(packKey) {
  state.selectedPack = packKey;
  $$(".pack").forEach((el) => el.classList.remove("active"));
  const btn = document.querySelector(`.pack[data-pack="${packKey}"]`);
  btn?.classList.add("active");
  $("#openPackBtn").disabled = !canAfford(packKey);
}

function canAfford(packKey) {
  if (!packKey) return false;
  return state.coins >= PACKS[packKey].price;
}

function renderPulled(cards) {
  const wrap = $("#cards");
  wrap.innerHTML = "";
  const tpl = $("#cardTemplate");
  cards.forEach((c) => {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.classList.add(c.rarity);
    // Iniciar mostrando la cara trasera (misterio)
    node.classList.add('flipped');
    // Estilo tipo ficha: nombre centrado y línea de rareza + OVR
    node.querySelector(".rating").textContent = ""; // no usar número grande arriba
    node.querySelector(".name").textContent = c.name;
    node.querySelector(".nation").textContent = `${RARITY_LABEL[c.rarity] || ''} • OVR ${c.rating}`;
    node.querySelector(".position").textContent = mapPosition(c.position);
    const img = node.querySelector(".art img");
    if (img) {
      img.src = c.image ? encodeURI(c.image) : "";
      img.alt = c.name || "";
      img.onerror = () => {
        // fallback: intenta UNA sola vez encontrar por nombre
        if (!img.dataset.fallbackTried) {
          const alt = IMAGE_FILES.find(f => f.toLowerCase().includes(c.name.toLowerCase().split(" ")[0]));
          if (alt) {
            img.dataset.fallbackTried = '1';
            img.src = encodeURI(alt);
            return;
          }
        }
        // Sin alternativa o ya intentado: quitar img y marcar placeholder visible
        const card = img.closest('.card');
        if (card) card.classList.add('noart');
        img.remove();
      };
    }
    node.addEventListener("click", () => node.classList.toggle("flipped"));
    wrap.appendChild(node);
  });
  const rev = $("#reveal");
  rev.classList.add("show");
  // Fuerza visibilidad por si alguna regla pisa display
  rev.style.display = 'block';
  // Llevar a la vista
  try { rev.scrollIntoView({behavior:'smooth', block:'start'}); } catch {}
  // Rehabilitar botón guardar ahora que el reveal está visible
  try { const k = document.getElementById('keepAllBtn'); if (k) k.disabled = false; } catch {}
  state.autoKeepLock = false;
  const ri = document.getElementById('revealInfo');
  if (ri) ri.textContent = `${cards.length} cartas`;
  try { toast(`${cards.length} cartas reveladas`); } catch {}
}

function openPack() {
  const key = state.selectedPack;
  if (!key) { toast('Selecciona un sobre primero'); return; }
  const price = PACKS[key].price;
  if (state.coins < price) { toast('No tienes monedas suficientes'); return; }
  const prevCoins = state.coins;
  state.coins -= price;
  updateCoins();
  // Evitar activación accidental de "Guardar todo" por doble click/tecla
  try {
    const keepBtn = document.getElementById('keepAllBtn');
    if (keepBtn) keepBtn.disabled = true;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  } catch {}
  state.autoKeepLock = true;

  try {
    // Genera y muestra
    const pulled = [];
    const pack = PACKS[key];
    // 1) Garantías
    if (pack.guarantees) {
      for (const [rar, count] of Object.entries(pack.guarantees)) {
        for (let i=0; i<count; i++) pulled.push(pullSpecific(key, rar));
      }
    }
    // 2) Relleno hasta completar tamaño
    while (pulled.length < pack.size) pulled.push(pullCard(key));
    state.lastPulled = pulled;
    renderPulled(pulled);
    saveState();
  } catch (err) {
    console.error('Error al abrir el sobre:', err);
    // Revertir monedas y estado si no se pudo abrir
    state.coins = prevCoins;
    updateCoins();
    state.lastPulled = [];
    state.autoKeepLock = false;
    saveState();
    toast('Hubo un problema al abrir el sobre. No se descontaron monedas.');
  }
}

function keepAll() {
  // Si acabamos de abrir el sobre, ignorar disparos accidentales
  if (state.autoKeepLock) { return; }
  if (!state.lastPulled.length) return;
  // Nueva regla: guardar todo incluso si son duplicados
  const toAdd = state.lastPulled.map(c => ({
    name: c.name,
    rating: c.rating,
    nation: c.nation,
    position: c.position,
    rarity: c.rarity,
    image: c.image,
  }));
  state.club.push(...toAdd);
  state.lastPulled = [];
  updateCoins();
  saveState();
  renderClub();
  toast("Guardado en el club (incluye duplicados)");
}

function renderClub() {
  const grid = $("#clubGrid");
  if (!grid) return;
  const q = $("#search").value.trim().toLowerCase();
  const f = $("#filter").value;
  // Filtrar primero
  const filtered = state.club.filter((c) =>
    (f === "all" || c.rarity === f) && (!q || c.name.toLowerCase().includes(q))
  );
  // Agrupar por imagen (misma carta exacta)
  const byImage = new Map();
  for (const c of filtered){
    const key = c.image || c.name;
    if (byImage.has(key)) {
      byImage.get(key).count += 1;
    } else {
      byImage.set(key, { card: c, count: 1 });
    }
  }
  const groups = Array.from(byImage.values());
  grid.innerHTML = "";
  if (!groups.length) {
    grid.innerHTML = `<div class="empty">No hay cartas en el club con ese filtro.</div>`;
    return;
  }
  groups.forEach(({card: c, count}) => {
    const div = document.createElement("div");
    div.className = `card ${c.rarity}`;
    div.style.position = 'relative';
    div.style.aspectRatio = "2.1/3";
    div.style.position = "relative";
    div.style.overflow = "hidden";
    const art = document.createElement("img");
    art.src = c.image ? encodeURI(c.image) : "";
    art.onerror = () => {
      if (!art.dataset.fallbackTried){
        const alt = IMAGE_FILES.find(f => f.toLowerCase().includes(c.name.toLowerCase().split(" ")[0]));
        if (alt) { art.dataset.fallbackTried = '1'; art.src = encodeURI(alt); return; }
      }
      // quitar imagen si no hay alternativa
      art.remove();
    };
    art.alt = c.name;
    art.style.position = "absolute";
    art.style.inset = "0";
    art.style.width = "100%";
    art.style.height = "100%";
    art.style.objectFit = "cover";
    // Badge de duplicados
    if (count > 1) {
      const badge = document.createElement('div');
      badge.className = 'dup-badge';
      badge.textContent = `×${count}`;
      div.appendChild(badge);
    }
    const overlay = document.createElement("div");
    overlay.style.position = "absolute";
    overlay.style.inset = "0";
    overlay.style.background = "linear-gradient(180deg, rgba(0,0,0,.1) 20%, rgba(0,0,0,.35) 70%)";
    const meta = document.createElement("div");
    meta.style.position = "absolute";
    meta.style.left = "0";
    meta.style.right = "0";
    meta.style.bottom = "0";
    meta.style.padding = "10px";
    meta.innerHTML = `
      <div class="rating">${c.rating}</div>
      <div class="name">${c.name}</div>
      <div class="position">${mapPosition(c.position)}</div>
    `;
    // Botón para editar OVR
    const btn = document.createElement('button');
    btn.className = 'btn small';
    btn.textContent = 'Editar OVR';
    btn.style.position = 'absolute';
    btn.style.top = '8px';
    btn.style.right = '8px';
    btn.style.zIndex = '50';
    btn.style.pointerEvents = 'auto';
    btn.onclick = () => {
      const val = prompt('Nuevo OVR (60-99):', String(c.rating));
      if (!val) return;
      const num = parseInt(val,10);
      if (Number.isNaN(num) || num<60 || num>99){ toast('OVR inválido'); return; }
      if (!state.overrides) state.overrides = {};
      if (c.image) state.overrides[c.image] = num;
      // Actualizar TODAS las copias de esa carta en el club
      const keyImg = c.image || c.name;
      state.club.forEach(cc => {
        if ((cc.image || cc.name) === keyImg) cc.rating = num;
      });
      saveState();
      renderClub();
      toast('OVR actualizado');
    };
    div.appendChild(art);
    div.appendChild(overlay);
    div.appendChild(meta);
    // Asegurar que el botón esté por encima de cualquier overlay
    div.appendChild(btn);
    grid.appendChild(div);
  });
}

// ...

function renderExchangeList(){
  const list = $('#exchangeList');
  if (!list) return;
  list.innerHTML = '';
  if (!state.club.length){
    list.innerHTML = '<div class="empty">No tienes cartas en el club.</div>';
    return;
  }
  state.club.forEach((c, idx)=>{
    if (!c) return;
    const item = document.createElement('div');
    const isLocked = c.rarity === 'dcp';
    item.className = 'exchange-item' + (isLocked ? ' disabled' : '') + (exchangeSelectedIndex===idx?' active':'');
    item.innerHTML = `<div><span class="tag ${c.rarity}">${c.rarity}</span> <strong>${c.name}</strong> <span class="muted">${c.rating}</span></div>` + (isLocked ? `<div class="muted">No intercambiable</div>` : '');
    item.addEventListener('click', ()=>{
      if (isLocked) { toast('Esta carta DCP no se puede vender ni intercambiar.'); return; }
      exchangeSelectedIndex = idx;
      // actualizar selección visual
      $$('#exchangeList .exchange-item').forEach(x=>x.classList.remove('active'));
      item.classList.add('active');
      // actualizar valor de venta rápida
      fillExchangeTargets();
      updateExchangeButtons();
    });
    list.appendChild(item);
  });
}

function fillExchangeTargets(){
  const valEl = $('#exchangeValue');
  if (!valEl) return;
  if (exchangeSelectedIndex==null){
    valEl.textContent = 'Selecciona una carta';
    return;
  }
  const card = state.club[exchangeSelectedIndex];
  if (card && card.rarity === 'dcp') { valEl.textContent = 'No se puede vender'; return; }
  const coins = DISCARD_VALUE[card.rarity] || 0;
  valEl.textContent = `Recibirás: 🪙 ${coins} monedas`;
}

function onExchangeTargetChange(){
  updateExchangeButtons();
}
function updateExchangeButtons(){
  const btn = $('#doExchangeBtn');
  if (!btn) return;
  const can = exchangeSelectedIndex!=null && state.club[exchangeSelectedIndex] && state.club[exchangeSelectedIndex].rarity !== 'dcp';
  btn.disabled = !can;
}

function doExchange(){
  if (exchangeSelectedIndex==null) return;
  const giving = state.club[exchangeSelectedIndex];
  if (!giving) return;
  if (giving.rarity === 'dcp') { toast('Las cartas DCP no se pueden vender ni obtener por otros medios.'); return; }
  const coins = DISCARD_VALUE[giving.rarity] || 0;
  // Eliminar carta y sumar monedas
  state.club.splice(exchangeSelectedIndex, 1);
  state.coins += coins;
  saveState();
  updateCoins();
  try { renderClub(); } catch {}
  renderExchangeList();
  fillExchangeTargets();
  updateExchangeButtons();
  toast(`Venta rápida: ${giving.name} (${giving.rarity}) por 🪙 ${coins}.`);
}

// -----------------------------
// Tournament Logic
// -----------------------------
function toggleTournament(show) {
  const sec = document.getElementById("tournament");
  if (!sec) return;
  if (show) {
    sec.classList.add("show");
  } else {
    sec.classList.remove("show");
  }
}

// Helpers de UI del torneo
function showChoices(show){
  const el = document.getElementById('choices');
  if (!el) return;
  el.style.display = show ? 'flex' : 'none';
}

function showPenGrid(show){
  const grid = document.getElementById('penGrid');
  if (!grid) return;
  grid.style.display = show ? 'block' : 'none';
}

function buildPenGrid(){
  const grid = document.getElementById('penGrid');
  if (!grid) return;
  grid.innerHTML = '';
  // Contenedor interior respetando CSS .pen-inner
  const inner = document.createElement('div');
  inner.className = 'pen-inner';
  const rows = 3, cols = 5;
  for (let r=0; r<rows; r++){
    for (let c=0; c<cols; c++){
      const cell = document.createElement('div');
      cell.className = 'pen-cell';
      const spot = document.createElement('div');
      spot.className = 'pen-spot';
      cell.appendChild(spot);
      cell.addEventListener('click', ()=>{
        // Mapear columnas a lados: 0-1 = L, 2 = C, 3-4 = R
        const side = (c <= 1) ? 'L' : (c === 2 ? 'C' : 'R');
        onPenChoice(side);
      });
      inner.appendChild(cell);
    }
  }
  grid.appendChild(inner);
}

function startTournament() {
  const t = state.tournament;
  t.active = true;
  t.round = 1;
  t.maxRounds = 4; // 4 etapas: Octavos, Cuartos, Semis, Final
  t.yourScore = 0;
  t.oppScore = 0;
  t.turnIndex = 0;
  t.stageIndex = 0;
  t.stageYour = 0;
  t.stageOpp = 0;
  t.pairCountInStage = 0;
  // Modo SOLO PENALES: saltar juego normal y empezar penales directo
  t.turnSeq = [];
  showChoices(false);
  buildPenGrid();
  showPenGrid(true);
  updateTourUI(`Torneo iniciado (solo penales). ${t.stages[t.stageIndex]}.`);
  startPenalties();
}

function startOpportunity() {
  const t = state.tournament;
  if (t.turnIndex >= t.turnSeq.length) return finishTournament();
  const turn = t.turnSeq[t.turnIndex];
  t.phase = 'idle';
  t.ai = { attackSide: null, shotSide: null, defBlock: null, keeperGuess: null };
  // Reset resultado visual
  setTourResult('—', 'neutral');
  if (turn === 'opp') {
    // Rival ataca, tú defiendes
    t.ai.attackSide = randChoice();
    t.ai.shotSide = randChoice();
    t.phase = 'defend_guess_side';
    updateTourUI(`${state.tournament.stages[state.tournament.stageIndex]} · El rival ataca. Adivina por dónde irá la jugada.`);
  } else {
    // Tú atacas
    t.ai.defBlock = randChoice();
    t.ai.keeperGuess = randChoice();
    t.phase = 'attack_choose_side';
    updateTourUI(`${state.tournament.stages[state.tournament.stageIndex]} · Atacas. Elige un lado para atacar.`);
  }
}

function randChoice() {
  const opts = ['L','C','R'];
  return opts[Math.floor(Math.random() * 3)];
}

function onChoice(side) {
  const t = state.tournament;
  if (!t.active) return;
  const turn = t.turnSeq[t.turnIndex];
  switch (t.phase) {
    case 'defend_guess_side': {
      if (side === t.ai.attackSide) {
        // Leíste la jugada, termina oportunidad
        setTourResult('No fue gol (cortaste la jugada)', 'no-goal');
        updateTourUI("¡Bien! Cortaste la jugada. Fin de la oportunidad del rival.");
        return endOpportunity();
      } else {
        t.phase = 'defend_guess_shot';
        updateTourUI("Fallaste la lectura. Ahora adivina a dónde tirará el rival.");
      }
      break;
    }
    case 'defend_guess_shot': {
      if (side === t.ai.shotSide) {
        setTourResult('No fue gol (atajaste)', 'no-goal');
        updateTourUI("¡Atajada! Fin de la oportunidad del rival.");
      } else {
        t.oppScore += 1;
        setTourResult('Gol del rival', 'goal-opp');
        updateTourUI("Gol del rival.");
      }
      return endOpportunity();
    }
    case 'attack_choose_side': {
      if (side === t.ai.defBlock) {
        setTourResult('No fue gol (bloqueado)', 'no-goal');
        updateTourUI("Te cerraron el camino. Fin de la oportunidad.");
        return endOpportunity();
      } else {
        t.phase = 'attack_shoot';
        updateTourUI("Pasaste. Elige un lado para tirar.");
      }
      break;
    }
    case 'attack_shoot': {
      if (side === t.ai.keeperGuess) {
        setTourResult('No fue gol (atajaron)', 'no-goal');
        updateTourUI("Atajado por el portero. Fin de la oportunidad.");
      } else {
        t.yourScore += 1;
        setTourResult('¡Gol a favor!', 'goal-you');
        updateTourUI("¡Gol!");
      }
      return endOpportunity();
    }
  }
}

function endOpportunity() {
  const t = state.tournament;
  // Avanzar turno y posiblemente ronda
  t.turnIndex += 1;
  // Al completar un par de turnos (rival + tú)
  if (t.turnIndex % 2 === 0) {
    t.pairCountInStage += 1;
    // Si completamos todos los pares de la etapa, decidir ganador de etapa
    if (t.pairCountInStage >= t.pairsPerStage) {
      if (t.stageYour > t.stageOpp) {
        return completeStage(true, false);
      } else if (t.stageYour < t.stageOpp) {
        return completeStage(false, false);
      } else {
        // Empate: penales
        return startPenalties();
      }
    }
  }
  if (t.turnIndex >= t.turnSeq.length) return finishTournament();
  // Pequeño delay para leer el mensaje
  setTimeout(() => startOpportunity(), 700);
  updateTourUI();
}

function finishTournament() {
  const t = state.tournament;
  t.active = false;
  t.phase = 'idle';
  let msg = `Torneo terminado. Marcador final ${t.yourScore} - ${t.oppScore}.`;
  if (t.yourScore > t.oppScore) msg += " ¡Ganaste!";
  else if (t.yourScore < t.oppScore) msg += " Perdiste.";
  else msg += " Empate.";
  updateTourUI(msg);
}

function finishTournamentWithMsg(message) {
  const t = state.tournament;
  t.active = false;
  t.phase = 'idle';
  updateTourUI(message);
}

function completeStage(youWin, viaPenalties) {
  const t = state.tournament;
  const stageName = t.stages[t.stageIndex];
  if (!youWin) {
    const mode = viaPenalties ? ' por penales' : '';
    return finishTournamentWithMsg(`Eliminado en ${stageName}${mode}.`);
  }
  // Premio
  const reward = STAGE_REWARDS[stageName] || 0;
  if (reward) {
    state.coins += reward;
    saveState();
    updateCoins();
    animateCoinGain(reward);
  }
  const prefix = viaPenalties ? 'Ganaste por penales ' : 'Ganaste ';
  const msg = `${prefix}${stageName}. +${reward.toLocaleString()} 🪙`;
  // Avanzar etapa
  t.stageIndex += 1;
  t.round += 1;
  t.stageYour = 0;
  t.stageOpp = 0;
  t.pairCountInStage = 0;
  t.penalties = { active:false, your:0, opp:0, round:1, maxInitial:5, turn:'you' };
  if (t.stageIndex >= t.stages.length) {
    const champ = STAGE_REWARDS['Campeon'] || 0;
    if (champ) {
      state.coins += champ;
      saveState();
      updateCoins();
      animateCoinGain(champ);
    }
    return finishTournamentWithMsg(`${msg}. ¡Campeón! +${champ.toLocaleString()} 🪙 extra`);
  }
  updateTourUI(`${msg}. Siguiente: ${t.stages[t.stageIndex]}`);
  // Continuar con siguiente oportunidad
  setTimeout(() => {
    // Si estamos en modo solo penales (sin turnos de juego), arrancar penales de nuevo
    if (!t.turnSeq || t.turnSeq.length === 0) {
      showChoices(false);
      buildPenGrid();
      showPenGrid(true);
      startPenalties();
    } else {
      startOpportunity();
    }
  }, 700);
}

// -----------------------------
// Penales
// -----------------------------
function startPenalties() {
  const t = state.tournament;
  t.penalties = { active: true, your: 0, opp: 0, round: 1, maxInitial: 5, turn: Math.random() < 0.5 ? 'you' : 'opp' };
  setTourResult('—', 'neutral');
  if (t.penalties.turn === 'opp') {
    t.phase = 'pens_defend';
    updateTourUI(`${t.stages[t.stageIndex]} · Penales · Defiende el tiro ${t.penalties.round}`);
  } else {
    t.phase = 'pens_attack';
    updateTourUI(`${t.stages[t.stageIndex]} · Penales · Tiras primero (tiro ${t.penalties.round})`);
  }
}

function onPenChoice(side) {
  const t = state.tournament;
  if (!t.penalties.active) return;
  if (t.phase === 'pens_defend') {
    // Rival tira, tú eliges dónde adivinar
    const shot = randChoice();
    if (side === shot) {
      setTourResult('No fue gol (atajaste penal)', 'no-goal');
    } else {
      t.penalties.opp += 1;
      setTourResult('Gol del rival (penal)', 'goal-opp');
    }
    // Cambia a tu tiro
    t.phase = 'pens_attack';
    updateTourUI(`Ahora tiras tú (tiro ${t.penalties.round})`);
  } else if (t.phase === 'pens_attack') {
    // Tú tiras, IA adivina
    const keeper = randChoice();
    if (side === keeper) {
      setTourResult('No fue gol (te atajaron el penal)', 'no-goal');
    } else {
      t.penalties.your += 1;
      setTourResult('¡Gol a favor (penal)!', 'goal-you');
    }
    // Termina la ronda de penales (par de tiros), evaluar estado
    checkPenaltiesProgress();
  }
}

function checkPenaltiesProgress() {
  const t = state.tournament;
  const p = t.penalties;
  // Decidir si ya es imposible alcanzar durante los 5 iniciales
  if (p.round <= p.maxInitial) {
    const remaining = p.maxInitial - p.round;
    if (p.your - p.opp > remaining) return completeStage(true, true);
    if (p.opp - p.your > remaining) return completeStage(false, true);
    if (p.round === p.maxInitial) {
      if (p.your > p.opp) return completeStage(true, true);
      if (p.opp > p.your) return completeStage(false, true);
      // Empate: muerte súbita
      p.round += 1; // marcar entrada a SD
      updateTourUI('Penales: muerte súbita. Defiende de nuevo.');
      t.phase = 'pens_defend';
      return;
    }
    // Avanzar a siguiente ronda
    p.round += 1;
    t.phase = 'pens_defend';
    updateTourUI(`Penales · Ronda ${p.round}: defiende`);
    return;
  }
  // Muerte súbita: decidir en pares
  if (p.your > p.opp) return completeStage(true, true);
  if (p.opp > p.your) return completeStage(false, true);
  // Si igualados después del par, continuar otra ronda súbita
  p.round += 1;
  t.phase = 'pens_defend';
  updateTourUI(`Penales (muerte súbita) · Ronda ${p.round}: defiende`);
}

function updateTourUI(extraMsg) {
  const t = state.tournament;
  const r = document.getElementById('tourRound');
  const s = document.getElementById('tourScore');
  const turn = document.getElementById('tourTurn');
  const msg = document.getElementById('tourMessage');
  const stageName = t.stages[t.stageIndex] || '-';
  if (r) r.textContent = t.active ? `Etapa: ${stageName}` : 'Ronda: -';
  if (s) s.textContent = `Marcador: ${t.yourScore} - ${t.oppScore}`;
  if (turn) {
    const who = t.turnSeq[t.turnIndex] || '-';
    turn.textContent = `Turno: ${who === 'you' ? 'Tú' : who === 'opp' ? 'Rival' : '-'}`;
  }
  if (msg) {
    if (extraMsg) msg.textContent = extraMsg;
    else {
      // Mensaje por defecto según fase
      const phaseMsg = {
        defend_guess_side: 'El rival ataca. Adivina por dónde irá la jugada.',
        defend_guess_shot: 'Adivina a dónde tirará el rival.',
        attack_choose_side: 'Atacas. Elige un lado para atacar.',
        attack_shoot: 'Elige un lado para tirar.',
        idle: 'Pulsa Iniciar para comenzar',
      };
      msg.textContent = phaseMsg[t.phase] || '...';
    }
  }
}

// -----------------------------
// Inicialización y eventos UI
// -----------------------------
function showAuth(show){
  const sec = document.getElementById('auth');
  if (!sec) return;
  sec.style.display = show ? 'flex' : 'none';
}

function showReveal(show){
  const sec = document.getElementById('reveal');
  if (!sec) return;
  if (show){ sec.classList.add('show'); sec.style.display = 'block'; }
  else { sec.classList.remove('show'); sec.style.display = 'none'; }
}

function showClub(show){
  const sec = document.getElementById('club');
  if (!sec) return;
  if (show){ sec.classList.add('show'); renderClub(); }
  else { sec.classList.remove('show'); }
}

function showDuplicates(show){
  const sec = document.getElementById('duplicates');
  if (!sec) return;
  if (show){ sec.classList.add('show'); renderDuplicates(); }
  else { sec.classList.remove('show'); }
}

function renderDuplicates(){
  const grid = document.getElementById('duplicatesGrid');
  if (!grid) return;
  grid.innerHTML = '';
  if (!state.club.length){
    grid.innerHTML = '<div class="empty">No tienes cartas en el club.</div>';
    return;
  }
  // Agrupar por imagen y filtrar grupos con más de 1
  const byImage = new Map();
  for (const c of state.club){
    const key = c.image || c.name;
    if (byImage.has(key)) byImage.get(key).count += 1; else byImage.set(key, { card:c, count:1 });
  }
  const groups = Array.from(byImage.values()).filter(g=>g.count>1);
  if (!groups.length){
    grid.innerHTML = '<div class="empty">No tienes duplicados ahora mismo.</div>';
    return;
  }
  // Ordenar por rareza y nombre como en el club
  groups.sort((a,b)=>{
    const ra = RARITY_ORDER.indexOf(a.card.rarity);
    const rb = RARITY_ORDER.indexOf(b.card.rarity);
    if (ra!==rb) return ra-rb;
    const na = a.card.name.toLowerCase();
    const nb = b.card.name.toLowerCase();
    return na.localeCompare(nb);
  });
  groups.forEach(({card:c, count})=>{
    const div = document.createElement('div');
    div.className = `card ${c.rarity}`;
    div.style.position = 'relative';
    div.style.aspectRatio = '2.1/3';
    div.style.overflow = 'hidden';
    const art = document.createElement('img');
    art.src = c.image ? encodeURI(c.image) : '';
    art.alt = c.name;
    art.style.position = 'absolute';
    art.style.inset = '0';
    art.style.width = '100%';
    art.style.height = '100%';
    art.style.objectFit = 'cover';
    art.onerror = ()=>{
      if (!art.dataset.fallbackTried){
        const alt = IMAGE_FILES.find(f => f.toLowerCase().includes(c.name.toLowerCase().split(' ')[0]));
        if (alt){ art.dataset.fallbackTried='1'; art.src = encodeURI(alt); return; }
      }
      art.remove();
    };
    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    overlay.style.inset = '0';
    overlay.style.background = 'linear-gradient(180deg, rgba(0,0,0,.1) 20%, rgba(0,0,0,.35) 70%)';
    const meta = document.createElement('div');
    meta.style.position = 'absolute';
    meta.style.left = '0';
    meta.style.right = '0';
    meta.style.bottom = '0';
    meta.style.padding = '10px';
    meta.style.background = 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,.55) 60%)';
    meta.style.color = '#fff';
    meta.style.display = 'flex';
    meta.style.flexDirection = 'column';
    meta.style.gap = '2px';
    const nm = document.createElement('div');
    nm.textContent = c.name;
    nm.style.fontWeight = '800';
    const info = document.createElement('div');
    info.textContent = `${RARITY_LABEL[c.rarity]||''} • OVR ${c.rating} • ${mapPosition(c.position)}`;
    info.style.fontSize = '.9rem';
    info.style.opacity = '.9';
    meta.appendChild(nm);
    meta.appendChild(info);
    const badge = document.createElement('div');
    badge.className = 'dup-badge';
    badge.textContent = `×${count}`;
    // Click: abrir DCP para facilitar uso
    div.addEventListener('click', ()=>{
      showDcp(true);
    });
    div.appendChild(art);
    div.appendChild(overlay);
    div.appendChild(meta);
    div.appendChild(badge);
    grid.appendChild(div);
  });
}

function showExchangeOverlay(show){
  const el = document.getElementById('exchange');
  if (!el) return;
  if (show){
    el.style.display = 'flex';
    exchangeSelectedIndex = null;
    renderExchangeList();
    fillExchangeTargets();
    updateExchangeButtons();
  } else {
    el.style.display = 'none';
  }
}

function showDcp(show){
  const el = document.getElementById('dcp');
  if (!el) return;
  if (show){
    el.style.display = 'flex';
    setDcpMode('CR');
  } else {
    el.style.display = 'none';
  }
}

function setDcpMode(mode){
  if (!DCP_CONFIG[mode]) mode = 'CR';
  dcpMode = mode;
  dcpSelected = new Set();
  const cfg = DCP_CONFIG[dcpMode];
  const title = document.getElementById('dcpTitle');
  if (title) title.textContent = cfg.title;
  const req = document.getElementById('dcpReqText');
  if (req) req.innerHTML = cfg.reqText;
  // Actualizar encabezado de la lista "Selecciona N cartas"
  const headerStrong = document.querySelector('#dcp .list-header strong');
  if (headerStrong) headerStrong.textContent = `Selecciona ${cfg.count} cartas`;
  // Tabs estilos: resetear todos a outline y activar el actual
  const tabIds = [
    ['CR','dcpTabCR'],
    ['MESSI','dcpTabMessi'],
    ['DIAZ','dcpTabDiaz'],
    ['RAPHINHA','dcpTabRaphinha'],
    ['MBAPPE','dcpTabMbappe'],
  ];
  tabIds.forEach(([key,id])=>{
    const el = document.getElementById(id);
    if (!el) return;
    if (key === dcpMode) el.classList.remove('btn-outline'); else el.classList.add('btn-outline');
  });
  renderDcpList();
  updateDcpStatus();
  updateDcpFilterButton();
}

function renderDcpList(){
  const list = document.getElementById('dcpList');
  if (!list) return;
  list.innerHTML = '';
  if (!state.club.length){
    list.innerHTML = '<div class="empty">No tienes cartas en el club.</div>';
    return;
  }
  const cfg = DCP_CONFIG[dcpMode];
  // Contar ocurrencias por clave (imagen o nombre)
  const counts = new Map();
  state.club.forEach(c=>{
    const key = c.image || c.name;
    counts.set(key, (counts.get(key)||0) + 1);
  });
  // Mostrar cartas (filtrando opcionalmente solo duplicados)
  let added = 0;
  state.club.forEach((c, idx)=>{
    const key = c.image || c.name;
    const cnt = counts.get(key) || 1;
    if (dcpFilterDuplicatesOnly && cnt < 2) return;
    const row = document.createElement('div');
    row.className = 'list-item dcp-item' + (dcpSelected.has(idx) ? ' active' : '');
    row.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px">
        <span class="tag ${c.rarity}">${c.rarity}</span>
        <strong>${c.name}</strong>
      </div>
      <div class="muted">OVR ${c.rating}</div>
    `;
    row.addEventListener('click', ()=>{
      if (dcpSelected.has(idx)) dcpSelected.delete(idx); else {
        if (dcpSelected.size >= cfg.count) { toast(`Máximo ${cfg.count} cartas`); return; }
        dcpSelected.add(idx);
      }
      renderDcpList();
      updateDcpStatus();
    });
    list.appendChild(row);
    added += 1;
  });
  if (!added){
    list.innerHTML = dcpFilterDuplicatesOnly
      ? '<div class="empty">No hay cartas duplicadas disponibles.</div>'
      : '<div class="empty">No tienes cartas en el club.</div>';
  }
}

function updateDcpStatus(){
  const st = document.getElementById('dcpStatus');
  const btn = document.getElementById('dcpSubmitBtn');
  const count = dcpSelected.size;
  let avg = 0;
  if (count){
    let sum = 0;
    dcpSelected.forEach(i=>{ const c = state.club[i]; if (c) sum += (c.rating||0); });
    avg = Math.round((sum / count) * 10)/10;
  }
  const cfg = DCP_CONFIG[dcpMode];
  if (st) st.textContent = `${count} / ${cfg.count} seleccionados · Media: ${avg}`;
  if (btn) btn.disabled = !(count === cfg.count && avg >= cfg.minAvg);
}

function updateDcpFilterButton(){
  const btn = document.getElementById('dcpFilterDupBtn');
  if (!btn) return;
  btn.textContent = dcpFilterDuplicatesOnly ? 'Todos' : 'Solo duplicados';
  // Visual: cuando está activo, quitar outline
  if (dcpFilterDuplicatesOnly) btn.classList.remove('btn-outline'); else btn.classList.add('btn-outline');
}

function clearDcpSelection(){
  dcpSelected = new Set();
  renderDcpList();
  updateDcpStatus();
}

function submitDcp(){
  const cfg = DCP_CONFIG[dcpMode];
  const count = dcpSelected.size;
  if (count !== cfg.count) { toast(`Debes seleccionar ${cfg.count} cartas`); return; }
  // Validar media
  let sum = 0; let ok = true;
  dcpSelected.forEach(i=>{ const c = state.club[i]; if (!c) ok = false; else sum += (c.rating||0); });
  const avg = sum / cfg.count;
  if (!ok || avg < cfg.minAvg){ toast(`La media debe ser al menos ${cfg.minAvg} OVR`); return; }
  // Eliminar cartas seleccionadas del club (ordenar índices desc para splice)
  const toRemove = Array.from(dcpSelected).sort((a,b)=>b-a);
  toRemove.forEach(i=>{ if (state.club[i]) state.club.splice(i,1); });
  // Otorgar recompensa según el reto activo
  state.club.push({ ...cfg.reward });
  saveState();
  try { renderClub(); } catch {}
  toast(`¡Has recibido a ${cfg.reward.name} ${cfg.reward.rating}!`);
  showDcp(false);
}

function init(){
  // Estado inicial
  loadState();

  // Packs selectores
  $$('.pack').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const key = btn.getAttribute('data-pack');
      if (key) selectPack(key);
    });
  });

  // Botones principales
  const openBtn = document.getElementById('openPackBtn');
  if (openBtn) openBtn.addEventListener('click', openPack);

  const viewClubBtn = document.getElementById('viewClubBtn');
  if (viewClubBtn) viewClubBtn.addEventListener('click', ()=> showClub(true));
  const closeClubBtn = document.getElementById('closeClubBtn');
  if (closeClubBtn) closeClubBtn.addEventListener('click', ()=> showClub(false));
  
  // Duplicados
  const duplicatesBtn = document.getElementById('duplicatesBtn');
  if (duplicatesBtn) duplicatesBtn.addEventListener('click', ()=> showDuplicates(true));
  const closeDuplicatesBtn = document.getElementById('closeDuplicatesBtn');
  if (closeDuplicatesBtn) closeDuplicatesBtn.addEventListener('click', ()=> showDuplicates(false));

  // Cupón (topbar)
  const couponBtn = document.getElementById('couponBtn');
  if (couponBtn) couponBtn.addEventListener('click', redeemCoupon);

  const exchangeBtn = document.getElementById('exchangeBtn');
  if (exchangeBtn) exchangeBtn.addEventListener('click', ()=> showExchangeOverlay(true));
  const closeExchangeBtn = document.getElementById('closeExchangeBtn');
  if (closeExchangeBtn) closeExchangeBtn.addEventListener('click', ()=> showExchangeOverlay(false));
  const doExchangeBtn = document.getElementById('doExchangeBtn');
  if (doExchangeBtn) doExchangeBtn.addEventListener('click', doExchange);

  // DCP
  const dcpBtn = document.getElementById('dcpBtn');
  if (dcpBtn) dcpBtn.addEventListener('click', ()=> showDcp(true));
  const closeDcpBtn = document.getElementById('closeDcpBtn');
  if (closeDcpBtn) closeDcpBtn.addEventListener('click', ()=> showDcp(false));
  const dcpClearBtn = document.getElementById('dcpClearBtn');
  if (dcpClearBtn) dcpClearBtn.addEventListener('click', clearDcpSelection);
  const dcpSubmitBtn = document.getElementById('dcpSubmitBtn');
  if (dcpSubmitBtn) dcpSubmitBtn.addEventListener('click', submitDcp);
  const dcpTabCR = document.getElementById('dcpTabCR');
  if (dcpTabCR) dcpTabCR.addEventListener('click', ()=> setDcpMode('CR'));
  const dcpTabMessi = document.getElementById('dcpTabMessi');
  if (dcpTabMessi) dcpTabMessi.addEventListener('click', ()=> setDcpMode('MESSI'));
  const dcpTabDiaz = document.getElementById('dcpTabDiaz');
  if (dcpTabDiaz) dcpTabDiaz.addEventListener('click', ()=> setDcpMode('DIAZ'));
  const dcpTabRaphinha = document.getElementById('dcpTabRaphinha');
  if (dcpTabRaphinha) dcpTabRaphinha.addEventListener('click', ()=> setDcpMode('RAPHINHA'));
  const dcpTabMbappe = document.getElementById('dcpTabMbappe');
  if (dcpTabMbappe) dcpTabMbappe.addEventListener('click', ()=> setDcpMode('MBAPPE'));
  const dcpDupBtn = document.getElementById('dcpDupBtn');
  if (dcpDupBtn) dcpDupBtn.addEventListener('click', ()=> { showDcp(false); showDuplicates(true); });
  const dcpFilterDupBtn = document.getElementById('dcpFilterDupBtn');
  if (dcpFilterDupBtn) dcpFilterDupBtn.addEventListener('click', ()=>{
    dcpFilterDuplicatesOnly = !dcpFilterDuplicatesOnly;
    updateDcpFilterButton();
    renderDcpList();
  });

  // Atajos de teclado
  document.addEventListener('keydown', (e)=>{
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
    const isTyping = tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable);
    if (isTyping) return;
    if (e.key === 'm' || e.key === 'M'){
      showDcp(true);
      setDcpMode('MESSI');
    } else if (e.key === 'c' || e.key === 'C'){
      showDcp(true);
      setDcpMode('CR');
    }
  });

  const tournamentBtn = document.getElementById('tournamentBtn');
  if (tournamentBtn) tournamentBtn.addEventListener('click', ()=> toggleTournament(true));
  const closeTournamentBtn = document.getElementById('closeTournamentBtn');
  if (closeTournamentBtn) closeTournamentBtn.addEventListener('click', ()=> toggleTournament(false));
  const startTournamentBtn = document.getElementById('startTournamentBtn');
  if (startTournamentBtn) startTournamentBtn.addEventListener('click', ()=>{
    // Requiere alineación previa
    toggleLineup(true);
  });
  const closeLineupBtn = document.getElementById('closeLineupBtn');
  if (closeLineupBtn) closeLineupBtn.addEventListener('click', ()=> toggleLineup(false));
  const autoFillBtn = document.getElementById('autoFillBtn');
  if (autoFillBtn) autoFillBtn.addEventListener('click', autoFillLineup);
  const clearLineupBtn = document.getElementById('clearLineupBtn');
  if (clearLineupBtn) clearLineupBtn.addEventListener('click', clearLineup);
  const confirmLineupBtn = document.getElementById('confirmLineupBtn');
  if (confirmLineupBtn) confirmLineupBtn.addEventListener('click', confirmLineupAndStart);

  const keepAllBtn = document.getElementById('keepAllBtn');
  if (keepAllBtn) keepAllBtn.addEventListener('click', keepAll);
  const closeRevealBtn = document.getElementById('closeRevealBtn');
  if (closeRevealBtn) closeRevealBtn.addEventListener('click', ()=> showReveal(false));

  const search = document.getElementById('search');
  if (search) search.addEventListener('input', renderClub);
  const filter = document.getElementById('filter');
  if (filter) filter.addEventListener('change', renderClub);

  const resetBtn = document.getElementById('resetBtn');
  if (resetBtn) resetBtn.addEventListener('click', ()=>{
    if (!confirm('¿Seguro que quieres reiniciar las monedas, club y overrides para este usuario?')) return;
    state.coins = 20000;
    state.club = [];
    state.overrides = {};
    saveState();
    updateCoins();
    renderClub();
    toast('Datos reiniciados');
  });

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', ()=>{
    // Cerrar sesión: olvidar usuario actual y mostrar login
    try { localStorage.removeItem(STORAGE_KEYS.currentUser); } catch {}
    state.user = null;
    updateCurrentUser();
    showAuth(true);
    try { document.getElementById('username')?.focus(); } catch {}
  });

  // Auth form
  const authForm = document.getElementById('authForm');
  if (authForm) authForm.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const uEl = document.getElementById('username');
    const pEl = document.getElementById('password');
    const errEl = document.getElementById('authError');
    if (errEl) errEl.textContent = '';
    const uname = uEl && uEl.value ? uEl.value.trim() : '';
    const pwd = pEl && pEl.value ? pEl.value : '';
    if (!uname){ if (errEl) errEl.textContent = 'Escribe un nombre de usuario'; return; }

    try {
      const existing = loadUser(uname);
      if (existing) {
        // Usuario existente: verificar contraseña si tiene hash guardado
        if (existing.passwordHash) {
          if (!pwd) { if (errEl) errEl.textContent = 'Esta cuenta requiere contraseña'; return; }
          const hp = await hashPassword(pwd);
          if (hp !== existing.passwordHash) { if (errEl) errEl.textContent = 'Contraseña incorrecta'; return; }
          // ok
          localStorage.setItem(STORAGE_KEYS.currentUser, uname);
          setUser(uname);
          showAuth(false);
          return;
        } else {
          // No tenía contraseña. Si el usuario escribe una ahora, establecerla.
          if (pwd) {
            const hp = await hashPassword(pwd);
            const updated = { ...existing, passwordHash: hp };
            localStorage.setItem(userKey(uname), JSON.stringify(updated));
          }
          localStorage.setItem(STORAGE_KEYS.currentUser, uname);
          setUser(uname);
          showAuth(false);
          return;
        }
      } else {
        // Crear nueva cuenta con 20,000 monedas
        const data = { coins: 20000, club: [], overrides: {} };
        if (pwd) {
          data.passwordHash = await hashPassword(pwd);
        }
        localStorage.setItem(userKey(uname), JSON.stringify(data));
        localStorage.setItem(STORAGE_KEYS.currentUser, uname);
        setUser(uname);
        showAuth(false);
        return;
      }
    } catch (err) {
      console.error('Auth error:', err);
      if (errEl) errEl.textContent = 'Ocurrió un error. Intenta de nuevo.';
    }
  });

  // Atajos torneo: clicks en opciones
  $$('#choices .choice').forEach(btn=>{
    btn.addEventListener('click', ()=> onChoice(btn.getAttribute('data-side')));
  });
}

document.addEventListener('DOMContentLoaded', init);
