/* Stouchi — les chiffres du mois, calculés à un seul endroit.
 *
 * Ce fichier est chargé DEUX fois : par le navigateur (avant app.js) et par le
 * proxy de chat (lib/chat-context.js, côté serveur). C'est volontaire — la
 * carte d'accueil et le contexte envoyé au modèle doivent sortir du même
 * calcul, sinon la bulle peut annoncer un reste que l'écran contredit.
 *
 * Pourquoi ce fichier existe : le modèle recalculait les montants lui-même à
 * partir d'une ligne ambiguë — « perso 840 (dépensé 1020, reste -180) » — et
 * ressortait la limite (840) comme si c'était le reste, tout en sachant par
 * ailleurs que 1020 avaient été dépensés. Il ne calcule plus rien : tout
 * chiffre qu'il a le droit de citer est écrit ici, en toutes lettres.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BudgetFacts = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function pad(n) { return String(n).padStart(2, '0'); }

  /* The row is a JSON blob that several clients write. One null or string in
     a list (a half-synced write, an old app version) used to throw here, which
     took down the home card in the browser and the whole server with it. Only
     plain objects get through. */
  function records(data, key) {
    var a = data && data[key];
    return Array.isArray(a) ? a.filter(function (x) { return x && typeof x === 'object' && !Array.isArray(x); }) : [];
  }

  function isoAdd(iso, days) {
    var d = new Date(Date.parse(iso + 'T00:00:00Z') + days * 86400000);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  /* Lundi de la semaine en cours : clé de nudge stable toute la semaine, même
     si la fenêtre de comparaison, elle, glisse d'un jour chaque jour. */
  function isoMonday(iso) {
    var d = new Date(Date.parse(iso + 'T00:00:00Z'));
    return isoAdd(iso, -((d.getUTCDay() + 6) % 7));
  }

  function daysInMonthOf(iso) {
    return new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0)).getUTCDate();
  }

  function names(s) {
    return { n1: s.n1 || 'Sofiene', n2: s.solo ? '' : (s.n2 || 'Zeineb'), solo: !!s.solo };
  }

  function rule(s) {
    var b = s.rb === undefined ? 50 : Number(s.rb);
    var p = s.rp === undefined ? 30 : Number(s.rp);
    return { b: b / 100, p: p / 100, e: Math.max(0, 100 - b - p) / 100 };
  }

  function income(s, scope) {
    if (scope === 'sofiene') return Number(s.s1) || 0;
    if (scope === 'zeineb') return Number(s.s2) || 0;
    return (Number(s.s1) || 0) + (Number(s.s2) || 0);
  }

  function scopeFilter(e, scope) {
    if (scope === 'sofiene') return e.who === 'Sofiene';
    if (scope === 'zeineb') return e.who === 'Zeineb';
    return true;
  }

  function monthExpenses(expenses, scope, today) {
    var mk = today.slice(0, 7);
    return expenses.filter(function (e) {
      return String(e.date || mk).slice(0, 7) === mk && scopeFilter(e, scope);
    });
  }

  function spentIn(expenses, scope, env, today) {
    return monthExpenses(expenses, scope, today)
      .filter(function (e) { return e.envelope === env; })
      .reduce(function (a, e) { return a + (Number(e.amount) || 0); }, 0);
  }

  function whoLabel(nm, w) {
    if (nm.solo) return '';
    if (w === 'Zeineb') return nm.n2;
    if (w === 'Sofiene') return nm.n1;
    return w === 'Maison' ? 'La maison' : w;
  }

  function migrateDebt(d) {
    if (!d || d.type) return d;
    return {
      id: d.id, type: d.kind === 'recevoir' ? 'due' : 'owe',
      person: d.who || '', label: d.note || '', amount: Number(d.amount) || 0,
      date: d.dueDate || '',
      who: (d.scope === 'Sofiene' || d.scope === 'Zeineb') ? d.scope : 'Maison',
      settled: !!d.settled
    };
  }

  /* Le seul endroit où l'on calcule. renderHome() lit ça pour la carte, le
     contexte du modèle lit ça pour ses faits : ils ne peuvent pas diverger. */
  function figures(data, scope, today) {
    var st = (data && data.settings) || {};
    var expenses = records(data, 'expenses');
    var r = rule(st);
    var inc = income(st, scope);
    var dim = daysInMonthOf(today);
    var dayOfMonth = Number(today.slice(8, 10));
    var dLeft = Math.max(1, dim - dayOfMonth);

    var env = [
      { key: 'besoins', label: 'Charges & courses', pct: r.b },
      { key: 'perso', label: 'Perso', pct: r.p }
    ].map(function (d) {
      var budget = Math.round(inc * d.pct);
      var sp = Math.round(spentIn(expenses, scope, d.key, today));
      return {
        key: d.key, label: d.label, budget: budget, spent: sp,
        remain: Math.max(0, budget - sp), over: Math.max(0, sp - budget)
      };
    });

    var budget = inc * (r.b + r.p);
    var sp = spentIn(expenses, scope, 'besoins', today) + spentIn(expenses, scope, 'perso', today);
    var remain = budget - sp;
    var ratio = budget > 0 ? sp / budget : 0;

    return {
      scope: scope, income: inc, envelopes: env,
      budget: budget, spent: sp, remain: remain, over: remain < 0, ratio: ratio,
      daysInMonth: dim, dayOfMonth: dayOfMonth, daysLeft: dLeft,
      perDay: Math.max(0, Math.floor(remain / dLeft)),
      /* Rythme : ce que donnerait la fin du mois si on continuait comme ça. */
      projection: dayOfMonth > 0 ? Math.round(sp / dayOfMonth * dim) : 0,
      ahead: remain >= 0 && ratio > 0.25 && ratio > (dayOfMonth / dim) + 0.15
    };
  }

  /* « le budget est de » et « il te reste » ne doivent jamais pouvoir être
     confondus : chaque enveloppe le dit en toutes lettres. */
  function envLine(e) {
    return e.label + ' : budget du mois ' + e.budget + ' TND' +
      ' | déjà dépensé ' + e.spent + ' TND' +
      ' | ' + (e.over > 0
        ? 'DÉPASSÉ DE ' + e.over + ' TND — il ne reste RIEN à dépenser (reste = 0 TND)'
        : 'il reste exactement ' + e.remain + ' TND');
  }

  /* Une catégorie nettement au-dessus de la semaine précédente. Un seul nudge
     à la fois, et seulement s'il n'a pas déjà été dit cette semaine — d'où la
     clé rendue à l'appelant, qui la mémorise. */
  function categoryNudge(expenses, today, seen) {
    var curFrom = isoAdd(today, -6);
    var prevFrom = isoAdd(today, -13);
    var prevTo = isoAdd(today, -7);
    var cur = {}, prev = {};
    expenses.forEach(function (e) {
      var d = e && e.date;
      if (!d) return;
      var cat = String(e.category || 'autre');
      var amt = Number(e.amount) || 0;
      if (d >= curFrom && d <= today) cur[cat] = (cur[cat] || 0) + amt;
      else if (d >= prevFrom && d <= prevTo) prev[cat] = (prev[cat] || 0) + amt;
    });
    var week = isoMonday(today);
    var best = null;
    Object.keys(cur).forEach(function (cat) {
      var c = Math.round(cur[cat]), p = Math.round(prev[cat] || 0);
      /* Seuils hauts exprès : on ne commente pas un café de plus. */
      if (c < 50 || c - p < 30 || c < p * 1.6) return;
      if (seen.indexOf(cat + '|' + week) !== -1) return;
      if (!best || (c - p) > (best.cur - best.prev)) best = { cat: cat, cur: c, prev: p };
    });
    if (!best) return null;
    return {
      key: best.cat + '|' + week,
      line: 'categorie_en_hausse : ' + best.cat + ' — ' + best.cur +
        ' TND sur les 7 derniers jours, contre ' + best.prev + ' TND les 7 jours d\'avant'
    };
  }

  var JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  var MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  function monthKeyAdd(mk, delta) {
    var y = Number(mk.slice(0, 4));
    var m = Number(mk.slice(5, 7)) - 1 + delta;
    var d = new Date(Date.UTC(y, m, 1));
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1);
  }

  function monthLabel(mk) { return MOIS[Number(mk.slice(5, 7)) - 1]; }

  function sum(list) {
    return list.reduce(function (a, e) { return a + (Number(e.amount) || 0); }, 0);
  }

  function median(nums) {
    var s = nums.slice().sort(function (a, b) { return a - b; });
    var i = Math.floor(s.length / 2);
    return s.length % 2 ? s[i] : Math.round((s[i - 1] + s[i]) / 2);
  }

  /* ── TENDANCES ────────────────────────────────────────────────
   * Statistiques calculées sur l'historique réel, jamais devinées. Chaque
   * tendance a un seuil de données en dessous duquel elle ne produit RIEN :
   * pas de ligne, pas de « données insuffisantes ». Une absence veut dire
   * « je n'ai pas ça », ce que le prompt interdit de combler.
   */
  function insights(data, today, seen) {
    var st = (data && data.settings) || {};
    var all = records(data, 'expenses');
    var expenses = all.filter(function (e) { return e && /^\d{4}-\d{2}-\d{2}$/.test(e.date || ''); });
    var mk = today.slice(0, 7);
    var day = Number(today.slice(8, 10));
    var week = isoMonday(today);
    var lines = [];
    var proactive = [];
    var r = rule(st);

    function inMonth(m) { return expenses.filter(function (e) { return e.date.slice(0, 7) === m; }); }

    /* 1. Rythme par rapport aux mois précédents — comparé au MÊME jour du
       mois, sinon un 10 du mois face à des mois complets dirait toujours
       « tu es en avance ». */
    var curTo = inMonth(mk).filter(function (e) { return Number(e.date.slice(8, 10)) <= day; });
    var refs = [];
    for (var i = 1; i <= 3; i++) {
      var pm = monthKeyAdd(mk, -i);
      var w = inMonth(pm).filter(function (e) { return Number(e.date.slice(8, 10)) <= day; });
      if (w.length >= 5) refs.push(Math.round(sum(w)));
    }
    if (refs.length) {
      var cur = Math.round(sum(curTo));
      var med = median(refs);
      var pct = med > 0 ? Math.round((cur - med) / med * 100) : 0;
      lines.push('rythme_vs_mois_precedents : ' + cur + ' TND au ' + day + ' du mois, contre ' + med +
        ' TND ' + (refs.length > 1 ? 'en médiane au même jour sur les ' + refs.length + ' mois précédents'
          : 'au même jour le mois précédent') +
        ' (' + (pct >= 0 ? '+' : '') + pct + '%)');
      if (pct >= 20) proactive.push('rythme_vs_mois_precedents');
    }

    /* 2. Concentration par jour de la semaine, sur 8 semaines. */
    var from = isoAdd(today, -55);
    var win = expenses.filter(function (e) { return e.date >= from && e.date <= today; });
    if (win.length >= 12) {
      var byDay = [0, 0, 0, 0, 0, 0, 0], cntDay = [0, 0, 0, 0, 0, 0, 0], catDay = {};
      win.forEach(function (e) {
        var d = new Date(Date.parse(e.date + 'T00:00:00Z')).getUTCDay();
        byDay[d] += Number(e.amount) || 0;
        cntDay[d] += 1;
        catDay[d] = catDay[d] || {};
        var c = String(e.category || 'autre');
        catDay[d][c] = (catDay[d][c] || 0) + (Number(e.amount) || 0);
      });
      var total = byDay.reduce(function (a, b) { return a + b; }, 0);
      var best = 0;
      for (var d2 = 1; d2 < 7; d2++) if (byDay[d2] > byDay[best]) best = d2;
      var share = total > 0 ? byDay[best] / total : 0;
      if (cntDay[best] >= 3 && share >= 0.25) {
        var cats = catDay[best] || {};
        var topCat = Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a]; })[0];
        var catPart = (topCat && byDay[best] > 0 && cats[topCat] / byDay[best] >= 0.4)
          ? ', surtout en ' + topCat : '';
        lines.push('jour_le_plus_depensier : ' + JOURS[best] + ' — ' + Math.round(share * 100) +
          '% des dépenses des 8 dernières semaines (' + Math.round(byDay[best]) + ' TND sur ' +
          Math.round(total) + ' TND)' + catPart);
        proactive.push('jour_le_plus_depensier');
      }
    }

    /* 3. Dépassement récurrent par enveloppe, sur les 3 mois complets
       précédents. Le budget d'un mois passé vient de l'instantané pris à
       l'époque ; à défaut, du revenu actuel — ce qui est signalé. */
    var hist = (st.budgetHistory && typeof st.budgetHistory === 'object') ? st.budgetHistory : {};
    var months = [];
    for (var j = 1; j <= 3; j++) {
      var m2 = monthKeyAdd(mk, -j);
      var list = inMonth(m2);
      if (list.length >= 3) months.push({ mk: m2, list: list });
    }
    if (months.length === 3) {
      var approx = false;
      [{ k: 'besoins', label: 'charges & courses', pct: r.b }, { k: 'perso', label: 'perso', pct: r.p }]
        .forEach(function (envDef) {
          var overMonths = [];
          months.forEach(function (m3) {
            var snap = hist[m3.mk];
            var budget;
            if (snap && Number(snap.inc) >= 0 && snap[envDef.k === 'besoins' ? 'rb' : 'rp'] !== undefined) {
              budget = Number(snap.inc) * (Number(snap[envDef.k === 'besoins' ? 'rb' : 'rp']) / 100);
            } else {
              budget = income(st, 'maison') * envDef.pct;
              approx = true;
            }
            var sp = sum(m3.list.filter(function (e) { return e.envelope === envDef.k; }));
            if (budget > 0 && sp > budget) overMonths.push(m3.mk);
          });
          if (overMonths.length >= 2) {
            lines.push('depassement_recurrent : ' + envDef.label + ' dépassé ' + overMonths.length +
              ' mois sur les 3 derniers (' + overMonths.map(monthLabel).reverse().join(', ') + ')' +
              (approx ? ' [budgets de ces mois recalculés avec le revenu actuel, faute d\'instantané]' : ''));
            proactive.push('depassement_recurrent');
          }
        });
    }

    /* 4. Poids des catégories du mois — sans ça le modèle, à qui tout calcul
       est interdit, ne peut pas répondre « c'est quoi ma plus grosse
       catégorie ? ». */
    var month = inMonth(mk);
    if (month.length >= 5) {
      var byCat = {};
      month.forEach(function (e) {
        var c = String(e.category || 'autre');
        byCat[c] = (byCat[c] || 0) + (Number(e.amount) || 0);
      });
      var totalM = sum(month);
      var top = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; }).slice(0, 3);
      if (totalM > 0) {
        lines.push('top_categories_du_mois : ' + top.map(function (c) {
          return c + ' ' + Math.round(byCat[c] / totalM * 100) + '% (' + Math.round(byCat[c]) + ' TND)';
        }).join(', '));
      }
    }

    /* Les lignes restent toutes lisibles — on peut y répondre si on le
       demande. Seule la mention SPONTANÉE est limitée à une fois par
       semaine, d'où les clés rendues à l'appelant. */
    var fresh = proactive.filter(function (n) { return seen.indexOf('insight:' + n + '|' + week) === -1; });
    return {
      lines: lines,
      proactive: fresh,
      keys: fresh.map(function (n) { return 'insight:' + n + '|' + week; })
    };
  }

  function build(data, today, seen) {
    var st = (data && data.settings) || {};
    var expenses = records(data, 'expenses');
    var debts = records(data, 'debts').map(migrateDebt);
    var nm = names(st);
    var seenKeys = Array.isArray(seen) ? seen : [];

    /* Le bloc du foyer est le seul auquel on répond par défaut : sans ce
       marquage, le modèle passait d'un bloc à l'autre au fil de la
       conversation et annonçait tour à tour deux dépassements différents,
       tous deux exacts mais jamais sur le même périmètre. */
    var scopes = nm.solo
      ? [{ k: 'maison', label: 'TOTAL' }]
      : [{ k: 'maison', label: 'FOYER (les deux ensemble) — BLOC PAR DÉFAUT, RÉPONDS AVEC CELUI-CI' },
        { k: 'sofiene', label: nm.n1 + ' seul — uniquement si le message parle de ' + nm.n1 },
        { k: 'zeineb', label: nm.n2 + ' seule — uniquement si le message parle de ' + nm.n2 }];

    var blocks = scopes.map(function (sc) {
      var f = figures(data, sc.k, today);
      var lines = ['[' + sc.label + '] revenu du mois : ' + f.income + ' TND'];
      f.envelopes.forEach(function (e) { lines.push('  ' + envLine(e)); });
      lines.push('  Total à dépenser (charges & courses + perso) : budget ' + Math.round(f.budget) +
        ' TND | déjà dépensé ' + Math.round(f.spent) + ' TND | ' +
        (f.over
          ? 'DÉPASSÉ DE ' + Math.round(-f.remain) + ' TND — il ne reste RIEN (reste = 0 TND)'
          : 'il reste exactement ' + Math.round(f.remain) + ' TND'));
      if (sc.k === 'maison') {
        lines.push('  Rythme : ' + f.perDay + ' TND par jour jusqu\'à la fin du mois (' +
          f.daysLeft + ' jours restants)');
        lines.push('  Projection fin de mois au rythme actuel : ' + f.projection +
          ' TND dépensés pour un budget de ' + Math.round(f.budget) + ' TND' +
          (f.projection > Math.round(f.budget)
            ? ' — soit ' + (f.projection - Math.round(f.budget)) + ' TND de trop'
            : ' — soit ' + (Math.round(f.budget) - f.projection) + ' TND de marge'));
      }
      return lines.join('\n');
    });

    var nudge = categoryNudge(monthExpenses(expenses, 'maison', today), today, seenKeys);
    var tend = insights(data, today, seenKeys);

    var list = monthExpenses(expenses, 'maison', today).map(function (e) {
      var lbl = whoLabel(nm, e.who) || e.who;
      return e.id + ' | ' + e.date + ' | ' + lbl + ' | ' + e.envelope + ' | ' + e.category +
        ' | ' + e.amount + ' TND | ' + e.label;
    });

    var debtList = debts.filter(function (d) { return d && !d.settled; }).map(function (d) {
      return d.id + ' | ' + d.type + ' | ' + d.person + ' | ' + d.amount + ' TND | ' + d.who +
        ' | échéance ' + (d.date || 'aucune') + (d.label ? ' | ' + d.label : '');
    });

    var text = 'FAITS CHIFFRÉS — déjà calculés, exacts, à recopier tels quels.\n' +
      'date_du_jour : ' + today + '\n' +
      blocks.join('\n') + '\n' +
      'Épargne maison : ' + (Number(st.saved) || 0) + ' TND mis de côté sur un objectif de ' +
      (Number(st.goal) || 0) + ' TND\n' +
      (nudge ? nudge.line + '\n' : '') +
      (tend.lines.length
        ? 'TENDANCES (calculées à partir de l\'historique réel, jamais devinées) :\n' +
          tend.lines.join('\n') + '\n'
        : '') +
      ((tend.proactive.length || nudge)
        ? 'a_signaler_spontanement : ' +
          tend.proactive.concat(nudge ? ['categorie_en_hausse'] : []).join(', ') + '\n'
        : '') +
      'Dépenses du mois (id | date | qui | enveloppe | catégorie | montant | libellé) :\n' +
      (list.length ? list.join('\n') : 'aucune') + '\n' +
      'Dettes/factures en attente (id | type owe/due | personne | montant | concerne | échéance) :\n' +
      (debtList.length ? debtList.join('\n') : 'aucune');

    return {
      text: text,
      /* Clés de ce qui vient d'être servi spontanément : le client les
         mémorise pour qu'on ne le répète pas au message suivant. */
      nudgeKeys: tend.keys.concat(nudge ? [nudge.key] : [])
    };
  }

  return { build: build, figures: figures, insights: insights, isoMonday: isoMonday };
}));
