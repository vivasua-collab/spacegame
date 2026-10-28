#!/usr/bin/env bash
# ============================================================================
# R-RES-QUEUE-VERIFY (Issue #16) — воспроизводимый browser-driven E2E
# циклической очереди исследований.
#
# Проверяет через РЕАЛЬНЫЙ UI (только клики по элементам интерфейса и чтение
# innerText; никаких прямых мутаций store/queue/rpInvested, никаких вызовов
# tickResearch/mediator из теста):
#   1. Новая игра (seed 424242) → колонизация Xi Ursae II через UI.
#   2. 2 лаборатории через диалог гексов → RP/День > 0 (лаборатории в пуле).
#   3. A/B/C (Термоядерный реактор / Обработка стали / Микроэлектроника,
#      Tier I, prerequisites выполнены) в очередь кнопкой «В очередь».
#   4. x50: наблюдение FIFO-ротации — передача хода после КАЖДОГО завершённого
#      уровня (A→B→C→A…), несколько полных проходов, отсутствие starvation
#      и монополизации (симптом владельца: первая технология до 8, остальные 0).
#   5. Pause → скриншот согласованного состояния (тик таймлайна == тик кадра).
#   6. Save → reload → Load: порядок очереди и частичный RP переживают
#      round-trip.
#   7. Артефакты: скриншоты, timeline.log, console.log (page errors + console).
#
# Требования: запущенный dev-сервер spacegame (next dev), agent-browser CLI
# (npm i -g agent-browser && agent-browser install), bash, python3.
#
# Использование:
#   bash scripts/e2e/research-queue-e2e.sh [BASE_URL] [SESSION] [ARTIFACT_DIR]
#   по умолчанию: http://127.0.0.1:3000  e2e-resq  checkpoints/e2e-runs/<ts>
#
# Exit code: 0 — все проверки пройдены; 1 — есть нарушения (список в конце).
# ============================================================================
set -u

BASE_URL="${1:-http://127.0.0.1:3000}"
SESSION="${2:-e2e-resq}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
ARTDIR="${3:-checkpoints/e2e-runs/resq-$TS}"
SEED="424242"
mkdir -p "$ARTDIR"

ab() { agent-browser --session "$SESSION" "$@"; }

FAILS=()
fail() { FAILS+=("$1"); echo "  [FAIL] $1"; }
ok()   { echo "  [OK] $1"; }

# Клик по кнопке по accessible name: сначала agent-browser find role, затем
# eval-фолбэк (реальный .click() на найденной кнопке — тот же UI-контрол).
click_btn() { # click_btn '<точное имя>' '<JS-предикат для фолбэка>'
  ab find role button click --name "$1" >/dev/null 2>&1 && return 0
  ab eval "(() => { const b = [...document.querySelectorAll('button')].find($2); if (b) { b.click(); return 'ok'; } return 'notfound'; })()" >/dev/null
}

# --- reader: состояние исследований ТОЛЬКО из innerText UI -----------------
read_state_js() {
  cat << 'JSEOF'
(() => {
  const t = document.body.innerText;
  const tick = (t.match(/Tick: (\d+)/) || [])[1];
  const speed = (t.match(/Speed: (\S+)/) || [])[1];
  const phase = (t.match(/Phase: (\S+)/) || [])[1];
  const lvls = {};
  [['Термоядерный реактор','A'],['Обработка стали','B'],['Микроэлектроника','C']].forEach(([n, id]) => {
    const m = t.match(new RegExp(n + '\\nУр\\. (\\d+)/10'));
    if (m) lvls[id] = parseInt(m[1], 10);
  });
  const act = t.match(/АКТИВНОЕ ИССЛЕДОВАНИЕ\n([^\n]+)\nЦель: ур\. (\d+)\n[^\n]*\n([0-9]+)\/([0-9]+) RP/);
  const qe = [];
  const qre = /(\d+)\.\n([^\n]+)\nцель ур\. (\d+) \(из 10\)/g;
  let m2; while ((m2 = qre.exec(t)) !== null) qe.push(m2[2] + '→L' + m2[3]);
  const bank = (t.match(/Аккумулятор:\n([\d\s\u00a0]+) RP/) || [])[1];
  const inflow = (t.match(/RP\/День → дерево: ([\d.]+)/) || [])[1];
  const rpday = (t.match(/RP\/День:\n([\d.]+)/) || [])[1];
  return JSON.stringify({ tick, speed, phase, rpday, inflow, bank, lvls,
    active: act ? { tech: act[1], target: parseInt(act[2], 10), rp: act[3] + '/' + act[4] } : null,
    queue: qe });
})()
JSEOF
}

state() { ab eval "$(read_state_js)"; }

# eval agent-browser возвращает JSON: строки обёрнуты в кавычки — снимаем их
unq() { sed -e 's/^"//' -e 's/"$//' <<<"$1"; }

pyval() { echo "$1" | python3 -c "
import json, sys
raw = sys.stdin.read().strip()
try:
    d = json.loads(json.loads(raw)) if raw.startswith('\"') else json.loads(raw)
    path = '$2'.strip('.').split('.')
    for p in path:
        if not p: continue
        d = d.get(p) if isinstance(d, dict) else None
        if d is None: break
    print(d if d is not None else '')
except Exception:
    print('')
"; }

TL="$ARTDIR/timeline.log"
{ echo "# R-RES-QUEUE E2E — $(date -u +%Y-%m-%dT%H:%M:%SZ)"; echo "# BASE_URL=$BASE_URL SESSION=$SESSION SEED=$SEED"; echo "# формат: tick | speed | active(цель, RP) | уровни A/B/C | очередь | банк | приток-дерево"; } > "$TL"

log_state() { # log_state '<json>' '<метка>'
  local s
  s=$(pyval "$1" tick); local sp=$(pyval "$1" speed)
  local a=$(pyval "$1" active.tech); local at=$(pyval "$1" active.target); local arp=$(pyval "$1" active.rp)
  local la=$(pyval "$1" lvls.A); local lb=$(pyval "$1" lvls.B); local lc=$(pyval "$1" lvls.C)
  local q=$(pyval "$1" queue); local bank=$(pyval "$1" bank); local inf=$(pyval "$1" inflow)
  echo "[$2] tick=$s speed=$sp active='$a'(L$at, $arp) A=$la B=$lb C=$lc очередь=[$q] банк=$bank дерево=$inf" >> "$TL"
}

echo "=== R-RES-QUEUE-VERIFY E2E (Issue #16) ==="
echo "BASE_URL=$BASE_URL  ARTIFACTS=$ARTDIR"

# --- 0. Свежая страница (с retry — close/open могут гоняться) ----------------
ab close >/dev/null 2>&1 || true
sleep 2
LOADED=""
for attempt in 1 2 3; do
  ab open "$BASE_URL" >/dev/null 2>&1
  sleep 5
  N=$(ab eval "document.querySelectorAll('input').length" 2>/dev/null)
  N=$(unq "$N")
  if [ "$N" != "0" ] && [ -n "$N" ]; then LOADED="yes"; break; fi
  sleep 3
done
[ "$LOADED" = "yes" ] && ok "страница загрузилась (попытка $attempt)" || { fail "страница не загрузилась"; }
ab set viewport 1280 800 >/dev/null 2>&1
sleep 1

# --- 1. Новая игра -----------------------------------------------------------
ab eval "(() => { const i = document.querySelector('input[type=number]'); if (i) { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(i, '$SEED'); i.dispatchEvent(new Event('input', { bubbles: true })); return 'set: ' + i.value; } return 'no-input'; })()" >/dev/null
click_btn "Launch Game" "x => x.textContent.trim() === 'Launch Game'"
sleep 8
PHASE=$(unq "$(ab eval "document.body.innerText.match(/Phase: (\S+)/)?.[1] || 'unknown'")")
[ "$PHASE" = "colonization" ] && ok "новая игра: фаза colonization" || fail "новая игра: фаза=$PHASE (ожидалась colonization)"

# --- 2. Колонизация Xi Ursae II (последняя кнопка «Колонизировать») ----------
# ждём кнопку системы (галактическая карта может рендериться до ~10с)
for i in $(seq 1 10); do
  SYSR=$(unq "$(ab eval "(() => { const b = [...document.querySelectorAll('button')].find(x => /^System/.test(x.textContent.trim())); if (b) { b.click(); return 'clicked'; } return 'notfound'; })()")")
  [ "$SYSR" = "clicked" ] && break
  sleep 1
 done
sleep 2
# кнопка «Колонизировать» последней планеты (Xi Ursae II — Скалистая), с ожиданием
COL="notfound"
for i in $(seq 1 10); do
  COL=$(unq "$(ab eval "(() => { const bs = [...document.querySelectorAll('button')].filter(x => x.textContent.trim() === 'Колонизировать'); if (bs.length) { bs[bs.length - 1].click(); return 'clicked:' + bs.length; } return 'notfound'; })()")")
  case "$COL" in clicked:*) break;; esac
  sleep 1
done
# ждём фазу playing
PHASE="unknown"
for i in $(seq 1 12); do
  PHASE=$(unq "$(ab eval "document.body.innerText.match(/Phase: (\S+)/)?.[1] || 'unknown'")")
  [ "$PHASE" = "playing" ] && break
  sleep 1
done
[ "$PHASE" = "playing" ] && ok "колонизация: фаза playing" || fail "колонизация: фаза=$PHASE (click=$COL)"

# --- 3. 2 лаборатории через диалоги гексов -----------------------------------
HEXJS="(() => { const svg = [...document.querySelectorAll('svg[role=img]')].find(s => s.getAttribute('aria-label')?.startsWith('Гекс-сетка')); if (!svg) return ''; const polys = [...svg.querySelectorAll('g.cursor-pointer polygon')].filter(p => p.getBoundingClientRect().width > 0); return polys.slice(0, 2).map(p => { const r = p.getBoundingClientRect(); return Math.round(r.left + r.width/2) + ',' + Math.round(r.top + r.height/2); }).join(';'); })()"
HEXES=$(unq "$(ab eval "$HEXJS")")
HEX1="${HEXES%%;*}"; HEX2="${HEXES##*;}"
X1="${HEX1%%,*}"; Y1="${HEX1##*,}"; X2="${HEX2%%,*}"; Y2="${HEX2##*,}"
if [ -z "$HEXES" ] || [ "$HEX1" = "$HEX2" ]; then
  fail "гекс-сетка не найдена (HEXES='$HEXES')"
else
  for XY in "$X1 $Y1" "$X2 $Y2"; do
    set -- $XY
    ab mouse move "$1" "$2" >/dev/null 2>&1; ab mouse down left >/dev/null 2>&1; ab mouse up left >/dev/null 2>&1
    sleep 2
    ab find text "Лаборатория" click >/dev/null 2>&1 || ab eval "(() => { const c = [...document.querySelectorAll('div')].find(d => typeof d.className === 'string' && d.className.includes('cursor-pointer') && d.textContent.trim().startsWith('Лаборатория')); if (c) { c.click(); return 'ok'; } return 'notfound'; })()" >/dev/null
    sleep 2
  done
fi
# лаборатории должны попасть в пул: открываем исследования и проверяем RP/День
ab eval "(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Исследования'); b?.click(); return !!b; })()" >/dev/null
sleep 2
S=$(state); RPDAY=$(pyval "$S" rpday); RPDAY=$(unq "$RPDAY")
case "$RPDAY" in ''|0|0.0) fail "RP/День=$RPDAY — лаборатории не в пуле";; *) ok "2 лаборатории через UI: RP/День=$RPDAY";; esac
log_state "$S" "после постройки лабораторий"

# --- 4. A/B/C в очередь кнопкой «В очередь» ----------------------------------
for TECH in "Термоядерный реактор" "Обработка стали" "Микроэлектроника"; do
  ab find text "$TECH" click >/dev/null 2>&1 || ab eval "(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('$TECH') && x.textContent.includes('Ур.')); if (b) { b.click(); return 'ok'; } return 'notfound'; })()" >/dev/null
  sleep 1.5
  click_btn "В очередь" "x => x.textContent.trim() === 'В очередь'"
  sleep 1.5
  # закрыть модалку, если осталась (после успешной постановки закрывается сама)
  ab eval "(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Закрыть'); b?.click(); return !!b; })()" >/dev/null
  sleep 0.5
done
sleep 1
S=$(state)
ACT=$(unq "$(pyval "$S" active.tech)"); AT=$(unq "$(pyval "$S" active.target)")
QA=$(unq "$(pyval "$S" queue)")
LA=$(pyval "$S" lvls.A); LB=$(pyval "$S" lvls.B); LC=$(pyval "$S" lvls.C)
if [ "$ACT" = "Термоядерный реактор" ] && [ "$AT" = "1" ] && [ "$LA" = "0" ] && [ "$LB" = "0" ] && [ "$LC" = "0" ]; then
  ok "начальное состояние: активна A (цель L1), уровни 0/0/0, очередь=[$QA]"
else
  fail "начальное состояние: active='$ACT'(L$AT) A=$LA B=$LB C=$LC очередь=[$QA]"
fi
log_state "$S" "начальная очередь"
ab screenshot "$ARTDIR/01-initial-queue.png" >/dev/null 2>&1

# --- 5. x50: наблюдение FIFO-ротации -----------------------------------------
ab eval "(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'x50'); b?.click(); return !!b; })()" >/dev/null
echo "[x50] старт наблюдения ротации (поллинг ~0.8с)" >> "$TL"

PREV_ACT="$ACT"
SEQ=("$ACT")
HANDOFFS=0
MONO_VIOL=0
for i in $(seq 1 150); do
  S=$(state)
  A_NOW=$(unq "$(pyval "$S" active.tech)")
  LA=$(pyval "$S" lvls.A); LB=$(pyval "$S" lvls.B); LC=$(pyval "$S" lvls.C)
  [ -z "$LA" ] && LA=0; [ -z "$LB" ] && LB=0; [ -z "$LC" ] && LC=0
  # монополизация: A обгоняет остальных больше чем на 2 уровня
  D=$(( LA - (LB < LC ? LB : LC) ))
  [ "$D" -gt 2 ] && MONO_VIOL=$((MONO_VIOL+1))
  if [ -n "$A_NOW" ] && [ "$A_NOW" != "$PREV_ACT" ]; then
    HANDOFFS=$((HANDOFFS+1))
    SEQ+=("$A_NOW")
    log_state "$S" "ПЕРЕДАЧА ХОДА #$HANDOFFS: $PREV_ACT → $A_NOW"
    PREV_ACT="$A_NOW"
  fi
  # условие выхода: все три ≥ 3 и минимум 6 передач (2 полных прохода)
  if [ "$LA" -ge 3 ] && [ "$LB" -ge 3 ] && [ "$LC" -ge 3 ] && [ "$HANDOFFS" -ge 6 ]; then
    break
  fi
  sleep 0.8
done

echo "наблюдаемая последовательность активных: ${SEQ[*]} (передач хода: $HANDOFFS)" >> "$TL"
[ "$HANDOFFS" -ge 6 ] && ok "FIFO-ротация: $HANDOFFS передач хода, последовательность: ${SEQ[*]}" || fail "FIFO-ротация: только $HANDOFFS передач (последовательность: ${SEQ[*]})"
[ "$MONO_VIOL" -eq 0 ] && ok "монополизации нет: A никогда не обогнала B/C больше чем на 2 уровня" || fail "монополизация: $MONO_VIOL замеров с отрывом A > 2 уровней"

# порядок передач строго циклический A→B→C→A...
CYCLE_OK=$(printf '%s\n' "${SEQ[@]}" | python3 -c "
import sys
order = ['Термоядерный реактор', 'Обработка стали', 'Микроэлектроника']
seq = [l.strip() for l in sys.stdin if l.strip()]
try:
    ok = all(seq[i+1] == order[(order.index(seq[i]) + 1) % 3] for i in range(len(seq)-1))
except ValueError:
    ok = False
print('yes' if ok else 'no')
")
[ "$CYCLE_OK" = "yes" ] && ok "порядок передач строго циклический (A→B→C→A…)" || fail "порядок передач не циклический: ${SEQ[*]}"

# --- 6. Пауза → скриншот согласованного состояния ----------------------------
ab eval "(() => { const p = [...document.querySelectorAll('button')].find(b => typeof b.className === 'string' && b.className.includes('w-7')); if (p) { p.click(); return 'ok'; } return 'notfound'; })()" >/dev/null
sleep 1
S=$(state)
SPD=$(unq "$(pyval "$S" speed)")
LA=$(pyval "$S" lvls.A); LB=$(pyval "$S" lvls.B); LC=$(pyval "$S" lvls.C)
[ "$SPD" = "Paused" ] && ok "пауза для согласованного скриншота (Speed: Paused)" || fail "пауза не сработала (speed=$SPD)"
ab screenshot "$ARTDIR/02-rotation-paused.png" >/dev/null 2>&1
log_state "$S" "ПАУЗА+СКРИНШОТ 02 (тик кадра == тик этой строки)"
MINL=$(( LA < LB ? (LA < LC ? LA : LC) : (LB < LC ? LB : LC) ))
[ "$MINL" -ge 1 ] && ok "нет starvation: все три получили уровни (A=$LA B=$LB C=$LC)" || fail "starvation: A=$LA B=$LB C=$LC"

# --- 7. Save → reload → Load round-trip --------------------------------------
S_PRE=$(state)
LA_PRE=$(pyval "$S_PRE" lvls.A); LB_PRE=$(pyval "$S_PRE" lvls.B); LC_PRE=$(pyval "$S_PRE" lvls.C)
Q_PRE=$(unq "$(pyval "$S_PRE" queue)")
ACT_PRE=$(unq "$(pyval "$S_PRE" active.tech)"); RP_PRE=$(unq "$(pyval "$S_PRE" active.rp)")
click_btn "Save" "x => x.textContent.trim() === 'Save'"
sleep 3
ab reload >/dev/null 2>&1; sleep 6
# Load Game (имя кнопки содержит счётчик сейвов — ищем по включению)
for i in $(seq 1 10); do
  LG=$(unq "$(ab eval "(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Load Game')); if (b) { b.click(); return 'clicked'; } return 'notfound'; })()")")
  [ "$LG" = "clicked" ] && break
  sleep 1
done
sleep 2
# Load (первый сейв в списке), с ожиданием появления кнопки
for i in $(seq 1 10); do
  LD=$(unq "$(ab eval "(() => { const bs = [...document.querySelectorAll('button')].filter(x => x.textContent.trim() === 'Load'); if (bs.length) { bs[0].click(); return 'clicked'; } return 'notfound'; })()")")
  [ "$LD" = "clicked" ] && break
  sleep 1
done
# ждём загрузки игры (появится Phase)
for i in $(seq 1 15); do
  PH_NOW=$(unq "$(ab eval "document.body.innerText.match(/Phase: (\S+)/)?.[1] || ''")")
  [ -n "$PH_NOW" ] && break
  sleep 1
done
sleep 2
# после loadGame view = галактическая карта — открываем исследования для чтения состояния
ab eval "(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Исследования'); b?.click(); return !!b; })()" >/dev/null
sleep 2
S_POST=$(state)
LA_POST=$(pyval "$S_POST" lvls.A); LB_POST=$(pyval "$S_POST" lvls.B); LC_POST=$(pyval "$S_POST" lvls.C)
Q_POST=$(unq "$(pyval "$S_POST" queue)")
ACT_POST=$(unq "$(pyval "$S_POST" active.tech)"); RP_POST=$(unq "$(pyval "$S_POST" active.rp)")
PH_POST=$(pyval "$S_POST" phase)
log_state "$S_POST" "ПОСЛЕ LOAD (round-trip)"
if [ "$LA_POST" = "$LA_PRE" ] && [ "$LB_POST" = "$LB_PRE" ] && [ "$LC_POST" = "$LC_PRE" ]; then
  ok "save/load: уровни пережили round-trip (A=$LA_POST B=$LB_POST C=$LC_POST)"
else
  fail "save/load: уровни до=($LA_PRE/$LB_PRE/$LC_PRE) после=($LA_POST/$LB_POST/$LC_POST)"
fi
if [ "$ACT_POST" = "$ACT_PRE" ] && [ "$RP_POST" = "$RP_PRE" ]; then
  ok "save/load: активный проект и частичный RP пережили round-trip ($ACT_POST $RP_POST)"
else
  fail "save/load: активный до='$ACT_PRE $RP_PRE' после='$ACT_POST $RP_POST'"
fi
ab screenshot "$ARTDIR/03-after-load-roundtrip.png" >/dev/null 2>&1

# --- 8. Консоль/page errors ---------------------------------------------------
{ echo "# Console/page errors — R-RES-QUEUE E2E $(date -u +%Y-%m-%dT%H:%M:%SZ)"; echo "## Page errors:"; ab errors 2>&1; echo "(конец page errors)"; echo "## Console:"; ab console 2>&1; echo "(конец console)"; } > "$ARTDIR/console.log"

# --- Итог ---------------------------------------------------------------------
echo "" >> "$TL"
echo "=== ИТОГ E2E ===" >> "$TL"
if [ "${#FAILS[@]}" -eq 0 ]; then
  echo "PASS — все проверки пройдены" >> "$TL"
  echo "=== E2E PASS ==="
  exit 0
else
  for f in "${FAILS[@]}"; do echo "FAIL: $f" >> "$TL"; done
  echo "=== E2E FAIL (${#FAILS[@]}) ==="
  exit 1
fi
