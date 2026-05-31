/**
 * Maply — relatório Premium (browser, espelha lib/premium-report.js)
 */
(function (global) {
  const UF_NAMES = {
    AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará',
    DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão',
    MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará',
    PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro',
    RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima',
    SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins'
  };

  function normalizeUf(uf) {
    if (!uf) return null;
    const u = String(uf).trim().toUpperCase();
    return u.length === 2 ? u : null;
  }

  function inferUf(row) {
    const direct = normalizeUf(row.uf);
    if (direct) return direct;
    const loc = String(row.localidade || row.bairro || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (loc.includes('florianopolis')) return 'SC';
    if (loc.includes('sao paulo')) return 'SP';
    if (loc.includes('rio de janeiro')) return 'RJ';
    return 'SC';
  }

  function locationKey(row) {
    const uf = inferUf(row);
    const bairro = String(row.bairro || 'Sem bairro').trim();
    const cidade = String(row.localidade || bairro).trim();
    return { uf, bairro, cidade, key: `${uf}|${cidade}|${bairro}` };
  }

  function isGrave(row) {
    return row.severidade === 'alta' || (row.severidade === 'media' && row.status !== 'resolvido');
  }

  function buildEstadosList(estadosComDados) {
    return Object.keys(UF_NAMES)
      .sort((a, b) => UF_NAMES[a].localeCompare(UF_NAMES[b], 'pt-BR'))
      .map(uf => ({
        uf,
        nome: UF_NAMES[uf],
        comDados: estadosComDados.has(uf)
      }));
  }

  function buildPremiumReport(rows, selectedUf) {
    const enriched = (rows || []).map(row => ({
      ...row,
      uf: inferUf(row),
      severidade: row.severidade || 'media',
      status: row.status || 'aberto'
    }));

    const estadosComDados = new Set(enriched.map(r => r.uf));
    const estados = buildEstadosList(estadosComDados);

    const requested = normalizeUf(selectedUf);
    const uf = requested && UF_NAMES[requested] ? requested : (estadosComDados.has('SC') ? 'SC' : 'SC');

    const inState = enriched.filter(r => r.uf === uf);
    const byPlace = new Map();

    inState.forEach(row => {
      const { key, bairro, cidade } = locationKey(row);
      if (!byPlace.has(key)) {
        byPlace.set(key, {
          uf, bairro, cidade,
          local: `${bairro}, ${cidade}`,
          total: 0, aberto: 0, analise: 0, resolvido: 0,
          alta: 0, media: 0, baixa: 0, graves: 0, pendentesGraves: 0, itens: []
        });
      }
      const place = byPlace.get(key);
      place.total += 1;
      if (row.status === 'aberto') place.aberto += 1;
      if (row.status === 'analise') place.analise += 1;
      if (row.status === 'resolvido') place.resolvido += 1;
      if (row.severidade === 'alta') place.alta += 1;
      if (row.severidade === 'media') place.media += 1;
      if (row.severidade === 'baixa') place.baixa += 1;
      if (isGrave(row)) {
        place.graves += 1;
        if (row.status !== 'resolvido') place.pendentesGraves += 1;
      }
      place.itens.push(row);
    });

    const places = [...byPlace.values()].map(p => {
      const dangerScore = Math.round(
        p.alta * 8 + p.pendentesGraves * 5 + p.aberto * 3 + p.analise * 2 + p.media * 1
      );
      const ocorrenciasGraves = p.itens
        .filter(i => i.severidade === 'alta' || (i.severidade === 'media' && i.status === 'aberto'))
        .sort((a, b) => (a.severidade === 'alta' ? -1 : 1))
        .slice(0, 5)
        .map(i => ({
          id: i.id,
          tipo: i.tipo,
          severidade: i.severidade,
          status: i.status,
          local: i.local || i.bairro
        }));

      return {
        ...p,
        dangerScore,
        risco: dangerScore >= 40 ? 'critico' : dangerScore >= 22 ? 'alto' : dangerScore >= 10 ? 'moderado' : 'baixo',
        ocorrenciasGraves
      };
    });

    const topPerigosos = places
      .sort((a, b) => b.dangerScore - a.dangerScore || b.graves - a.graves)
      .slice(0, 10)
      .map((p, idx) => ({
        rank: idx + 1,
        local: p.local,
        bairro: p.bairro,
        cidade: p.cidade,
        uf: p.uf,
        dangerScore: p.dangerScore,
        risco: p.risco,
        graves: p.graves,
        pendentesGraves: p.pendentesGraves,
        total: p.total,
        aberto: p.aberto,
        analise: p.analise,
        resolvido: p.resolvido,
        ocorrenciasGraves: p.ocorrenciasGraves
      }));

    const total = inState.length;
    const aberto = inState.filter(r => r.status === 'aberto').length;
    const analise = inState.filter(r => r.status === 'analise').length;
    const resolvido = inState.filter(r => r.status === 'resolvido').length;
    const alta = inState.filter(r => r.severidade === 'alta').length;
    const media = inState.filter(r => r.severidade === 'media').length;
    const baixa = inState.filter(r => r.severidade === 'baixa').length;
    const pendentesGraves = inState.filter(r => isGrave(r) && r.status !== 'resolvido').length;
    const bairrosAfetados = new Set(inState.map(r => locationKey(r).bairro)).size;
    const taxaResolucao = total ? Math.round((resolvido / total) * 100) : 0;
    const locaisCriticos = places.filter(p => p.dangerScore >= 22).length;

    const indicadores = [
      { id: 'total', label: 'Total de ocorrências', value: total, hint: `Registradas em ${UF_NAMES[uf] || uf}`, icon: 'fa-clipboard-list', tone: 'acid' },
      { id: 'aberto', label: 'Em aberto', value: aberto, hint: 'Aguardam ação', icon: 'fa-circle', tone: 'red' },
      { id: 'analise', label: 'Em análise', value: analise, hint: 'Em triagem pela gestão', icon: 'fa-clock', tone: 'orange' },
      { id: 'resolvido', label: 'Resolvidas', value: resolvido, hint: 'Encerradas com sucesso', icon: 'fa-check-circle', tone: 'green' },
      { id: 'taxa', label: 'Taxa de resolução', value: `${taxaResolucao}%`, hint: 'Resolvidas ÷ total', icon: 'fa-percent', tone: 'acid' },
      { id: 'alta', label: 'Severidade alta', value: alta, hint: 'Risco elevado', icon: 'fa-triangle-exclamation', tone: 'red' },
      { id: 'media', label: 'Severidade média', value: media, hint: 'Impacto moderado', icon: 'fa-circle-half-stroke', tone: 'orange' },
      { id: 'baixa', label: 'Severidade baixa', value: baixa, hint: 'Menor urgência', icon: 'fa-circle-check', tone: 'green' },
      { id: 'pendentes', label: 'Graves pendentes', value: pendentesGraves, hint: 'Alta/média não resolvidas', icon: 'fa-bolt', tone: 'red' },
      { id: 'criticos', label: 'Locais de risco alto', value: locaisCriticos, hint: `Em ${bairrosAfetados} bairros monitorados`, icon: 'fa-map-location-dot', tone: 'orange' }
    ];

    return {
      uf,
      estadoNome: UF_NAMES[uf] || uf,
      estados,
      topPerigosos,
      indicadores,
      resumo: { total, aberto, analise, resolvido, bairrosAfetados, taxaResolucao }
    };
  }

  global.buildPremiumReport = buildPremiumReport;
  global.UF_NAMES = UF_NAMES;
})(typeof window !== 'undefined' ? window : globalThis);
