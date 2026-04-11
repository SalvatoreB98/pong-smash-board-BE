const supabase = require('../services/db');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  try {
    const { competition_id } = req.query;

    let matchesQuery = supabase
      .from('matches')
      .select('competition_id, player1_id, player2_id, player1_score, player2_score, created, date')
      .not('created', 'is', null)
      .order('created', { ascending: true });

    if (competition_id !== undefined) {
      const id = Number(competition_id);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ error: 'competition_id deve essere un numero > 0' });
      }
      matchesQuery = matchesQuery.eq('competition_id', id);
    }

    const { data: matches, error: matchesError } = await matchesQuery;
    if (matchesError) throw matchesError;

    const { data: players, error: playersError } = await supabase
      .from('players')
      .select('id, name, lastname, nickname, image_url, birth_date, description, play_style, racket_blade, racket_rubber_fh, racket_rubber_bh, handedness');
    if (playersError) throw playersError;

    const playerMap = Object.fromEntries(
      players.map((p) => [p.id, { 
        name: p.name, 
        lastname: p.lastname, 
        nickname: p.nickname, 
        image_url: p.image_url 
      }])
    );

    const stats = {};

    matches.forEach((match) => {
      // FIX 1: Estrazione variabili necessaria
      const { competition_id: compId, player1_id: p1, player2_id: p2, player1_score: s1, player2_score: s2 } = match;
      if (s1 === null || s2 === null) return;

      const key1 = `${compId}-${p1}`;
      const key2 = `${compId}-${p2}`;

      // Inizializzazione con draws e losses
      if (!stats[key1]) stats[key1] = { player_id: p1, competition_id: compId, played: 0, wins: 0, draws: 0, losses: 0, elo: 1000, history: [], form: [] };
      if (!stats[key2]) stats[key2] = { player_id: p2, competition_id: compId, played: 0, wins: 0, draws: 0, losses: 0, elo: 1000, history: [], form: [] };

      stats[key1].played += 1;
      stats[key2].played += 1;

      let p1Result, p2Result;

      if (s1 > s2) {
        p1Result = 1; p2Result = 0;
        stats[key1].wins += 1;
        stats[key2].losses += 1;
        stats[key1].form.push('W');
        stats[key2].form.push('L');
      } else if (s2 > s1) {
        p1Result = 0; p2Result = 1;
        stats[key2].wins += 1;
        stats[key1].losses += 1;
        stats[key1].form.push('L');
        stats[key2].form.push('W');
      } else {
        p1Result = 0.5; p2Result = 0.5;
        stats[key1].draws += 1;
        stats[key2].draws += 1;
        stats[key1].form.push('D');
        stats[key2].form.push('D');
      }

      const elo1 = stats[key1].elo;
      const elo2 = stats[key2].elo;
      const expected1 = 1 / (1 + Math.pow(10, (elo2 - elo1) / 400));
      const expected2 = 1 / (1 + Math.pow(10, (elo1 - elo2) / 400));

      const K = 32;
      stats[key1].elo = elo1 + K * (p1Result - expected1);
      stats[key2].elo = elo2 + K * (p2Result - expected2);

      const matchDate = match.date || match.created;
      const r1 = s1 > s2 ? 'W' : s2 > s1 ? 'L' : 'D';
      const r2 = s2 > s1 ? 'W' : s1 > s2 ? 'L' : 'D';

      stats[key1].history.push({ date: matchDate, elo: Math.round(stats[key1].elo), result: r1 });
      stats[key2].history.push({ date: matchDate, elo: Math.round(stats[key2].elo), result: r2 });
    });

    // Registrazione giocatori senza match
    let cpQuery = supabase.from('competitions_players').select('competition_id, player_id');
    if (competition_id !== undefined) cpQuery = cpQuery.eq('competition_id', Number(competition_id));
    
    const { data: cpData, error: cpError } = await cpQuery;
    if (!cpError && cpData) {
      cpData.forEach((cp) => {
        const key = `${cp.competition_id}-${cp.player_id}`;
        if (!stats[key]) {
          // FIX 2: Aggiunto draws: 0, losses: 0 per coerenza
          stats[key] = { player_id: cp.player_id, competition_id: cp.competition_id, played: 0, wins: 0, draws: 0, losses: 0, elo: 1000, history: [], form: [] };
        }
      });
    }

    let ranking = Object.values(stats).map((stat) => {
      const player = playerMap[stat.player_id] || {};
      // Calcolo winrate (vittorie / giocate)
      const winrate = stat.played > 0 ? (stat.wins / stat.played) * 100 : 0;
      
      return {
        competition_id: stat.competition_id,
        playerid: stat.player_id,
        name: player.name || player.nickname || 'Player',
        image_url: player.image_url || null,
        played: stat.played,
        wins: stat.wins,
        draws: stat.draws,
        losses: stat.losses,
        winrate: Number(winrate.toFixed(1)),
        rating: Math.round(stat.elo),
        history: stat.history,
        form: stat.form.slice(-5)
      };
    });

    ranking.sort((a, b) => {
      if (a.competition_id !== b.competition_id) return a.competition_id - b.competition_id;
      if (b.rating !== a.rating) return b.rating - a.rating;
      return b.winrate - a.winrate;
    });

    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    return res.status(200).json({
      competition_id: competition_id ? Number(competition_id) : null,
      ranking,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('Ranking API error:', e);
    return res.status(500).json({ error: 'Failed to fetch ranking' });
  }
};