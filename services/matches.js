// services/matches.js
const supabase = require('./db');
const { parseData } = require('../utils/stats.js');

async function fetchCompetitionData(competitionId) {
    const { data: competition, error: competitionError } = await supabase
        .from('competitions')
        .select('id, type')
        .eq('id', competitionId)
        .maybeSingle();

    if (competitionError) throw competitionError;

    const includeGroupId =
        (competition?.type || '').toLowerCase() === 'group_knockouts';

    // matches
    const { data: matches, error: matchesError } = await supabase
        .from('matches')
        .select(`
      id,
      player1_id,
      player2_id,
      player1_score,
      player2_score,
      competition_id,
      group_id,
      created,
      match_sets (id, match_id, player1_score, player2_score)
    `)
        .eq('competition_id', competitionId)
        .order('created', { ascending: false });

    if (matchesError) throw matchesError;

    // players
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

    const { wins, totPlayed, points, monthlyWinRates, badges } =
        parseData(formattedMatches);

    return {
        competitionId,
        players,
        matches: formattedMatches,
        wins,
        totPlayed,
        points,
        monthlyWinRates,
        badges,
    };
}

module.exports = { fetchCompetitionData };
