// /api/get-matches.js
const supabase = require('../services/db');
const { parseData } = require('../utils/stats.js');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const competitionIdParam = req.query?.competitionId
      ? parseInt(req.query.competitionId, 10)
      : undefined;
    const playerIdParam = req.query?.playerId
      ? parseInt(req.query.playerId, 10)
      : undefined;

    let effectiveCompetitionId = competitionIdParam;

    // 2) Se non c'è competitionId, prova a dedurlo dal player
    if (!effectiveCompetitionId) {
      if (!playerIdParam) {
        // nessun modo per dedurre la competition
        return res.status(200).json({
          players: [],
          matches: [],
          wins: {},
          totPlayed: 0,
          points: {},
          monthlyWinRates: {},
          badges: [],
          not_available: {
            it: 'Nessuna competizione associata al giocatore.',
            en: 'No competition found for this player.',
          },
        });
      }

      // Trova le competition a cui è iscritto il player e prendi la più recente
      const { data: compsPlayers, error: cpErr } = await supabase
        .from('competitions_players')
        .select('competition_id')
        .eq('player_id', playerIdParam);

      if (cpErr) throw cpErr;

      if (!compsPlayers || compsPlayers.length === 0) {
        return res.status(200).json({
          players: [],
          matches: [],
          wins: {},
          totPlayed: 0,
          points: {},
          monthlyWinRates: {},
          badges: [],
          not_available: {
            it: 'Nessuna competizione trovata per il giocatore.',
            en: 'No competitions found for this player.',
          },
        });
      }

      const compIds = compsPlayers.map((r) => r.competition_id);

      // Prendi la più recente (updated_at DESC, poi created_at DESC)
      const { data: latestComp, error: compErr } = await supabase
        .from('competitions')
        .select('id, updated_at, created_at')
        .in('id', compIds)
        .order('updated_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();

      if (compErr) throw compErr;

      if (!latestComp?.id) {
        return res.status(200).json({
          players: [],
          matches: [],
          wins: {},
          totPlayed: 0,
          points: {},
          monthlyWinRates: {},
          badges: [],
          not_available: {
            it: 'Nessuna competizione recente trovata.',
            en: 'No recent competition found.',
          },
        });
      }

      effectiveCompetitionId = latestComp.id;
    }

    // 1/2) A questo punto ho sempre effectiveCompetitionId
    const { data: competition, error: competitionError } = await supabase
      .from('competitions')
      .select('id, type')
      .eq('id', effectiveCompetitionId)
      .maybeSingle();

    if (competitionError) throw competitionError;

    const includeGroupId =
      (competition?.type || '').toLowerCase() === 'group_knockouts';

    const { data: matches, error: matchesError } = await supabase
      .from('matches')
      .select(
        `
        id,
        player1_id,
        player2_id,
        player1_score,
        player2_score,
        competition_id,
        group_id,
        created,
        date,
        match_sets (id, match_id, player1_score, player2_score)
      `
      )
      .eq('competition_id', effectiveCompetitionId)
      .order('created', { ascending: false });

    if (matchesError) throw matchesError;

    // Prendi i player coinvolti in un solo colpo
    const playerIds = Array.from(
      new Set(
        (matches || []).flatMap((m) => [m.player1_id, m.player2_id]).filter(Boolean)
      )
    );

    let players = [];
    if (playerIds.length) {
      const { data: playersData, error: playersError } = await supabase
        .from('players')
        .select('id, name, image_url, nickname')
        .in('id', playerIds);

      if (playersError) throw playersError;
      players = playersData || [];
    }

    const playerMap = Object.fromEntries(
      players.map((p) => [p.id, { nickname: p.nickname, image: p.image_url }])
    );

    const formattedMatches = (matches || []).map((match) => {
      const { group_id, ...rest } = match;
      const baseMatch = {
        player1_name: playerMap[match.player1_id]?.nickname || 'Unknown Player',
        player2_name: playerMap[match.player2_id]?.nickname || 'Unknown Player',
        player1_img: playerMap[match.player1_id]?.image || null,
        player2_img: playerMap[match.player2_id]?.image || null,
        ...rest,
        match_sets: Array.isArray(match.match_sets) ? match.match_sets : [],
      };

      if (includeGroupId) {
        baseMatch.groupId = group_id || null;
      }

      return baseMatch;
    });

    const { wins, totPlayed, points, monthlyWinRates, badges } = parseData(formattedMatches);

    return res.status(200).json({
      competitionId: effectiveCompetitionId,
      players,
      matches: formattedMatches,
      wins,
      totPlayed,
      points,
      monthlyWinRates,
      badges,
    });
  } catch (error) {
    console.error('Error fetching matches or players:', error?.message || error);
    return res.status(500).json({ error: 'Failed to fetch match or player data.' });
  }
};
