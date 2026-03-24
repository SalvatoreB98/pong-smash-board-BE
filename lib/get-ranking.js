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
        image_url: p.image_url,
        birth_date: p.birth_date,
        description: p.description,
        play_style: p.play_style,
        racket_blade: p.racket_blade,
        racket_rubber_fh: p.racket_rubber_fh,
        racket_rubber_bh: p.racket_rubber_bh,
        handedness: p.handedness
      }])
    );

    const stats = {};

    // Generate stats for given matches
    matches.forEach((match) => {
      const { competition_id: compId, player1_id: p1, player2_id: p2, player1_score: s1, player2_score: s2 } = match;
      if (s1 === null || s2 === null) return; // Skip incomplete matches

      const key1 = `${compId}-${p1}`;
      const key2 = `${compId}-${p2}`;

      if (!stats[key1]) stats[key1] = { player_id: p1, competition_id: compId, played: 0, wins: 0, elo: 1000, history: [], form: [] };
      if (!stats[key2]) stats[key2] = { player_id: p2, competition_id: compId, played: 0, wins: 0, elo: 1000, history: [], form: [] };

      stats[key1].played += s1 + s2;
      stats[key2].played += s1 + s2;
      
      stats[key1].wins += s1;
      stats[key2].wins += s2;

      // ELO Calculation
      let p1Result = 0.5;
      let p2Result = 0.5;
      if (s1 > s2) {
        p1Result = 1;
        p2Result = 0;
      } else if (s2 > s1) {
        p1Result = 0;
        p2Result = 1;
      }

      const elo1 = stats[key1].elo;
      const elo2 = stats[key2].elo;

      const expected1 = 1 / (1 + Math.pow(10, (elo2 - elo1) / 400));
      const expected2 = 1 / (1 + Math.pow(10, (elo1 - elo2) / 400));

      const K = 32;
      stats[key1].elo = elo1 + K * (p1Result - expected1);
      stats[key2].elo = elo2 + K * (p2Result - expected2);

      // Record history
      const matchDate = match.date || match.created;
      stats[key1].history.push({ date: matchDate, elo: Math.round(stats[key1].elo) });
      stats[key2].history.push({ date: matchDate, elo: Math.round(stats[key2].elo) });

      // Record form
      if (p1Result === 1) stats[key1].form.push('W');
      else if (p1Result === 0) stats[key1].form.push('L');
      else stats[key1].form.push('D');

      if (p2Result === 1) stats[key2].form.push('W');
      else if (p2Result === 0) stats[key2].form.push('L');
      else stats[key2].form.push('D');
    });

    // Also fetch competitions_players to ensure all registered players are included with 0 played
    let cpQuery = supabase.from('competitions_players').select('competition_id, player_id');
    if (competition_id !== undefined) {
      cpQuery = cpQuery.eq('competition_id', Number(competition_id));
    }
    const { data: cpData, error: cpError } = await cpQuery;
    
    if (!cpError && cpData) {
      cpData.forEach((cp) => {
        const key = `${cp.competition_id}-${cp.player_id}`;
        if (!stats[key]) {
          stats[key] = { player_id: cp.player_id, competition_id: cp.competition_id, played: 0, wins: 0, elo: 1000, history: [], form: [] };
        }
      });
    }

    let ranking = Object.values(stats).map((stat) => {
      const player = playerMap[stat.player_id] || {};
      const winrate = stat.played > 0 ? (stat.wins / stat.played) * 100 : 0;
      
      return {
        competition_id: stat.competition_id,
        playerid: stat.player_id,
        name: player.name || player.nickname || 'Player',
        image_url: player.image_url || null,
        played: stat.played,
        wins: stat.wins,
        winrate: Number(winrate.toFixed(1)),
        rating: Math.round(stat.elo),
        nickname: player.nickname || 'Player',
        history: stat.history,
        form: stat.form.slice(-5)
      };
    });

    // Sort by rating DESC, then winrate DESC, then wins DESC, then played DESC
    ranking.sort((a, b) => {
      if (a.competition_id !== b.competition_id) return a.competition_id - b.competition_id;
      if (b.rating !== a.rating) return b.rating - a.rating;
      if (b.winrate !== a.winrate) return b.winrate - a.winrate;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return b.played - a.played;
    });

    res.setHeader('Cache-Control', 'public, no-cache, no-store, must-revalidate');
    res.setHeader('Vary', 'competition_id');

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
